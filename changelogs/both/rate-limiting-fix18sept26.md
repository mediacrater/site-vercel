# Deployment index: shared rate-limiting fix

- **Date:** 18 September 2026 (2026-09-18)
- **Project:** Mediacrater
- **Filename:** `rate-limiting-fix18sept26.md`
- **Suggested repository location:** `changelogs/website/rate-limiting-fix18sept26.md`
- **Scope:** Custom solutions inquiries, signup, signin, the shared rate-limit helper, and the Supabase RPC used by that helper.
- **Status:** Implementation instructions and code were supplied in conversation. Deployment, SQL execution, build success, and post-change behavior were not independently verified. This document records the final intended implementation and the superseded intermediate changes separately.

## 1. Problem and evidence

The custom solutions form displayed its success state and the submission appeared in Slack, but the user reported no corresponding row in either `custom_solutions_form_attempts` or `rate_limits`.

The original route called `check_and_log_form_attempt` and proceeded only if the RPC returned the boolean `true`. It did not insert a row itself. Therefore, if that exact route was deployed, a successful Slack submission meant the RPC returned `true`; it did not establish which table the function wrote to. The original function definition and the imported `supabaseClient` implementation were not supplied, so the precise cause of the missing original rows was not established. A wrong project, deployed-code mismatch, or function behavior was not proven.

The requested destination is `public.rate_limits`, with an action label identifying each request type. For custom solutions the agreed label is `solutions_form`. Response headers also identify the action. Raw request headers are not stored.

The user subsequently supplied the signup route, signin route, shared `lib/rate-limit.ts`, and the definition of `check_and_log_rate_limit`. These showed:

- Signup originally used its own `signup_rate_limits` counter table, with a 24-hour fixed window and a maximum of 10 attempts per IP.
- Signup logged rate-limit write failures but continued; errors reading its counter were not checked.
- Signin already called the shared helper with `signin`, 8 attempts, and 120 seconds. Its opening comment incorrectly said 10 attempts per 60 seconds.
- The helper already called `check_and_log_rate_limit` using the service-role client and passed `p_user_id: null`.
- The shared SQL function already inserted into `rate_limits` and filtered counts by action.
- The original shared function did a count and then an insert without serialization. Merely putting both statements in one function/transaction did not prevent simultaneous callers from both observing an available slot.

## 2. Final design

Request flow:

1. The route performs its existing validation and Turnstile verification.
2. The route supplies an action, IP, maximum attempts, and time window to `checkAndLogRateLimit`.
3. `lib/rate-limit.ts` calls `public.check_and_log_rate_limit` using the server-only service-role key.
4. The database function serializes matching requests, counts recent attempts, and either returns a denial or inserts one row into `public.rate_limits`.
5. The route returns 500 on a limiter error, 429 on a genuine exhausted allowance, or continues to its existing Slack/auth operation.

| Route / feature | Action | Maximum | Rolling window | Final integration |
| --- | --- | --- | --- | --- |
| `app/api/custom-solutions-form/route.ts` | `solutions_form` | 4 | 86,400 seconds / 24 hours | Local thin wrapper calls shared helper |
| `app/api/signup/route.ts` | `signup` | 10 | 86,400 seconds / 24 hours | Calls shared helper directly |
| `app/api/signin/route.ts` | `signin` | 8 | 120 seconds | Already shared; error/header handling updated |
| Password reset | `reset_password` | Existing route setting | Existing route setting | Listed in shared helper; route implementation not supplied or edited |
| Resend verification | `resend_verification` | Existing route setting | Existing route setting | Listed in shared helper; route implementation not supplied or edited |

Actions have separate allowances. For current callers, counts are scoped to action plus IP because `p_user_id` is null. The SQL retains its pre-existing optional user-based counting behavior for future authenticated callers; when a user ID is supplied, it counts that action for that user rather than enforcing a second independent IP allowance.

## 3. Files and database objects affected

| Item | Change |
| --- | --- |
| `lib/rate-limit.ts` | Add `solutions_form` to the action union; validate RPC results; catch thrown failures |
| `app/api/custom-solutions-form/route.ts` | Replace direct Supabase RPC/client dependency with shared helper; add action/limit headers; use returned retry delay |
| `app/api/signup/route.ts` | Replace dedicated limiter with shared helper; preserve signup/profile/device logic; add headers |
| `app/api/signin/route.ts` | Distinguish database failure from exhausted allowance; attach action/limit headers; correct comment |
| `public.check_and_log_rate_limit(text, text, uuid, integer, integer)` | Add validation and transaction locks; qualify table; set explicit privileges and search path |
| `public.rate_limits` | Existing table reused; no column or index changes |
| `app/solutions/page.tsx` | Reviewed original upload; no changes |
| `public.check_and_log_solutions_form_attempt` | Intermediate dedicated RPC; superseded, retain during deployment overlap if present |
| `public.check_and_log_signup_attempt` | Intermediate dedicated RPC; superseded, retain during deployment overlap if present |
| `public.check_and_log_form_attempt` | Original solutions RPC; no final edits or deletion specified |
| `public.custom_solutions_form_attempts` / `public.signup_rate_limits` | Legacy data/objects retained; no deletion or historical import performed |

## 4. Existing table schema

Reference only: the destination already exists. Do not recreate the table as part of this migration.

```sql
create table public.rate_limits (
  id bigint generated always as identity not null,
  action text not null,
  ip text not null,
  user_id uuid null,
  created_at timestamp with time zone not null default now(),
  constraint rate_limits_pkey primary key (id)
) TABLESPACE pg_default;

create index IF not exists idx_rate_limits_action_ip_created
  on public.rate_limits using btree (action, ip, created_at)
  TABLESPACE pg_default;

create index IF not exists idx_rate_limits_action_user_created
  on public.rate_limits using btree (action, user_id, created_at)
  TABLESPACE pg_default;
```

The original solutions-specific schema provided by the user was:

```sql
create table public.custom_solutions_form_attempts (
  id bigint generated always as identity not null,
  user_id uuid null,
  ip text not null,
  created_at timestamp with time zone not null default now(),
  constraint custom_solutions_form_attempts_pkey primary key (id),
  constraint custom_solutions_form_attempts_user_id_fkey
    foreign KEY (user_id) references auth.users (id)
) TABLESPACE pg_default;

create index IF not exists idx_csfa_ip_created
  on public.custom_solutions_form_attempts using btree (ip, created_at)
  TABLESPACE pg_default;

create index IF not exists idx_csfa_user_created
  on public.custom_solutions_form_attempts using btree (user_id, created_at)
  TABLESPACE pg_default;
```

## 5. Final database migration — apply before updated routes

Run in the Supabase SQL editor for the matching environment. This is the final shared RPC supplied in the conversation. It replaces the shared function, not the table or existing rows.

```sql
begin;

create or replace function public.check_and_log_rate_limit(
  p_action text,
  p_ip text,
  p_user_id uuid,
  p_max_attempts integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count bigint;
  v_oldest_in_window timestamptz;
  v_now timestamptz;
  v_window interval;
begin
  if p_action is null or btrim(p_action) = ''
     or p_ip is null or btrim(p_ip) = '' then
    raise exception 'Action and IP are required';
  end if;

  if p_max_attempts is null or p_max_attempts < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'Invalid rate limit configuration';
  end if;

  -- Serialize requests for the same action and IP.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        'rate_limits', p_action, 'ip', p_ip
      )::text,
      0
    )
  );

  -- Also serialize requests for a supplied user across different IPs.
  if p_user_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        pg_catalog.jsonb_build_array(
          'rate_limits', p_action, 'user', p_user_id
        )::text,
        0
      )
    );
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_window := pg_catalog.make_interval(secs => p_window_seconds);

  select count(*), min(rl.created_at)
  into v_count, v_oldest_in_window
  from public.rate_limits as rl
  where rl.action = p_action
    and rl.created_at > v_now - v_window
    and (
      (p_user_id is not null and rl.user_id = p_user_id)
      or (p_user_id is null and rl.ip = p_ip)
    );

  if v_count >= p_max_attempts then
    return query
    select
      false,
      greatest(
        1,
        ceil(
          extract(epoch from (v_oldest_in_window + v_window - v_now))
        )::integer
      );

    return;
  end if;

  insert into public.rate_limits (
    action,
    ip,
    user_id,
    created_at
  )
  values (
    p_action,
    p_ip,
    p_user_id,
    v_now
  );

  return query select true, 0;
end;
$$;

revoke all on function public.check_and_log_rate_limit(
  text, text, uuid, integer, integer
) from public, anon, authenticated;

grant execute on function public.check_and_log_rate_limit(
  text, text, uuid, integer, integer
) to service_role;

commit;
```

The function must be owned by a role with access to the table, as expected when created through the Supabase SQL editor's administrative role. Its return columns must match the existing shared helper: `allowed` and `retry_after_seconds`. If the existing function has different return types or parameter defaults, inspect its full definition before resolving a migration error; no destructive drop-and-recreate was supplied here.

The advisory lock provides serialization between callers using this shared lock protocol. The earlier dedicated RPCs used different lock keys, so concurrent old and new deployments are not fully serialized against each other during a mixed-version rollout.

## 6. Final shared helper changes

File: `lib/rate-limit.ts`.

Replace the action union with:

```ts
export type RateLimitAction =
  | "signup"
  | "signin"
  | "reset_password"
  | "resend_verification"
  | "solutions_form"
```

Keep the existing return type:

```ts
export type RateLimitResult = {
  allowed: boolean
  retryAfterSeconds: number
  error?: string
}
```

Replace the complete `checkAndLogRateLimit` function with:

```ts
export async function checkAndLogRateLimit(
  action: RateLimitAction,
  ip: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const { data, error } = await supabaseAdmin
      .rpc("check_and_log_rate_limit", {
        p_action: action,
        p_ip: ip,
        p_user_id: null,
        p_max_attempts: maxAttempts,
        p_window_seconds: windowSeconds,
      })
      .single()

    if (error) {
      console.error(
        `[RATE LIMIT] RPC error for action "${action}":`,
        error.message
      )

      return {
        allowed: false,
        retryAfterSeconds: windowSeconds,
        error: error.message,
      }
    }

    if (
      !data ||
      typeof data.allowed !== "boolean" ||
      !Number.isInteger(data.retry_after_seconds) ||
      data.retry_after_seconds < 0 ||
      (!data.allowed && data.retry_after_seconds < 1)
    ) {
      console.error(
        `[RATE LIMIT] Invalid RPC response for action "${action}".`
      )

      return {
        allowed: false,
        retryAfterSeconds: windowSeconds,
        error: "Invalid rate limit response.",
      }
    }

    return {
      allowed: data.allowed,
      retryAfterSeconds: data.retry_after_seconds,
    }
  } catch (error) {
    console.error(
      `[RATE LIMIT] Request failed for action "${action}":`,
      error
    )

    return {
      allowed: false,
      retryAfterSeconds: windowSeconds,
      error: "Rate limit request failed.",
    }
  }
}
```

The existing `supabaseAdmin` initialization, `clientIpFrom`, and `verifyTurnstileToken` stay as supplied. The shared client uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. IP parsing still uses the first `x-forwarded-for` value, then `x-real-ip`, then `"unknown"`. Turnstile verification still occurs via Cloudflare's `siteverify` endpoint.

## 7. Final signup route changes

File: `app/api/signup/route.ts`.

Add:

```ts
import { checkAndLogRateLimit } from "@/lib/rate-limit";
```

Keep these existing settings:

```ts
const SIGNUP_RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SIGNUPS_PER_WINDOW = 10;
```

Replace the complete per-IP rate-limit block, after Turnstile verification and before `mergeDeviceFields`, with:

```ts
  // Per-IP signup rate limit: 10 attempts per rolling 24 hours.
  if (ip) {
    const rateLimit = await checkAndLogRateLimit(
      "signup",
      ip,
      MAX_SIGNUPS_PER_WINDOW,
      SIGNUP_RATE_LIMIT_MS / 1000
    );

    if (rateLimit.error) {
      return jsonWithDevice(
        { error: "Something went wrong. Please try again." },
        500,
        deviceId
      );
    }

    if (!rateLimit.allowed) {
      return jsonWithDevice(
        { error: "Too many signup attempts. Please try again later." },
        429,
        deviceId,
        {
          "Retry-After": String(rateLimit.retryAfterSeconds),
          "X-RateLimit-Action": "signup",
          "X-RateLimit-Limit": String(MAX_SIGNUPS_PER_WINDOW),
          "X-RateLimit-Remaining": "0",
        }
      );
    }
  }
```

Retain the success-return change supplied during the earlier signup step:

```ts
  return jsonWithDevice(
    {
      success: true,
      hasSession: Boolean(data.session),
      deviceRecorded,
      deviceError,
    },
    200,
    deviceId,
    {
      'X-RateLimit-Action': 'signup',
      'X-RateLimit-Limit': String(MAX_SIGNUPS_PER_WINDOW),
    }
  );
```

Keep `createClient`, `supabaseAnon`, and `supabaseAdmin` in this route. They still perform signup, profile upsert, and device recording. Preserve `jsonWithDevice`, terms acceptance, existing Turnstile verification, `clientIpFrom` from `@/lib/account-device`, device-cookie handling, IP intelligence, consent timestamp, and response fields.

Behavior changes and retained behavior:

- No more counter reads/updates/inserts against `signup_rate_limits` from this route.
- Each allowed attempt creates a `rate_limits` row with `action = 'signup'` before account creation.
- Auth failure still consumes an allowed attempt; this limits attempts, not only successful accounts.
- Limiter errors now stop the request with 500 rather than logging and continuing.
- The original `if (ip)` guard remains: a falsy IP skips the limiter. This migration did not change that behavior.
- The old fixed window becomes a rolling window: each row ages out individually after 24 hours.
- Old counter values in `signup_rate_limits` are not imported. Existing `signup` rows in `rate_limits`, including rows from the intermediate dedicated RPC if deployed, do count.

## 8. Final custom solutions route changes

File: `app/api/custom-solutions-form/route.ts`.

Replace the original `supabaseClient` import, or the intermediate `createClient` import if already applied, with:

```ts
import { checkAndLogRateLimit } from "@/lib/rate-limit"
```

Keep:

```ts
const RATE_LIMIT_MAX_REQUESTS = 4
const RATE_LIMIT_WINDOW_MINUTES = 24 * 60
```

Replace `checkRateLimit` completely with:

```ts
async function checkRateLimit(ip: string) {
  return checkAndLogRateLimit(
    "solutions_form",
    ip,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_MINUTES * 60
  )
}
```

The final rate-limit branch in `POST` is:

```ts
  const rateLimit = await checkRateLimit(ip)
  if (!rateLimit.allowed) {
    if (rateLimit.error) {
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
          "X-RateLimit-Action": "solutions_form",
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
        },
      }
    )
  }
```

Retain the earlier success-return change:

```ts
  return NextResponse.json(
    { success: true },
    {
      status: 200,
      headers: {
        "X-RateLimit-Action": "solutions_form",
        "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
      },
    }
  )
```

Preserve payload validation, local `getClientIp`, local Turnstile verification, Slack formatting, webhook handling, and `runtime = "nodejs"`. The page UI is unchanged.

An allowed attempt is inserted before checking/sending the Slack webhook. A missing webhook configuration or failed Slack send still consumes a slot. Invalid payloads and failed Turnstile checks do not reach the limiter. A denied rate-limit attempt does not add another row. The final `Retry-After` uses the RPC result instead of always returning 86,400 seconds.

## 9. Final signin route changes

File: `app/api/signin/route.ts`.

Its existing shared-helper import and constants remain:

```ts
import { checkAndLogRateLimit, clientIpFrom, verifyTurnstileToken } from "@/lib/rate-limit"

const SIGNIN_MAX_ATTEMPTS = 8
const SIGNIN_WINDOW_SECONDS = 120 //seconds
```

Correct the opening rate-limit comment to `8 attempts / 120 seconds / IP`.

Replace the complete `POST` function with:

```ts
export async function POST(req: NextRequest) {
  const { email, password, turnstileToken } = await req.json()

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    )
  }

  const ip = clientIpFrom(req)

  const isHuman = await verifyTurnstileToken(turnstileToken, ip)
  if (!isHuman) {
    return NextResponse.json(
      { error: "Verification failed. Please try again." },
      { status: 400 }
    )
  }

  const rateLimit = await checkAndLogRateLimit(
    "signin",
    ip,
    SIGNIN_MAX_ATTEMPTS,
    SIGNIN_WINDOW_SECONDS
  )

  const rateLimitHeaders = {
    "X-RateLimit-Action": "signin",
    "X-RateLimit-Limit": String(SIGNIN_MAX_ATTEMPTS),
  }

  if (rateLimit.error) {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500, headers: rateLimitHeaders }
    )
  }

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please try again shortly." },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders,
          "Retry-After": String(rateLimit.retryAfterSeconds),
          "X-RateLimit-Remaining": "0",
        },
      }
    )
  }

  const { data, error } = await supabaseAnon.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: rateLimitHeaders }
    )
  }

  return NextResponse.json(
    {
      success: true,
      session: data.session,
    },
    { headers: rateLimitHeaders }
  )
}
```

The auth call and session response are preserved. The route was already server-side when supplied; creating that route or changing `signin/page.tsx` was not work performed in this conversation. Successful and unsuccessful password checks consume a slot after passing Turnstile. The helper does not use the supplied email as a rate-limit key.

## 10. Environment requirements

| Variable | Purpose | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Target Supabase project | Must match the environment's keys |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side RPC, profile/device writes | Server-only; never use a `NEXT_PUBLIC_` prefix |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Existing auth clients | Must belong to the same project |
| `TURNSTILE_SECRET_KEY` | Server-side human verification | Existing setting retained |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Existing solutions-page widget | No change |
| `SLACK_FORM_WEBHOOK_URL` | Custom solutions delivery | Existing setting retained |

No secret values were supplied, changed, or recorded. No new package was requested; the code already used `@supabase/supabase-js` and Next.js. Keep TEST and LIVE source identical and use each deployment's environment variables for project-specific values.

## 11. Deployment order

These are deployment instructions, not a record of completed deployment.

1. Preserve the current source revision and the existing full shared RPC definition/permissions for rollback.
2. Confirm the target is TEST and its Supabase URL/keys point to the TEST project.
3. Apply the final shared RPC migration in section 5.
4. Update the action union and helper in section 6.
5. Apply the signup, custom solutions, and signin edits in sections 7–9, including success-response headers carried forward from intermediate steps.
6. Run the project's established build/type-check workflow. No package-manager/build script was supplied, so this record does not invent an exact build command or claim a passing build.
7. Deploy the updated application through the existing deployment process.
8. Complete the TEST verification in section 13.
9. Apply the same migration and source revision to LIVE with its own environment variables, then verify.
10. Retire old application instances before assuming every caller uses the shared locking protocol. Do not delete old RPCs while a deployment may still call them.

No legacy-table removal, data backfill, retention policy, cron cleanup, or automatic migration between TEST and LIVE was included.

## 12. Commands and execution record

### Actually executed or observed during this conversation

The assistant read the supplied route/page attachment copies using this shell command in `/workspace/scratch/46e11161d7a9`:

```bash
cat 'upload/Pasted text(8).txt' 'upload/Pasted text (2).txt'
```

`Pasted text(8).txt` contained the original custom solutions API route; `Pasted text (2).txt` contained `app/solutions/page.tsx`. The original submission-success and Slack-delivery observations were supplied by the user. Later signup, signin, helper, and SQL definitions were supplied directly in the conversation. The screenshot and pasted function body identified `public.check_and_log_rate_limit` and its parameters.

The assistant consulted these official references:

- [Supabase database functions and permissions](https://supabase.com/docs/guides/database/functions)
- [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)

For this documentation task, `pwd` confirmed the working directory and the Markdown file was created and inspected locally. Those document-generation operations did not modify the application or database.

### Supplied but not executed by the assistant

- Dedicated solutions RPC migration, archived in appendix A.
- Dedicated signup RPC migration, archived in appendix B.
- Final shared RPC migration in section 5.
- Application replacement snippets in this index.
- Read-only database inspection queries below.

No `npm`, `pnpm`, `yarn`, `git`, `psql`, Supabase CLI, server restart, deployment, or database mutation command was executed by the assistant against the Mediacrater application. No post-change test result was supplied. Intermediate SQL execution by the user is not confirmed merely by their continuing the conversation.

### Read-only queries supplied during the work

Inspect solutions records:

```sql
select id, action, ip, user_id, created_at
from public.rate_limits
where action = 'solutions_form'
order by created_at desc
limit 20;
```

Inspect signup records:

```sql
select id, action, ip, user_id, created_at
from public.rate_limits
where action = 'signup'
order by created_at desc
limit 20;
```

Inspect signin records:

```sql
select id, action, ip, user_id, created_at
from public.rate_limits
where action = 'signin'
order by created_at desc
limit 20;
```

Inspect the actual shared function definition:

```sql
select pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'check_and_log_rate_limit';
```

## 13. Verification checklist — pending

Use TEST with fresh Turnstile tokens. Existing rows within the relevant window reduce the remaining allowance; the counts below assume no existing rows for that action/IP.

| Check | Expected outcome |
| --- | --- |
| Valid solutions inquiry | Success and Slack message; one `solutions_form` row |
| Fifth solutions attempt within 24 hours | 429; no extra row; no Slack delivery |
| Valid signup attempt | One `signup` row before auth; existing profile/device behavior retained |
| Eleventh signup attempt within 24 hours | 429; no extra row; auth not called |
| Signin with correct or incorrect password after valid Turnstile | One `signin` row per allowed attempt; existing auth outcome returned |
| Ninth signin attempt within 120 seconds | 429; no extra row; password check not called |
| Different actions from the same IP | Independent counts and allowances |
| Invalid Turnstile token | Verification error; no rate-limit row |
| Limiter RPC failure in TEST | Generic 500 from the three updated routes; downstream action blocked |
| Malformed/null RPC result | Shared helper fails closed instead of trusting a type assertion |
| Concurrent TEST requests for one action/IP near the limit | Only remaining slots admitted when all callers use the final shared RPC |
| A counted row ages beyond the rolling window | Its slot becomes available |
| 429 response | Correct action, maximum, `X-RateLimit-Remaining: 0`, and positive `Retry-After` |
| Success response | Correct `X-RateLimit-Action` and `X-RateLimit-Limit` |

Headers are not added to every response. Early validation/Turnstile failures retain their existing handling; signup and solutions limiter-error responses also do not gain action headers in the supplied snippets. Successful remaining-slot counts were not implemented.

## 14. Boundaries and rollback

- This migration governs requests that reach the application routes. It does not itself configure Supabase Auth's direct endpoint protections or prove that direct auth requests are forced through these routes.
- The IP extraction logic and trust in forwarding headers were retained, not audited or redesigned.
- The shared helper and SQL were reviewed from supplied text; no integration/concurrency test was run.
- Existing rows are retained. Switching from the old signup counter table does not reconstruct historical attempt timestamps.
- Retry timing is derived from the oldest counted row. If historical over-admission or a later limit reduction leaves more rows than the configured maximum, the client may need to retry again after that delay; the function still rechecks before admitting a request.
- No code was supplied for reset-password or resend-verification routes. Their existing helper usage should be checked in the repository; their limits and response handling were not independently verified here.
- Rollback should restore a coherent saved source/RPC revision and permissions. Old callers expecting the dedicated RPCs need those functions retained. Rolling back to the original SQL restores its original concurrency weakness; rolling back to the original signup counter restores its fail-open database-error behavior.
- Do not delete rate-limit rows as an assumed rollback step. No destructive cleanup SQL was supplied.

## 15. Change history within this conversation

1. Investigated solutions submissions reaching Slack without visible rate-limit rows.
2. Proposed an explicit dedicated solutions RPC and a server service-role client, logging `solutions_form` into `rate_limits` and adding response headers.
3. Proposed a dedicated signup RPC that writes `signup` rows to the same table, changes fixed to rolling windows, and stops signup on limiter errors.
4. Inspected signin and requested its existing shared helper before changing database behavior.
5. Inspected the helper and supplied signin response/error/header improvements plus a query to retrieve the shared SQL function.
6. Explained that the helper connects routes to the database RPC; acknowledged that the earlier dedicated functions duplicated existing shared infrastructure.
7. Reviewed the user-supplied shared SQL body and identified its unprotected count/insert sequence.
8. Supplied the final shared RPC, helper validation, `solutions_form` union entry, and route rewiring documented above.
9. Created this deployment index on 18 September 2026 at the user's request.

The appendices preserve intermediate code for audit/history. They are not additional deployment steps for the final design.

## Appendix A. Superseded dedicated solutions implementation

**Historical only.** This was supplied before the existing shared helper was available. The final design uses `checkAndLogRateLimit` and `check_and_log_rate_limit` instead.

### A1. Intermediate SQL supplied

```sql
begin;

create or replace function public.check_and_log_solutions_form_attempt(
  p_ip text,
  p_max_attempts integer,
  p_window_minutes integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count bigint;
  v_now timestamptz;
begin
  if p_ip is null or btrim(p_ip) = '' then
    raise exception 'IP is required';
  end if;

  if p_max_attempts is null or p_max_attempts < 1
     or p_window_minutes is null or p_window_minutes < 1 then
    raise exception 'Invalid rate limit configuration';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'rate_limits:solutions_form:' || p_ip,
      0
    )
  );

  v_now := pg_catalog.clock_timestamp();

  select count(*)
  into v_count
  from public.rate_limits
  where action = 'solutions_form'
    and ip = p_ip
    and created_at >= (
      v_now - pg_catalog.make_interval(mins => p_window_minutes)
    );

  if v_count >= p_max_attempts then
    return false;
  end if;

  insert into public.rate_limits (
    action,
    ip,
    user_id,
    created_at
  )
  values (
    'solutions_form',
    p_ip,
    null,
    v_now
  );

  return true;
end;
$$;

revoke all on function public.check_and_log_solutions_form_attempt(
  text, integer, integer
) from public, anon, authenticated;

grant execute on function public.check_and_log_solutions_form_attempt(
  text, integer, integer
) to service_role;

commit;
```

### A2. Intermediate import and function supplied

The original import:

```ts
import { supabase } from "@/lib/mediacrater/supabaseClient"
```

Was initially replaced with:

```ts
import { createClient } from "@supabase/supabase-js"
```

The intermediate complete function was:

```ts
async function checkRateLimit(
  ip: string
): Promise<{ allowed: boolean; error?: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Solutions form: missing Supabase server configuration.")
    return {
      allowed: false,
      error: "Missing Supabase server configuration.",
    }
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })

    const { data, error } = await supabaseAdmin.rpc(
      "check_and_log_solutions_form_attempt",
      {
        p_ip: ip,
        p_max_attempts: RATE_LIMIT_MAX_REQUESTS,
        p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
      }
    )

    if (error) {
      console.error("Solutions form rate limit RPC error:", error)
      return { allowed: false, error: error.message }
    }

    if (typeof data !== "boolean") {
      console.error("Solutions form rate limit RPC returned invalid data.")
      return {
        allowed: false,
        error: "Invalid rate limit response.",
      }
    }

    return { allowed: data }
  } catch (error) {
    console.error("Solutions form rate limit request failed:", error)
    return {
      allowed: false,
      error: "Rate limit request failed.",
    }
  }
}
```

The intermediate 429 headers used the full window for `Retry-After`:

```ts
headers: {
  "Retry-After": String(RATE_LIMIT_WINDOW_MINUTES * 60),
  "X-RateLimit-Action": "solutions_form",
  "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
  "X-RateLimit-Remaining": "0",
},
```

The success return introduced at that stage is preserved verbatim in section 8. The final shared-helper import and wrapper replace the entire intermediate import/function above. The final 429 header uses the returned retry delay.

## Appendix B. Superseded dedicated signup implementation

**Historical only.** The final signup route calls the shared helper instead of this dedicated function.

### B1. Intermediate SQL supplied

```sql
begin;

create or replace function public.check_and_log_signup_attempt(
  p_ip text,
  p_max_attempts integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count bigint;
  v_oldest_attempt timestamptz;
  v_now timestamptz;
  v_window interval;
  v_retry_after integer;
begin
  if p_ip is null or btrim(p_ip) = '' then
    raise exception 'IP is required';
  end if;

  if p_max_attempts is null or p_max_attempts < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'Invalid rate limit configuration';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'rate_limits:signup:' || p_ip,
      0
    )
  );

  v_now := pg_catalog.clock_timestamp();
  v_window := pg_catalog.make_interval(secs => p_window_seconds);

  select count(*), min(created_at)
  into v_count, v_oldest_attempt
  from public.rate_limits
  where action = 'signup'
    and ip = p_ip
    and created_at > v_now - v_window;

  if v_count >= p_max_attempts then
    v_retry_after := greatest(
      1,
      ceil(
        extract(epoch from (v_oldest_attempt + v_window - v_now))
      )::integer
    );

    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'retry_after', v_retry_after
    );
  end if;

  insert into public.rate_limits (
    action,
    ip,
    user_id,
    created_at
  )
  values (
    'signup',
    p_ip,
    null,
    v_now
  );

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'retry_after', 0
  );
end;
$$;

revoke all on function public.check_and_log_signup_attempt(
  text, integer, integer
) from public, anon, authenticated;

grant execute on function public.check_and_log_signup_attempt(
  text, integer, integer
) to service_role;

commit;
```

### B2. Intermediate route block supplied

This replaced the original `signup_rate_limits` counter block before it was itself replaced by section 7:

```ts
  // ── Per-IP signup rate limit (10 attempts per rolling 24 hours) ──
  if (ip) {
    try {
      const { data: rateLimit, error: rateLimitError } =
        await supabaseAdmin.rpc('check_and_log_signup_attempt', {
          p_ip: ip,
          p_max_attempts: MAX_SIGNUPS_PER_WINDOW,
          p_window_seconds: SIGNUP_RATE_LIMIT_MS / 1000,
        });

      if (rateLimitError) {
        console.error('[SIGNUP] Rate limit RPC failed:', rateLimitError);

        return jsonWithDevice(
          { error: 'Something went wrong. Please try again.' },
          500,
          deviceId
        );
      }

      if (
        !rateLimit ||
        typeof rateLimit.allowed !== 'boolean' ||
        !Number.isInteger(rateLimit.retry_after) ||
        rateLimit.retry_after < 0 ||
        (!rateLimit.allowed && rateLimit.retry_after < 1)
      ) {
        console.error('[SIGNUP] Invalid rate limit RPC response.');

        return jsonWithDevice(
          { error: 'Something went wrong. Please try again.' },
          500,
          deviceId
        );
      }

      if (!rateLimit.allowed) {
        return jsonWithDevice(
          { error: 'Too many signup attempts. Please try again later.' },
          429,
          deviceId,
          {
            'Retry-After': String(rateLimit.retry_after),
            'X-RateLimit-Action': 'signup',
            'X-RateLimit-Limit': String(MAX_SIGNUPS_PER_WINDOW),
            'X-RateLimit-Remaining': '0',
          }
        );
      }
    } catch (error) {
      console.error('[SIGNUP] Rate limit request failed:', error);

      return jsonWithDevice(
        { error: 'Something went wrong. Please try again.' },
        500,
        deviceId
      );
    }
  }
```

The signup success headers introduced at this stage remain in section 7. No extra dependency was introduced at this stage because signup already had a service-role client.

## Appendix C. Original shared function body and helper

These are the relevant original implementations supplied by the user. They explain the changes; they are not rollback instructions by themselves because a full function's owner, language attributes, defaults, and grants also matter.

### C1. Original database function body

```sql
declare
  v_count int;
  v_oldest_in_window timestamptz;
begin
  select count(*), min(created_at) into v_count, v_oldest_in_window
  from rate_limits
  where action = p_action
    and created_at > now() - (p_window_seconds || ' seconds')::interval
    and (
      (p_user_id is not null and user_id = p_user_id)
      or (p_user_id is null and ip = p_ip)
    );

  if v_count >= p_max_attempts then
    return query select
      false,
      greatest(0, p_window_seconds - extract(epoch from (now() - v_oldest_in_window))::int);
    return;
  end if;

  insert into rate_limits (action, ip, user_id)
  values (p_action, p_ip, p_user_id);

  return query select true, 0;
end;
```

The final version adds locks and input checks, qualifies `public.rate_limits`, uses a timestamp captured after acquiring locks, explicitly stamps inserted rows with that timestamp, and rounds retry seconds upward with a minimum of one on denial. The table-returning API is retained.

### C2. Original action union and helper function

```ts
export type RateLimitAction = "signup" | "signin" | "reset_password" | "resend_verification"

export async function checkAndLogRateLimit(
  action: RateLimitAction,
  ip: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const { data, error } = await supabaseAdmin
    .rpc("check_and_log_rate_limit", {
      p_action: action,
      p_ip: ip,
      p_user_id: null,
      p_max_attempts: maxAttempts,
      p_window_seconds: windowSeconds,
    })
    .single()

  if (error) {
    console.error(`[RATE LIMIT] RPC error for action "${action}":`, error.message)
    // Fail closed — an RPC error is treated as "not allowed" rather than
    // silently letting the request through.
    return { allowed: false, retryAfterSeconds: windowSeconds, error: error.message }
  }

  const result = data as { allowed: boolean; retry_after_seconds: number }
  return { allowed: result.allowed, retryAfterSeconds: result.retry_after_seconds }
}
```

### C3. Original solutions rate-limit wrapper

```ts
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

### C4. Original signup limiter block

```ts
  // ── Per-IP signup rate limit (10 signups per 24 hours) ──────────────────────────────
  if (ip) {
    const { data: existingLimit } = await supabaseAdmin
      .from('signup_rate_limits')
      .select('first_attempt_at, last_attempt_at, attempt_count')
      .eq('ip', ip)
      .maybeSingle();

    const now = new Date();
    const nowMs = now.getTime();

    if (existingLimit) {
      const firstAttemptMs = new Date(existingLimit.first_attempt_at).getTime();
      const elapsedMs = nowMs - firstAttemptMs;

      if (elapsedMs < SIGNUP_RATE_LIMIT_MS) {
        if (existingLimit.attempt_count >= MAX_SIGNUPS_PER_WINDOW) {
          const retryAfterSeconds = Math.ceil((SIGNUP_RATE_LIMIT_MS - elapsedMs) / 1000);
          return jsonWithDevice(
            { error: 'Too many signup attempts. Please try again later.' },
            429,
            deviceId,
            { 'Retry-After': String(retryAfterSeconds) }
          );
        }

        // Within 24hr window and under limit -> Increment attempt count
        const { error: rateLimitError } = await supabaseAdmin
          .from('signup_rate_limits')
          .update({
            attempt_count: existingLimit.attempt_count + 1,
            last_attempt_at: now.toISOString(),
          })
          .eq('ip', ip);

        if (rateLimitError) {
          console.error('[SIGNUP] Failed to increment rate limit attempt:', rateLimitError.message);
        }
      } else {
        // Window expired -> Reset count to 1 and update window start time
        const { error: rateLimitError } = await supabaseAdmin
          .from('signup_rate_limits')
          .update({
            attempt_count: 1,
            first_attempt_at: now.toISOString(),
            last_attempt_at: now.toISOString(),
          })
          .eq('ip', ip);

        if (rateLimitError) {
          console.error('[SIGNUP] Failed to reset rate limit window:', rateLimitError.message);
        }
      }
    } else {
      // First attempt for this IP
      const { error: rateLimitError } = await supabaseAdmin
        .from('signup_rate_limits')
        .insert({
          ip,
          attempt_count: 1,
          first_attempt_at: now.toISOString(),
          last_attempt_at: now.toISOString(),
        });

      if (rateLimitError) {
        console.error('[SIGNUP] Failed to record initial rate limit attempt:', rateLimitError.message);
      }
    }
  }
```

### C5. Original signin rate-limit branch and returns

The original branch treated all helper denials, including database errors, as 429:

```ts
  const rateLimit = await checkAndLogRateLimit(
    "signin",
    ip,
    SIGNIN_MAX_ATTEMPTS,
    SIGNIN_WINDOW_SECONDS
  )
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }
    )
  }
```

Its original auth-error and success returns did not carry action/limit headers:

```ts
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    session: data.session,
  })
```

Section 9 records the complete final replacement function. No other signin functionality was intentionally changed.

## Appendix D. Final deployment sign-off fields

Complete after actual deployment; these fields were not established in the conversation.

| Item | Recorded value |
| --- | --- |
| TEST source commit | Not recorded |
| TEST SQL applied at | Not confirmed |
| TEST build result | Not run by assistant |
| TEST functional/concurrency verification | Pending |
| LIVE source commit | Not recorded |
| LIVE SQL applied at | Not confirmed |
| LIVE deployment time | Not confirmed |
| Legacy caller retirement | Not confirmed |
| Old RPC/table cleanup | Not performed |
