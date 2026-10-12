# Unverified Account Cleanup Job (pg_cron): Designed and Tested, Not Applied

| | |
|---|---|
| **Date** | 12 October 2026 (`12oct26`) |
| **Conversation** | `<add this conversation's URL>` |
| **Related work (same conversation)** | `server-verified-accounts-12oct26.md` (creates the pending accounts this would clean up) |
| **Stack** | Supabase Postgres, `pg_cron`, `auth.users`, `public.profiles` |
| **Starting trigger** | Direct-API signups (with a solved captcha) still create accounts, even though they can't scan. You were concerned they could flood Supabase, and had thought about a cron job that deletes unverified accounts after some time |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included. Test data used fake UUIDs and labels.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied. ⏳ = open.

> **Decision: not applied.** You chose to keep cleanup manual ("These scripts can't see patterns, it just executes"). Nothing in this file has been run in test or production. `06b` (read-only) is still useful for manual review.

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
9. [Appendix A – 06a: foreign key check (read-only)](#appendix-a--06a-foreign-key-check-read-only)
10. [Appendix B – 06b: dry run (read-only)](#appendix-b--06b-dry-run-read-only)
11. [Appendix C – 06c: function and schedule](#appendix-c--06c-function-and-schedule)
12. [Appendix D – 06d: checks and pause](#appendix-d--06d-checks-and-pause)
13. [Appendix E – Local test](#appendix-e--local-test)

---

## 1. Summary

An hourly `pg_cron` job (`private.cleanup_unverified_accounts()`) would delete:
1. accounts in `pending_verification` for more than **24 hours** (bypass signups, abandoned Google signups);
2. accounts whose email was **never confirmed and that never signed in**, after **7 days**.

It never touches abuse-locked accounts (`action_required`), which are evidence for duplicate-account clustering. It deletes one user at a time, skipping and logging any it can't delete. It runs at most 500 per run, lives in a `private` schema that Supabase doesn't expose through its API, and is revoked from `anon` and `authenticated`.

**It was tested on a real local Postgres 16 with mock tables. Not applied: you prefer manual review.**

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| SQL written (`06a`–`06d`) | ✅ Done | |
| Local test (Postgres 16, mock data) | ✅ Passed | [Appendix E](#appendix-e--local-test) |
| Applied to test or production | ⏳ Not applied | Your decision: manual for now |
| `pg_cron` enabled | ⏳ Not done | Only needed if applied |

---

## 3. Starting point

- After `server-verified-accounts-12oct26.md`, bypass signups exist but stay `pending_verification` and can't scan.
- Supabase's own per-IP signup limit can't be lowered safely: legitimate signups arrive from **Vercel's server IPs** (`/api/signup`), so a low limit would block real users first.

---

## 4. Timeline: what we did, in order

1. I agreed a cleanup job fits, and laid out the rules: two kinds of "unverified" with different ages, keep locked accounts, delete one user at a time, keep it out of the API.
2. Wrote `06a` (FK check), `06b` (dry run), `06c` (function and schedule), `06d` (checks).
3. Installed Postgres 16 in my sandbox (the first `apt-get install` failed without `apt-get update`), created mock `auth.users`, `profiles` (FK to `auth.users`, no cascade), `scans`, and a `cron` stub, then ran the dry run and the function. Results in [Appendix E](#appendix-e--local-test).
4. You decided not to apply it: a person can spot patterns (a burst from one domain, many signups on one day) that fixed rules can't.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | First Postgres install returned nothing | Package lists not updated | `apt-get update` then install |
| 2 | One mock user was skipped with `23503` | A `scans` row referenced its profile (no cascade) | Intended: skipped and logged, the rest continued |

---

## 6. Corrections / important decisions

### Decisions

1. **Not applied.** Manual review for now.
2. **If applied later:** 24 h for pending, 7 days for never-confirmed and never-signed-in, never `action_required`.
3. **Don't lower Supabase's per-IP signup limit** (Vercel IPs).
4. Fallback if `postgres` can't delete from `auth.users` on Supabase: a VPS job using the admin API.

---

## 7. Open items checklist

- [ ] Optional: run `06b` occasionally for manual review, and delete accounts in Authentication → Users
- [ ] If you ever automate: enable `pg_cron`, run `06a` → `06b` → `06c`, then run the function once by hand and compare with the dry run

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Function | `private.cleanup_unverified_accounts(batch_size integer default 500)` → returns the number deleted |
| Schedule | `cleanup-unverified-accounts`, `17 * * * *` (hourly at minute 17) |
| Rules | pending > 24 h; or `email_confirmed_at is null and last_sign_in_at is null` > 7 d; never `action_required` |
| Batch | 500 per run (clamped 1–5000), oldest first |
| Logs | `cleanup_unverified_accounts: deleted N, skipped M` (log); `skipped user <id> (<sqlstate>)` (warning). No emails |
| Access | Schema `private` revoked from `public`, `anon`, `authenticated` |

---

## Appendix A – 06a: foreign key check (read-only)

```sql
-- sql/06a_check_foreign_keys.sql
-- READ-ONLY. Shows which tables point at auth.users / profiles and what
-- happens to their rows when a user is deleted (delete_action):
--   CASCADE   rows are deleted too
--   SET NULL  the link is cleared, rows are kept
--   NO ACTION / RESTRICT  the user can't be deleted while rows exist
-- The cleanup job (06c) skips and logs any user it can't delete, so this is
-- only to know in advance what will be removed alongside each account.

select
  conrelid::regclass  as table_name,
  conname             as constraint_name,
  confrelid::regclass as references_table,
  case confdeltype
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    when 'r' then 'RESTRICT'
    else 'NO ACTION'
  end as delete_action
from pg_constraint
where contype = 'f'
  and confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
  and connamespace <> 'auth'::regnamespace
order by references_table::text, table_name::text;
```

---

## Appendix B – 06b: dry run (read-only)

```sql
-- sql/06b_dry_run_cleanup.sql
-- READ-ONLY. Lists exactly the accounts the cleanup job (06c) would delete
-- right now, with the reason. Run this before scheduling, and any time you
-- change the time limits.

select
  u.id,
  u.email,
  u.created_at,
  u.email_confirmed_at,
  u.last_sign_in_at,
  p.account_status,
  case
    when p.account_status = 'pending_verification'
      then 'pending > 24h'
    else 'email never confirmed > 7d'
  end as reason
from auth.users u
left join public.profiles p on p.id = u.id
where coalesce(p.account_status, '') <> 'action_required'
  and (
    (p.account_status = 'pending_verification'
      and u.created_at < now() - interval '24 hours')
    or
    (u.email_confirmed_at is null
      and u.last_sign_in_at is null
      and u.created_at < now() - interval '7 days')
  )
order by u.created_at;
```

---

## Appendix C – 06c: function and schedule

Requires **Database → Extensions → pg_cron** enabled first.

```sql
-- sql/06c_cleanup_unverified_accounts.sql
--
-- Hourly job that deletes accounts that never became usable:
--   1. account_status = 'pending_verification' for more than 24 hours
--      (direct-API signups that bypassed /api/signup, abandoned Google sign-ups)
--   2. email never confirmed AND never signed in, for more than 7 days
-- Never touches accounts locked by abuse detection ('action_required'): they
-- are kept as evidence for duplicate-account clustering.
--
-- Safety:
-- - Lives in a "private" schema, which Supabase does not expose through its
--   API, and EXECUTE is revoked from everyone but the owner.
-- - Deletes each user separately. If one can't be deleted (e.g. another table
--   still references it), that one is skipped with a warning; the rest go on.
-- - At most 500 accounts per run, oldest first, so a backlog can't lock tables.
--
-- Requires the pg_cron extension (Database → Extensions → pg_cron, or
-- Integrations → Cron). Run 06b (dry run) first.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.cleanup_unverified_accounts(batch_size integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_deleted integer := 0;
  v_failed integer := 0;
begin
  for v_id in
    select u.id
    from auth.users u
    left join public.profiles p on p.id = u.id
    where coalesce(p.account_status, '') <> 'action_required'
      and (
        (p.account_status = 'pending_verification'
          and u.created_at < now() - interval '24 hours')
        or
        (u.email_confirmed_at is null
          and u.last_sign_in_at is null
          and u.created_at < now() - interval '7 days')
      )
    order by u.created_at
    limit greatest(1, least(batch_size, 5000))
  loop
    begin
      -- Profile first, in case profiles -> auth.users isn't ON DELETE CASCADE.
      delete from public.profiles where id = v_id;
      delete from auth.users where id = v_id;
      v_deleted := v_deleted + 1;
    exception when others then
      v_failed := v_failed + 1;
      -- User ID only; no email in logs.
      raise warning 'cleanup_unverified_accounts: skipped user % (%)', v_id, sqlstate;
    end;
  end loop;

  if v_deleted > 0 or v_failed > 0 then
    raise log 'cleanup_unverified_accounts: deleted %, skipped %', v_deleted, v_failed;
  end if;

  return v_deleted;
end;
$$;

revoke all on function private.cleanup_unverified_accounts(integer) from public, anon, authenticated;

commit;

-- Schedule: every hour at minute 17 (off the hour, when other jobs run).
-- Re-running this line replaces the existing schedule with the same name.
select cron.schedule(
  'cleanup-unverified-accounts',
  '17 * * * *',
  $job$select private.cleanup_unverified_accounts();$job$
);
```

---

## Appendix D – 06d: checks and pause

Run one at a time.

```sql
-- sql/06d_cleanup_checks.sql
-- Useful queries for the cleanup job. Run ONE at a time (highlight + Run).

-- Is it scheduled?
select jobid, jobname, schedule, active from cron.job where jobname = 'cleanup-unverified-accounts';

-- Recent runs and their result
select start_time, status, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'cleanup-unverified-accounts')
order by start_time desc
limit 10;

-- Run it once now, by hand (returns how many accounts were deleted)
select private.cleanup_unverified_accounts();

-- Pause / remove the schedule (the function stays)
select cron.unschedule('cleanup-unverified-accounts');
```

---

## Appendix E – Local test

Mock data (ages relative to now):

| Label | Created | Confirmed | Signed in | Status |
|---|---|---|---|---|
| pending-old | 2 days ago | no | no | `pending_verification` |
| pending-new | 2 hours ago | no | no | `pending_verification` |
| unconf-8d | 8 days ago | no | no | `active` |
| unconf-3d | 3 days ago | no | no | `active` |
| locked-old | 30 days ago | no | no | `action_required` |
| active-conf | 30 days ago | yes | yes | `active` |
| pending-w-scan | 3 days ago | no | no | `pending_verification` (has a `scans` row) |
| unconf-signedin | 9 days ago | no | yes | `active` |

**Dry run (`06b`) listed:** `unconf-8d` (email never confirmed > 7 d), `pending-w-scan` (pending > 24 h), `pending-old` (pending > 24 h).

**Function run:**
```
WARNING:  cleanup_unverified_accounts: skipped user 00000000-0000-4000-8000-000000000007 (23503)
2
```
**Remaining:** `active-conf`, `locked-old`, `pending-new`, `pending-w-scan`, `unconf-3d`, `unconf-signedin`.

**As `anon`:** `ERROR: permission denied for schema private`.
**Schedule row:** `cleanup-unverified-accounts | 17 * * * *`.

---

*End of index.  
Conversation: `<add this conversation's URL>`*
