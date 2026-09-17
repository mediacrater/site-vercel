# Deployment Index 02: Rate Limiting & Bot Protection (Custom Solutions Form)

**Scope:** Rate limiting and Cloudflare Turnstile bot verification on `app/api/custom-solutions-form/route.ts`
**Status:** Deployed
**Depends on:** `deployment-index-01-slack-form-integration.md` (this index assumes that route already exists and forwards to Slack)

---

## 1. Overview

This index covers the evolution of rate limiting on the custom-solutions form endpoint through three designs, in the order they were actually built and replaced, plus the addition of Cloudflare Turnstile as a bot-verification layer ahead of the rate limiter.

**Final state:** Turnstile verification → Supabase-RPC-backed atomic rate limit (10 requests / 24 hours per IP) → Slack forward.

## 2. Design history (in order)

### 2.1 — Design A: In-memory `Map` (superseded)

**Reason attempted:** Fast first pass — no external dependency, works correctly on a single warm instance.

**Why superseded:** Vercel serverless functions run as multiple concurrent instances, each with its own memory, and instances are recycled/frozen when idle. An in-memory counter is therefore either bypassable via concurrent requests landing on different instances, or silently reset when an instance is torn down. This is not a hard guarantee at any real traffic level.

**Not deployed to production in this form** — superseded before final delivery by Design C. Recorded here because it was the first working version and explains why later designs moved external.

### 2.2 — Design B considered: Upstash Redis (discussed, not built)

**Reason considered:** The standard fix for in-memory rate-limit drift on serverless — atomic `INCR` against a shared external store, HTTP-based so it fits serverless request/response model well, native Vercel integration available.

**Why not chosen:** User already had Supabase configured in the project and preferred to avoid adding a second external service. Design C (Supabase) was built instead.

### 2.3 — Design C: Supabase Postgres RPC (deployed)

**Reason:** Reuses existing Supabase project. Atomicity achieved via a single Postgres function call (`security definer`) that does count-check-and-insert as one round trip, avoiding the same race condition that plain in-memory or naive read-then-write SQL would have.

**Design decision — row-per-attempt, not row-per-IP:** Considered a single-row-per-IP with an `attempt_count` column (smaller table, but fixed-window semantics — allows up to ~2x the limit right at a window boundary). Chose instead one row per *allowed* attempt, counted via `COUNT(*)` over a rolling window at check time — true sliding-window accuracy, self-correcting, no reset logic needed. Confirmed via direct discussion that storage cost of this approach is negligible (well under 100 bytes/row; a determined single-IP abuser is capped at exactly `max_attempts` rows per window because **rejected attempts do not insert a row** — the count-check happens before the insert).

**SQL — table creation:**
```sql
create table custom_solutions_form_attempts (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id),
  ip text not null,
  created_at timestamptz not null default now()
);

create index idx_csfa_ip_created on custom_solutions_form_attempts (ip, created_at);
create index idx_csfa_user_created on custom_solutions_form_attempts (user_id, created_at);
```

**SQL — atomic check-and-log function:**
```sql
create or replace function check_and_log_form_attempt(
  p_ip text,
  p_user_id uuid,
  p_max_attempts int default 4,
  p_window_minutes int default 60
)
returns boolean
language plpgsql
security definer
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from custom_solutions_form_attempts
  where created_at > now() - (p_window_minutes || ' minutes')::interval
    and (
      (p_user_id is not null and user_id = p_user_id)
      or (p_user_id is null and ip = p_ip)
    );

  if v_count >= p_max_attempts then
    return false;
  end if;

  insert into custom_solutions_form_attempts (user_id, ip)
  values (p_user_id, p_ip);

  return true;
end;
$$;
```

**SQL — permissions (required — RLS was enabled on the table with no policies):**

Function is `security definer` (runs as owner internally), but the calling role (`anon`, since the form is anonymous-only) still needs `EXECUTE` grant separately from RLS. Table itself has **no RLS policies for `anon`** — direct table access via the API is fully blocked; the RPC is the only door in. This was a deliberate choice over adding an `anon` INSERT policy, which would have reopened direct writable access and the race condition the RPC exists to close.

```sql
grant execute on function check_and_log_form_attempt(text, uuid, int, int) to anon;
```

**Confirmed run** by user: `select * from cron.job` / direct testing showed exactly 4 rows logged for repeated same-IP attempts within the original 4/60min window, with a clean cutoff (no row) on the 5th — confirming both the atomicity and the reject-without-insert behavior worked as designed.

**Route code — initial Supabase-backed version of `checkRateLimit`:**
```typescript
async function checkRateLimit(ip: string): Promise<{ allowed: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("check_and_log_form_attempt", {
    p_ip: ip,
    p_user_id: null,
    p_max_attempts: RATE_LIMIT_MAX_REQUESTS,
    p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
  })

  if (error) {
    console.error("Rate limit RPC error:", error)
    return { allowed: false, error: error.message }
  }

  return { allowed: data === true }
}
```

Called with `p_user_id: null` throughout — user confirmed the form is anonymous-only (no logged-in session applies), so IP is the sole identity key. `userId` column and parameter were kept in the schema/function signature for future-proofing if the form ever becomes reachable by authenticated users.

**Import added to route:** `import { supabase } from "@/lib/mediacrater/supabaseClient"` — the project's existing shared Supabase client, built with the **anon key** (not service role). This is why the `EXECUTE` grant to `anon` above was necessary.

**Fail-closed behavior:** If the RPC call itself errors (permissions, connectivity) rather than legitimately hitting the limit, the route returns `500` rather than silently allowing the request through. Documented as a deliberate choice, not the only valid one — user did not request the fail-open alternative.

### 2.4 — Rate limit threshold change: 4/60min → 10/24hr

**Reason:** 4 requests/hour caps bursts tightly but resets fast — a persistent attacker could still reach 96 attempts/day (4 × 24). 10/24hr caps total daily volume harder, judged a better fit for a low-traffic B2B contact form where legitimate users essentially never approach either limit.

**Change:** Made directly by user in the route file (not authored in this chat — user stated "I did #3 myself"). Constants affected:
```typescript
const RATE_LIMIT_MAX_REQUESTS = 10
const RATE_LIMIT_WINDOW_MINUTES = 1440 // 24 hours
```
No SQL change required — `check_and_log_form_attempt` already accepted these as parameters rather than hardcoding them.

### 2.5 — Cleanup: scheduled deletion via `pg_cron`

**Reason:** Even though abusive-IP row growth is bounded (max = rate limit ceiling per IP), old rows outside any possible rate-limit window serve no purpose and should be swept. Considered and rejected a fixed calendar-day window (00:00:01–23:59:59 EST) — this would have **weakened** the rate limit itself (reintroduces a boundary-gaming gap: e.g., 10 attempts at 11:58pm + 10 more at 12:02am) while also being *more* complex to write (requires timezone conversion) than the rolling-window version, which needs none since `created_at`/`now()` are both `timestamptz`. Kept the true rolling window for the limit itself; used a simple age-based delete for cleanup only, decoupled from the limit's own logic.

**SQL — enable extension:**
```sql
create extension if not exists pg_cron;
```
(User confirmed via `select * from cron.job` that `pg_cron` was already active in the project from a prior unrelated job, `reset-free-scans`.)

**SQL — schedule hourly cleanup:**
```sql
select cron.schedule(
  'cleanup-custom-solutions-attempts',
  '0 * * * *',
  $$
    delete from custom_solutions_form_attempts
    where created_at < now() - interval '24 hours'
  $$
);
```

**Confirmed run** by user via screenshot: `cron.schedule` returned job id `6`; `select * from cron.job` showed `jobname = cleanup-custom-solutions-attempts`, `schedule = 0 * * * *`, `active = true`.

Uses the existing `idx_csfa_ip_created` index (`ip, created_at`) — no new index needed for the cleanup query.

### 2.6 — Cloudflare Turnstile (bot verification layer, added ahead of rate limiting)

**Reason:** Rate limiting alone doesn't stop distributed abuse — many unique IPs, each individually staying under the cap, still generate real (if bounded) row growth and query volume proportional to attacker count. This is a different threat than the one rate limiting solves, and needs a different tool: a challenge that filters out non-human traffic before it reaches the rate limiter or Slack at all.

**Environment variables:**

| Variable | Where set | Notes |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Vercel, server-side only (no `NEXT_PUBLIC_` prefix) | Used in `siteverify` call. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Vercel, exposed to browser | Used by the client-side widget render call. |

**Ordering decision:** Turnstile verification runs **before** the rate-limit RPC, which runs **before** the Slack forward. Rationale: don't spend a Supabase round trip or a rate-limit slot on a request that isn't even confirmed to be a real browser.

**`app/api/custom-solutions-form/route.ts` — additions:**

New verification function:
```typescript
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

async function verifyTurnstileToken(token: string, remoteIp: string): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY
  if (!secretKey) {
    console.error("TURNSTILE_SECRET_KEY is not set.")
    return false
  }

  try {
    const params = new URLSearchParams()
    params.append("secret", secretKey)
    params.append("response", token)
    if (remoteIp && remoteIp !== "unknown") {
      params.append("remoteip", remoteIp)
    }

    const verifyResponse = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })

    if (!verifyResponse.ok) {
      console.error("Turnstile siteverify HTTP error:", verifyResponse.status)
      return false
    }

    const result = (await verifyResponse.json()) as { success: boolean; [key: string]: unknown }
    if (!result.success) {
      console.error("Turnstile verification failed:", result)
    }
    return result.success === true
  } catch (err) {
    console.error("Failed to reach Turnstile siteverify:", err)
    return false
  }
}
```

`FormPayload` type extended with `turnstileToken: string`; `validatePayload()` extended with:
```typescript
if (typeof turnstileToken !== "string" || turnstileToken.trim().length === 0) {
  return { valid: false, error: "Please complete the verification checkbox." }
}
```

`POST` handler reordered to (final order):
1. Parse JSON body.
2. `validatePayload()` (now includes token presence check).
3. `verifyTurnstileToken()` — `400` with `"Verification failed. Please try the checkbox again."` on failure.
4. `checkRateLimit()` via Supabase RPC (Design C, §2.3–2.4).
5. Forward to Slack (Index 01, §5.1).

**`app/solutions/page.tsx` — additions:**

- `next/script` import; loads `https://challenges.cloudflare.com/turnstile/v0/api.js` with `strategy="afterInteractive"`, sets `turnstileScriptLoaded` state `onLoad`.
- `window.turnstile` typed via a `declare global` block (`render`/`reset` methods).
- `turnstileContainerRef` (div ref) + `turnstileWidgetIdRef` (widget id ref) + `turnstileToken` state.
- `useEffect` renders the widget once the script has loaded and the container ref exists, reading `process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY`; sets/clears `turnstileToken` via the widget's `callback` / `expired-callback` / `error-callback`.
- Widget container placed directly above the Submit button, below the error message block:
  ```tsx
  <div ref={turnstileContainerRef} />
  ```
- `handleSubmit`: guards on `turnstileToken` being present before attempting submit; includes `turnstileToken` in the POST body (`{ ...formData, turnstileToken }`); calls `resetTurnstile()` (forces a fresh token) after **every** outcome — success, server rejection, and network failure — since Turnstile tokens are single-use.
- Submit button `disabled` condition extended: `status === "loading" || !turnstileToken`.

**Manual setup step (not code):** Turnstile site keys are domain-restricted by default in the Cloudflare dashboard. `localhost` must be explicitly added to the widget's allowed domains for local testing, or Cloudflare's published test site key used instead during development.

## 3. Final route execution order (as of this index)

1. Parse JSON body → `400` on parse failure.
2. `validatePayload()` → `400` on any missing/invalid required field, including `turnstileToken`.
3. `verifyTurnstileToken()` → `400` if Cloudflare rejects the token.
4. `checkRateLimit()` via `check_and_log_form_attempt` RPC (10 attempts / 1440 min / IP) → `429` if exceeded, `500` if the RPC itself errors.
5. Forward to Slack → `502` if Slack webhook fails, `200` + `{ success: true }` on success.

## 4. Open / explicitly deferred items (as of this index)

- **Login endpoint:** Identified as unprotected (no Turnstile, no rate limiting) during this conversation. Explicitly flagged as higher-priority than further tuning the signup rate limit, because login defends existing real accounts against credential stuffing — a threat that exists independent of how well-protected signup is. **Not yet implemented.**
- **Signup endpoint:** Currently Turnstile-protected; rate limit under discussion (1/60min → considering 10/24hr, mirroring the form's change). **Not yet implemented as of this index.**
- **Consolidated `rate_limits` table:** A shared, `action`-discriminated table/RPC design (one table for signup/login/form instead of one per endpoint) was discussed as the next step, to replace `custom_solutions_form_attempts` specifically. **Not yet built as of this index** — this document reflects the dedicated-table design (§2.3) as the currently deployed state.

## 5. Rollback notes

- **Revert to no rate limiting:** Remove the `checkRateLimit()` call and its surrounding block from `POST`; the route will still work (Slack forwarding unaffected) but loses all abuse protection. Not recommended.
- **Revert rate limit threshold:** Change `RATE_LIMIT_MAX_REQUESTS`/`RATE_LIMIT_WINDOW_MINUTES` constants back to `4`/`60`. No SQL change needed.
- **Revert to in-memory limiter (Design A):** Not recommended; documented in §2.1 specifically as the superseded design and the reasons it was replaced still apply.
- **Disable Turnstile only, keep rate limiting:** Remove the `verifyTurnstileToken()` call from `POST` (step 3) and remove the token requirement from `validatePayload()`. Frontend widget can be left in place harmlessly if the backend stops requiring the token, though this defeats its purpose — recommend removing both sides together.
- **Pause the cleanup cron job without deleting it:**
  ```sql
  select cron.unschedule('cleanup-custom-solutions-attempts');
  ```
  Re-schedule using the exact command in §2.5 to resume.
