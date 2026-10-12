# Server-Verified Accounts: Every New Account Starts Pending Until Server Code Activates It

| | |
|---|---|
| **Date** | 12 October 2026 (`12oct26`) |
| **Conversation** | `<add this conversation's URL>` |
| **Related prior work** | `auth-hardening-turnstile-supabase-origin-secret-05oct26.md` (5 Oct 2026, `/api/signup` writes IP, device and consent with the service-role key)<br>6 Oct 2026 per-scan abuse check index (`ip_at_creation` used for duplicate-account clustering) |
| **Related work (same conversation)** | `google-oauth-signin-12oct26.md` (the Google activation path)<br>`unverified-account-cleanup-job-12oct26.md` (cleanup of pending accounts, not applied) |
| **Stack** | Supabase Postgres (`handle_new_user()`, `profiles`), Next.js `/api/signup` on Vercel, VPS `/api/oauth/complete` |
| **Starting trigger** | Values in `raw_user_meta_data` come from the person signing up. With the public anon key, anyone could call Supabase's `/auth/v1/signup` directly (after solving Turnstile once) and set their own `ip_at_creation`, `browser_id` and consent timestamp, then get an `active` account. That undermines duplicate-account detection |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included. `<project-ref>`, `<anon key>` and `bypass-test@<your domain>` are placeholders.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied. ⏳ = open.

---

## Contents

1. [Summary](#1-summary)
2. [Status at a glance](#2-status-at-a-glance)
3. [Starting point](#3-starting-point)
4. [Timeline: what we did, in order](#4-timeline-what-we-did-in-order)
5. [Errors and surprises](#5-errors-and-surprises)
6. [Corrections / important decisions](#6-corrections--important-decisions)
7. [Open items checklist](#7-open-items-checklist)
8. [Reference: key settings](#8-reference-key-settings)
9. [Appendix A – SQL: 04_server_verified_accounts.sql](#appendix-a--sql-04_server_verified_accountssql)
10. [Appendix B – /api/signup change](#appendix-b--apisignup-change)
11. [Appendix C – Repair query](#appendix-c--repair-query)
12. [Appendix D – Verification commands](#appendix-d--verification-commands)
13. [Appendix E – Rollback](#appendix-e--rollback)

---

## 1. Summary

`handle_new_user()` no longer copies `browser_id`, `ip_at_creation` or the consent timestamp from user metadata, and creates **every** new profile as `pending_verification`. Only server code activates accounts: `/api/signup` (email, after writing the real values with the service-role key) and `/api/oauth/complete` (Google). A direct-API signup stays pending, with none of its forged values, and can't scan.

**Main outcomes**

- One function handles all providers. The separate Google-only trigger (`on_auth_user_created_oauth_pending`) is dropped.
- `/api/signup` now **returns an error** if writing the profile or activating it fails. It used to log the error and report success.
- Activation only moves `pending_verification` → `active`, so it can never lift an abuse lock (`action_required`).
- Live on **test and production**. Your drift check shows them identical.
- A direct `fetch` to `/auth/v1/signup` **without** a captcha token was refused: `captcha_failed`.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| `/api/signup` (server-verified version) on test and prod | ✅ Live | Seen in the repo: `pending_verification` in `app/api/signup/route.ts`. Email signups end up active |
| `04` on **test** | ✅ Done | Trigger check: only `on_auth_user_created`; `like '%pending_verification%'` → `true` |
| Accidental rollback on test, then `04` re-run | ✅ Recovered | See Phase 4 |
| Bypass without captcha | ✅ Refused | `{"error_code":"captcha_failed", …}` |
| Bypass with a real captcha token | ✅ Signup succeeded (expected) | ⚠️ Profile result not reported |
| Prod `00` + `04` | ✅ Done | Prod `handle_new_user()` matched test's before replacement |
| Prod repair query | ✅ Run | Run **before** `04`, so it changed nothing (nothing was pending yet) |
| Prod email signups end up active | ✅ Verified | "Signed up several times… it works" |
| Bypass test account deleted | ⚠️ Unconfirmed | `bypass-test@<your domain>` |
| Profile cascade on user delete | ⚠️ Unknown | Check in Appendix D |
| Auth Hook review (log contents, `SET LOCAL`) | ⏳ Open | Function never provided |

---

## 3. Starting point

`handle_new_user()` (identical in test and prod, apart from formatting):

```sql
INSERT INTO public.profiles (
  id, email, browser_id, plan, scans_remaining, scans_per_month,
  deep_scan_enabled, scan_history, subscription_renews_at,
  accept_tos_privacy_refund_emailconsent_age18plus, ip_at_creation
) VALUES (
  NEW.id, NEW.email, NEW.raw_user_meta_data->>'browser_id', 'free', 3, 3,
  false, false, NOW() + INTERVAL '30 days',
  (NEW.raw_user_meta_data->>'accepted_tos_privacy_at')::timestamptz,
  NEW.raw_user_meta_data->>'ip_at_creation'   -- must be written by the hook
);
```

- `/api/signup` overwrote those three fields from server-observed values, but only for signups that went through it.
- `authenticateUser` on the VPS only fills `ip_at_creation` when it's NULL, so a forged value was never corrected.
- Columns `browser_id`, `ip_at_creation` and the consent column are nullable; `email` and `account_status` (default `'active'`) are NOT NULL.
- The Chrome extension is accountless (it creates no accounts), so only the two server routes matter.

---

## 4. Timeline: what we did, in order

### Phase 1 – Finding the gap

I checked `route.ts` line 191: the upsert writes `ip_at_creation: ip || null`, `browser_id: deviceId`, and the consent timestamp from the server. The gap was only for signups that bypass the route.

### Phase 2 – The fix

`04_server_verified_accounts.sql` ([Appendix A](#appendix-a--sql-04_server_verified_accountssql)) and the `/api/signup` change ([Appendix B](#appendix-b--apisignup-change)): activation guarded by `.eq('account_status', 'pending_verification')`, and a 500 "Your account could not be set up. Please try again." on failure. A retry re-sends the confirmation for an unconfirmed user and activates them (to my understanding).

**Required order:** deploy the route **first** (its activation does nothing until `04` exists), then run `04`.

### Phase 3 – Your two blockers, answered

- **Extension:** accountless (you'd said so before; my repeated question was my mistake).
- **Auth Hook:** doesn't block `04`. A "Before User Created" hook runs before the row exists, and `/api/signup` writes the real IP itself.

### Phase 4 – The accidental rollback

You ran `05_rollback_server_verified_accounts.sql`, thinking it was "step 5". It restored the pre-change state, which was harmless and had worked before. You re-ran `04`. Checks: one trigger (`on_auth_user_created`), and `pg_get_functiondef(…) like '%pending_verification%'` → `true`. I renamed the file `ROLLBACK_server_verified_accounts.sql`.

### Phase 5 – Bypass tests

1. `fetch('…/auth/v1/signup', …)` **without** a captcha token:
   ```
   {code: 400, error_code: 'captcha_failed', msg: 'captcha protection: request disallowed (no captcha_token found)'}
   ```
2. **With** `gotrue_meta_security: { captcha_token: turnstile.getResponse() }` from the signup page → the user was created (expected). ⚠️ The profile check result wasn't reported. **Expected:** `account_status = pending_verification`, and `ip_at_creation`, `browser_id` and consent all NULL.

You raised that bypass accounts could still flood Supabase. That led to the cleanup-job design (`unverified-account-cleanup-job-12oct26.md`), which you decided to keep manual.

### Phase 6 – Production

1. Production `handle_new_user()` compared with test: same logic. One trigger.
2. `00` (constraint) ✅.
3. You ran the **repair query first** (it found nothing pending), **then `04`**. No email signup was harmed: production's `/api/signup` was already the new version (your drift check), so activation worked from the start.
4. Email signups on production end up active ✅.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Forged metadata accepted for direct-API signups | `handle_new_user()` trusted `raw_user_meta_data` | Ignore metadata; pending until the server activates |
| 2 | `/api/signup` reported success when the profile write failed | Error only logged | Returns 500 now |
| 3 | Rollback file run by mistake | I named it `05_…` right after a list with a "step 5" | Re-ran `04`; file renamed `ROLLBACK_…` |
| 4 | I asked about extension signups again | I'd lost track that you'd already answered | Accountless confirmed |
| 5 | Repair query run before `04` | Order swapped | Harmless (no-op) |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. **Rollback file naming** caused the accidental run.
2. **Repeated question** about the extension.

### Decisions

1. **Pending by default for all providers,** activated only by server routes.
2. **Never lift abuse locks during activation** (guarded update).
3. **Fail loudly in `/api/signup`.**
4. **Direct-API signups are allowed to exist, but can't do anything.** Fully preventing them needs signups disabled in Supabase plus `admin.createUser`, which would change how confirmation emails are sent; deferred.
5. **Cleanup of leftover accounts: manual** (your choice).

---

## 7. Open items checklist

- [ ] Delete `bypass-test@<your domain>` in Authentication → Users (test), then check that its profile is gone ([Appendix D](#appendix-d--verification-commands))
- [ ] Send the Auth Hook function (`select pg_get_functiondef('public.<function_name>'::regproc);`): log the user ID only, and fix the `SET LOCAL` warnings
- [ ] Optional: run `06b_dry_run_cleanup.sql` occasionally for manual review of stale pending or unconfirmed accounts
- [ ] Optional: friendlier message for pending accounts that try to scan (they currently see the `ACCOUNT_FLAGGED`-style message)

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| New profile status | `pending_verification` |
| Activated by | `/api/signup` (email), `/api/oauth/complete` (Google) |
| Activation guard | `update … set account_status = 'active' where id = … and account_status = 'pending_verification'` |
| Allowed statuses | `active`, `action_required`, `pending_verification` (`profiles_account_status_check`) |
| Trigger on `auth.users` | `on_auth_user_created` → `handle_new_user()` only |
| Order for any new environment | `00` → deploy `/api/signup` → `04` |

---

## Appendix A – SQL: 04_server_verified_accounts.sql

```sql
-- sql/04_server_verified_accounts.sql
--
-- Every new account starts as 'pending_verification'. Only server code
-- activates it:
--   - email signups: /api/signup (Vercel), after writing the real IP,
--     device and consent with the service-role key
--   - Google signups: POST /api/oauth/complete (VPS)
-- A signup made by calling Supabase's /auth/v1/signup directly (public anon
-- key) stays pending, and the scan routes refuse non-active accounts.
--
-- handle_new_user() no longer copies browser_id, ip_at_creation or the
-- consent timestamp from raw_user_meta_data: the person signing up controls
-- that data. Those columns are nullable and are filled by the server routes.
--
-- Replaces the separate Google-only trigger from 02_oauth_pending_trigger.sql,
-- so all the new-user logic is in one function.
--
-- Run 00 (constraint) first if this project doesn't have it yet.
-- Existing accounts are not changed.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (
    id,
    email,
    plan,
    scans_remaining,
    scans_per_month,
    deep_scan_enabled,
    scan_history,
    subscription_renews_at,
    account_status
  )
  values (
    new.id,
    new.email,
    'free',
    3,
    3,
    false,
    false,
    now() + interval '30 days',
    'pending_verification'
  );
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created_oauth_pending on auth.users;
drop function if exists public.mark_oauth_signup_pending();

commit;
```

---

## Appendix B – /api/signup change

Header comment added, then after the existing profile upsert:

```ts
    if (upsertError) {
      console.error('[SIGNUP] Failed to write profile data:', upsertError.message);
      return jsonWithDevice(
        { error: 'Your account could not be set up. Please try again.' },
        500,
        deviceId
      );
    }

    const { error: activateError } = await supabaseAdmin
      .from('profiles')
      .update({ account_status: 'active' })
      .eq('id', userId)
      .eq('account_status', 'pending_verification');

    if (activateError) {
      console.error('[SIGNUP] Failed to activate profile:', activateError.message);
      return jsonWithDevice(
        { error: 'Your account could not be set up. Please try again.' },
        500,
        deviceId
      );
    }
```

---

## Appendix C – Repair query

Activates email signups that went through `/api/signup` but got stuck pending (only needed if `04` ever runs before the new route is live). Safe to re-run any number of times.

```sql
update public.profiles p
set account_status = 'active'
from auth.users u
where u.id = p.id
  and p.account_status = 'pending_verification'
  and p.accept_tos_privacy_refund_emailconsent_age18plus is not null
  and p.ip_at_creation is not null
  and coalesce(u.raw_app_meta_data->>'provider', 'email') = 'email';
```

---

## Appendix D – Verification commands

**Trigger and function** (run one at a time):
```sql
select tgname from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal
order by tgname;
```
Expected: `on_auth_user_created` only.
```sql
select pg_get_functiondef('public.handle_new_user'::regproc) like '%pending_verification%' as updated;
```
Expected: `true`.

**Bypass test** (browser console on the signup page, after the Turnstile checkmark):
```js
await fetch('https://<project-ref>.supabase.co/auth/v1/signup', {
  method: 'POST',
  headers: { apikey: '<anon key>', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'bypass-test@<your domain>',
    password: 'Test-password-123!',
    data: { ip_at_creation: '1.2.3.4', browser_id: 'forged', accepted_tos_privacy_at: '2020-01-01' },
    gotrue_meta_security: { captcha_token: turnstile.getResponse() }
  })
}).then(r => r.json())
```
Then:
```sql
select account_status, ip_at_creation, browser_id,
       accept_tos_privacy_refund_emailconsent_age18plus
from public.profiles
where id = '<id returned by the fetch>';
```
Expected: `pending_verification`, then NULL, NULL, NULL.

**After deleting a test user, check the profile went too:**
```sql
select count(*) from public.profiles where id = '<user id>';
```
Expected: `0`. If it says `1`, profiles don't cascade on delete: remove the row with `delete from public.profiles where id = '<user id>';` and note it, because every deleted user would leave an orphan.

**A real email signup:**
```sql
select account_status from public.profiles where email = '<address used>';
```
Expected: `active`.

---

## Appendix E – Rollback

`ROLLBACK_server_verified_accounts.sql` restores the original `handle_new_user()` (copies metadata, `active` by default) **and** the Google-only pending trigger:

```sql
-- sql/05_rollback_server_verified_accounts.sql
-- Emergency rollback of 04: restores the original handle_new_user() (active
-- accounts, values copied from metadata) and the Google-only pending trigger.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (
    id, email, browser_id, plan, scans_remaining, scans_per_month,
    deep_scan_enabled, scan_history, subscription_renews_at,
    accept_tos_privacy_refund_emailconsent_age18plus, ip_at_creation
  )
  values (
    new.id, new.email, new.raw_user_meta_data->>'browser_id', 'free', 3, 3,
    false, false, now() + interval '30 days',
    (new.raw_user_meta_data->>'accepted_tos_privacy_at')::timestamptz,
    new.raw_user_meta_data->>'ip_at_creation'
  );
  return new;
end;
$function$;

create or replace function public.mark_oauth_signup_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email' then
    update public.profiles set account_status = 'pending_verification' where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.mark_oauth_signup_pending() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_oauth_pending on auth.users;
create trigger on_auth_user_created_oauth_pending
  after insert on auth.users
  for each row execute function public.mark_oauth_signup_pending();

commit;
```

To go forward again, re-run `04`. It fully replaces what the rollback restores.

---

*End of index.  
Conversation: `<add this conversation's URL>`*
