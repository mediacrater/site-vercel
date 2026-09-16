# Mediacrater — Server-Authoritative Batch Security Hardening

**Date:** September 15, 2026  
**File:** `batching-server-hardening-15sept26.md`  
**Status:** Implementation guide for TEST first  
**Scope:** Harden the existing paid client-side batching feature so the browser is never the authority for batch entitlement, batch size, batch creation, batch positions, duplicate-position reuse, or the post-batch cooldown.

---

# 1. Final trust model

Keep the existing browser-side controls. They are useful UX friction and catch normal mistakes, but they are not security boundaries.

The hardened model is:

```text
Browser
  ├─ shows only the allowed number of creatives
  ├─ performs local frame/audio/image preparation
  ├─ requests a batch from the VPS
  └─ is NOT trusted for entitlement, size, batch identity,
     position reuse, or cooldown state

VPS
  ├─ authenticates every request
  ├─ reads batch entitlement from profiles
  ├─ creates the authoritative batch
  ├─ creates the exact permitted positions
  ├─ validates every child scan against that batch
  ├─ atomically claims each position before expensive AI work
  ├─ marks each item terminal server-side
  ├─ finalizes the batch server-side
  └─ sets a 60-second post-batch scan cooldown

Supabase
  ├─ profiles = account entitlement + cooldown source of truth
  ├─ scan_batches = batch-level source of truth
  ├─ scan_batch_items = exact per-position source of truth
  └─ scans = actual analysis/result rows
```

A modified browser, DevTools request, cURL request, or rewritten frontend must not allow:

- a free account to create a batch;
- a paid account to exceed its server-side `batch_limit`;
- the browser to create its own authoritative `scan_batches` row;
- a user to execute position 1 repeatedly to get more than the authorized number of creatives;
- a user to submit a solo scan while an active batch exists;
- two active batches for one account;
- a new solo scan or batch during the 60-second post-batch cooldown;
- an authenticated browser client to modify `batching_enabled`, `batch_limit`, or `batch_cooldown_until`.

---

# 2. Existing defenses that stay

Do not remove the controls already implemented:

```text
Frontend MAX_BATCH_FILES = 5
Existing 5-second visible delay between batch creatives
scan_batches.total_creatives CHECK 2..5
scans.batch_position CHECK 1..5
Authenticated VPS scan routes
Per-user queue / duplicate active scan protection
Per-scan allowance checks
/scan-video request limiter
/scan-image request limiter
Batch ownership checks
```

The existing limits remain useful defense in depth.

The gap being closed is that a range check alone cannot prove a valid position was used only once:

```text
authorized positions:
1 2 3 4 5

malicious replay:
1 1 1 1 1 ...
```

`scan_batch_items` fixes this by creating exactly one authoritative row for every allowed position and allowing `pending -> processing` only once.

---

# 3. Files

## New VPS file

```text
routes/batchControl.js
```

## Existing VPS files modified

```text
routes/_shared/resolveClientBatch.js
routes/scanImage.js
routes/scanVideo.js
server.js
```

## Existing website files modified

```text
lib/mediacrater/scanApi.ts
components/scan-workspace.tsx
```

Optional visibility-only update:

```text
app/scan-history/page.tsx
```

No batching-specific increase is needed for the existing scan endpoint limits.

---

# 4. Supabase migration

Run this in TEST first.

## 4.1 Account-level batch entitlement

```sql
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS batching_enabled boolean
NOT NULL DEFAULT false;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS batch_limit smallint
NOT NULL DEFAULT 5;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS batch_cooldown_until timestamptz NULL;

ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_batch_limit_check;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_batch_limit_check
CHECK (batch_limit BETWEEN 2 AND 5);
```

The desired state is:

```text
FREE
batching_enabled = false
batch_limit       = 5

PAID
batching_enabled = true
batch_limit       = 5
```

The numeric limit is irrelevant while `batching_enabled = false`.

### Backfill existing paid accounts

```sql
UPDATE public.profiles
SET
  batching_enabled = true,
  batch_limit = 5
WHERE plan <> 'free';

UPDATE public.profiles
SET
  batching_enabled = false,
  batch_limit = 5,
  batch_cooldown_until = NULL
WHERE plan = 'free';
```

---

## 4.2 Automatically synchronize batching with trusted plan changes

This avoids having multiple payment paths forget to set the new feature flag.

The existing trusted backend already changes `profiles.plan` when a subscription becomes paid/free. The database can make batching follow that entitlement transition.

```sql
CREATE OR REPLACE FUNCTION public.sync_batching_entitlement_from_plan()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    IF COALESCE(NEW.plan, 'free') = 'free' THEN
      NEW.batching_enabled := false;
      NEW.batch_limit := 5;
      NEW.batch_cooldown_until := NULL;
    ELSE
      NEW.batching_enabled := true;
      NEW.batch_limit := 5;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_batching_entitlement_from_plan_trigger
ON public.profiles;

CREATE TRIGGER sync_batching_entitlement_from_plan_trigger
BEFORE UPDATE OF plan
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_batching_entitlement_from_plan();
```

This assumes the existing plan values use `free` for the non-paid entitlement state. If the billing system has other non-entitled plan strings, use the existing paid-plan allowlist instead of `plan <> 'free'`.

A subscription that is cancelled but remains paid until its actual end date should keep its paid `plan` value until the existing billing lifecycle really transitions it to free.

---

## 4.3 Block browser writes to entitlement/security columns

Protect the existing `plan` field too. Otherwise a weak profile UPDATE policy could allow a user to change `plan`, which would legitimately trigger `batching_enabled = true`.

```sql
CREATE OR REPLACE FUNCTION public.protect_server_managed_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF
      NEW.plan IS DISTINCT FROM OLD.plan
      OR NEW.batching_enabled IS DISTINCT FROM OLD.batching_enabled
      OR NEW.batch_limit IS DISTINCT FROM OLD.batch_limit
      OR NEW.batch_cooldown_until IS DISTINCT FROM OLD.batch_cooldown_until
    THEN
      RAISE EXCEPTION
        'Server-managed profile fields cannot be changed by the client';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_server_managed_profile_fields_trigger
ON public.profiles;

CREATE TRIGGER protect_server_managed_profile_fields_trigger
BEFORE UPDATE
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_server_managed_profile_fields();
```

The VPS and Stripe/subscription backend use trusted server credentials and remain able to update the fields.

---

## 4.4 Make `scan_batches` a visible lifecycle source of truth

Historical batch rows already represent past finished work. Add lifecycle columns, backfill historical rows, then enforce valid status values.

```sql
ALTER TABLE public.scan_batches
ADD COLUMN IF NOT EXISTS status text;

ALTER TABLE public.scan_batches
ADD COLUMN IF NOT EXISTS started_at timestamptz NULL;

ALTER TABLE public.scan_batches
ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NULL;

ALTER TABLE public.scan_batches
ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL;

UPDATE public.scan_batches
SET
  status = COALESCE(status, 'completed'),
  started_at = COALESCE(started_at, created_at),
  last_activity_at = COALESCE(last_activity_at, created_at),
  completed_at = COALESCE(completed_at, created_at);

ALTER TABLE public.scan_batches
ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE public.scan_batches
ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.scan_batches
DROP CONSTRAINT IF EXISTS scan_batches_status_check;

ALTER TABLE public.scan_batches
ADD CONSTRAINT scan_batches_status_check
CHECK (
  status IN (
    'active',
    'completed',
    'completed_with_errors',
    'failed',
    'cancelled',
    'expired'
  )
);
```

Keep the existing `total_creatives BETWEEN 2 AND 5` constraint.

---

## 4.5 Enforce one active batch per account

This closes the race where two `/batch/start` requests arrive at nearly the same time.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS
scan_batches_one_active_per_user_idx
ON public.scan_batches (user_id)
WHERE status = 'active';
```

---

## 4.6 Add authoritative batch positions

```sql
CREATE TABLE IF NOT EXISTS public.scan_batch_items (
  batch_id uuid NOT NULL
    REFERENCES public.scan_batches(id)
    ON DELETE CASCADE,

  batch_position smallint NOT NULL,

  status text NOT NULL DEFAULT 'pending',

  scan_id uuid NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  completed_at timestamptz NULL,

  error_code text NULL,

  CONSTRAINT scan_batch_items_pkey
    PRIMARY KEY (batch_id, batch_position),

  CONSTRAINT scan_batch_items_position_check
    CHECK (batch_position BETWEEN 1 AND 5),

  CONSTRAINT scan_batch_items_status_check
    CHECK (
      status IN (
        'pending',
        'processing',
        'completed',
        'error',
        'cancelled'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
scan_batch_items_scan_id_unique_idx
ON public.scan_batch_items (scan_id)
WHERE scan_id IS NOT NULL;
```

The primary key guarantees:

```text
one batch + position 1 = exactly one authoritative slot
one batch + position 2 = exactly one authoritative slot
...
```

The unique `scan_id` also prevents one client-generated scan ID from being bound to multiple batch positions.

---

## 4.7 Make batch-control rows server-managed

The browser currently inserts `scan_batches` directly. That behavior is removed in the frontend later in this guide.

Add a DB guard so a modified browser cannot restore the old behavior manually:

```sql
CREATE OR REPLACE FUNCTION public.prevent_client_batch_control_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION
      'Batch control rows are server managed';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS server_manage_scan_batches_trigger
ON public.scan_batches;

CREATE TRIGGER server_manage_scan_batches_trigger
BEFORE INSERT OR UPDATE OR DELETE
ON public.scan_batches
FOR EACH ROW
EXECUTE FUNCTION public.prevent_client_batch_control_writes();

DROP TRIGGER IF EXISTS server_manage_scan_batch_items_trigger
ON public.scan_batch_items;

CREATE TRIGGER server_manage_scan_batch_items_trigger
BEFORE INSERT OR UPDATE OR DELETE
ON public.scan_batch_items
FOR EACH ROW
EXECUTE FUNCTION public.prevent_client_batch_control_writes();
```

For the new `scan_batch_items` table, enable RLS and permit only owner reads if the website ever needs to display these rows:

```sql
ALTER TABLE public.scan_batch_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS
"Users can read own batch items"
ON public.scan_batch_items;

CREATE POLICY
"Users can read own batch items"
ON public.scan_batch_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.scan_batches b
    WHERE b.id = scan_batch_items.batch_id
      AND b.user_id = auth.uid()
  )
);
```

Do not add browser INSERT/UPDATE/DELETE policies for this table.

---

# 5. Replace `routes/_shared/resolveClientBatch.js`

Replace the existing helper with:

```js
// routes/_shared/resolveClientBatch.js

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const HARD_MAX_BATCH_LIMIT = 5;
const POST_BATCH_COOLDOWN_MS = 60 * 1000;

// This is inactivity, not maximum batch duration.
// It prevents a crashed/closed browser from leaving an account
// permanently blocked by an abandoned active batch.
const STALE_BATCH_INACTIVITY_MS =
  90 * 60 * 1000;

const TERMINAL_ITEM_STATUSES =
  new Set([
    'completed',
    'error',
    'cancelled'
  ]);

function failure(
  status,
  error,
  message,
  extra = {}
) {
  return {
    ok: false,
    status,
    body: {
      error,
      message,
      ...extra
    }
  };
}

function invalidBatchMetadata() {
  return failure(
    400,
    'INVALID_BATCH_METADATA',
    'Invalid batch metadata.'
  );
}

function normalizeUuid(value) {
  const normalized =
    typeof value === 'string'
      ? value.trim()
      : '';

  return UUID_PATTERN.test(normalized)
    ? normalized
    : null;
}

function getBatchLimit(profile) {
  const value =
    Number(profile?.batch_limit);

  if (
    !Number.isInteger(value) ||
    value < 2 ||
    value > HARD_MAX_BATCH_LIMIT
  ) {
    return null;
  }

  return value;
}

function getCooldownState(profile) {
  const raw =
    profile?.batch_cooldown_until;

  if (!raw) {
    return {
      active: false,
      remainingSeconds: 0
    };
  }

  const until =
    Date.parse(raw);

  if (
    !Number.isFinite(until) ||
    until <= Date.now()
  ) {
    return {
      active: false,
      remainingSeconds: 0
    };
  }

  return {
    active: true,
    remainingSeconds:
      Math.max(
        1,
        Math.ceil(
          (until - Date.now()) /
            1000
        )
      )
  };
}

function cooldownFailure(profile) {
  const cooldown =
    getCooldownState(profile);

  if (!cooldown.active) {
    return null;
  }

  return failure(
    429,
    'BATCH_COOLDOWN',
    `Please wait ${cooldown.remainingSeconds} second${cooldown.remainingSeconds === 1 ? '' : 's'} before starting another scan.`,
    {
      retryAfterSeconds:
        cooldown.remainingSeconds
    }
  );
}

async function expireStaleActiveBatch({
  supabase,
  userId
}) {
  const {
    data: active,
    error
  } =
    await supabase
      .from('scan_batches')
      .select(
        'id, last_activity_at, started_at'
      )
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

  if (error) {
    throw error;
  }

  if (!active) {
    return null;
  }

  const activityRaw =
    active.last_activity_at ||
    active.started_at;

  const activityTime =
    activityRaw
      ? Date.parse(activityRaw)
      : NaN;

  if (
    Number.isFinite(activityTime) &&
    Date.now() - activityTime <
      STALE_BATCH_INACTIVITY_MS
  ) {
    return active;
  }

  const now =
    new Date().toISOString();

  await supabase
    .from('scan_batch_items')
    .update({
      status: 'cancelled',
      completed_at: now,
      error_code: 'BATCH_EXPIRED'
    })
    .eq('batch_id', active.id)
    .in(
      'status',
      ['pending', 'processing']
    );

  const {
    error: expireError
  } =
    await supabase
      .from('scan_batches')
      .update({
        status: 'expired',
        completed_at: now,
        last_activity_at: now
      })
      .eq('id', active.id)
      .eq('user_id', userId)
      .eq('status', 'active');

  if (expireError) {
    throw expireError;
  }

  return null;
}

async function getActiveBatch({
  supabase,
  userId
}) {
  await expireStaleActiveBatch({
    supabase,
    userId
  });

  const {
    data,
    error
  } =
    await supabase
      .from('scan_batches')
      .select(
        'id, total_creatives, status, last_activity_at'
      )
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

/**
 * Validate a scan request against server-owned batch state.
 *
 * Important:
 * This DOES NOT claim the position. A first request may legitimately
 * receive HTTP 202 because it entered the queue. The position is claimed
 * only after queue admission, immediately before expensive AI work.
 */
async function resolveClientBatch({
  supabase,
  userId,
  profile,
  batchedByClient,
  batchId,
  batchPosition,
  scanId
}) {
  const cooldownError =
    cooldownFailure(profile);

  if (cooldownError) {
    return cooldownError;
  }

  const hasBatchId =
    batchId !== null &&
    batchId !== undefined &&
    batchId !== '';

  const hasBatchPosition =
    batchPosition !== null &&
    batchPosition !== undefined;

  if (batchedByClient !== true) {
    if (
      (
        batchedByClient !== undefined &&
        batchedByClient !== null &&
        batchedByClient !== false
      ) ||
      hasBatchId ||
      hasBatchPosition
    ) {
      return invalidBatchMetadata();
    }

    try {
      const activeBatch =
        await getActiveBatch({
          supabase,
          userId
        });

      if (activeBatch) {
        return failure(
          409,
          'BATCH_IN_PROGRESS',
          'Finish or cancel your current batch before starting a solo scan.'
        );
      }
    } catch (error) {
      console.error(
        '[BATCH SECURITY] Active batch lookup failed:',
        error
      );

      return failure(
        500,
        'BATCH_VALIDATION_FAILED',
        'Unable to validate scan state.'
      );
    }

    return {
      ok: true,
      value: {
        batchedByClient: false,
        batchId: null,
        batchPosition: null,
        scanId: null
      }
    };
  }

  if (
    profile?.batching_enabled !== true
  ) {
    return failure(
      403,
      'BATCH_SCANNING_UNAVAILABLE',
      'Batch scanning is available on paid plans only.'
    );
  }

  const batchLimit =
    getBatchLimit(profile);

  if (!batchLimit) {
    return failure(
      403,
      'BATCH_SCANNING_UNAVAILABLE',
      'Batch scanning is not enabled for this account.'
    );
  }

  const normalizedBatchId =
    normalizeUuid(batchId);

  const normalizedScanId =
    normalizeUuid(scanId);

  if (
    !normalizedBatchId ||
    !normalizedScanId ||
    !Number.isInteger(batchPosition) ||
    batchPosition < 1 ||
    batchPosition > HARD_MAX_BATCH_LIMIT
  ) {
    return invalidBatchMetadata();
  }

  try {
    const {
      data: batch,
      error: batchError
    } =
      await supabase
        .from('scan_batches')
        .select(
          'id, total_creatives, status'
        )
        .eq('id', normalizedBatchId)
        .eq('user_id', userId)
        .maybeSingle();

    if (batchError) {
      throw batchError;
    }

    if (
      !batch ||
      batch.status !== 'active'
    ) {
      return failure(
        409,
        'BATCH_NOT_ACTIVE',
        'This batch is no longer active.'
      );
    }

    if (
      !Number.isInteger(
        batch.total_creatives
      ) ||
      batch.total_creatives < 2 ||
      batch.total_creatives >
        batchLimit ||
      batch.total_creatives >
        HARD_MAX_BATCH_LIMIT ||
      batchPosition >
        batch.total_creatives
    ) {
      return invalidBatchMetadata();
    }

    const {
      data: item,
      error: itemError
    } =
      await supabase
        .from('scan_batch_items')
        .select(
          'batch_position, status'
        )
        .eq(
          'batch_id',
          normalizedBatchId
        )
        .eq(
          'batch_position',
          batchPosition
        )
        .maybeSingle();

    if (itemError) {
      throw itemError;
    }

    if (!item) {
      return invalidBatchMetadata();
    }

    if (item.status !== 'pending') {
      return failure(
        409,
        'BATCH_POSITION_USED',
        'This batch position has already been used.'
      );
    }

    return {
      ok: true,
      value: {
        batchedByClient: true,
        batchId:
          normalizedBatchId,
        batchPosition,
        scanId:
          normalizedScanId
      }
    };
  } catch (error) {
    console.error(
      '[BATCH SECURITY] Batch validation failed:',
      error
    );

    return failure(
      500,
      'BATCH_VALIDATION_FAILED',
      'Unable to validate scan batch.'
    );
  }
}

async function claimBatchItem({
  supabase,
  batchMeta
}) {
  if (
    !batchMeta?.batchedByClient
  ) {
    return {
      ok: true,
      claimed: false
    };
  }

  const now =
    new Date().toISOString();

  const {
    data,
    error
  } =
    await supabase
      .from('scan_batch_items')
      .update({
        status: 'processing',
        scan_id:
          batchMeta.scanId,
        started_at: now,
        error_code: null
      })
      .eq(
        'batch_id',
        batchMeta.batchId
      )
      .eq(
        'batch_position',
        batchMeta.batchPosition
      )
      .eq('status', 'pending')
      .select(
        'batch_id, batch_position'
      )
      .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return failure(
        409,
        'BATCH_SCAN_ID_REUSED',
        'This scan identifier has already been used.'
      );
    }

    console.error(
      '[BATCH SECURITY] Position claim failed:',
      error
    );

    return failure(
      500,
      'BATCH_CLAIM_FAILED',
      'Unable to claim batch position.'
    );
  }

  if (!data) {
    return failure(
      409,
      'BATCH_POSITION_USED',
      'This batch position has already been used.'
    );
  }

  await supabase
    .from('scan_batches')
    .update({
      last_activity_at: now
    })
    .eq(
      'id',
      batchMeta.batchId
    )
    .eq('status', 'active');

  return {
    ok: true,
    claimed: true
  };
}

async function finalizeBatchIfDone({
  supabase,
  batchId,
  userId
}) {
  const {
    data: items,
    error
  } =
    await supabase
      .from('scan_batch_items')
      .select('status')
      .eq('batch_id', batchId);

  if (error) {
    console.error(
      '[BATCH SECURITY] Finalization lookup failed:',
      error
    );
    return;
  }

  if (
    !items ||
    items.length === 0 ||
    items.some(
      (item) =>
        !TERMINAL_ITEM_STATUSES.has(
          item.status
        )
    )
  ) {
    return;
  }

  const completedCount =
    items.filter(
      (item) =>
        item.status ===
        'completed'
    ).length;

  const terminalStatus =
    completedCount === items.length
      ? 'completed'
      : completedCount === 0
      ? 'failed'
      : 'completed_with_errors';

  const now =
    new Date();

  const cooldownUntil =
    new Date(
      now.getTime() +
        POST_BATCH_COOLDOWN_MS
    ).toISOString();

  const {
    data: finalized,
    error: finalizeError
  } =
    await supabase
      .from('scan_batches')
      .update({
        status: terminalStatus,
        completed_at:
          now.toISOString(),
        last_activity_at:
          now.toISOString()
      })
      .eq('id', batchId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .select('id')
      .maybeSingle();

  if (finalizeError) {
    console.error(
      '[BATCH SECURITY] Batch finalization failed:',
      finalizeError
    );
    return;
  }

  // Only the request that actually changed active -> terminal
  // is allowed to set the cooldown.
  if (!finalized) {
    return;
  }

  const {
    error: cooldownError
  } =
    await supabase
      .from('profiles')
      .update({
        batch_cooldown_until:
          cooldownUntil
      })
      .eq('id', userId);

  if (cooldownError) {
    console.error(
      '[BATCH SECURITY] Failed to set cooldown:',
      cooldownError
    );
  }
}

async function finishBatchItem({
  supabase,
  userId,
  batchMeta,
  success,
  errorCode = null
}) {
  if (
    !batchMeta?.batchedByClient
  ) {
    return;
  }

  const now =
    new Date().toISOString();

  const {
    error
  } =
    await supabase
      .from('scan_batch_items')
      .update({
        status:
          success
            ? 'completed'
            : 'error',
        completed_at: now,
        error_code:
          success
            ? null
            : (
                errorCode ||
                'SCAN_FAILED'
              )
      })
      .eq(
        'batch_id',
        batchMeta.batchId
      )
      .eq(
        'batch_position',
        batchMeta.batchPosition
      )
      .eq(
        'scan_id',
        batchMeta.scanId
      )
      .eq(
        'status',
        'processing'
      );

  if (error) {
    console.error(
      '[BATCH SECURITY] Failed to finish batch item:',
      error
    );
    return;
  }

  await supabase
    .from('scan_batches')
    .update({
      last_activity_at: now
    })
    .eq(
      'id',
      batchMeta.batchId
    )
    .eq('status', 'active');

  await finalizeBatchIfDone({
    supabase,
    batchId:
      batchMeta.batchId,
    userId
  });
}

async function markPendingBatchItemFailed({
  supabase,
  userId,
  batchId,
  batchPosition,
  errorCode =
    'CLIENT_PREPARATION_FAILED'
}) {
  const normalizedBatchId =
    normalizeUuid(batchId);

  if (
    !normalizedBatchId ||
    !Number.isInteger(
      batchPosition
    ) ||
    batchPosition < 1 ||
    batchPosition >
      HARD_MAX_BATCH_LIMIT
  ) {
    return invalidBatchMetadata();
  }

  const {
    data: batch,
    error: batchError
  } =
    await supabase
      .from('scan_batches')
      .select('id, status')
      .eq('id', normalizedBatchId)
      .eq('user_id', userId)
      .maybeSingle();

  if (batchError) {
    throw batchError;
  }

  if (
    !batch ||
    batch.status !== 'active'
  ) {
    return failure(
      409,
      'BATCH_NOT_ACTIVE',
      'This batch is no longer active.'
    );
  }

  const now =
    new Date().toISOString();

  const {
    data: changed,
    error
  } =
    await supabase
      .from('scan_batch_items')
      .update({
        status: 'error',
        completed_at: now,
        error_code:
          String(errorCode)
            .slice(0, 100)
      })
      .eq(
        'batch_id',
        normalizedBatchId
      )
      .eq(
        'batch_position',
        batchPosition
      )
      .eq('status', 'pending')
      .select('batch_position')
      .maybeSingle();

  if (error) {
    throw error;
  }

  if (!changed) {
    const {
      data: existing
    } =
      await supabase
        .from('scan_batch_items')
        .select('status')
        .eq(
          'batch_id',
          normalizedBatchId
        )
        .eq(
          'batch_position',
          batchPosition
        )
        .maybeSingle();

    // Retrying the exact local failure report is harmless.
    if (
      existing &&
      (
        existing.status ===
          'error' ||
        existing.status ===
          'cancelled'
      )
    ) {
      return {
        ok: true
      };
    }

    return failure(
      409,
      'BATCH_POSITION_USED',
      'This batch position has already started.'
    );
  }

  await supabase
    .from('scan_batches')
    .update({
      last_activity_at: now
    })
    .eq('id', normalizedBatchId)
    .eq('status', 'active');

  await finalizeBatchIfDone({
    supabase,
    batchId:
      normalizedBatchId,
    userId
  });

  return {
    ok: true
  };
}

async function abandonBatch({
  supabase,
  userId,
  batchId
}) {
  const normalizedBatchId =
    normalizeUuid(batchId);

  if (!normalizedBatchId) {
    return invalidBatchMetadata();
  }

  const {
    data: batch,
    error: batchError
  } =
    await supabase
      .from('scan_batches')
      .select('id, status')
      .eq('id', normalizedBatchId)
      .eq('user_id', userId)
      .maybeSingle();

  if (batchError) {
    throw batchError;
  }

  if (!batch) {
    return invalidBatchMetadata();
  }

  if (
    batch.status !== 'active'
  ) {
    return {
      ok: true
    };
  }

  const {
    data: processing,
    error: processingError
  } =
    await supabase
      .from('scan_batch_items')
      .select('batch_position')
      .eq('batch_id', normalizedBatchId)
      .eq('status', 'processing')
      .limit(1);

  if (processingError) {
    throw processingError;
  }

  if (
    processing &&
    processing.length > 0
  ) {
    return failure(
      409,
      'BATCH_ITEM_PROCESSING',
      'A batch scan is already processing and cannot be cancelled.'
    );
  }

  const now =
    new Date();

  await supabase
    .from('scan_batch_items')
    .update({
      status: 'cancelled',
      completed_at:
        now.toISOString(),
      error_code:
        'BATCH_CANCELLED'
    })
    .eq('batch_id', normalizedBatchId)
    .eq('status', 'pending');

  const cooldownUntil =
    new Date(
      now.getTime() +
        POST_BATCH_COOLDOWN_MS
    ).toISOString();

  const {
    error: closeError
  } =
    await supabase
      .from('scan_batches')
      .update({
        status: 'cancelled',
        completed_at:
          now.toISOString(),
        last_activity_at:
          now.toISOString()
      })
      .eq('id', normalizedBatchId)
      .eq('user_id', userId)
      .eq('status', 'active');

  if (closeError) {
    throw closeError;
  }

  await supabase
    .from('profiles')
    .update({
      batch_cooldown_until:
        cooldownUntil
    })
    .eq('id', userId);

  return {
    ok: true
  };
}

module.exports = {
  HARD_MAX_BATCH_LIMIT,
  cooldownFailure,
  expireStaleActiveBatch,
  getActiveBatch,
  getBatchLimit,
  resolveClientBatch,
  claimBatchItem,
  finishBatchItem,
  markPendingBatchItemFailed,
  abandonBatch
};
```


---

# 6. New VPS file — `routes/batchControl.js`

Create:

```js
// routes/batchControl.js

const crypto =
  require('crypto');

const {
  HARD_MAX_BATCH_LIMIT,
  cooldownFailure,
  expireStaleActiveBatch,
  getActiveBatch,
  getBatchLimit,
  markPendingBatchItemFailed,
  abandonBatch
} =
  require(
    './_shared/resolveClientBatch'
  );

async function loadProfile(
  supabase,
  userId
) {
  const {
    data,
    error
  } =
    await supabase
      .from('profiles')
      .select(
        [
          'id',
          'account_status',
          'batching_enabled',
          'batch_limit',
          'batch_cooldown_until'
        ].join(',')
      )
      .eq('id', userId)
      .single();

  if (error || !data) {
    return null;
  }

  return data;
}

async function handleBatchStart(
  req,
  res,
  supabase
) {
  try {
    const userId =
      req.user?.id;

    if (!userId) {
      return res
        .status(401)
        .json({
          error:
            'Unauthorized'
        });
    }

    const totalCreatives =
      Number(
        req.body
          ?.totalCreatives
      );

    if (
      !Number.isInteger(
        totalCreatives
      ) ||
      totalCreatives < 2 ||
      totalCreatives >
        HARD_MAX_BATCH_LIMIT
    ) {
      return res
        .status(400)
        .json({
          error:
            'INVALID_BATCH_SIZE',
          message:
            'Batch size must be between 2 and 5 creatives.'
        });
    }

    const profile =
      await loadProfile(
        supabase,
        userId
      );

    if (!profile) {
      return res
        .status(404)
        .json({
          error:
            'Profile not found'
        });
    }

    if (
      profile.account_status !==
      'active'
    ) {
      return res
        .status(403)
        .json({
          error:
            'ACCOUNT_FLAGGED',
          message:
            'This account is not currently allowed to scan.'
        });
    }

    if (
      profile.batching_enabled !==
      true
    ) {
      return res
        .status(403)
        .json({
          error:
            'BATCH_SCANNING_UNAVAILABLE',
          message:
            'Batch scanning is available on paid plans only.'
        });
    }

    const batchLimit =
      getBatchLimit(
        profile
      );

    if (
      !batchLimit ||
      totalCreatives >
        batchLimit
    ) {
      return res
        .status(400)
        .json({
          error:
            'BATCH_LIMIT_EXCEEDED',
          message:
            `This account can batch up to ${batchLimit || 0} creatives at a time.`
        });
    }

    const cooldownError =
      cooldownFailure(
        profile
      );

    if (cooldownError) {
      return res
        .status(
          cooldownError.status
        )
        .json(
          cooldownError.body
        );
    }

    await expireStaleActiveBatch({
      supabase,
      userId
    });

    const active =
      await getActiveBatch({
        supabase,
        userId
      });

    if (active) {
      return res
        .status(409)
        .json({
          error:
            'BATCH_ALREADY_ACTIVE',
          message:
            'A batch is already in progress.'
        });
    }

    const batchId =
      crypto.randomUUID();

    const now =
      new Date()
        .toISOString();

    const {
      error: batchError
    } =
      await supabase
        .from('scan_batches')
        .insert({
          id: batchId,
          user_id: userId,
          total_creatives:
            totalCreatives,
          status: 'active',
          started_at: now,
          last_activity_at:
            now,
          completed_at: null
        });

    if (batchError) {
      // The partial unique index is the race-safe final guard
      // against two simultaneous batch starts.
      if (
        batchError.code ===
        '23505'
      ) {
        return res
          .status(409)
          .json({
            error:
              'BATCH_ALREADY_ACTIVE',
            message:
              'A batch is already in progress.'
          });
      }

      throw batchError;
    }

    const items =
      Array.from(
        {
          length:
            totalCreatives
        },
        (
          _,
          index
        ) => ({
          batch_id:
            batchId,
          batch_position:
            index + 1,
          status: 'pending'
        })
      );

    const {
      error: itemsError
    } =
      await supabase
        .from(
          'scan_batch_items'
        )
        .insert(items);

    if (itemsError) {
      await supabase
        .from('scan_batches')
        .delete()
        .eq('id', batchId)
        .eq('user_id', userId);

      throw itemsError;
    }

    return res
      .status(201)
      .json({
        success: true,
        batchId,
        totalCreatives,
        batchLimit
      });
  } catch (error) {
    console.error(
      '[BATCH START] Failed:',
      error
    );

    return res
      .status(500)
      .json({
        error:
          'BATCH_START_FAILED',
        message:
          'Unable to start batch.'
      });
  }
}

async function handleBatchItemFailed(
  req,
  res,
  supabase
) {
  try {
    const userId =
      req.user?.id;

    if (!userId) {
      return res
        .status(401)
        .json({
          error:
            'Unauthorized'
        });
    }

    const result =
      await markPendingBatchItemFailed({
        supabase,
        userId,
        batchId:
          req.body?.batchId,
        batchPosition:
          Number(
            req.body
              ?.batchPosition
          ),
        errorCode:
          req.body
            ?.errorCode ||
          'CLIENT_PREPARATION_FAILED'
      });

    if (!result.ok) {
      return res
        .status(
          result.status
        )
        .json(
          result.body
        );
    }

    return res.json({
      success: true
    });
  } catch (error) {
    console.error(
      '[BATCH ITEM FAIL] Failed:',
      error
    );

    return res
      .status(500)
      .json({
        error:
          'BATCH_ITEM_UPDATE_FAILED',
        message:
          'Unable to update batch item.'
      });
  }
}

async function handleBatchAbandon(
  req,
  res,
  supabase
) {
  try {
    const userId =
      req.user?.id;

    if (!userId) {
      return res
        .status(401)
        .json({
          error:
            'Unauthorized'
        });
    }

    const result =
      await abandonBatch({
        supabase,
        userId,
        batchId:
          req.body?.batchId
      });

    if (!result.ok) {
      return res
        .status(
          result.status
        )
        .json(
          result.body
        );
    }

    return res.json({
      success: true
    });
  } catch (error) {
    console.error(
      '[BATCH ABANDON] Failed:',
      error
    );

    return res
      .status(500)
      .json({
        error:
          'BATCH_ABANDON_FAILED',
        message:
          'Unable to close batch.'
      });
  }
}

module.exports = {
  handleBatchStart,
  handleBatchItemFailed,
  handleBatchAbandon
};
```

---

# 7. `server.js`

The existing scan routes stay at:

```text
/scan-video = 5 requests / 60 sec
/scan-image = 7 requests / 60 sec
```

Do not increase them for this hardening.

## 7.1 Add the new import

Near the existing scan-route imports:

```js
const {
  handleBatchStart,
  handleBatchItemFailed,
  handleBatchAbandon
} =
  require(
    './routes/batchControl'
  );
```

## 7.2 Add the authenticated control routes

Place these after `authenticateUser` exists and after JSON parsing has been installed, with the other authenticated API routes:

```js
app.post(
  '/batch/start',
  authenticateUser,
  requestLimit({
    maxRequests: 3,
    windowMs: 60_000
  }),
  (req, res) =>
    handleBatchStart(
      req,
      res,
      supabase
    )
);

app.post(
  '/batch/item-failed',
  authenticateUser,
  requestLimit({
    maxRequests: 10,
    windowMs: 60_000
  }),
  (req, res) =>
    handleBatchItemFailed(
      req,
      res,
      supabase
    )
);

app.post(
  '/batch/abandon',
  authenticateUser,
  requestLimit({
    maxRequests: 5,
    windowMs: 60_000
  }),
  (req, res) =>
    handleBatchAbandon(
      req,
      res,
      supabase
    )
);
```

These are semantic batch controls. They supplement rather than replace the existing HTTP request limiters.

---

# 8. `routes/scanImage.js`

Do not replace the whole image route. Preserve its current payload validation, Qwen logic, queue behavior, accounting, `helpers.logScan()`, batch metadata logging, and error handling.

Make these surgical changes.

## 8.1 Replace the batch helper import

Replace:

```js
const {
  resolveClientBatch
} =
  require(
    './_shared/resolveClientBatch'
  );
```

with:

```js
const {
  resolveClientBatch,
  claimBatchItem,
  finishBatchItem
} =
  require(
    './_shared/resolveClientBatch'
  );
```

If the current import is on one line, the result is equivalent.

## 8.2 Add lifecycle state near the existing hoisted batch variables

The route already hoists:

```js
let batchedByClient = false;
let batchId = null;
let batchPosition = null;
```

Immediately after them add:

```js
let batchLifecycleMeta = null;
let batchItemClaimed = false;
```

## 8.3 Replace the existing `resolveClientBatch()` call

Replace the current call that passes `profilePlan: profile.plan` with:

```js
const batchMeta =
  await resolveClientBatch({
    supabase,
    userId: user.id,
    profile,
    batchedByClient:
      reqBatchedByClient,
    batchId:
      reqBatchId,
    batchPosition:
      reqBatchPosition,
    scanId
  });

if (!batchMeta.ok) {
  return res
    .status(
      batchMeta.status
    )
    .json(
      batchMeta.body
    );
}

batchedByClient =
  batchMeta.value
    .batchedByClient;

batchId =
  batchMeta.value
    .batchId;

batchPosition =
  batchMeta.value
    .batchPosition;

batchLifecycleMeta =
  batchMeta.value;
```

This is also where solo scans receive the active-batch and post-batch cooldown checks.

## 8.4 Claim a batch position only after queue admission

Keep the existing queue gate unchanged.

The first request may return HTTP 202 while queued. In that case the position must remain `pending`, because the normal resumed request with `jobId` still needs to execute it.

Immediately after the queue block and before the expensive image-model call, add:

```js
if (batchedByClient) {
  const claim =
    await claimBatchItem({
      supabase,
      batchMeta:
        batchLifecycleMeta
    });

  if (!claim.ok) {
    return res
      .status(
        claim.status
      )
      .json(
        claim.body
      );
  }

  batchItemClaimed =
    claim.claimed;
}
```

The first real execution changes:

```text
pending → processing
```

A replay of the same position cannot claim it again.

## 8.5 Mark success

After the successful scan row has been persisted with `helpers.logScan(...)` and before sending the final success response:

```js
if (
  batchItemClaimed &&
  batchLifecycleMeta
) {
  await finishBatchItem({
    supabase,
    userId: user.id,
    batchMeta:
      batchLifecycleMeta,
    success: true
  });
}
```

The last terminal item automatically finalizes the parent batch and starts the 60-second cooldown.

## 8.6 Mark an executed failure

In the route catch block, before the existing `handleError(...)` call:

```js
if (
  batchItemClaimed &&
  batchLifecycleMeta &&
  user?.id
) {
  await finishBatchItem({
    supabase,
    userId: user.id,
    batchMeta:
      batchLifecycleMeta,
    success: false,
    errorCode:
      'SCAN_IMAGE_FAILED'
  });
}
```

Keep the current partial scan logging unchanged so Scan History can still show the failed child as Error.

---

# 9. `routes/scanVideo.js`

Apply the same lifecycle hardening to the video route.

## 9.1 Import

Replace the current single-helper import with:

```js
const {
  resolveClientBatch,
  claimBatchItem,
  finishBatchItem
} =
  require(
    './_shared/resolveClientBatch'
  );
```

## 9.2 Hoisted state

Immediately after:

```js
let batchedByClient = false;
let batchId = null;
let batchPosition = null;
```

add:

```js
let batchLifecycleMeta = null;
let batchItemClaimed = false;
```

## 9.3 Resolver

Replace the current `profilePlan: profile.plan` resolver call with:

```js
const batchMeta =
  await resolveClientBatch({
    supabase,
    userId: user.id,
    profile,
    batchedByClient:
      reqBatchedByClient,
    batchId:
      reqBatchId,
    batchPosition:
      reqBatchPosition,
    scanId
  });

if (!batchMeta.ok) {
  return res
    .status(
      batchMeta.status
    )
    .json(
      batchMeta.body
    );
}

batchedByClient =
  batchMeta.value
    .batchedByClient;

batchId =
  batchMeta.value
    .batchId;

batchPosition =
  batchMeta.value
    .batchPosition;

batchLifecycleMeta =
  batchMeta.value;
```

## 9.4 Claim after queue admission, before AI

Immediately after the existing queue gate:

```js
if (batchedByClient) {
  const claim =
    await claimBatchItem({
      supabase,
      batchMeta:
        batchLifecycleMeta
    });

  if (!claim.ok) {
    return res
      .status(
        claim.status
      )
      .json(
        claim.body
      );
  }

  batchItemClaimed =
    claim.claimed;
}
```

## 9.5 Success

After successful `helpers.logScan(...)`:

```js
if (
  batchItemClaimed &&
  batchLifecycleMeta
) {
  await finishBatchItem({
    supabase,
    userId: user.id,
    batchMeta:
      batchLifecycleMeta,
    success: true
  });
}
```

## 9.6 Catch

Before the existing `handleError(...)`:

```js
if (
  batchItemClaimed &&
  batchLifecycleMeta &&
  user?.id
) {
  await finishBatchItem({
    supabase,
    userId: user.id,
    batchMeta:
      batchLifecycleMeta,
    success: false,
    errorCode:
      'SCAN_VIDEO_FAILED'
  });
}
```

Keep all existing batch fields in the successful and partial-error `scans` data.

---

# 10. `lib/mediacrater/scanApi.ts`

Keep the existing `ClientBatchMeta` type and the existing batch metadata sent by `scanVideo()` / `scanImage()`.

Add the server batch-control API.

## 10.1 Add the response type

```ts
export interface BatchStartResponse {
  success: true;
  batchId: string;
  totalCreatives: number;
  batchLimit: number;
}
```

## 10.2 Add `startBatch`

```ts
export async function startBatch(
  totalCreatives: number
): Promise<BatchStartResponse> {
  const token =
    await requireAccessToken();

  const response =
    await fetch(
      `${VPS_URL}/batch/start`,
      {
        method: 'POST',
        credentials:
          'include',
        headers: {
          Authorization:
            `Bearer ${token}`,
          'Content-Type':
            'application/json',
          'x-scan-origin':
            'webapp',
        },
        body:
          JSON.stringify({
            totalCreatives,
          }),
      }
    );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        `Failed to start batch (${response.status})`
      )
    );
  }

  return response.json();
}
```

## 10.3 Add browser-preparation failure reporting

```ts
export async function reportBatchItemFailure(
  batchId: string,
  batchPosition: number,
  errorCode:
    string =
      'CLIENT_PREPARATION_FAILED'
): Promise<void> {
  const token =
    await requireAccessToken();

  const response =
    await fetch(
      `${VPS_URL}/batch/item-failed`,
      {
        method: 'POST',
        credentials:
          'include',
        headers: {
          Authorization:
            `Bearer ${token}`,
          'Content-Type':
            'application/json',
          'x-scan-origin':
            'webapp',
        },
        body:
          JSON.stringify({
            batchId,
            batchPosition,
            errorCode,
          }),
      }
    );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        `Failed to update batch item (${response.status})`
      )
    );
  }
}
```

## 10.4 Add batch abandonment

```ts
export async function abandonBatch(
  batchId: string
): Promise<void> {
  const token =
    await requireAccessToken();

  const response =
    await fetch(
      `${VPS_URL}/batch/abandon`,
      {
        method: 'POST',
        credentials:
          'include',
        headers: {
          Authorization:
            `Bearer ${token}`,
          'Content-Type':
            'application/json',
          'x-scan-origin':
            'webapp',
        },
        body:
          JSON.stringify({
            batchId,
          }),
      }
    );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        `Failed to close batch (${response.status})`
      )
    );
  }
}
```

The existing `readErrorMessage()` already surfaces a 429 response message, so a server `BATCH_COOLDOWN` response reaches the existing client error flow.

---

# 11. `components/scan-workspace.tsx`

These changes preserve the existing client-side five-file friction and the existing five-second visible per-creative delay.

## 11.1 Extend `WorkspaceProfile`

Add:

```tsx
batching_enabled?: boolean;
batch_limit?: number;
batch_cooldown_until?: string | null;
```

Final relevant interface:

```tsx
export interface WorkspaceProfile {
  plan: string;
  scans_remaining: number;
  scans_per_month?: number;
  deep_scan_enabled?: boolean;
  audio_analysis?: boolean;
  scan_history?: boolean;
  last_notified_at?: string | null;

  batching_enabled?: boolean;
  batch_limit?: number;
  batch_cooldown_until?: string | null;
}
```

## 11.2 Import the new API functions

Add to the existing `scanApi` import:

```tsx
startBatch,
reportBatchItemFailure,
abandonBatch,
```

## 11.3 Replace the frontend entitlement check

Replace:

```tsx
const canBatchScan =
  Boolean(profile) &&
  profile?.plan !== 'free';
```

with:

```tsx
const canBatchScan =
  profile?.batching_enabled ===
  true;

const effectiveBatchLimit =
  canBatchScan
    ? Math.min(
        profile?.batch_limit ??
          MAX_BATCH_FILES,
        MAX_BATCH_FILES
      )
    : 1;
```

Then replace:

```tsx
const maxFiles =
  canBatchScan
    ? MAX_BATCH_FILES
    : 1;
```

with:

```tsx
const maxFiles =
  effectiveBatchLimit;
```

This browser check is still only UX. The VPS performs the real enforcement.

## 11.4 Add a ref for the authoritative server batch

Near the other refs:

```tsx
const activeServerBatchIdRef =
  useRef<string | null>(
    null
  );
```

## 11.5 Remove the direct browser `scan_batches` insert

Inside `performAnalysis()`, delete the current browser-side creation:

```tsx
batchId =
  crypto.randomUUID();

const {
  error: batchError,
} =
  await supabase
    .from(
      'scan_batches'
    )
    .insert({
      id: batchId,
      user_id: userId,
      total_creatives:
        executionCreatives.length,
    });

if (batchError) {
  throw new Error(
    'Unable to create scan batch.'
  );
}
```

Replace the entire `if (isBatch) { ... }` body with:

```tsx
if (isBatch) {
  const startedBatch =
    await startBatch(
      executionCreatives.length
    );

  batchId =
    startedBatch.batchId;

  activeServerBatchIdRef.current =
    batchId;
}
```

Now the browser requests a batch; it does not manufacture one.

## 11.6 Keep one platform per creative

Do not reintroduce the earlier multi-platform loop.

The final batching implementation is one platform per creative. Keep the frontend radio behavior and keep the execution path defensively constrained to the first platform entry.

The hardened server model assumes:

```text
one batch_position = at most one logical AI scan
```

That is what makes an authoritative per-position claim meaningful.

## 11.7 Report local preparation failures

There is an outer per-creative catch that handles failures before/around the normal scan request and currently marks that batch item red.

In that outer catch, after the existing abort/fatal checks but before moving on to the next creative, add:

```tsx
if (
  isBatch &&
  batchId &&
  batchPosition
) {
  await reportBatchItemFailure(
    batchId,
    batchPosition,
    'CLIENT_PREPARATION_FAILED'
  ).catch(
    (reportError) =>
      console.error(
        '[CLIENT BATCH] Failed to report local item failure:',
        reportError
      )
  );
}
```

Do **not** add this to the inner provider/API scan catch. An actual VPS scan request is claimed and marked success/error by the server route itself.

## 11.8 Clear the active batch ref after normal batch completion

After the full batch loop completes:

```tsx
if (isBatch) {
  activeServerBatchIdRef.current =
    null;
}
```

By then, the server has finalized the parent when the final authoritative item became terminal.

## 11.9 Close a pending batch on explicit cancellation

Before local state is cleared in `handleCancelAnalysis()`:

```tsx
const activeBatchId =
  activeServerBatchIdRef.current;

if (activeBatchId) {
  abandonBatch(
    activeBatchId
  ).catch(
    (error) =>
      console.error(
        '[CLIENT BATCH] Failed to abandon batch:',
        error
      )
  );

  activeServerBatchIdRef.current =
    null;
}
```

The VPS rejects abandonment if an item is already `processing`, preserving the existing non-cancellable processing boundary.

## 11.10 Close remaining pending positions on a fatal top-level batch stop

In the top-level `handleAnalyze()` catch, once an error is known to stop the whole batch, attempt:

```tsx
const activeBatchId =
  activeServerBatchIdRef.current;

if (activeBatchId) {
  await abandonBatch(
    activeBatchId
  ).catch(
    (abandonError) =>
      console.error(
        '[CLIENT BATCH] Failed to close stopped batch:',
        abandonError
      )
  );

  activeServerBatchIdRef.current =
    null;
}
```

Do this before the final failure banner/state cleanup.

## 11.11 Extend `shouldStopBatch()`

Add the following fatal server messages/tokens:

```tsx
message.includes(
  'BATCH_COOLDOWN'
) ||
message.includes(
  'BATCH_IN_PROGRESS'
) ||
message.includes(
  'BATCH_ALREADY_ACTIVE'
) ||
message.includes(
  'BATCH_NOT_ACTIVE'
) ||
message.includes(
  'BATCH_POSITION_USED'
) ||
message.includes(
  'BATCH_SCAN_ID_REUSED'
) ||
message.includes(
  'BATCH_LIMIT_EXCEEDED'
) ||
message.includes(
  'BATCH_VALIDATION_FAILED'
)
```

If `readErrorMessage()` currently returns the human message instead of the error code, also match the corresponding stable messages, especially:

```text
A batch is already in progress.
This batch position has already been used.
Please wait ... before starting another scan.
```

A cleaner optional follow-up is to change `readErrorMessage()` to preserve both the server `error` code and message, but that is not required for the server security boundary.

---

# 12. Post-batch cooldown behavior

The new cooldown is separate from the existing 5-second client delay.

Existing within-batch UX:

```text
creative 1
5 seconds
creative 2
5 seconds
creative 3
```

New server security cooldown:

```text
last batch item becomes terminal
↓
profiles.batch_cooldown_until = now + 60 seconds
↓
all new solo scans and new batches rejected
↓
cooldown expires
↓
normal scanning allowed again
```

The new rule is intentionally enforced at **start**, not merely completion. That is stronger and easier to reason about.

During cooldown:

```text
POST /batch/start → 429 BATCH_COOLDOWN
POST /scan-image  → 429 BATCH_COOLDOWN
POST /scan-video  → 429 BATCH_COOLDOWN
```

---

# 13. Why `scan_batch_items` is necessary

`profiles.batch_limit = 5` answers:

```text
How many creatives is this account entitled to batch?
```

`scan_batches.total_creatives = 4` answers:

```text
How many creatives were authorized for this specific batch?
```

`scan_batch_items` answers:

```text
Which exact positions exist?
Which position is pending?
Which one is currently processing?
Which position completed?
Which failed?
Was position 1 already consumed?
```

That gives a visible source of truth rather than relying on a client-generated sequence.

Example:

```text
scan_batches

id          total_creatives  status
ABC         3                completed_with_errors
```

```text
scan_batch_items

batch_id  position  status      scan_id
ABC       1         completed   111...
ABC       2         error       222...
ABC       3         completed   333...
```

```text
scans

id      batch_id  batch_position  status
111...  ABC       1               completed
222...  ABC       2               error
333...  ABC       3               completed
```

This is auditable directly in Supabase.

---

# 14. Optional Scan History visibility

The current Scan History already groups child scans by `batch_id` and shows errors correctly.

If you want the folder itself to expose the authoritative server lifecycle, extend the `scan_batches` select from:

```text
id
created_at
total_creatives
```

to:

```text
id
created_at
total_creatives
status
started_at
completed_at
```

Then a batch folder can display, for example:

```text
Batch scan
3 creatives
2 completed · 1 error
completed_with_errors
```

This is optional for security. The source-of-truth fields exist in Supabase regardless.

---

# 15. Abuse cases after hardening

## Free user forges batching

```text
POST /batch/start
totalCreatives = 5

profiles.batching_enabled = false
→ 403
```

## Paid user changes browser code to request 100

```text
→ 400 INVALID_BATCH_SIZE
```

## Paid user requests 6

```text
hard server maximum = 5
→ 400
```

## Account batch_limit is 3 but browser asks for 5

```text
profiles.batch_limit = 3
→ 400 BATCH_LIMIT_EXCEEDED
```

## Browser invents a UUID and claims it is a batch

```text
scan request with forged batchId
→ batch not found for authenticated user
→ rejected before AI work
```

## Browser tries position 6

```text
→ rejected before AI work
```

## Browser replays position 1

First legitimate execution:

```text
pending → processing → completed
```

Replay:

```text
status != pending
→ 409 BATCH_POSITION_USED
→ AI provider is not called
```

## Two batch starts race each other

```text
first request creates active batch
second violates partial unique active-batch index
→ 409 BATCH_ALREADY_ACTIVE
```

## Browser drops batch metadata and tries a solo scan during the batch

```text
active scan_batches row exists
→ 409 BATCH_IN_PROGRESS
```

## User tries another batch immediately after completion

```text
batch_cooldown_until is in the future
→ 429 BATCH_COOLDOWN
```

## User tries a solo scan immediately after completion

```text
→ 429 BATCH_COOLDOWN
```

## Browser-side frame/audio/image preparation fails

```text
POST /batch/item-failed
pending → error
```

Later positions can continue, and the batch can still reach a terminal state.

## Browser closes and leaves an active batch

The active batch remains authoritative and prevents bypass scans.

After the stale inactivity threshold, a later request can expire it so the account is not permanently stuck.

---

# 16. Source-of-truth inspection queries

## Account entitlement

```sql
SELECT
  id,
  plan,
  batching_enabled,
  batch_limit,
  batch_cooldown_until
FROM public.profiles
WHERE id = '<USER UUID>';
```

## Batch lifecycle

```sql
SELECT
  id,
  user_id,
  total_creatives,
  status,
  created_at,
  started_at,
  last_activity_at,
  completed_at
FROM public.scan_batches
WHERE user_id = '<USER UUID>'
ORDER BY created_at DESC;
```

## Exact authorized positions

```sql
SELECT
  batch_id,
  batch_position,
  status,
  scan_id,
  created_at,
  started_at,
  completed_at,
  error_code
FROM public.scan_batch_items
WHERE batch_id = '<BATCH UUID>'
ORDER BY batch_position;
```

## Actual scans

```sql
SELECT
  id,
  batch_id,
  batch_position,
  status,
  file_name,
  target_platform,
  created_at
FROM public.scans
WHERE batch_id = '<BATCH UUID>'
ORDER BY batch_position;
```

The meaning is deliberately separated:

```text
profiles
= what the account is entitled to do

scan_batches
= what this specific batch was authorized to do

scan_batch_items
= exact allowed positions and lifecycle

scans
= actual analysis/result records
```

---

# 17. TEST checklist

## Entitlement

- [ ] Existing paid TEST accounts backfill to `batching_enabled = true`.
- [ ] Free accounts remain `batching_enabled = false`.
- [ ] Free account cannot start a batch through the UI.
- [ ] Free account cannot manually call `/batch/start`.
- [ ] Authenticated browser cannot update `profiles.plan`.
- [ ] Authenticated browser cannot update `profiles.batching_enabled`.
- [ ] Authenticated browser cannot update `profiles.batch_limit`.
- [ ] Authenticated browser cannot update `profiles.batch_cooldown_until`.

## Batch creation

- [ ] 2 creatives accepted.
- [ ] 5 creatives accepted.
- [ ] 6 creatives rejected by VPS.
- [ ] 100 creatives rejected by VPS.
- [ ] Browser no longer inserts `scan_batches`.
- [ ] VPS creates one parent row.
- [ ] VPS creates exactly N item rows for N creatives.
- [ ] Positions are exactly 1..N.
- [ ] Authenticated browser cannot directly INSERT/UPDATE/DELETE batch-control rows.

## Concurrent start

Fire two `/batch/start` requests simultaneously.

Expected:

```text
one succeeds
one returns 409 BATCH_ALREADY_ACTIVE
```

## Position replay

Run position 1 normally, then manually resend a request using the same `batchId` and `batchPosition = 1`.

Expected:

```text
409 BATCH_POSITION_USED
no model call
no second scan deduction
```

## Scan ID reuse

Attempt to bind the same `scanId` to two different positions.

Expected:

```text
409 BATCH_SCAN_ID_REUSED
```

## Active-batch isolation

While a batch is active:

- [ ] solo `/scan-image` rejected;
- [ ] solo `/scan-video` rejected;
- [ ] another `/batch/start` rejected.

## Successful batch

For a 3-item batch:

```text
1 completed
2 completed
3 completed
```

Expected:

```text
scan_batches.status = completed
completed_at set
batch_cooldown_until ≈ now + 60 sec
```

## Mixed provider/JSON failure

Force the normal parse/provider failure on item 2:

```text
1 completed
2 error
3 completed
```

Expected:

```text
scan_batches.status = completed_with_errors
Scan History = 2 completed · 1 error
failed child remains Error
```

## Local preparation failure

Force browser-side media preparation to fail before the scan route is called.

Expected:

```text
/batch/item-failed
position status = error
later items can continue
```

## Cooldown

Immediately after a terminal batch:

- [ ] `/batch/start` returns 429.
- [ ] solo `/scan-image` returns 429.
- [ ] solo `/scan-video` returns 429.
- [ ] response includes a remaining wait message.
- [ ] after 60 seconds, normal scanning works.

## Cancellation

Cancel while no item is processing.

Expected:

```text
pending positions → cancelled
batch → cancelled
60-second cooldown set
```

If an item is already `processing`, `/batch/abandon` should return 409 and leave that server-owned execution intact.

## Crash / abandonment

Start a batch and stop sending requests without abandonment.

Expected:

```text
batch remains active
new solo/batch requests blocked
```

After 90 minutes without activity, the stale batch can be expired rather than permanently locking the account.

---

# 18. VPS syntax validation

From the TEST API root:

```bash
cd /var/www/mediacrater-api-test

node --check routes/_shared/resolveClientBatch.js
node --check routes/batchControl.js
node --check routes/scanImage.js
node --check routes/scanVideo.js
node --check server.js
```

Then restart the existing TEST API systemd service using its real service name and inspect the journal.

Do not create a new systemd unit for this feature.

---

# 19. Website validation

Run the normal TEST build.

If local `npm run build` is blocked because `NEXT_PUBLIC_SUPABASE_URL` exists only in Vercel, use the same TEST-environment approach already established for this project rather than hard-coding the URL into source.

Test:

```text
free user → one creative only
paid user → 2–5
paid user with batch_limit 3 → UI stops at 3
server still rejects forged > limit request
normal solo scan works when no active batch/cooldown exists
```

---

# 20. Deployment order

Use this order:

```text
1. Apply TEST Supabase migration.
2. Backfill TEST profile batching entitlements.
3. Verify browser cannot update protected profile fields.
4. Verify browser cannot mutate batch control tables.
5. Replace routes/_shared/resolveClientBatch.js.
6. Add routes/batchControl.js.
7. Patch routes/scanImage.js.
8. Patch routes/scanVideo.js.
9. Patch server.js.
10. Syntax-check VPS files.
11. Restart TEST VPS.
12. Patch lib/mediacrater/scanApi.ts.
13. Patch components/scan-workspace.tsx.
14. Build/deploy TEST website.
15. Run normal 2–5 creative batches.
16. Run deliberate >5 request manipulation.
17. Run duplicate-position replay.
18. Run scan-ID reuse test.
19. Run solo-scan-during-batch test.
20. Run concurrent batch-start test.
21. Run parse-error mixed batch.
22. Run browser preparation failure.
23. Run 60-second cooldown tests.
24. Verify Scan History still groups/errors correctly.
25. Confirm drift monitor shows only intended TEST/LIVE differences.
26. Promote schema and code to LIVE only after TEST passes.
```

Because entitlement is synchronized from the trusted `plan` transition at the database layer, no separate browser-visible purchase code needs to set `batching_enabled`.

If you prefer to set the flag explicitly inside Stripe instead, remove the synchronization trigger and patch every trusted paid/free entitlement transition consistently. Do not do both independently unless they intentionally write the same values.

---

# 21. Rollback

Application rollback:

```text
1. Restore previous scan-workspace batch creation.
2. Restore previous scanApi surface.
3. Restore previous resolveClientBatch helper.
4. Remove batchControl routes/import.
5. Restore previous scan route lifecycle hooks.
```

Database rollback should be conservative if TEST already contains batch data.

Do not immediately drop historical rows. The new columns/tables are additive and can remain dormant while application code is rolled back.

If fully removing the hardening from TEST before any important data exists:

```sql
DROP TRIGGER IF EXISTS
server_manage_scan_batch_items_trigger
ON public.scan_batch_items;

DROP TRIGGER IF EXISTS
server_manage_scan_batches_trigger
ON public.scan_batches;

DROP TRIGGER IF EXISTS
protect_server_managed_profile_fields_trigger
ON public.profiles;

DROP TRIGGER IF EXISTS
sync_batching_entitlement_from_plan_trigger
ON public.profiles;

DROP FUNCTION IF EXISTS
public.prevent_client_batch_control_writes();

DROP FUNCTION IF EXISTS
public.protect_server_managed_profile_fields();

DROP FUNCTION IF EXISTS
public.sync_batching_entitlement_from_plan();

DROP TABLE IF EXISTS
public.scan_batch_items;

DROP INDEX IF EXISTS
public.scan_batches_one_active_per_user_idx;
```

Only drop the added profile/batch columns if you explicitly want a destructive rollback and are certain no useful data depends on them.

---

# 22. Final security result

After this hardening:

```text
trusted paid-plan transition
        ↓
profiles.batching_enabled
profiles.batch_limit
        ↓
VPS /batch/start
        ↓
server-created scan_batches
        ↓
server-created scan_batch_items positions 1..N
        ↓
each scan claims exactly one unused position
        ↓
AI work
        ↓
server marks position completed/error
        ↓
last terminal position finalizes batch
        ↓
profiles.batch_cooldown_until = +60 sec
        ↓
new scans/batches blocked until cooldown expires
```

The important properties are:

```text
Browser cannot enable batching.
Browser cannot increase batch_limit.
Browser cannot create an authoritative batch.
Browser cannot create position 6.
Browser cannot reuse position 1 for extra AI work.
Browser cannot reuse one scan ID across positions.
Browser cannot create two active batches.
Browser cannot bypass an active batch with a solo scan.
Browser cannot immediately begin another scan after a batch.
```

The browser's existing five-file cap remains because it is still useful friction.

The security boundary is now the authenticated VPS + server-managed Supabase state.
