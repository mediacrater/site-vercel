# Mediacrater — Client Batch Scanning

**Date:** September 15, 2026  
**File:** `client-batching-15sept26.md`  
**Scope:** Paid client-side batching, batch metadata, sequential execution, per-creative configuration, Dashboard batch status, per-creative feedback, and Scan History grouping contract.

---

# 1. Final architecture

The implementation keeps the existing hybrid architecture:

```text
browser
  ├─ validates uploads
  ├─ extracts video frames/audio locally
  ├─ prepares image payloads locally
  ├─ executes logical scans sequentially
  └─ waits 5 seconds between logical batch scans

VPS
  ├─ authenticates every request
  ├─ validates batch ownership + paid entitlement
  ├─ uses the existing one-active-scan-per-user queue
  ├─ performs model analysis
  ├─ deducts scans only on successful analysis
  └─ logs each scan row with batch metadata
```

A batch is:

```text
scan_batches.id
    ↓
scans.batch_id
```

Each creative receives one execution position. If one creative scans multiple platforms, all scan rows for that creative share the same `batch_position`.

Example:

```text
Uploaded order
1 video-a.mp4
2 image-a.jpg
3 image-b.jpg
4 video-b.mp4

Execution order
1 image-a.jpg
2 image-b.jpg
3 video-a.mp4
4 video-b.mp4
```

Therefore:

```text
image-a / Meta     batch_position = 1
image-a / TikTok   batch_position = 1
image-b / Meta     batch_position = 2
video-a / Meta     batch_position = 3
video-b / TikTok   batch_position = 4
```

Do **not** add a unique constraint on `(batch_id, batch_position)` because multi-platform scans intentionally produce more than one row for the same creative position.

---

# 2. Database hardening

The existing `scans` table is already correct for batching:

```text
batched_by_client boolean not null default false
batch_id uuid null
batch_position smallint null
```

and:

```text
scans.batch_id → scan_batches.id ON DELETE SET NULL
```

## Recommended additional metadata

After reviewing the current client preprocessing path, add `total_creatives` to `scan_batches`.

Reason: a creative can fail during browser-side preprocessing before a `scans` row exists. If the last creative in a five-item batch fails before reaching the VPS, child rows alone cannot prove whether the original batch contained four or five creatives. `total_creatives` preserves the intended batch size.

Run in TEST:

```sql
ALTER TABLE public.scan_batches
ADD COLUMN IF NOT EXISTS total_creatives smallint;

ALTER TABLE public.scan_batches
DROP CONSTRAINT IF EXISTS scan_batches_total_creatives_check;

ALTER TABLE public.scan_batches
ADD CONSTRAINT scan_batches_total_creatives_check
CHECK (
  total_creatives IS NULL
  OR total_creatives BETWEEN 2 AND 5
);

ALTER TABLE public.scans
DROP CONSTRAINT IF EXISTS scans_batch_position_range_check;

ALTER TABLE public.scans
ADD CONSTRAINT scans_batch_position_range_check
CHECK (
  batch_position IS NULL
  OR batch_position BETWEEN 1 AND 5
);
```

The application created below always writes `total_creatives` for new batches.

---

# 3. New VPS helper — `routes/_shared/resolveClientBatch.js`

Create this new file:

```js
// routes/_shared/resolveClientBatch.js

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidBatchMetadata() {
  return {
    ok: false,
    status: 400,
    body: {
      error: 'Invalid batch metadata.'
    }
  };
}

async function resolveClientBatch({
  supabase,
  userId,
  profilePlan,
  batchedByClient,
  batchId,
  batchPosition
}) {
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

    return {
      ok: true,
      value: {
        batchedByClient: false,
        batchId: null,
        batchPosition: null
      }
    };
  }

  if (!profilePlan || profilePlan === 'free') {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'Batch scanning unavailable',
        message: 'Batch scanning is available on paid plans only.'
      }
    };
  }

  const normalizedBatchId =
    typeof batchId === 'string'
      ? batchId.trim()
      : '';

  if (
    !UUID_PATTERN.test(normalizedBatchId) ||
    !Number.isInteger(batchPosition) ||
    batchPosition < 1 ||
    batchPosition > 5
  ) {
    return invalidBatchMetadata();
  }

  const {
    data: batch,
    error: lookupError
  } = await supabase
    .from('scan_batches')
    .select('id, total_creatives')
    .eq('id', normalizedBatchId)
    .eq('user_id', userId)
    .maybeSingle();

  if (lookupError) {
    console.error(
      '[CLIENT BATCH] Batch ownership lookup failed:',
      lookupError
    );

    return {
      ok: false,
      status: 500,
      body: {
        error: 'Unable to validate scan batch.'
      }
    };
  }

  if (!batch) {
    return invalidBatchMetadata();
  }

  if (
    Number.isInteger(batch.total_creatives) &&
    batchPosition > batch.total_creatives
  ) {
    return invalidBatchMetadata();
  }

  return {
    ok: true,
    value: {
      batchedByClient: true,
      batchId: normalizedBatchId,
      batchPosition
    }
  };
}

module.exports = {
  resolveClientBatch
};
```

Why:
- the browser is not trusted to self-declare a valid paid batch;
- the VPS verifies that the batch belongs to the authenticated user;
- free users cannot forge `batchedByClient: true`;
- malformed positions are rejected;
- solo extension/web requests remain backwards compatible.

---

# 4. `lib/mediacrater/scanApi.ts`

## 4.1 Add the batch metadata interface

Replace:

```ts
export type ScanResponse = ScanQueuedResponse | ScanCompletedResponse;
```

with:

```ts
export type ScanResponse = ScanQueuedResponse | ScanCompletedResponse;

export interface ClientBatchMeta {
  batchedByClient: boolean;
  batchId: string | null;
  batchPosition: number | null;
}
```

Why:
The client API needs one explicit typed envelope for the three database batch fields.

## 4.2 Extend `scanVideo()`

Replace:

```ts
  scanId?: string | null,
  thumbnailUrl?: string | null,
  fileName?: string | null
): Promise<ScanResponse> {
```

with:

```ts
  scanId?: string | null,
  thumbnailUrl?: string | null,
  fileName?: string | null,
  batchMeta?: ClientBatchMeta
): Promise<ScanResponse> {
```

Then replace this tail of the request body:

```ts
      scanId: scanId || null,
      thumbnailUrl: thumbnailUrl || null,
      fileName: fileName || null,
```

with:

```ts
      scanId: scanId || null,
      thumbnailUrl: thumbnailUrl || null,
      fileName: fileName || null,
      batchedByClient:
        batchMeta?.batchedByClient === true,
      batchId:
        batchMeta?.batchId ?? null,
      batchPosition:
        batchMeta?.batchPosition ?? null,
```

## 4.3 Extend `scanImage()`

Replace:

```ts
  scanId?: string | null,
  thumbnailUrl?: string | null,
  fileName?: string | null
): Promise<ScanResponse> {
```

with:

```ts
  scanId?: string | null,
  thumbnailUrl?: string | null,
  fileName?: string | null,
  batchMeta?: ClientBatchMeta
): Promise<ScanResponse> {
```

Then replace:

```ts
      scanId: scanId || null,
      thumbnailUrl: thumbnailUrl || null,
      fileName: fileName || null,
```

with:

```ts
      scanId: scanId || null,
      thumbnailUrl: thumbnailUrl || null,
      fileName: fileName || null,
      batchedByClient:
        batchMeta?.batchedByClient === true,
      batchId:
        batchMeta?.batchId ?? null,
      batchPosition:
        batchMeta?.batchPosition ?? null,
```

Solo callers can omit `batchMeta`.

---

# 5. `routes/scanImage.js`

## 5.1 Add the helper import

Replace:

```js
const { detectOrigin } = require('./_shared/detectOrigin');
```

with:

```js
const { detectOrigin } = require('./_shared/detectOrigin');
const { resolveClientBatch } = require('./_shared/resolveClientBatch');
```

## 5.2 Add hoisted batch state

Replace:

```js
  let thumbnailUrl = null;
  let fileName = null;
  const scanStartTime = Date.now();
```

with:

```js
  let thumbnailUrl = null;
  let fileName = null;
  let batchedByClient = false;
  let batchId = null;
  let batchPosition = null;
  const scanStartTime = Date.now();
```

## 5.3 Read batch metadata from the request

Replace:

```js
      scanId: reqScanId,
      thumbnailUrl: reqThumbnailUrl,
      fileName: reqFileName
```

with:

```js
      scanId: reqScanId,
      thumbnailUrl: reqThumbnailUrl,
      fileName: reqFileName,
      batchedByClient: reqBatchedByClient,
      batchId: reqBatchId,
      batchPosition: reqBatchPosition
```

## 5.4 Validate the batch after account-status validation

Immediately after the existing `profile.account_status` block, add:

```js
    const batchMeta = await resolveClientBatch({
      supabase,
      userId: user.id,
      profilePlan: profile.plan,
      batchedByClient: reqBatchedByClient,
      batchId: reqBatchId,
      batchPosition: reqBatchPosition
    });

    if (!batchMeta.ok) {
      return res
        .status(batchMeta.status)
        .json(batchMeta.body);
    }

    batchedByClient =
      batchMeta.value.batchedByClient;

    batchId =
      batchMeta.value.batchId;

    batchPosition =
      batchMeta.value.batchPosition;
```

Why:
The service-role VPS, not the browser, determines whether the requested batch metadata is valid.

## 5.5 Add batch fields to successful scan logging

Replace:

```js
      thumbnail_url: thumbnailUrl,
      file_name: fileName
```

with:

```js
      thumbnail_url: thumbnailUrl,
      file_name: fileName,
      batched_by_client: batchedByClient,
      batch_id: batchId,
      batch_position: batchPosition
```

## 5.6 Add the same metadata to the error path

Replace:

```js
      generated_data: null,
      thumbnail_url: thumbnailUrl,
      file_name: fileName
```

with:

```js
      generated_data: null,
      thumbnail_url: thumbnailUrl,
      file_name: fileName,
      batched_by_client: batchedByClient,
      batch_id: batchId,
      batch_position: batchPosition
```

This makes the metadata available to the existing `handleError()` path when a server-side failure is persisted.

---

# 6. `routes/scanVideo.js`

Make the same six changes as `scanImage.js`.

## 6.1 Import

Replace:

```js
const { detectOrigin } = require('./_shared/detectOrigin');
```

with:

```js
const { detectOrigin } = require('./_shared/detectOrigin');
const { resolveClientBatch } = require('./_shared/resolveClientBatch');
```

## 6.2 Hoisted state

Replace:

```js
  let thumbnailUrl = null;
  let fileName = null;
  const scanStartTime = Date.now();
```

with:

```js
  let thumbnailUrl = null;
  let fileName = null;
  let batchedByClient = false;
  let batchId = null;
  let batchPosition = null;
  const scanStartTime = Date.now();
```

## 6.3 Request destructuring

Replace:

```js
      scanId: reqScanId,
      thumbnailUrl: reqThumbnailUrl,
      fileName: reqFileName
```

with:

```js
      scanId: reqScanId,
      thumbnailUrl: reqThumbnailUrl,
      fileName: reqFileName,
      batchedByClient: reqBatchedByClient,
      batchId: reqBatchId,
      batchPosition: reqBatchPosition
```

## 6.4 Validate after the existing account-status check

Add:

```js
    const batchMeta = await resolveClientBatch({
      supabase,
      userId: user.id,
      profilePlan: profile.plan,
      batchedByClient: reqBatchedByClient,
      batchId: reqBatchId,
      batchPosition: reqBatchPosition
    });

    if (!batchMeta.ok) {
      return res
        .status(batchMeta.status)
        .json(batchMeta.body);
    }

    batchedByClient =
      batchMeta.value.batchedByClient;

    batchId =
      batchMeta.value.batchId;

    batchPosition =
      batchMeta.value.batchPosition;
```

Keep the existing Deep Scan and Audio Analysis entitlement checks immediately after this.

## 6.5 Success logging

Replace:

```js
      thumbnail_url: thumbnailUrl,
      file_name: fileName,
      audio_analysis: Boolean(audio)
```

with:

```js
      thumbnail_url: thumbnailUrl,
      file_name: fileName,
      audio_analysis: Boolean(audio),
      batched_by_client: batchedByClient,
      batch_id: batchId,
      batch_position: batchPosition
```

## 6.6 Error metadata

Replace:

```js
      generated_data: null,
      thumbnail_url: thumbnailUrl,
      file_name: fileName
```

with:

```js
      generated_data: null,
      thumbnail_url: thumbnailUrl,
      file_name: fileName,
      batched_by_client: batchedByClient,
      batch_id: batchId,
      batch_position: batchPosition
```

---

# 7. `queueManager.js`

**No code change.**

The current queue already enforces one active scan per user. Client batching should work with that invariant, not around it.

The important architectural change is that batch work is sent sequentially rather than using `Promise.all()` for all logical scans.

---

# 8. `routes/scanFeedback.js`

**No code change.**

The handler already:
- accepts 1–5 UUID scan IDs;
- verifies ownership;
- applies one feedback answer to all supplied scan IDs;
- rejects conflicting rewrites;
- accepts exact idempotent retries.

That is exactly what one creative needs when it has one or more successful platform scan rows.

---

# 9. `lib/mediacrater/backgroundScanStore.ts`

## 9.1 Replace the result type block

Replace:

```ts
export interface BackgroundScanResult {
  platform: string;
  riskLevel: string;
  riskClass: string;
  processedViolations: unknown[];
}
```

with:

```ts
export type BackgroundBatchItemStatus =
  | 'queued'
  | 'cooldown'
  | 'processing'
  | 'success'
  | 'error';

export interface BackgroundBatchItem {
  creativeId: string;
  fileName: string;
  fileKind: 'image' | 'video';
  batchPosition: number;
  status: BackgroundBatchItemStatus;
  scanIds: string[];
  error: string | null;
}

export interface BackgroundScanResult {
  creativeId: string;
  fileName: string;
  fileKind: 'image' | 'video';
  batchPosition: number | null;
  scanId: string;
  platform: string;
  riskLevel: string;
  riskClass: string;
  processedViolations: unknown[];
}
```

## 9.2 Add `batchItems` to state

Replace:

```ts
  results: BackgroundScanResult[] | null;
  scanIds: string[];
  error: {
```

with:

```ts
  results: BackgroundScanResult[] | null;
  scanIds: string[];
  batchItems: BackgroundBatchItem[];
  error: {
```

## 9.3 Add `batchItems` to idle state

Replace:

```ts
    results: null,
    scanIds: [],
    error: null,
```

with:

```ts
    results: null,
    scanIds: [],
    batchItems: [],
    error: null,
```

## 9.4 Add a stored-item normalizer before `normalizeStoredState()`

Add:

```ts
const VALID_BATCH_ITEM_STATUSES:
  BackgroundBatchItemStatus[] = [
    'queued',
    'cooldown',
    'processing',
    'success',
    'error',
  ];

function normalizeBatchItems(
  value: unknown
): BackgroundBatchItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== 'object'
    ) {
      return [];
    }

    const candidate =
      item as Partial<BackgroundBatchItem>;

    if (
      typeof candidate.creativeId !== 'string' ||
      typeof candidate.fileName !== 'string' ||
      (
        candidate.fileKind !== 'image' &&
        candidate.fileKind !== 'video'
      ) ||
      !Number.isInteger(candidate.batchPosition) ||
      !VALID_BATCH_ITEM_STATUSES.includes(
        candidate.status as BackgroundBatchItemStatus
      )
    ) {
      return [];
    }

    return [{
      creativeId: candidate.creativeId,
      fileName: candidate.fileName,
      fileKind: candidate.fileKind,
      batchPosition:
        candidate.batchPosition as number,
      status:
        candidate.status as BackgroundBatchItemStatus,
      scanIds:
        Array.isArray(candidate.scanIds)
          ? candidate.scanIds.filter(
              (id): id is string =>
                typeof id === 'string'
            )
          : [],
      error:
        typeof candidate.error === 'string'
          ? candidate.error
          : null,
    }];
  });
}
```

## 9.5 Restore batch items from session storage

Inside `normalizeStoredState()`, replace:

```ts
    scanIds:
      Array.isArray(state.scanIds)
        ? state.scanIds.filter(
            (id): id is string =>
              typeof id === 'string'
          )
        : [],

    error:
```

with:

```ts
    scanIds:
      Array.isArray(state.scanIds)
        ? state.scanIds.filter(
            (id): id is string =>
              typeof id === 'string'
          )
        : [],

    batchItems:
      normalizeBatchItems(
        state.batchItems
      ),

    error:
```

## 9.6 Preserve item-level failure state after a full page reload

Inside `convertStaleRuntime()`, replace:

```ts
      results: null,
      scanIds: [],
      error: {
```

with:

```ts
      results: null,
      scanIds: [],
      batchItems:
        state.batchItems.map(
          (item) =>
            item.status === 'success' ||
            item.status === 'error'
              ? item
              : {
                  ...item,
                  status: 'error',
                  error: 'Scan interrupted.',
                }
        ),
      error: {
```

## 9.7 Allow `beginBackgroundScan()` to initialize batch slots

Replace:

```ts
export function beginBackgroundScan(
  message = 'Preparing analysis...'
) {
```

with:

```ts
export function beginBackgroundScan(
  message = 'Preparing analysis...',
  batchItems:
    BackgroundBatchItem[] = []
) {
```

Then replace:

```ts
    results: null,
    scanIds: [],
    error: null,
```

inside `beginBackgroundScan()` with:

```ts
    results: null,
    scanIds: [],
    batchItems,
    error: null,
```

## 9.8 Add an item update function

Immediately after `updateBackgroundScanProgress()`, add:

```ts
export function updateBackgroundBatchItem(
  operationId: string,
  creativeId: string,
  patch: Partial<
    Pick<
      BackgroundBatchItem,
      'status' | 'scanIds' | 'error'
    >
  >
) {
  const current =
    getBackgroundScanState();

  if (
    current.operationId !==
    operationId
  ) {
    return;
  }

  publishState({
    ...current,
    runtimeId: RUNTIME_ID,
    batchItems:
      current.batchItems.map(
        (item) =>
          item.creativeId ===
          creativeId
            ? {
                ...item,
                ...patch,
              }
            : item
      ),
    updatedAt:
      new Date().toISOString(),
  });
}
```

## 9.9 Mark unfinished items red on a global failure

Inside `failBackgroundScan()`, replace:

```ts
    results: null,
    scanIds: [],
    updatedAt:
```

with:

```ts
    results: null,
    scanIds: [],
    batchItems:
      current.batchItems.map(
        (item) =>
          item.status === 'success' ||
          item.status === 'error'
            ? item
            : {
                ...item,
                status: 'error',
                error: message,
              }
      ),
    updatedAt:
```

Do not change the store version. Old version-1 session data safely normalizes to `batchItems: []`.

---

# 10. `components/app-sidebar.tsx`

This patch assumes the background-continuity version already installed on September 14, which already has the single spinner/check/X status.

## 10.1 Imports

Replace:

```tsx
import {
  CheckCircle2,
  History,
  LayoutDashboard,
  Loader2,
  Settings as SettingsIcon,
  XCircle,
} from 'lucide-react';

import {
  useBackgroundScanState,
} from '@/lib/mediacrater/backgroundScanStore';
```

with:

```tsx
import {
  CheckCircle2,
  History,
  LayoutDashboard,
  Loader2,
  Pause,
  Settings as SettingsIcon,
  XCircle,
} from 'lucide-react';

import {
  useBackgroundScanState,
  type BackgroundScanState,
} from '@/lib/mediacrater/backgroundScanStore';
```

## 10.2 Replace only `DashboardScanStatus()`

Replace the existing function with:

```tsx
function DashboardScanStatus({
  scan,
}: {
  scan: BackgroundScanState;
}) {
  if (scan.batchItems.length > 1) {
    return (
      <span
        className="ml-auto inline-flex items-center gap-0.5"
        aria-label="Batch scan status"
      >
        {scan.batchItems.map((item) => {
          if (item.status === 'processing') {
            return (
              <Loader2
                key={item.creativeId}
                className="w-3.5 h-3.5 animate-spin text-primary"
                aria-label={`Batch position ${item.batchPosition} processing`}
              />
            );
          }

          if (item.status === 'success') {
            return (
              <CheckCircle2
                key={item.creativeId}
                className="w-3.5 h-3.5 text-green-600 dark:text-green-400"
                aria-label={`Batch position ${item.batchPosition} complete`}
              />
            );
          }

          if (item.status === 'error') {
            return (
              <XCircle
                key={item.creativeId}
                className="w-3.5 h-3.5 text-red-600 dark:text-red-400"
                aria-label={`Batch position ${item.batchPosition} failed`}
              />
            );
          }

          return (
            <Pause
              key={item.creativeId}
              className={
                item.status === 'cooldown'
                  ? 'w-3.5 h-3.5 text-amber-500'
                  : 'w-3.5 h-3.5 text-muted-foreground/50'
              }
              aria-label={
                item.status === 'cooldown'
                  ? `Batch position ${item.batchPosition} waiting for cooldown`
                  : `Batch position ${item.batchPosition} queued`
              }
            />
          );
        })}
      </span>
    );
  }

  if (
    scan.status === 'preparing' ||
    scan.status === 'running'
  ) {
    return (
      <span
        className="ml-auto inline-flex items-center text-primary"
        title="Scan in progress"
        aria-label="Scan in progress"
      >
        <Loader2
          className="w-4 h-4 animate-spin"
          aria-hidden="true"
        />
      </span>
    );
  }

  if (scan.status === 'completed') {
    return (
      <span
        className="ml-auto inline-flex items-center text-green-600 dark:text-green-400"
        title="Scan complete"
        aria-label="Scan complete"
      >
        <CheckCircle2
          className="w-4 h-4"
          aria-hidden="true"
        />
      </span>
    );
  }

  if (scan.status === 'error') {
    return (
      <span
        className="ml-auto inline-flex items-center text-red-600 dark:text-red-400"
        title="Scan failed"
        aria-label="Scan failed"
      >
        <XCircle
          className="w-4 h-4"
          aria-hidden="true"
        />
      </span>
    );
  }

  return null;
}
```

## 10.3 Change the call site

Replace:

```tsx
<DashboardScanStatus
  status={backgroundScan.status}
/>
```

with:

```tsx
<DashboardScanStatus
  scan={backgroundScan}
/>
```

---

# 11. `components/scan-workspace.tsx`

This is the largest change, but keep it surgical: change the named blocks below rather than replacing the whole file.

## 11.1 Add store import

Replace:

```tsx
  failBackgroundScan,
  updateBackgroundScanProgress,
  useBackgroundScanState,
```

with:

```tsx
  failBackgroundScan,
  updateBackgroundBatchItem,
  updateBackgroundScanProgress,
  useBackgroundScanState,
  type BackgroundBatchItem,
```

## 11.2 Add constants

After:

```tsx
const MAX_VIDEO_SECONDS = 121;
```

add:

```tsx
const MAX_BATCH_FILES = 5;
const BATCH_COOLDOWN_SECONDS = 5;
```

## 11.3 Replace feedback/result types and add creative types

Replace:

```tsx
export interface CompletedScanFeedbackTarget {
  scanIds: string[];
}

interface PlatformResult {
  platform: string;
  riskLevel: string;
  riskClass: string;
  processedViolations: Violation[];
}
```

with:

```tsx
type CreativeKind =
  | 'video'
  | 'image';

interface CreativeBase {
  id: string;
  file: File;
  previewUrl: string;
  platforms: string[];
}

interface ImageCreative
  extends CreativeBase {
  kind: 'image';
}

interface VideoCreative
  extends CreativeBase {
  kind: 'video';
  scanType: ScanType;
  analyzeAudio: boolean;
}

type BatchCreative =
  | ImageCreative
  | VideoCreative;

export interface CompletedScanFeedbackItem {
  creativeId: string;
  fileName: string;
  batchPosition: number | null;
  scanIds: string[];
}

export interface CompletedScanFeedbackTarget {
  isBatch: boolean;
  items: CompletedScanFeedbackItem[];
}

interface PlatformResult {
  creativeId: string;
  fileName: string;
  fileKind: CreativeKind;
  batchPosition: number | null;
  scanId: string;
  platform: string;
  riskLevel: string;
  riskClass: string;
  processedViolations: Violation[];
}
```

## 11.4 Add module helpers before `ScanWorkspace`

Add:

```tsx
function orderCreativesForExecution(
  creatives: BatchCreative[]
) {
  return [
    ...creatives.filter(
      (creative) =>
        creative.kind === 'image'
    ),
    ...creatives.filter(
      (creative) =>
        creative.kind === 'video'
    ),
  ];
}

function buildFeedbackTarget(
  results: PlatformResult[],
  isBatch: boolean
): CompletedScanFeedbackTarget | null {
  const grouped =
    new Map<
      string,
      CompletedScanFeedbackItem
    >();

  for (const result of results) {
    const existing =
      grouped.get(
        result.creativeId
      );

    if (existing) {
      existing.scanIds.push(
        result.scanId
      );

      continue;
    }

    grouped.set(
      result.creativeId,
      {
        creativeId:
          result.creativeId,
        fileName:
          result.fileName,
        batchPosition:
          result.batchPosition,
        scanIds: [
          result.scanId,
        ],
      }
    );
  }

  const items =
    Array.from(
      grouped.values()
    );

  if (items.length === 0) {
    return null;
  }

  return {
    isBatch,
    items,
  };
}

function waitWithAbort(
  ms: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise(
    (resolve, reject) => {
      if (signal.aborted) {
        reject(
          new DOMException(
            'Aborted',
            'AbortError'
          )
        );

        return;
      }

      const onAbort = () => {
        clearTimeout(timeout);

        reject(
          new DOMException(
            'Aborted',
            'AbortError'
          )
        );
      };

      const timeout =
        window.setTimeout(
          () => {
            signal.removeEventListener(
              'abort',
              onAbort
            );

            resolve();
          },
          ms
        );

      signal.addEventListener(
        'abort',
        onAbort,
        { once: true }
      );
    }
  );
}

function shouldStopBatch(
  error: unknown
) {
  const message =
    error instanceof Error
      ? error.message
      : String(error || '');

  return (
    message.includes(
      'Not authenticated'
    ) ||
    message.includes(
      'Unauthorized'
    ) ||
    message.includes(
      'ACCOUNT_FLAGGED'
    ) ||
    message.includes(
      'locked pending resolution'
    ) ||
    message.includes(
      'Insufficient tokens'
    ) ||
    message.includes(
      'Scan limit reached'
    ) ||
    message.includes(
      'Rate limit exceeded'
    ) ||
    message.includes(
      'already have a scan in progress'
    ) ||
    message.includes(
      'Batch scanning is available on paid plans only'
    ) ||
    message.includes(
      'Invalid batch metadata'
    ) ||
    message.includes(
      'Unable to validate scan batch'
    )
  );
}
```

## 11.5 Replace single-file/global-option state

Replace:

```tsx
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileKind, setFileKind] = useState<'video' | 'image' | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const [platforms, setPlatforms] = useState<string[]>([]);
  const [scanType, setScanType] = useState<ScanType>('regular');
  // Opt-in — audio is only extracted and sent when this is checked.
  // Video scans only; irrelevant for images and reset whenever a new
  // file is chosen via removeFile()/resetForNewScan().
  const [analyzeAudio, setAnalyzeAudio] = useState(false);
  const [canCancel, setCanCancel] = useState(true);
```

with:

```tsx
  const [
    creatives,
    setCreatives,
  ] =
    useState<BatchCreative[]>([]);

  const [
    platformCreativeId,
    setPlatformCreativeId,
  ] =
    useState<string | null>(null);

  const [
    videoCreativeId,
    setVideoCreativeId,
  ] =
    useState<string | null>(null);

  const [
    selectedResultCreativeId,
    setSelectedResultCreativeId,
  ] =
    useState<string | null>(null);

  const [isDragOver, setIsDragOver] =
    useState(false);

  const [canCancel, setCanCancel] =
    useState(true);
```

## 11.6 Add a preview URL ref

After:

```tsx
const fileInputRef = useRef<HTMLInputElement | null>(null);
```

add:

```tsx
const previewUrlsRef =
  useRef<Set<string>>(
    new Set()
  );
```

## 11.7 Replace the old derived single-file settings

Replace:

```tsx
  const isVideo = fileKind === 'video';
  const canDeepScan = Boolean(profile?.deep_scan_enabled);
  const canAnalyzeAudio = Boolean(profile?.audio_analysis);
  const scansRemaining = profile?.scans_remaining ?? 0;

  const scanCostPerPlatform = isVideo && scanType === 'deep' ? 2 : 1;
  const totalCost = platforms.length > 0 ? platforms.length * scanCostPerPlatform : scanCostPerPlatform;
```

with:

```tsx
  const canDeepScan =
    Boolean(
      profile?.deep_scan_enabled
    );

  const canAnalyzeAudio =
    Boolean(
      profile?.audio_analysis
    );

  const canBatchScan =
    Boolean(profile) &&
    profile?.plan !== 'free';

  const scansRemaining =
    profile?.scans_remaining ?? 0;

  const videoCreatives =
    creatives.filter(
      (
        creative
      ): creative is VideoCreative =>
        creative.kind === 'video'
    );

  const platformCreative =
    creatives.find(
      (creative) =>
        creative.id ===
        platformCreativeId
    ) ??
    creatives[0] ??
    null;

  const selectedVideoCreative =
    videoCreatives.find(
      (creative) =>
        creative.id ===
        videoCreativeId
    ) ??
    videoCreatives[0] ??
    null;

  const executionPreview =
    orderCreativesForExecution(
      creatives
    );

  const allCreativesConfigured =
    creatives.length > 0 &&
    creatives.every(
      (creative) =>
        creative.platforms.length > 0
    );

  const totalCost =
    creatives.reduce(
      (
        total,
        creative
      ) => {
        const perPlatformCost =
          creative.kind ===
            'video' &&
          creative.scanType ===
            'deep'
            ? 2
            : 1;

        return (
          total +
          creative.platforms.length *
            perPlatformCost
        );
      },
      0
    );
```

## 11.8 Replace the preview cleanup effect

Replace:

```tsx
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!canAnalyzeAudio) setAnalyzeAudio(false);
  }, [canAnalyzeAudio]);
```

with:

```tsx
  useEffect(() => {
    return () => {
      for (
        const url of
        previewUrlsRef.current
      ) {
        URL.revokeObjectURL(
          url
        );
      }

      previewUrlsRef.current.clear();

      if (timerRef.current) {
        clearInterval(
          timerRef.current
        );
      }
    };
  }, []);

  useEffect(() => {
    if (canAnalyzeAudio) {
      return;
    }

    setCreatives(
      (previous) =>
        previous.map(
          (creative) =>
            creative.kind ===
            'video'
              ? {
                  ...creative,
                  analyzeAudio:
                    false,
                }
              : creative
        )
    );
  }, [canAnalyzeAudio]);
```

## 11.9 Update completed-state rehydration

Replace:

```tsx
      setResults(
        backgroundScan.results as PlatformResult[]
      );

      onResultsChange?.({
        scanIds:
          backgroundScan.scanIds,
      });
```

with:

```tsx
      const restoredResults =
        backgroundScan.results as PlatformResult[];

      setResults(
        restoredResults
      );

      setSelectedResultCreativeId(
        backgroundScan.batchItems[0]
          ?.creativeId ??
          restoredResults[0]
            ?.creativeId ??
          null
      );

      onResultsChange?.(
        buildFeedbackTarget(
          restoredResults,
          backgroundScan.batchItems
            .length > 1
        )
      );
```

## 11.10 Replace `handleFile()`, `removeFile()`, `togglePlatform()`, and `resetForNewScan()`

Replace that complete helper block with:

```tsx
  async function prepareCreative(
    file: File
  ): Promise<BatchCreative> {
    if (
      !VALID_TYPES.includes(
        file.type
      )
    ) {
      throw new Error(
        'INVALID_FILE_TYPE'
      );
    }

    if (
      file.size >
      MAX_FILE_BYTES
    ) {
      throw new Error(
        'FILE_TOO_LARGE'
      );
    }

    const kind:
      CreativeKind =
        file.type.startsWith(
          'video/'
        )
          ? 'video'
          : 'image';

    const objectUrl =
      URL.createObjectURL(
        file
      );

    try {
      if (kind === 'video') {
        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            const probe =
              document.createElement(
                'video'
              );

            const timeout =
              window.setTimeout(
                () =>
                  reject(
                    new Error(
                      'CORRUPT_FILE'
                    )
                  ),
                10000
              );

            probe.addEventListener(
              'loadedmetadata',
              () => {
                clearTimeout(
                  timeout
                );

                if (
                  !isFinite(
                    probe.duration
                  ) ||
                  probe.duration <= 0 ||
                  probe.videoWidth ===
                    0 ||
                  probe.videoHeight ===
                    0
                ) {
                  reject(
                    new Error(
                      'CORRUPT_FILE'
                    )
                  );

                  return;
                }

                if (
                  probe.duration >
                  MAX_VIDEO_SECONDS
                ) {
                  reject(
                    new Error(
                      'VIDEO_TOO_LONG'
                    )
                  );

                  return;
                }

                resolve();
              },
              { once: true }
            );

            probe.addEventListener(
              'error',
              () => {
                clearTimeout(
                  timeout
                );

                reject(
                  new Error(
                    'CORRUPT_FILE'
                  )
                );
              },
              { once: true }
            );

            probe.src =
              objectUrl;
          }
        );
      } else {
        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            const image =
              new Image();

            const timeout =
              window.setTimeout(
                () =>
                  reject(
                    new Error(
                      'CORRUPT_FILE'
                    )
                  ),
                5000
              );

            image.onload = () => {
              clearTimeout(
                timeout
              );

              if (
                image.naturalWidth ===
                  0 ||
                image.naturalHeight ===
                  0
              ) {
                reject(
                  new Error(
                    'CORRUPT_FILE'
                  )
                );

                return;
              }

              resolve();
            };

            image.onerror =
              () => {
                clearTimeout(
                  timeout
                );

                reject(
                  new Error(
                    'CORRUPT_FILE'
                  )
                );
              };

            image.src =
              objectUrl;
          }
        );
      }

      previewUrlsRef.current.add(
        objectUrl
      );

      const base = {
        id:
          crypto.randomUUID(),
        file,
        previewUrl:
          objectUrl,
        platforms: [],
      };

      return kind === 'video'
        ? {
            ...base,
            kind: 'video',
            scanType:
              'regular',
            analyzeAudio:
              false,
          }
        : {
            ...base,
            kind: 'image',
          };
    } catch (error) {
      URL.revokeObjectURL(
        objectUrl
      );

      throw error;
    }
  }

  async function handleFiles(
    files: File[]
  ) {
    clearBackgroundScanState();
    setBanner(null);
    setResults(null);
    setSelectedResultCreativeId(
      null
    );
    onResultsChange?.(null);

    if (files.length === 0) {
      return;
    }

    const maxFiles =
      canBatchScan
        ? MAX_BATCH_FILES
        : 1;

    if (
      !canBatchScan &&
      (
        files.length > 1 ||
        creatives.length > 0
      )
    ) {
      setBanner({
        tone: 'warning',
        title:
          'Paid plan required',
        message:
          'Batch scanning is available on paid plans. Free accounts can scan one creative at a time.',
        actionLabel:
          'Upgrade plan',
        onAction: () =>
          window.location.assign(
            '/buy-tokens'
          ),
      });

      return;
    }

    if (
      creatives.length +
        files.length >
      maxFiles
    ) {
      setBanner({
        tone: 'warning',
        title:
          'Batch limit reached',
        message:
          `You can upload up to ${maxFiles} creative${maxFiles === 1 ? '' : 's'} at a time.`,
      });

      return;
    }

    const prepared:
      BatchCreative[] = [];

    try {
      for (
        const file of files
      ) {
        prepared.push(
          await prepareCreative(
            file
          )
        );
      }
    } catch (error: any) {
      for (
        const creative of
        prepared
      ) {
        if (
          creative.previewUrl
            .startsWith('blob:')
        ) {
          URL.revokeObjectURL(
            creative.previewUrl
          );

          previewUrlsRef.current.delete(
            creative.previewUrl
          );
        }
      }

      if (
        error?.message ===
        'VIDEO_TOO_LONG'
      ) {
        setBanner({
          tone: 'error',
          title:
            'Video too long',
          message:
            'Most platforms recommend 15-60 seconds for optimal engagement. Maximum allowed length is 2 minutes.',
        });
      } else if (
        error?.message ===
        'FILE_TOO_LARGE'
      ) {
        setBanner({
          tone: 'error',
          title:
            'File too large',
          message:
            'Ads are typically under 1 GB. Please compress your video first.',
        });
      } else if (
        error?.message ===
        'INVALID_FILE_TYPE'
      ) {
        setBanner({
          tone: 'error',
          title:
            'Invalid file type',
          message:
            'Please upload a valid video (MP4, MOV, WebM) or image (PNG, JPG, GIF) file.',
        });
      } else {
        setBanner({
          tone: 'error',
          title:
            'Corrupt file',
          message:
            "Your content seems to be corrupt or we don't support this file type. Please upload another file or convert this file into a supported format.",
        });
      }

      return;
    }

    setCreatives(
      (previous) => [
        ...previous,
        ...prepared,
      ]
    );

    setPlatformCreativeId(
      (previous) =>
        previous ??
        prepared[0]?.id ??
        null
    );

    const firstNewVideo =
      prepared.find(
        (
          creative
        ): creative is VideoCreative =>
          creative.kind ===
          'video'
      );

    if (firstNewVideo) {
      setVideoCreativeId(
        (previous) =>
          previous ??
          firstNewVideo.id
      );
    }

    if (
      fileInputRef.current
    ) {
      fileInputRef.current.value =
        '';
    }
  }

  function removeCreative(
    creativeId: string
  ) {
    const creative =
      creatives.find(
        (item) =>
          item.id ===
          creativeId
      );

    if (
      creative?.previewUrl
        .startsWith('blob:')
    ) {
      URL.revokeObjectURL(
        creative.previewUrl
      );

      previewUrlsRef.current.delete(
        creative.previewUrl
      );
    }

    const next =
      creatives.filter(
        (item) =>
          item.id !==
          creativeId
      );

    setCreatives(next);

    setPlatformCreativeId(
      (previous) =>
        previous ===
        creativeId
          ? next[0]?.id ??
            null
          : previous
    );

    const nextVideos =
      next.filter(
        (
          item
        ): item is VideoCreative =>
          item.kind ===
          'video'
      );

    setVideoCreativeId(
      (previous) =>
        previous ===
        creativeId
          ? nextVideos[0]
              ?.id ??
            null
          : previous
    );

    clearBackgroundScanState();
    setResults(null);
    setSelectedResultCreativeId(
      null
    );
    onResultsChange?.(null);

    if (
      fileInputRef.current
    ) {
      fileInputRef.current.value =
        '';
    }
  }

  function togglePlatform(
    creativeId: string,
    value: string
  ) {
    setCreatives(
      (previous) =>
        previous.map(
          (creative) =>
            creative.id ===
            creativeId
              ? {
                  ...creative,
                  platforms:
                    creative.platforms.includes(
                      value
                    )
                      ? creative.platforms.filter(
                          (
                            platform
                          ) =>
                            platform !==
                            value
                        )
                      : [
                          ...creative.platforms,
                          value,
                        ],
                }
              : creative
        )
    );
  }

  function applyPlatformsToAll() {
    if (!platformCreative) {
      return;
    }

    const nextPlatforms = [
      ...platformCreative.platforms,
    ];

    setCreatives(
      (previous) =>
        previous.map(
          (creative) => ({
            ...creative,
            platforms: [
              ...nextPlatforms,
            ],
          })
        )
    );
  }

  function updateSelectedVideo(
    patch: Partial<
      Pick<
        VideoCreative,
        'scanType' |
        'analyzeAudio'
      >
    >
  ) {
    if (
      !selectedVideoCreative
    ) {
      return;
    }

    setCreatives(
      (previous) =>
        previous.map(
          (creative) =>
            creative.id ===
              selectedVideoCreative.id &&
            creative.kind ===
              'video'
              ? {
                  ...creative,
                  ...patch,
                }
              : creative
        )
    );
  }

  function applyVideoSettingsToAll() {
    if (
      !selectedVideoCreative
    ) {
      return;
    }

    setCreatives(
      (previous) =>
        previous.map(
          (creative) =>
            creative.kind ===
            'video'
              ? {
                  ...creative,
                  scanType:
                    selectedVideoCreative.scanType,
                  analyzeAudio:
                    selectedVideoCreative.analyzeAudio,
                }
              : creative
        )
    );
  }

  function resetForNewScan() {
    for (
      const creative of
      creatives
    ) {
      if (
        creative.previewUrl
          .startsWith('blob:')
      ) {
        URL.revokeObjectURL(
          creative.previewUrl
        );

        previewUrlsRef.current.delete(
          creative.previewUrl
        );
      }
    }

    setCreatives([]);
    setPlatformCreativeId(
      null
    );
    setVideoCreativeId(
      null
    );
    setSelectedResultCreativeId(
      null
    );
    setResults(null);
    setBanner(null);

    clearBackgroundScanState();
    onResultsChange?.(null);

    if (
      fileInputRef.current
    ) {
      fileInputRef.current.value =
        '';
    }
  }
```

## 11.11 Add a visible five-second cooldown helper after `handleCancelAnalysis()`

Add:

```tsx
  async function runBatchCooldown(
    signal: AbortSignal,
    messagePrefix: string
  ) {
    if (mountedRef.current) {
      setCanCancel(true);
    }

    for (
      let remaining =
        BATCH_COOLDOWN_SECONDS;
      remaining >= 1;
      remaining--
    ) {
      publishScanProgress(
        `${messagePrefix} ${remaining} second${remaining === 1 ? '' : 's'}...`,
        'running'
      );

      await waitWithAbort(
        1000,
        signal
      );
    }
  }
```

## 11.12 Replace `performAnalysis()` completely, but only that function

Replace the current `performAnalysis(signal)` function with:

```tsx
  async function performAnalysis(
    signal: AbortSignal,
    userId: string,
    executionCreatives:
      BatchCreative[]
  ) {
    const isBatch =
      executionCreatives.length >
      1;

    let batchId:
      string | null = null;

    if (isBatch) {
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
        console.error(
          '[CLIENT BATCH] Could not create batch:',
          batchError
        );

        throw new Error(
          'Unable to create scan batch.'
        );
      }
    }

    const allResults:
      PlatformResult[] = [];

    const completedScanIds:
      string[] = [];

    for (
      let creativeIndex = 0;
      creativeIndex <
      executionCreatives.length;
      creativeIndex++
    ) {
      const creative =
        executionCreatives[
          creativeIndex
        ];

      const batchPosition =
        isBatch
          ? creativeIndex + 1
          : null;

      const operationId =
        backgroundOperationIdRef.current;

      if (
        isBatch &&
        operationId
      ) {
        updateBackgroundBatchItem(
          operationId,
          creative.id,
          {
            status:
              'processing',
            error: null,
          }
        );
      }

      const label =
        isBatch
          ? `Creative ${creativeIndex + 1} of ${executionCreatives.length}`
          : 'Your creative';

      publishScanProgress(
        `${label}: preparing ${creative.kind}...`,
        'preparing'
      );

      const creativeStartTime =
        Date.now();

      let frames:
        ExtractedFrame[] = [];

      let framesExtractedTime:
        number | null = null;

      let audio:
        {
          data: string;
          mimeType: string;
        } |
        null = null;

      try {
        if (
          creative.kind ===
          'video'
        ) {
          frames =
            await extractFrames(
              creative.file,
              signal,
              creative.scanType
            );

          framesExtractedTime =
            Date.now();

          if (
            creative.analyzeAudio &&
            canAnalyzeAudio
          ) {
            publishScanProgress(
              `${label}: preparing audio track...`,
              'preparing'
            );

            audio =
              await extractAudio(
                creative.file,
                signal
              );
          }
        } else {
          const imageData =
            await fileToBase64(
              creative.file
            );

          frames = [{
            frameNumber: 1,
            timestamp:
              '00:00.00',
            timestampSeconds:
              0,
            data: imageData,
          }];

          framesExtractedTime =
            Date.now();
        }

        let thumbnailPath:
          string | null = null;

        if (
          profile?.scan_history &&
          frames[0]
        ) {
          const thumbnailScanId =
            crypto.randomUUID();

          thumbnailPath =
            await uploadScanThumbnail(
              userId,
              thumbnailScanId,
              frames[0].data
            );
        }

        const framesWaitMs =
          framesExtractedTime
            ? framesExtractedTime -
              creativeStartTime
            : 0;

        const batchMeta =
          isBatch &&
          batchId &&
          batchPosition
            ? {
                batchedByClient:
                  true,
                batchId,
                batchPosition,
              }
            : undefined;

        const creativeResults:
          PlatformResult[] = [];

        const creativeScanIds:
          string[] = [];

        let creativeError:
          Error | null = null;

        for (
          let platformIndex = 0;
          platformIndex <
          creative.platforms.length;
          platformIndex++
        ) {
          const platform =
            creative.platforms[
              platformIndex
            ];

          const scanId =
            crypto.randomUUID();

          const scanStartTime =
            Date.now();

          const fileName =
            profile?.scan_history
              ? creative.file.name
              : null;

          try {
            publishScanProgress(
              `${label}: analyzing against ${platform.toUpperCase()} policies...`,
              'running'
            );

            if (
              mountedRef.current
            ) {
              setCanCancel(
                false
              );
            }

            let response =
              creative.kind ===
              'video'
                ? await scanVideo(
                    frames,
                    audio,
                    platform,
                    creative.scanType,
                    null,
                    signal,
                    scanId,
                    thumbnailPath,
                    fileName,
                    batchMeta
                  )
                : await scanImage(
                    frames[0].data,
                    platform,
                    null,
                    signal,
                    scanId,
                    thumbnailPath,
                    fileName,
                    batchMeta
                  );

            let queueEnteredAt:
              number | null = null;

            let queueWaitMs =
              0;

            let jobId:
              string | null = null;

            while (
              'queued' in
                response &&
              response.queued
            ) {
              if (
                !queueEnteredAt
              ) {
                queueEnteredAt =
                  Date.now();
              }

              jobId =
                response.jobId;

              currentJobIdRef.current =
                jobId;

              if (
                mountedRef.current
              ) {
                setCanCancel(
                  true
                );
              }

              publishScanProgress(
                `${label}: queued at position ${response.position}. Waiting for your turn...`,
                'running'
              );

              await waitForQueueTurn(
                jobId,
                signal,
                (position) =>
                  publishScanProgress(
                    `${label}: queued at position ${position}. Waiting for your turn...`,
                    'running'
                  )
              );

              currentJobIdRef.current =
                null;

              queueWaitMs =
                Date.now() -
                (
                  queueEnteredAt as number
                );

              publishScanProgress(
                `${label}: analyzing against ${platform.toUpperCase()} policies...`,
                'running'
              );

              if (
                mountedRef.current
              ) {
                setCanCancel(
                  false
                );
              }

              response =
                creative.kind ===
                  'video'
                  ? await scanVideo(
                      frames,
                      audio,
                      platform,
                      creative.scanType,
                      jobId,
                      signal,
                      scanId,
                      thumbnailPath,
                      fileName,
                      batchMeta
                    )
                  : await scanImage(
                      frames[0].data,
                      platform,
                      jobId,
                      signal,
                      scanId,
                      thumbnailPath,
                      fileName,
                      batchMeta
                    );
            }

            const completed =
              response as Extract<
                typeof response,
                {
                  success: true;
                }
              >;

            if (jobId) {
              reportQueueTiming(
                jobId,
                {
                  totalTimeMs:
                    Date.now() -
                    scanStartTime,
                  queueWaitMs,
                  framesWaitMs,
                }
              );
            }

            const {
              riskLevel,
              riskClass,
              processedViolations,
            } =
              calculateConfidenceScore(
                completed.result
                  .violations as Violation[]
              );

            creativeResults.push({
              creativeId:
                creative.id,
              fileName:
                creative.file.name,
              fileKind:
                creative.kind,
              batchPosition,
              scanId,
              platform:
                completed.result
                  .platform,
              riskLevel,
              riskClass,
              processedViolations,
            });

            creativeScanIds.push(
              scanId
            );
          } catch (
            error: any
          ) {
            if (
              error?.name ===
                'AbortError' ||
              signal.aborted
            ) {
              throw error;
            }

            if (
              isBatch &&
              shouldStopBatch(
                error
              )
            ) {
              throw error;
            }

            if (!isBatch) {
              throw error;
            }

            if (
              !creativeError
            ) {
              creativeError =
                error instanceof
                  Error
                  ? error
                  : new Error(
                      'Creative scan failed.'
                    );
            }
          }

          if (
            isBatch &&
            platformIndex <
              creative.platforms.length -
                1
          ) {
            await runBatchCooldown(
              signal,
              `${label}: next platform scan starting in`
            );
          }
        }

        allResults.push(
          ...creativeResults
        );

        completedScanIds.push(
          ...creativeScanIds
        );

        if (
          isBatch &&
          operationId
        ) {
          updateBackgroundBatchItem(
            operationId,
            creative.id,
            {
              status:
                creativeError
                  ? 'error'
                  : 'success',
              scanIds:
                creativeScanIds,
              error:
                creativeError
                  ? 'One or more scans for this creative could not be completed.'
                  : null,
            }
          );
        }
      } catch (
        error: any
      ) {
        if (
          error?.name ===
            'AbortError' ||
          signal.aborted ||
          shouldStopBatch(
            error
          )
        ) {
          throw error;
        }

        if (!isBatch) {
          throw error;
        }

        if (
          operationId
        ) {
          updateBackgroundBatchItem(
            operationId,
            creative.id,
            {
              status: 'error',
              scanIds: [],
              error:
                'This creative could not be prepared or completed.',
            }
          );
        }
      }

      if (
        isBatch &&
        creativeIndex <
          executionCreatives.length -
            1
      ) {
        const nextCreative =
          executionCreatives[
            creativeIndex + 1
          ];

        if (
          operationId
        ) {
          updateBackgroundBatchItem(
            operationId,
            nextCreative.id,
            {
              status:
                'cooldown',
            }
          );
        }

        await runBatchCooldown(
          signal,
          `Scan ${creativeIndex + 1} of ${executionCreatives.length} complete. Next scan starting in`
        );
      }
    }

    const operationId =
      backgroundOperationIdRef.current;

    if (operationId) {
      completeBackgroundScan(
        operationId,
        allResults,
        completedScanIds
      );
    }

    if (
      mountedRef.current
    ) {
      setResults(
        allResults
      );

      setSelectedResultCreativeId(
        executionCreatives[0]
          ?.id ??
          allResults[0]
            ?.creativeId ??
          null
      );

      onResultsChange?.(
        buildFeedbackTarget(
          allResults,
          isBatch
        )
      );

      await onScanComplete();
    }
  }
```

Important behavior:
- images are sorted ahead of videos before this function is called;
- one failed batch creative does not stop ordinary later creatives;
- fatal account/auth/rate-limit problems stop the batch;
- a five-second cooldown occurs between logical platform scans inside a batch and between creatives;
- queue retries for the same logical scan do not add another artificial cooldown.

## 11.13 Replace `handleAnalyze()` preflight/start section

Inside `handleAnalyze()`, replace the old scan-balance block plus `beginBackgroundScan()` call with:

```tsx
    if (
      creatives.length > 1 &&
      !canBatchScan
    ) {
      setBanner({
        tone: 'warning',
        title:
          'Paid plan required',
        message:
          'Batch scanning is available on paid plans only.',
        actionLabel:
          'Upgrade plan',
        onAction: () =>
          window.location.assign(
            '/buy-tokens'
          ),
      });

      return;
    }

    if (
      !allCreativesConfigured
    ) {
      setBanner({
        tone: 'warning',
        title:
          'Choose target platforms',
        message:
          'Every creative needs at least one target platform before analysis can start.',
      });

      return;
    }

    if (
      scansRemaining <
      totalCost
    ) {
      setBanner({
        tone: 'warning',
        title:
          'Not enough scans',
        message:
          creatives.length > 1
            ? `This batch requires ${totalCost} scans. You have ${scansRemaining} remaining. Reduce the selected platforms, use Regular Scan where appropriate, or upgrade your plan.`
            : `This scan requires ${totalCost} scan${totalCost === 1 ? '' : 's'}. You have ${scansRemaining} remaining.`,
        actionLabel:
          'Upgrade plan',
        onAction: () =>
          window.location.assign(
            '/buy-tokens'
          ),
      });

      return;
    }

    const executionCreatives =
      orderCreativesForExecution(
        creatives
      );

    const initialBatchItems:
      BackgroundBatchItem[] =
        executionCreatives.length >
        1
          ? executionCreatives.map(
              (
                creative,
                index
              ) => ({
                creativeId:
                  creative.id,
                fileName:
                  creative.file.name,
                fileKind:
                  creative.kind,
                batchPosition:
                  index + 1,
                status:
                  'queued',
                scanIds: [],
                error: null,
              })
            )
          : [];

    const operationId =
      beginBackgroundScan(
        'Preparing analysis...',
        initialBatchItems
      );
```

Then change:

```tsx
      await performAnalysis(controller.signal);
```

to:

```tsx
      await performAnalysis(
        controller.signal,
        session.user.id,
        executionCreatives
      );
```

## 11.14 Add batch errors to the existing catch taxonomy

After:

```tsx
      const isAudioLockedError =
        message.includes('Audio analysis unavailable') ||
        message.includes('Audio analysis is available on paid plans only');
```

add:

```tsx
      const isBatchLockedError =
        message.includes(
          'Batch scanning unavailable'
        ) ||
        message.includes(
          'Batch scanning is available on paid plans only'
        );

      const isBatchMetadataError =
        message.includes(
          'Invalid batch metadata'
        ) ||
        message.includes(
          'Unable to validate scan batch'
        ) ||
        message.includes(
          'Unable to create scan batch'
        );
```

Before the final generic `else`, add:

```tsx
      } else if (
        isBatchLockedError
      ) {
        recordFailure({
          tone: 'warning',
          title:
            'Paid plan required',
          message:
            'Batch scanning is available on paid plans only.',
          actionLabel:
            'Upgrade plan',
          onAction: () =>
            window.location.assign(
              '/buy-tokens'
            ),
        });
      } else if (
        isBatchMetadataError
      ) {
        recordFailure({
          tone: 'error',
          title:
            'Batch could not start',
          message:
            'The batch could not be validated. Please start a new batch and try again.',
        });
```

## 11.15 Replace `analyzeDisabled`

Replace:

```tsx
const analyzeDisabled = !currentFile || platforms.length === 0 || isAnalyzing;
```

with:

```tsx
const analyzeDisabled =
  creatives.length === 0 ||
  !allCreativesConfigured ||
  isAnalyzing;
```

## 11.16 Replace the upload/config JSX block

Replace the current upload + single preview + Platforms + Scan Type + Audio sections with this block:

```tsx
            {/* Upload */}
            {creatives.length <
              (
                canBatchScan
                  ? MAX_BATCH_FILES
                  : 1
              ) && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() =>
                  setIsDragOver(false)
                }
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);

                  handleFiles(
                    Array.from(
                      e.dataTransfer
                        .files ??
                        []
                    )
                  );
                }}
                onClick={() =>
                  fileInputRef.current
                    ?.click()
                }
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  isDragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/60'
                }`}
              >
                <input
                  ref={
                    fileInputRef
                  }
                  type="file"
                  multiple={
                    canBatchScan
                  }
                  accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/gif"
                  className="hidden"
                  onChange={(e) =>
                    handleFiles(
                      Array.from(
                        e.target
                          .files ??
                          []
                      )
                    )
                  }
                />

                <p className="font-medium text-foreground">
                  {canBatchScan
                    ? 'Drop up to 5 videos or images here, or click to browse'
                    : 'Drop a video or image here, or click to browse'}
                </p>

                <p className="text-sm text-muted-foreground mt-1">
                  Supported: MP4, MOV, WebM, PNG, JPG, GIF
                </p>

                <p className="text-xs text-muted-foreground mt-1">
                  For best results, use videos at 720p or higher.
                </p>

                {!canBatchScan && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Batch scanning is available on paid plans.
                  </p>
                )}
              </div>
            )}

            {creatives.length >
              0 && (
              <>
                <div className="space-y-2">
                  {creatives.map(
                    (
                      creative
                    ) => {
                      const executionPosition =
                        executionPreview.findIndex(
                          (item) =>
                            item.id ===
                            creative.id
                        ) + 1;

                      return (
                        <div
                          key={
                            creative.id
                          }
                          className="flex items-center gap-3 border border-border rounded-lg p-3"
                        >
                          <div className="w-16 h-12 shrink-0 rounded-md overflow-hidden bg-muted">
                            {creative.kind ===
                            'video' ? (
                              <video
                                src={
                                  creative.previewUrl
                                }
                                muted
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <img
                                src={
                                  creative.previewUrl
                                }
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {
                                creative
                                  .file
                                  .name
                              }
                            </p>

                            <p className="text-xs text-muted-foreground">
                              {creative.kind ===
                              'video'
                                ? 'Video'
                                : 'Image'}

                              {creatives.length >
                                1 &&
                                ` · Batch position ${executionPosition}`}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              removeCreative(
                                creative.id
                              )
                            }
                            className="text-muted-foreground hover:text-foreground text-lg leading-none px-2"
                            aria-label={`Remove ${creative.file.name}`}
                          >
                            ×
                          </button>
                        </div>
                      );
                    }
                  )}

                  {creatives.length >
                    1 && (
                    <p className="text-xs text-muted-foreground">
                      Images are processed before videos. Batch position follows execution order.
                    </p>
                  )}
                </div>

                {/* Target Platforms */}
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                    <p className="text-sm font-semibold">
                      Target Platforms
                    </p>

                    {creatives.length >
                      1 && (
                      <div className="flex items-center gap-2">
                        <select
                          value={
                            platformCreative
                              ?.id ??
                            ''
                          }
                          onChange={(
                            event
                          ) =>
                            setPlatformCreativeId(
                              event
                                .target
                                .value
                            )
                          }
                          className="max-w-52 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                        >
                          {creatives.map(
                            (
                              creative
                            ) => (
                              <option
                                key={
                                  creative.id
                                }
                                value={
                                  creative.id
                                }
                              >
                                {
                                  creative
                                    .file
                                    .name
                                }
                              </option>
                            )
                          )}
                        </select>

                        <button
                          type="button"
                          onClick={
                            applyPlatformsToAll
                          }
                          disabled={
                            !platformCreative ||
                            platformCreative
                              .platforms
                              .length ===
                              0
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-secondary disabled:opacity-50"
                        >
                          Apply to all
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {PLATFORMS.map(
                      (platform) => {
                        const checked =
                          platformCreative
                            ?.platforms
                            .includes(
                              platform.value
                            ) ??
                          false;

                        return (
                          <label
                            key={
                              platform.value
                            }
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${
                              checked
                                ? 'border-primary bg-primary/5 text-foreground'
                                : 'border-border text-muted-foreground hover:border-primary/50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={
                                checked
                              }
                              disabled={
                                !platformCreative
                              }
                              onChange={() => {
                                if (
                                  platformCreative
                                ) {
                                  togglePlatform(
                                    platformCreative.id,
                                    platform.value
                                  );
                                }
                              }}
                              className="accent-current"
                            />

                            <img
                              src={
                                platform.icon
                              }
                              alt=""
                              className="w-4 h-4 object-contain"
                            />

                            {
                              platform.label
                            }
                          </label>
                        );
                      }
                    )}
                  </div>
                </div>

                {/* Video-only settings */}
                {videoCreatives.length >
                  0 &&
                  selectedVideoCreative && (
                  <div className="space-y-4">
                    {videoCreatives.length >
                      1 && (
                      <div className="flex items-center gap-2">
                        <select
                          value={
                            selectedVideoCreative.id
                          }
                          onChange={(
                            event
                          ) =>
                            setVideoCreativeId(
                              event
                                .target
                                .value
                            )
                          }
                          className="max-w-52 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                        >
                          {videoCreatives.map(
                            (
                              creative
                            ) => (
                              <option
                                key={
                                  creative.id
                                }
                                value={
                                  creative.id
                                }
                              >
                                {
                                  creative
                                    .file
                                    .name
                                }
                              </option>
                            )
                          )}
                        </select>

                        <button
                          type="button"
                          onClick={
                            applyVideoSettingsToAll
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-secondary"
                        >
                          Apply video settings to all
                        </button>
                      </div>
                    )}

                    <div>
                      <p className="text-sm font-semibold mb-2">
                        Scan Type
                      </p>

                      <div className="space-y-2">
                        <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer">
                          <input
                            type="radio"
                            name={`scanType-${selectedVideoCreative.id}`}
                            checked={
                              selectedVideoCreative.scanType ===
                              'regular'
                            }
                            onChange={() =>
                              updateSelectedVideo({
                                scanType:
                                  'regular',
                              })
                            }
                            className="mt-1"
                          />

                          <span>
                            <span className="block font-medium text-sm">
                              Regular Scan
                            </span>

                            <span className="block text-xs text-muted-foreground">
                              Fast and optimized for standard commercials, "talking head" videos, and VSLs
                            </span>
                          </span>
                        </label>

                        <label
                          className={`flex items-start gap-3 p-3 rounded-lg border ${
                            canDeepScan
                              ? 'border-border cursor-pointer'
                              : 'border-border opacity-60 cursor-not-allowed'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`scanType-${selectedVideoCreative.id}`}
                            disabled={
                              !canDeepScan
                            }
                            checked={
                              selectedVideoCreative.scanType ===
                              'deep'
                            }
                            onChange={() =>
                              updateSelectedVideo({
                                scanType:
                                  'deep',
                              })
                            }
                            className="mt-1"
                          />

                          <span>
                            <span className="block font-medium text-sm">
                              Deep Scan

                              {!canDeepScan && (
                                <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                  Paid plan required
                                </span>
                              )}
                            </span>

                            <span className="block text-xs text-muted-foreground">
                              Slower, but designed for fast-paced "UGC-style" ads or montages where violations might be hidden in fast cuts
                            </span>
                          </span>
                        </label>
                      </div>
                    </div>

                    <label
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm w-fit ${
                        canAnalyzeAudio
                          ? 'border-border cursor-pointer'
                          : 'border-border opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={
                          !canAnalyzeAudio
                        }
                        checked={
                          canAnalyzeAudio &&
                          selectedVideoCreative.analyzeAudio
                        }
                        onChange={(
                          event
                        ) =>
                          updateSelectedVideo({
                            analyzeAudio:
                              event
                                .target
                                .checked,
                          })
                        }
                        className="accent-current"
                      />

                      <span className="font-medium">
                        Analyze Audio Content

                        {!canAnalyzeAudio && (
                          <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            Paid plan required
                          </span>
                        )}
                      </span>
                    </label>
                  </div>
                )}

                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    Scan cost:{' '}
                    <strong>
                      {totalCost}{' '}
                      scan
                      {totalCost ===
                      1
                        ? ''
                        : 's'}
                    </strong>
                  </span>

                  <span className="text-muted-foreground">
                    {
                      scansRemaining
                    }{' '}
                    remaining
                  </span>
                </div>
              </>
            )}

            {banner && (
              <div
                className={`p-3 rounded-lg border text-sm ${
                  banner.tone === 'error'
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-400'
                    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-400'
                }`}
              >
                <p className="font-semibold">
                  {banner.title}
                </p>

                {banner.message && (
                  <p className="mt-0.5">
                    {banner.message}
                  </p>
                )}

                {banner.actionLabel &&
                  banner.onAction && (
                  <button
                    onClick={
                      banner.onAction
                    }
                    className="mt-2 text-xs font-semibold underline underline-offset-2"
                  >
                    {
                      banner.actionLabel
                    }
                  </button>
                )}
              </div>
            )}

            {creatives.length >
              0 && (
              <button
                onClick={
                  handleAnalyze
                }
                disabled={
                  analyzeDisabled
                }
                className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatives.length >
                1
                  ? 'Analyze Batch'
                  : 'Analyze Ad'}
              </button>
            )}
```

## 11.17 Change progress heading

Replace:

```tsx
<h3 className="font-bold">Analyzing Your Ad...</h3>
```

with:

```tsx
<h3 className="font-bold">
  {backgroundScan.batchItems
    .length > 1
    ? 'Analyzing Your Batch...'
    : 'Analyzing Your Ad...'}
</h3>
```

## 11.18 Add result selector derived values before `return`

Immediately before:

```tsx
return (
```

add:

```tsx
  const isBatchResult =
    backgroundScan.batchItems
      .length > 1;

  const resultCreativeOptions =
    isBatchResult
      ? backgroundScan.batchItems.map(
          (item) => ({
            creativeId:
              item.creativeId,
            fileName:
              item.fileName,
            batchPosition:
              item.batchPosition,
            status:
              item.status,
            error:
              item.error,
          })
        )
      : Array.from(
          new Map(
            (
              results ?? []
            ).map(
              (result) => [
                result.creativeId,
                {
                  creativeId:
                    result.creativeId,
                  fileName:
                    result.fileName,
                  batchPosition:
                    result.batchPosition,
                  status:
                    'success' as const,
                  error:
                    null,
                },
              ]
            )
          ).values()
        );

  const activeResultCreativeId =
    selectedResultCreativeId ??
    resultCreativeOptions[0]
      ?.creativeId ??
    results?.[0]
      ?.creativeId ??
    null;

  const visibleResults =
    (
      results ?? []
    ).filter(
      (result) =>
        result.creativeId ===
        activeResultCreativeId
    );

  const activeResultOption =
    resultCreativeOptions.find(
      (item) =>
        item.creativeId ===
        activeResultCreativeId
    ) ??
    null;
```

## 11.19 Replace the start of the results block

Immediately after the existing Results heading/New Scan row and before `results.map(...)`, add:

```tsx
            {isBatchResult && (
              <>
                <div className="flex flex-wrap gap-2">
                  {resultCreativeOptions.map(
                    (item) => (
                      <button
                        key={
                          item.creativeId
                        }
                        type="button"
                        onClick={() =>
                          setSelectedResultCreativeId(
                            item.creativeId
                          )
                        }
                        className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                          activeResultCreativeId ===
                          item.creativeId
                            ? 'border-primary bg-primary/5 text-foreground'
                            : 'border-border text-muted-foreground hover:border-primary/50'
                        }`}
                      >
                        #{item.batchPosition}{' '}
                        {item.fileName}{' '}

                        {item.status ===
                        'success'
                          ? '✓'
                          : item.status ===
                            'error'
                          ? '✕'
                          : ''}
                      </button>
                    )
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  {
                    backgroundScan.batchItems.filter(
                      (item) =>
                        item.status ===
                        'success'
                    ).length
                  }{' '}
                  of{' '}
                  {
                    backgroundScan.batchItems.length
                  }{' '}
                  creatives completed without errors.
                </p>
              </>
            )}

            {activeResultOption
              ?.status ===
              'error' && (
              <div className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-400">
                {activeResultOption.error ||
                  'One or more scans for this creative could not be completed.'}
              </div>
            )}
```

Then replace:

```tsx
{results.map((r) => {
```

with:

```tsx
{visibleResults.map((r) => {
```

and replace:

```tsx
<div key={r.platform} className="border border-border rounded-lg p-4">
```

with:

```tsx
<div
  key={`${r.creativeId}:${r.platform}:${r.scanId}`}
  className="border border-border rounded-lg p-4"
>
```

This keeps one Analysis Results viewer and switches the visible creative rather than rendering five full result stacks.

---

# 12. `components/scan-feedback.tsx`

Keep the same API endpoint and security model. Change only the component state/UI so feedback is per creative.

## 12.1 Add types after `FeedbackStage`

Add:

```tsx
export interface ScanFeedbackItem {
  creativeId: string;
  fileName: string;
  batchPosition: number | null;
  scanIds: string[];
}

interface FeedbackItemState {
  stage: FeedbackStage;
  comment: string;
  answer: boolean | null;
}
```

## 12.2 Replace the component signature/state block

Replace:

```tsx
export function ScanFeedback({
  scanIds,
}: {
  scanIds: string[];
}) {
  const [stage, setStage] =
    useState<FeedbackStage>('question');

  const [comment, setComment] =
    useState('');

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);
```

with:

```tsx
export function ScanFeedback({
  items,
  isBatch,
}: {
  items: ScanFeedbackItem[];
  isBatch: boolean;
}) {
  const [
    selectedCreativeId,
    setSelectedCreativeId,
  ] =
    useState(
      items[0]
        ?.creativeId ??
        ''
    );

  const [
    states,
    setStates,
  ] =
    useState<
      Record<
        string,
        FeedbackItemState
      >
    >(() =>
      Object.fromEntries(
        items.map(
          (item) => [
            item.creativeId,
            {
              stage:
                'question' as FeedbackStage,
              comment: '',
              answer: null,
            },
          ]
        )
      )
    );

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const currentItem =
    items.find(
      (item) =>
        item.creativeId ===
        selectedCreativeId
    ) ??
    items[0] ??
    null;

  const currentState =
    currentItem
      ? states[
          currentItem
            .creativeId
        ]
      : null;

  const allSubmitted =
    items.length > 0 &&
    items.every(
      (item) =>
        states[
          item.creativeId
        ]?.stage ===
        'submitted'
    );

  function patchCurrentState(
    patch:
      Partial<FeedbackItemState>
  ) {
    if (!currentItem) {
      return;
    }

    setStates(
      (previous) => ({
        ...previous,
        [currentItem.creativeId]:
          {
            ...previous[
              currentItem.creativeId
            ],
            ...patch,
          },
      })
    );
  }
```

## 12.3 Change submission to use the selected creative's scan IDs

At the start of `submitFeedback()`, replace:

```tsx
    if (submitting) return;
```

with:

```tsx
    if (
      submitting ||
      !currentItem
    ) {
      return;
    }
```

Then replace:

```tsx
              scanIds,
```

with:

```tsx
              scanIds:
                currentItem.scanIds,
```

Then replace:

```tsx
      setStage('submitted');
```

with:

```tsx
      patchCurrentState({
        stage:
          'submitted',
        answer:
          feedbackAnswer,
      });
```

## 12.4 Replace `handleNo()` and `handleSubmitNegative()`

Replace:

```tsx
  function handleNo() {
    setError(null);
    setStage('details');
  }

  function handleSubmitNegative() {
    const trimmedComment =
      comment.trim();

    submitFeedback(
      false,
      trimmedComment || null
    );
  }
```

with:

```tsx
  function handleNo() {
    setError(null);

    patchCurrentState({
      stage: 'details',
    });
  }

  function handleSubmitNegative() {
    const trimmedComment =
      currentState
        ?.comment
        .trim() ??
      '';

    submitFeedback(
      false,
      trimmedComment || null
    );
  }
```

## 12.5 Replace the old top-level submitted return

Replace:

```tsx
if (stage === 'submitted') {
```

with:

```tsx
if (allSubmitted) {
```

The existing final “Thanks for the feedback” card can remain unchanged.

## 12.6 Add a batch selector inside the normal feedback card

Immediately after the “Your feedback helps us…” paragraph, add:

```tsx
        {isBatch &&
          items.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {items.map(
              (item) => {
                const state =
                  states[
                    item.creativeId
                  ];

                const status =
                  state?.stage ===
                  'submitted'
                    ? state.answer ===
                      true
                      ? 'Yes'
                      : 'No'
                    : 'Pending';

                return (
                  <button
                    key={
                      item.creativeId
                    }
                    type="button"
                    onClick={() => {
                      setSelectedCreativeId(
                        item.creativeId
                      );

                      setError(
                        null
                      );
                    }}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      currentItem
                        ?.creativeId ===
                      item.creativeId
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    #{item.batchPosition}{' '}
                    {
                      item.fileName
                    }{' '}
                    · {status}
                  </button>
                );
              }
            )}
          </div>
        )}
```

## 12.7 Replace stage/comment references

Replace:

```tsx
{stage === 'question' ? (
```

with:

```tsx
{currentState?.stage ===
'question' ? (
```

Replace:

```tsx
value={comment}
```

with:

```tsx
value={
  currentState?.comment ??
  ''
}
```

Replace:

```tsx
onChange={(event) =>
  setComment(
    event.target.value
  )
}
```

with:

```tsx
onChange={(event) =>
  patchCurrentState({
    comment:
      event.target.value,
  })
}
```

Replace:

```tsx
{comment.length}/
```

with:

```tsx
{currentState?.comment
  .length ?? 0}/
```

Replace the Back button body:

```tsx
setError(null);
setStage(
  'question'
);
```

with:

```tsx
setError(null);

patchCurrentState({
  stage:
    'question',
});
```

Finally, immediately before the stage question/details conditional, add:

```tsx
        {currentState?.stage ===
          'submitted' && (
          <div
            className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-800 dark:text-green-400"
            role="status"
          >
            Feedback saved for this creative.
          </div>
        )}
```

and change the question/details rendering so it only renders when the selected item is not already submitted:

```tsx
        {currentState?.stage !==
          'submitted' &&
          (
            currentState?.stage ===
            'question'
              ? (
                // existing Yes / No block
              )
              : (
                // existing comment block
              )
          )}
```

The Yes/No and comment controls themselves stay visually the same.

---

# 13. `app/dashboard/page.tsx`

Replace:

```tsx
<ScanFeedback
  scanIds={
    feedbackTarget.scanIds
  }
/>
```

with:

```tsx
<ScanFeedback
  key={
    feedbackTarget.items
      .map(
        (item) =>
          item.creativeId
      )
      .join(':')
  }
  items={
    feedbackTarget.items
  }
  isBatch={
    feedbackTarget.isBatch
  }
/>
```

Why:
A fresh feedback component is created for each completed result set, and batch feedback receives one item per creative.

---

# 14. `server.js` rate-limit adjustments

The current scan endpoints were previously configured around single scans. A maximum batch can legitimately create more requests, especially when creatives target multiple platforms and a queued logical scan requires the normal second request with `jobId`.

If your current TEST `server.js` still contains:

```js
app.post('/scan-video', authenticateUser,
  requestLimit({ maxRequests: 5, windowMs: 60_000 }),
  logRequestOrigin,
  (req, res) => handleScanVideo(req, res, supabase, openRouterConfig, helpers, queueManager)
);

app.post('/scan-image', authenticateUser,
  requestLimit({ maxRequests: 7, windowMs: 60_000 }),
  logRequestOrigin,
  (req, res) => handleScanImage(req, res, supabase, qwenCloudConfig, helpers, queueManager)
);
```

replace only the request limits with:

```js
app.post('/scan-video', authenticateUser,
  requestLimit({ maxRequests: 30, windowMs: 60_000 }),
  logRequestOrigin,
  (req, res) => handleScanVideo(req, res, supabase, openRouterConfig, helpers, queueManager)
);

app.post('/scan-image', authenticateUser,
  requestLimit({ maxRequests: 30, windowMs: 60_000 }),
  logRequestOrigin,
  (req, res) => handleScanImage(req, res, supabase, qwenCloudConfig, helpers, queueManager)
);
```

Why:
- the user is authenticated before the limiter;
- actual model work is still protected by scan allowance checks;
- queueManager still allows only one active scan per user;
- 30/minute accommodates legitimate client batch orchestration and queued retries without allowing concurrent AI work.

For feedback, if the current route is:

```js
app.post(
  '/scan-feedback',
  authenticateUser,
  requestLimit({ maxRequests: 5, windowMs: 60_000 }),
  (req, res) => handleScanFeedback(req, res, supabase)
);
```

replace it with:

```js
app.post(
  '/scan-feedback',
  authenticateUser,
  requestLimit({ maxRequests: 10, windowMs: 60_000 }),
  (req, res) => handleScanFeedback(req, res, supabase)
);
```

Why:
A five-creative batch can legitimately produce five independent feedback submissions. Ten gives retry headroom without changing the immutable feedback handler.

---

# 15. Scan History contract

The current `/scan-history` source was not included in the September 15 attachment set, so do **not** blindly replace that page from guessed code.

When editing the actual file, the query must include:

```text
batched_by_client
batch_id
batch_position
```

and, if you use the new parent metadata:

```text
scan_batches.total_creatives
```

Grouping logic:

```ts
const batches =
  new Map<
    string,
    ScanRow[]
  >();

const soloScans:
  ScanRow[] = [];

for (const scan of scans) {
  if (
    scan.batched_by_client &&
    scan.batch_id
  ) {
    const group =
      batches.get(
        scan.batch_id
      ) ?? [];

    group.push(scan);

    batches.set(
      scan.batch_id,
      group
    );
  } else {
    soloScans.push(scan);
  }
}

for (
  const group of
  batches.values()
) {
  group.sort(
    (a, b) =>
      (
        a.batch_position ??
        999
      ) -
      (
        b.batch_position ??
        999
      )
  );
}
```

For a folder card, deduplicate platform rows by `batch_position` when counting/displaying creatives:

```ts
const creativePositions =
  Array.from(
    new Set(
      group
        .map(
          (scan) =>
            scan.batch_position
        )
        .filter(
          (
            position
          ): position is number =>
            typeof position ===
            'number'
        )
    )
  );
```

The batch folder should display:
- one normal-sized History card;
- “Batch Scan · N creatives”;
- stacked thumbnails deduplicated by `batch_position`;
- click/expand to reveal individual scan rows;
- children sorted by `batch_position`, then by platform if needed.

Do not use `created_at` to reconstruct execution order. `batch_position` is authoritative.

---

# 16. Important failure-observability boundary

Successful server scan rows definitely receive:

```text
batched_by_client
batch_id
batch_position
```

The modified route catch blocks also pass those fields into the existing `handleError()` path.

However, `errorHandler.js` was not in the supplied file set, so this change cannot claim that **every** server exception becomes a `scans` row without inspecting that implementation.

Client preprocessing failures can occur before the VPS receives a scan at all. They therefore cannot create a `scans` child row under the current architecture.

The combination of:
- `scan_batches.total_creatives`,
- non-renumbered execution `batch_position`,
- later child rows retaining their original positions,

still makes missing positions visible for diagnostics.

Example:

```text
total_creatives = 5

child positions:
1
3
4
5
```

Position 2 did not produce a persisted child scan and is therefore an obvious failure gap.

---

# 17. Accounting behavior

This implementation deliberately preserves the current accounting boundary:

```text
successful model result
→ commitScanDeduction()
→ scan row logged
```

The client preflights the full estimated batch cost before starting, but this patch does not invent a new reservation system.

That means:
- successful scans deduct normally;
- failed scans continue to follow current failure/refund semantics;
- a mid-batch external account change could still affect later creatives.

If atomic batch reservation is desired later, implement it as a separate server-side accounting change rather than mixing it into the client batching rollout.

---

# 18. Validation

## Website

Run your normal TEST build. At minimum:

```bash
npm run build
```

If the project has a TypeScript check command, also run it.

## VPS

```bash
node --check routes/_shared/resolveClientBatch.js
node --check routes/scanImage.js
node --check routes/scanVideo.js
node --check routes/scanFeedback.js
node --check queueManager.js
```

Then restart the existing TEST API systemd service using its real service name and inspect its journal.

Do not invent a new service unit for batching.

---

# 19. TEST checklist

### Entitlement
- Free user can upload only one creative.
- Free user cannot forge `batchedByClient: true`.
- Paid user can upload 2–5 creatives.
- Sixth creative is rejected in the UI.

### Configuration
- Every creative can have its own target platforms.
- “Apply to all” copies the selected creative's platform set.
- Images appear in platform selection.
- Images never appear in Scan Type or Audio selectors.
- Video settings can differ per video.
- “Apply video settings to all” copies only video settings.

### Execution
- Images run before videos.
- `batch_position` follows execution order, not upload order.
- Multiple platform rows for one creative share the same `batch_position`.
- Logical batch scans execute sequentially.
- Five-second countdown is visible between logical scans.
- No unnecessary cooldown occurs after the final logical scan.
- A normal creative/provider failure marks that item red and later items continue.
- Authentication/account/rate-limit failures stop the batch.

### Navigation
- Dashboard sidebar shows one status icon per batch creative.
- queued = grey pause.
- cooldown = amber pause.
- processing = spinner.
- success = green check.
- error = red X.
- Navigate Dashboard → Settings while a batch runs.
- Batch continues in the same tab.
- Return to Dashboard and verify progress/results restore.
- Reloading the tab during an active client batch still correctly becomes “Scan interrupted”.

### Database
- One `scan_batches` row is created for each client batch.
- `user_id` is the authenticated user.
- `total_creatives` matches the intended batch size.
- All child scan rows share the correct `batch_id`.
- `batched_by_client = true`.
- `batch_position` is 1–5.
- Solo scans still have:
  - `batched_by_client = false`
  - `batch_id = NULL`
  - `batch_position = NULL`
- Deleting a parent batch sets child `batch_id = NULL` rather than deleting scans.

### Security
- A user cannot submit another user's `batch_id`.
- Malformed UUID returns 400.
- Position 0 or 6 returns 400.
- Free account batch request returns 403.
- Missing batch ID with `batchedByClient = true` returns 400.
- Sending a `batch_id` while `batchedByClient = false` returns 400.

### Feedback
- Solo feedback still behaves exactly as before.
- Batch feedback shows one selector entry per creative.
- Yes/No is stored only for that creative's successful scan IDs.
- Multi-platform rows for one creative receive the same feedback.
- Five creatives can all submit feedback without hitting the old 5/60 ceiling.
- Exact retry remains idempotent.
- Conflicting feedback still returns 409.

### Results
- One Analysis Results viewer is used.
- Creative selector switches the displayed result.
- Failed creative can be selected and shows its failure state.
- Partial creative shows successful platform results plus an error notice.
- “New Scan” clears the batch UI and background state.

---

# 20. Deployment order

1. Run the TEST Supabase constraint/`total_creatives` migration.
2. Add `routes/_shared/resolveClientBatch.js`.
3. Patch `scanImage.js`.
4. Patch `scanVideo.js`.
5. Patch TEST `server.js` rate limits.
6. Syntax-check VPS JS.
7. Restart TEST API.
8. Patch `scanApi.ts`.
9. Patch `backgroundScanStore.ts`.
10. Patch `app-sidebar.tsx`.
11. Patch `scan-workspace.tsx`.
12. Patch `scan-feedback.tsx`.
13. Patch Dashboard feedback props.
14. Build TEST website.
15. Run the TEST checklist.
16. Patch `/scan-history` once its current source is open and verified.
17. Confirm drift monitor reports only intended TEST/LIVE differences.
18. Promote only after TEST passes.

---

# 21. Files changed

## New

```text
VPS:
routes/_shared/resolveClientBatch.js
```

## Modified

```text
Website:
lib/mediacrater/scanApi.ts
lib/mediacrater/backgroundScanStore.ts
components/scan-workspace.tsx
components/scan-feedback.tsx
components/app-sidebar.tsx
app/dashboard/page.tsx
app/scan-history/...  (exact file pending current source)

VPS:
routes/scanImage.js
routes/scanVideo.js
server.js

Supabase:
scan_batches.total_creatives
scans batch-position range constraint
```

## No change

```text
routes/scanFeedback.js
queueManager.js
```

---

# 22. Rollback

The safest rollback is application-first:

```text
1. Restore pre-batch ScanWorkspace.
2. Restore pre-batch ScanFeedback props/UI.
3. Restore pre-batch background store/sidebar status.
4. Restore scanApi signatures.
5. Restore scan route batch parsing/logging.
6. Restore previous server.js request limits if desired.
7. Leave nullable batch columns and scan_batches table in place.
```

The schema is backwards compatible with solo scans, so an emergency UI rollback does not require destructive SQL.

Do not drop `scan_batches` or the batch columns if real batch rows have already been created.
