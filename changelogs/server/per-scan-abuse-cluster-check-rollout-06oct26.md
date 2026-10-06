# Per-Scan Free-Tier Abuse Check: Linked-Account Shared Quota, Live Rollout & Verification

| | |
|---|---|
| **Date** | 6 October 2026 (`06oct26`) |
| **Conversation** | https://claude.ai/chat/344c1200-b593-4d05-bab9-cd0f70039e9c |
| **Related prior work** | `vps-hardening-cloudflare-lockdown-ssrf-fix-02oct26.md` (2 Oct 2026)<br>`auth-hardening-turnstile-supabase-origin-secret-05oct26.md` (5 Oct 2026) |
| **Stack** | Node API on the VPS (`rateLimiter.js`, `abuseDetection.js`, PM2), Supabase Postgres (**separate databases for test and live**) |
| **Starting trigger** | One IP address creating a new free account each time the old one was locked, then immediately running 3 scans on the new account |

> **Redaction note:** No secrets, keys, IP addresses or user IDs are included. `ABUSER_IP` and `<abuser account uuid>` stand in for them.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied. ⏳ = open.

> **This file replaces the pool design in the 05oct26 index.** Appendices E and F of that file describe a stored-pool design (`scan_pools`, `profiles.pool_id`, `assign_pool`). We did **not** use it. The check below computes linked accounts on the fly on every scan, so there are no pool tables and no migration. If you haven't run that pool SQL, skip it.

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
9. [Appendix A – SQL](#appendix-a--sql)
10. [Appendix B – rateLimiter.js (final)](#appendix-b--ratelimiterjs-final)
11. [Appendix C – Verification and troubleshooting commands](#appendix-c--verification-and-troubleshooting-commands)
12. [Appendix D – Rollback and maintenance](#appendix-d--rollback-and-maintenance)

---

## 1. Summary

The abuser's pattern was: scan on the old account, get blocked (`Blocked scan attempt by flagged account`), create a new account, and immediately run 3 scans. The timed sweep couldn't stop that, because a new account stays `active` until the next run. We moved the check into the scan path.

**Main outcomes**

- Every free-plan scan now checks whether the account is **linked** to other free accounts and, if so, whether the **group's shared quota** for the month is used up. If it is, the scan gets a **429** before anything runs.
- An account is linked to another in two ways:
  1. **Strong link:** the same `device_id`, or the same `device_fp` (fingerprints shared by more than 10 accounts are ignored).
  2. **IP link:** the same IP at creation (IPv6 `/64`), **only if a currently locked account already lives at that IP** (flagged within 30 days). This keeps shared networks like schools and offices from being pooled.
- Quota is counted from the `scans` table, so there is no counter to reset, no stored pool to go stale, and no migration.
- The SQL function and the new `rateLimiter.js` are **live and enforcing**. A direct check on one of the abuser's accounts returned `allowed: false` with the shared-quota message.
- The abuser's four accounts used **9 scans** across them before this.
- The **sweep keeps running**. The IP rule depends on a locked account existing at that IP, and the sweep creates those locks.

**Not yet seen:** a real `[ABUSE-LINK] blocked` log line from live traffic. That only appears when an active free account linked to a locked one tries to scan, and the abuser hasn't been back since the switch.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| SQL in the **live** database (`ip_bucket`, indexes, `free_cluster_usage`) | ✅ Done | Dry run returned the expected numbers |
| SQL in the **test** database | ⏳ Not applied | Test uses a separate Supabase project. The test app logs `[CLUSTER] lookup failed` and allows scans |
| Abuser's 4 accounts locked, with `flagged_at` set | ✅ Done | One was unlocked, so you locked it by hand and filled in `flagged_at` |
| Dry run on an abuser account | ✅ Verified | `used_scans` 9, `member_count` 4, `strong_count` 1, `flagged_count` 3 |
| New `rateLimiter.js` copied to live | ✅ Done | Verified by a direct function call, then by the mode line in the logs |
| `POOL_ENFORCE=true` in live `.env`, PM2 restarted | ✅ Done | Logs show `[ABUSE-LINK] mode: ENFORCE` after the restart |
| Direct check of `checkRateLimit` on an abuser account | ✅ Verified | `allowed: false`, `clusterRemaining:0 members:4 strongLinks:1 flaggedIpLinks:3` |
| Strict `=== 'true'` enforce line | ✅ Done | You had changed it to `process.env.POOL_ENFORCE` (any non-empty value enforces), then restored the strict check |
| A real blocked scan from live traffic | ⏳ Waiting | No `[ABUSE-LINK] blocked` line yet |
| Mode line printed twice after restart | ✅ Explained | You ran the step 6 restart commands separately, so there were two restarts and each logged the line. Enforcement was never affected |
| RPC stopgap (`detect_duplicate_free_ips`) from the 05oct26 file | ⏳ Not confirmed | Without it, the sweep still skips the third and later accounts |
| Frontend shows the 429 message | ⏳ Unverified | I haven't seen your frontend code |
| `scanVideo.js` / `scanImage.js` load the full profile row | ⏳ Unverified | I only saw the two URL handlers |
| Live is running the new `rateLimiter.js` (the Appendix B version) | ✅ Clarified | `rateLimiter.js.bak` is only a backup of the old file. It isn't loaded by the app |
| End-to-end A/B test through the site | ⏳ Not done | Replaced by the direct function check |

---

## 3. Starting point

- The free plan has 3 scans per month. Scan handlers call `checkRateLimit` (read-only), then `commitScanDeduction` after a successful scan.
- `abuseDetection.js` sweeps every **5 minutes**: it calls the `detect_duplicate_free_ips` RPC, locks accounts (`account_status = 'action_required'`, `flagged_at` set), emails them, and a second sweep unlocks accounts when no free peers remain.
- The scan handlers return **403 `ACCOUNT_FLAGGED`** for locked accounts **before** they call `checkRateLimit`. This matters for testing: a locked account never reaches the new code.
- `account_devices` (signup and login events with `device_id`, `device_fp`, IP, ASN) already exists and is written by the website's signup route.
- A new account is `active` until the next sweep, so the abuser got up to 3 fresh scans per account.
- **Test and live use separate Supabase databases.** The abuser's data exists only in live.

---

## 4. Timeline: what we did, in order

### Phase 1 – The trigger

You saw one IP repeating the same pattern and asked for the per-scan check to be implemented now. The earlier plan (from the 05oct26 file) was a stored-pool design and a week of shadow mode. Because the abuse was active, we simplified.

### Phase 2 – Design: a narrow IP rule plus device links, checked on every scan

**The rule:** a free account is linked to another when they share a strong signal, or when they share an IP **and** a locked account already lives at that IP. Everyone linked shares one monthly quota counted from `scans`. For your abuser, the new account starts at 3 minus whatever the locked accounts already used (at least 3), so its first scan is blocked.

**What the SQL does** (`free_cluster_usage`, read-only):

| Step | What it finds |
|---|---|
| `strong` | Other accounts whose **signup** row shares this account's `device_id` or `device_fp`. Fingerprints shared by more than 10 accounts are ignored |
| `flagged_here` | Other free accounts at the same IP bucket that are currently locked, flagged within 30 days, and not `abuse_lock_exempt` |
| `ip_cluster` | Every account at that IP bucket, **only if `flagged_here` is not empty** |
| `members` | This account, plus `strong` and `ip_cluster`, limited to free plans |

It returns `used_scans` (completed scans this month summed across all members), `member_count`, `strong_count` and `flagged_count`. The helper `ip_bucket` turns an IP into a comparison key (IPv4 as is, `::ffff:` mapped addresses unwrapped, IPv6 reduced to its `/64`). The function is `security definer`, so it is revoked from `anon` and `authenticated` and granted only to `service_role`.

**Worked example (your abuser):**

1. Old account A is locked and used its 3 scans.
2. New account B has the same IP, so `flagged_here` finds A, and A and B become members.
3. `used_scans` is 3, so B's remaining quota is 3 minus 3, which is 0.
4. B's first scan returns 429.

**The plan I gave (all code in the appendices):**

1. **Step 0:** check the abuser's rows ([Appendix A](#appendix-a--sql)).
2. **Step 1:** run the SQL, then a dry run.
3. **Step 2:** replace `rateLimiter.js` ([Appendix B](#appendix-b--ratelimiterjs-final)).
4. **Step 3:** deploy, test, watch the logs.

### Phase 3 – Clarifications

**"What does step 1's SQL actually do?"** It only creates things (a helper, two indexes, one read-only function). Nothing changes in your data or app until `rateLimiter.js` calls it.

**"I thought you recommended something else."** My earlier recommendation was: pool on strong signals only, stored pool membership, shadow mode first, and **stop creating IP locks** (make the sweep alert-only). What changed:

| | Earlier plan | This implementation |
|---|---|---|
| Per-scan check instead of a timer | Yes | Same |
| Pool across linked free accounts | Strong signals only | Strong signals **plus** the narrow IP rule |
| Stored pools (`pool_id`, `assign_pool`) | Yes | Dropped. Membership is computed each scan |
| Stop IP locks | Yes | **Reversed.** Keep the sweep locking |
| Shadow mode first | A week | Optional, since the abuse is active |

I added the IP rule because your abuser is on one IP and creates fresh accounts. If they clear cookies, strong signals alone would miss them. I reversed "stop IP locks" because the IP rule needs a locked account at that IP. I should have flagged that conflict at the time.

**"So this doesn't actually lock anyone out?"** It blocks **scanning**, not the account:

| | Account lock (the sweep) | Per-scan check (new) |
|---|---|---|
| What it does | Sets `action_required` and emails the user | Returns a 429 when the group's shared quota is used up |
| When | Up to 5 minutes after the accounts exist | On every scan, immediately |
| Marks the account? | Yes | No |
| Log line | `Blocked scan attempt by flagged account` | `[ABUSE-LINK] blocked ...` |

Conditions for it to block: `POOL_ENFORCE=true` and a PM2 restart with `--update-env`, the sweep still running, the new account's `ip_at_creation` matching the old account's, the old account's `flagged_at` within 30 days and not exempt, and the new account on the free plan. The new account can still log in. It just can't scan.

### Phase 4 – The enforce switch

- You thought the file already set enforcement to true. The shipped line is `const CLUSTER_ENFORCE = process.env.POOL_ENFORCE === 'true';`. It reads the environment variable, and when it's unset the code falls back to shadow mode (logs `SHADOW would block`, lets the scan through).
- You changed the line to `const CLUSTER_ENFORCE = process.env.POOL_ENFORCE;` and set the variable. **Footgun:** any non-empty value is truthy, so `POOL_ENFORCE=false` or `=0` would also enforce. Restore the strict `=== 'true'` check.
- **Update:** you restored the strict `=== 'true'` check, and live runs the `rateLimiter.js` printed in [Appendix B](#appendix-b--ratelimiterjs-final).

### Phase 5 – Preparing the abuser's accounts

- Step 0's query returned **4 accounts** at the abuser's IP. One was not locked, so you locked it by hand.
- **Problem:** a manual lock leaves `flagged_at` empty, and the IP rule only counts locked accounts flagged within the last 30 days. That account would be invisible to it.
- **Fix attempt:** `update profiles set flagged_at = now() where id = '…' and flagged_at is null` failed with `42601: syntax error at or near "update"`. The Supabase SQL editor appends `limit 100` to the last statement, which breaks an `update`.
- **Fix:** choose **No limit** in the dropdown next to Run, run the update by itself, and match by IP so no UUID is needed:

```sql
update profiles
set flagged_at = now()
where ip_at_creation = 'ABUSER_IP'
  and account_status = 'action_required'
  and flagged_at is null;
```

- The follow-up `select` showed a `flagged_at` date on all four accounts (`abuse_lock_exempt` not true).

### Phase 6 – Verifying the SQL, and the empty log search

**Dry run on an abuser account** (run it by itself, with No limit selected):

| Column | Result | Meaning |
|---|---|---|
| `used_scans` | 9 | The four accounts used 9 scans this month |
| `member_count` | 4 | All four are linked |
| `strong_count` | 1 | One other account shares a `device_id` or fingerprint |
| `flagged_count` | 3 | The other three are locked (the passed account is excluded) |

With a quota of 3, the group's remaining is 0, so any new free account on that IP is blocked on its first scan.

**The empty `grep ABUSE-LINK`:** `grep` exits with code 1 when nothing matches, which the terminal shows as a red x. Nothing had triggered the line yet, because locked accounts get a 403 before `checkRateLimit` runs. Also, you were reading the **test** app's logs while the abuser is on **live**. Don't type `<app-name>` literally; the shell reads `<` as a redirect.

### Phase 7 – Testing options, and the two-databases discovery

**A/B test (not used in the end).** Two throwaway accounts recreate the abuser: A uses its 3 scans and gets locked, B is the new account. B's first scan should return 429. You found it hard to run because the sweep is fast. The steps are in [Appendix C](#appendix-c--verification-and-troubleshooting-commands) if you want them later.

**Direct function check (used instead).** A one-off `node -e` script calls `checkRateLimit` on an abuser account. It reads the database and writes nothing. The line `profile.scans_remaining = 3` changes a value in memory only, to pretend the account is brand new, so the group logic is exercised and not the account-level quota.

**"Why would the abuser be using my test environment?"** They aren't. You run the script on your own server. The abuser's ID is used only because their four accounts are the ready-made linked-and-locked case in the database.

**The catch:** the script only works against a database that contains that ID. Checking `SUPABASE_URL` showed **test and live are different Supabase projects**. So the abuser's data, the locks and the SQL function exist only in live. The script has to run from the live folder, and the test app can't exercise this logic until the SQL is also run in the test project.

### Phase 8 – Rollout to live

1. **Back up** live's `rateLimiter.js`, which was now the only copy of the old code.
2. **Check** that the file being copied has the strict enforce line. Optionally add `console.log(`[ABUSE-LINK] mode: ${CLUSTER_ENFORCE ? 'ENFORCE' : 'SHADOW'}`);` below it.
3. **Copy** test's `rateLimiter.js` to live.
4. **Run the direct check** from live's folder with `POOL_ENFORCE=true` on the command line (for that run only). The full script is in [Appendix C](#appendix-c--verification-and-troubleshooting-commands).

**Output:**

```
[ABUSE-LINK] mode: ENFORCE
[ABUSE-LINK] blocked user:<abuser account uuid> | clusterRemaining:0 members:4 strongLinks:1 flaggedIpLinks:3
{"allowed":false,"message":"The free scans for this device or network have been used up. Upgrade for more scans."}
```

5. **Turned it on for real:** `POOL_ENFORCE=true` in live's `.env` and a PM2 restart with `--update-env`. The logs then showed `[ABUSE-LINK] mode: ENFORCE`. It printed twice because the restart commands were run separately, so there were two restarts.

**Result:** live is enforcing. The next new free account on the abuser's IP should be blocked on its first scan.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | The abuser's new accounts scanned immediately | A new account stays `active` until the next 5-minute sweep | Per-scan check in `checkRateLimit` |
| 2 | One of the abuser's four accounts was not locked | The third-and-later-account gap in the RPC (see the 05oct26 file, Appendix D) | Locked by hand. The RPC stopgap is still to be applied |
| 3 | Manually locked account invisible to the IP rule | A manual lock leaves `flagged_at` empty, and the rule needs a date within 30 days | `update … set flagged_at = now()` for that IP |
| 4 | `ERROR 42601: syntax error at or near "update"` | The Supabase SQL editor appends `limit 100` to the last statement | Select **No limit** and run the update by itself |
| 5 | Enforcement line edited to `process.env.POOL_ENFORCE` | Misread of how the switch works | Strict `=== 'true'` check recommended |
| 6 | `grep ABUSE-LINK` printed nothing, with a red x | grep exits 1 on no match. Nothing had triggered the line, and the logs were the **test** app's | Expected result; check the live app's logs |
| 7 | A locked account can't exercise the new code | Handlers return 403 `ACCOUNT_FLAGGED` before `checkRateLimit` runs | Test with a direct function call, or an active account linked to a locked one |
| 8 | A/B test impractical | The sweep runs every 5 minutes and is fast (your report) | Direct function check |
| 9 | Test can't run the check against the abuser's data | Test and live use different Supabase projects | Run the script from the **live** folder |
| 10 | The test app would log `[CLUSTER] lookup failed` | The SQL function doesn't exist in the test database | Harmless (fails open). Run the step 1 SQL in the test project if you want to test there |
| 11 | `[ABUSE-LINK] mode: ENFORCE` printed twice in the logs | The restart commands from step 6 were run separately, so there were two restarts and each logged the line | Nothing to fix. Enforcement was never affected |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. **Reversed "stop IP locks."** My earlier plan said to make the sweep alert-only. The IP rule depends on locked accounts, so the sweep must keep locking. I should have flagged the conflict when I made the change, and you caught it.
2. **Test instructions assumed one database.** I told you to run the check in the test folder using the abuser's ID, then asked about the Supabase projects afterwards. I should have checked first.
3. **"In the test folder" was confusing.** It made it sound as if the abuser used the test site. They don't. It only meant running the new code before it was on live.
4. **I called the stored-pool design "recommended" and then replaced it.** The 05oct26 file's Appendices E and F no longer apply.

### Decisions

1. **Narrow IP rule:** an IP links accounts only when a currently locked account lives there (flagged within 30 days). Shared networks aren't pooled.
2. **Compute linked accounts on the fly,** not stored pools. Nothing goes stale, no migration.
3. **Shared quota comes from the `scans` table** (completed scans this calendar month, UTC).
4. **Strong signals:** `device_id` or `device_fp` from **signup** rows. Fingerprints shared by more than 10 accounts are ignored (a guess, tune it from your data).
5. **Fails open:** if the lookup errors, the scan is allowed and the error is logged.
6. **Escape hatch:** `abuse_lock_exempt = true` skips the check for that account.
7. **Enforcement is a strict `POOL_ENFORCE === 'true'`.** Unset means shadow mode.
8. **The per-scan check returns a 429. It doesn't lock the account.** The sweep still does the locking and emailing.
9. **Don't delete flagged accounts.** Deleting a locked account removes the evidence the IP rule needs (and, if `scans.user_id` cascades, the scan history).

### Known limits

- **Worst case is about 6 scans per IP.** Accounts A and B can each use 3 scans before the sweep flags the pair. The third and later accounts are blocked immediately. Pooling every IP-only sibling would close this, but it throttles schools and offices.
- **Links aren't transitive** (A to B by device, B to C by IP). The window is 30 days, and quota resets on the 1st (UTC), so a persistent abuser returns each month.
- **Determined abusers still win.** A VPN or phone hotspot gives a new IP, and a new browser profile changes the fingerprint. The $0 card setup is the next step if this continues.
- **Matching depends on `ip_at_creation`.** Accounts with a null or Cloudflare-edge IP (anything created before the IP fix) can't be matched by IP.
- **Device links apply even with no lock.** Two people sharing one browser profile share a quota.

---

## 7. Open items checklist

### Do next

- [x] Live's `rateLimiter.js` has the **strict** `=== 'true'` line (you restored it)
- [ ] Apply the **RPC stopgap** from Appendix D of the 05oct26 file, so the sweep locks the third and later accounts
- [x] Live runs the new `rateLimiter.js` from Appendix B. `rateLimiter.js.bak` is only an unused backup of the old file and isn't loaded by the app
- [ ] Watch for the first real block:
  ```bash
  sudo -u echobeehive223 pm2 logs mediacrater-api --lines 1000 --nostream 2>&1 | grep "ABUSE-LINK\] blocked"
  ```
- [ ] Don't delete the locked abuser accounts

### Verify

- [ ] Confirm your frontend displays the 429 message ("The free scans for this device or network have been used up…") and not a generic error
- [ ] Confirm `scanVideo.js` and `scanImage.js` load the profile with `select('*')`, since `checkRateLimit` needs `plan`, `scans_remaining`, `abuse_lock_exempt` and `ip_at_creation`
- [x] Duplicate mode line: explained (two separate restarts, one log line each)
- [ ] When the abuser returns, run the step 0 query again and compare `device_id` / `device_fp` across the accounts. If they match, the device link also catches them when the IP changes

### Optional / later

- [ ] Run the step 1 SQL in the **test** Supabase project if you want to test this on the test site
- [ ] Update the 05oct26 index so Appendices E and F match this design (I offered to do it)
- [ ] A small tombstone table, if you ever need to delete flagged accounts without losing the link
- [ ] $0 card setup (Stripe SetupIntent) and a link on `card.fingerprint`, if abuse continues
- [ ] Fix the stale 45-minute comment in `server.js` (the sweep runs every 5 minutes)

### Still open from earlier indexes

- [ ] Items from the 02oct26 VPS index (PM2 root daemon cleanup, tools app bind, Resend key revocation, `apt upgrade` + reboot, `certbot renew --dry-run`, nginx `error_log`)
- [ ] Items from the 05oct26 auth index (production-only secret, `clientIpFrom` swaps, device-field patches, Stripe webhook URL, Supabase anonymous sign-ins)

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Enforce switch | `POOL_ENFORCE=true` in `.env` (read as `process.env.POOL_ENFORCE === 'true'`). Unset = shadow mode |
| Live app / folder | `mediacrater-api` / `/var/www/mediacrater-api` |
| Test app / folder | `mediacrater-api-test` / `/var/www/mediacrater-api-test` (different Supabase project) |
| SQL objects (live database) | `ip_bucket(text)`, `profiles_ip_bucket_idx`, `account_devices_device_fp_idx`, `free_cluster_usage(uuid, timestamptz, int)` |
| Who can call the function | `service_role` only (revoked from `public`, `anon`, `authenticated`) |
| Quota | 3 free scans per month (`PLAN_CONFIG.free.maxScans`), counted per calendar month in UTC |
| IP link window | A locked account's `flagged_at` within 30 days |
| Device link | Same `device_id`, or same `device_fp` shared by 10 or fewer accounts, from **signup** rows |
| IP key | IPv4 as is, IPv6 reduced to `/64`, `::ffff:` mapped addresses unwrapped |
| Skip the check | `abuse_lock_exempt = true`, or any non-free plan |
| Blocked response | HTTP 429, `error: "Scan limit reached"`, message: "The free scans for this device or network have been used up. Upgrade for more scans." |
| Log lines | `[ABUSE-LINK] mode: ENFORCE\|SHADOW`, `[ABUSE-LINK] blocked user:… \| clusterRemaining:… members:… strongLinks:… flaggedIpLinks:…`, `[ABUSE-LINK] SHADOW would block …`, `[CLUSTER] lookup failed …` |
| Sweep | `abuseDetection.js`, every 5 minutes, still locking and emailing |
| Log commands use `console.warn` | They don't flood Slack. Switch to `console.error` if you want alerts |

---

## Appendix A – SQL

Run each statement **by itself**, with **No limit** selected in the Supabase SQL editor (it appends `limit 100` to the last statement, which breaks `update`s).

### Step 0: inspect the abuser's accounts

```sql
select p.id, p.plan, p.account_status, p.flagged_at, p.ip_at_creation,
  (select count(*) from scans s where s.user_id = p.id and s.status = 'completed') as scans_done,
  d.device_id, d.device_fp, d.browser, d.os, d.created_at
from profiles p
left join account_devices d on d.user_id = p.id and d.event = 'signup'
where p.ip_at_creation = 'ABUSER_IP'
order by d.created_at desc;
```

- `ip_at_creation` matching on the old and new accounts means the IP rule works.
- The same `device_id` / `device_fp` across them means the device link works too.
- `ip_at_creation` null, or a Cloudflare IP, means the rule can't see that account.

### Step 1: helper, indexes and the cluster function

Untested when written. Run the dry run below before enabling anything. Assumed columns: `profiles.ip_at_creation`, `plan`, `account_status`, `flagged_at`, `abuse_lock_exempt`, and `scans.user_id`, `tokens_deducted`, `status`, `created_at`.

```sql
create or replace function public.ip_bucket(p text) returns text
language plpgsql immutable as $$
begin
  if p is null then return null; end if;
  if p like '::ffff:%' then p := substring(p from 8); end if;
  if position(':' in p) > 0 then
    return host(network(set_masklen(p::inet, 64)));
  end if;
  return p;
exception when others then
  return null;
end $$;

create index if not exists profiles_ip_bucket_idx
  on public.profiles (public.ip_bucket(ip_at_creation));
create index if not exists account_devices_device_fp_idx
  on public.account_devices (device_fp) where device_fp is not null;

create or replace function public.free_cluster_usage(
  p_user uuid, p_since timestamptz, p_flag_days int default 30
) returns table(used_scans int, member_count int, strong_count int, flagged_count int)
language sql stable security definer set search_path = public as $$
  with me as (
    select public.ip_bucket(ip_at_creation) as ipb from profiles where id = p_user
  ),
  my_dev as (
    select device_id, device_fp from account_devices
    where user_id = p_user and event = 'signup'
  ),
  crowded_fp as (
    select device_fp from account_devices
    where event = 'signup' and device_fp is not null
    group by device_fp having count(distinct user_id) > 10
  ),
  strong as (
    select distinct d.user_id as uid
    from account_devices d
    where d.event = 'signup' and d.user_id <> p_user
      and (
        d.device_id in (select device_id from my_dev)
        or (d.device_fp is not null
            and d.device_fp in (select device_fp from my_dev where device_fp is not null)
            and d.device_fp not in (select device_fp from crowded_fp))
      )
  ),
  flagged_here as (
    select p.id as uid from profiles p, me
    where me.ipb is not null
      and p.id <> p_user
      and p.plan = 'free'
      and p.account_status = 'action_required'
      and p.abuse_lock_exempt is not true
      and p.flagged_at > now() - make_interval(days => p_flag_days)
      and public.ip_bucket(p.ip_at_creation) = me.ipb
  ),
  ip_cluster as (
    select p.id as uid from profiles p, me
    where exists (select 1 from flagged_here)
      and me.ipb is not null
      and p.id <> p_user
      and public.ip_bucket(p.ip_at_creation) = me.ipb
  ),
  members as (
    select p_user as uid
    union
    select l.uid
    from (select uid from strong union select uid from ip_cluster) l
    join profiles p on p.id = l.uid
    where p.plan = 'free'
  )
  select
    coalesce((select sum(s.tokens_deducted) from scans s
              where s.user_id in (select uid from members)
                and s.status = 'completed'
                and s.created_at >= p_since), 0)::int,
    (select count(*) from members)::int,
    (select count(*) from strong)::int,
    (select count(*) from flagged_here)::int;
$$;

revoke execute on function public.free_cluster_usage(uuid, timestamptz, int) from public, anon, authenticated;
grant execute on function public.free_cluster_usage(uuid, timestamptz, int) to service_role;
```

### Dry run

Use any account in the cluster, including a locked one. Expected for your abuser: `used_scans >= 3`, `member_count > 1`, `flagged_count >= 1`. The result you got was 9 / 4 / 1 / 3.

```sql
select * from public.free_cluster_usage(
  '<abuser account uuid>',
  (date_trunc('month', now() at time zone 'utc')) at time zone 'utc',
  30);
```

### Fix a manually locked account

A manual lock leaves `flagged_at` empty, so the IP rule can't see the account. Fill it in for every locked account at the IP:

```sql
update profiles
set flagged_at = now()
where ip_at_creation = 'ABUSER_IP'
  and account_status = 'action_required'
  and flagged_at is null;
```

Then check (`abuse_lock_exempt` should not be `true` on any row):

```sql
select id, account_status, flagged_at, abuse_lock_exempt
from profiles where ip_at_creation = 'ABUSER_IP';
```

### Escape hatch for a wrongly linked real user

```sql
update profiles set abuse_lock_exempt = true where id = '<user uuid>';
```

---

## Appendix B – rateLimiter.js (final)

Full replacement. `withRetry` and `commitScanDeduction` are unchanged from the original. The log lines use `console.warn`, so they don't flood Slack. The mode line near the top is optional but useful, because it shows in the logs after each restart.

```js
// rateLimiter.js - Scan-based rate limiting (subscription model) = SERVER

const PLAN_CONFIG = {
  free:        { maxScans: 3,   period: 'monthly' },
  startup:     { maxScans: 20,  period: 'monthly' },
  established: { maxScans: 100, period: 'monthly' },
  scaler:      { maxScans: 250, period: 'monthly' },
  agency:      { maxScans: 1000, period: 'monthly' }
};

// Unset = shadow mode (logs what would be blocked). 'true' = enforce.
// Keep the strict === 'true' check: any non-empty value would otherwise enforce.
const CLUSTER_ENFORCE = process.env.POOL_ENFORCE === 'true';
console.log(`[ABUSE-LINK] mode: ${CLUSTER_ENFORCE ? 'ENFORCE' : 'SHADOW'}`);

// ── Retry wrapper ─────────────────────────────────────────────
async function withRetry(fn, retries = 3, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      const isNetworkError =
        error.message?.includes('502') ||
        error.message?.includes('503') ||
        error.message?.includes('fetch failed') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('ETIMEDOUT');

      if (isNetworkError && i < retries - 1) {
        console.warn(`Attempt ${i + 1} failed, retrying in ${delayMs * (i + 1)}ms...`, error.message);
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        continue;
      }
      throw error;
    }
  }
}

// ── Free-account cluster quota ────────────────────────────────
function monthStartUtc() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString();
}

// Returns { remaining, members, strong, flagged } or null (lookup failed or exempt -> fails open).
async function getFreeClusterRemaining(userId, profile, supabase, quota) {
  if (profile.abuse_lock_exempt === true) return null;
  try {
    const { data, error } = await supabase.rpc('free_cluster_usage', {
      p_user: userId,
      p_since: monthStartUtc(),
      p_flag_days: 30
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      remaining: Math.max(0, quota - row.used_scans),
      members: row.member_count,
      strong: row.strong_count,
      flagged: row.flagged_count
    };
  } catch (err) {
    console.error('[CLUSTER] lookup failed, using per-account limit only:', err.message);
    return null;
  }
}

// ── checkRateLimit ────────────────────────────────────────────
// READ-ONLY. Verifies the user has enough scans remaining, but does
// NOT deduct anything. Deduction only happens via commitScanDeduction,
// called after a scan has actually succeeded — this prevents charging
// users for scans that failed, got stuck in queue, or errored out
// before ever reaching the AI provider.
// Free accounts also share a quota with linked accounts (same device, or
// same IP as a currently locked account) — see free_cluster_usage().
async function checkRateLimit(userId, profile, supabase, scanCost = 1) {
  const plan = profile.plan || 'free';
  const config = PLAN_CONFIG[plan] || PLAN_CONFIG.free;
  const isPaid = plan !== 'free';

  const accountRemaining = profile.scans_remaining ?? config.maxScans;
  let effectiveRemaining = accountRemaining;
  let clusterLimited = false;

  if (!isPaid) {
    const cluster = await getFreeClusterRemaining(userId, profile, supabase, config.maxScans);
    if (cluster && cluster.members > 1 && cluster.remaining < effectiveRemaining) {
      if (cluster.remaining < scanCost) {
        console.warn(
          `[ABUSE-LINK] ${CLUSTER_ENFORCE ? 'blocked' : 'SHADOW would block'} user:${userId}`,
          `| clusterRemaining:${cluster.remaining} members:${cluster.members}`,
          `strongLinks:${cluster.strong} flaggedIpLinks:${cluster.flagged}`
        );
      }
      if (CLUSTER_ENFORCE) {
        effectiveRemaining = cluster.remaining;
        clusterLimited = true;
      }
    }
  }

  if (effectiveRemaining < scanCost) {
    return {
      allowed: false,
      isPaid,
      plan,
      error: 'Scan limit reached',
      message: clusterLimited
        ? 'The free scans for this device or network have been used up. Upgrade for more scans.'
        : scanCost === 2
          ? `Deep scan requires 2 scans. You have ${effectiveRemaining} scan${effectiveRemaining === 1 ? '' : 's'} remaining. Switch to regular scan or upgrade your plan.`
          : plan === 'free'
            ? `Free plan limit: ${config.maxScans} scans per month. Upgrade for more scans.`
            : `Monthly scan limit of ${config.maxScans} reached. Resets on your next billing date.`,
      remaining: accountRemaining,
      maxScans: config.maxScans
    };
  }

  return {
    allowed: true,
    isPaid,
    plan,
    remaining: accountRemaining, // NOT yet deducted — this is the pre-scan balance
    maxScans: config.maxScans
  };
}

// ── commitScanDeduction ────────────────────────────────────────
// Actually deducts the scan cost. Call this ONLY after a scan has
// successfully completed (AI response received and parsed). Returns
// the new remaining count so the caller can report it back to the client.
async function commitScanDeduction(userId, currentRemaining, scanCost, supabase) {
  const newRemaining = Math.max(0, currentRemaining - scanCost);

  try {
    const { error } = await withRetry(() =>
      supabase
        .from('profiles')
        .update({ scans_remaining: newRemaining })
        .eq('id', userId)
    );

    if (error) {
      console.error('Scan deduction error:', error);
      // The scan already succeeded at this point — we don't want to
      // fail the response over a deduction write error. Log it for
      // manual reconciliation instead.
      return { success: false, remaining: currentRemaining };
    }
  } catch (error) {
    console.error('Scan deduction failed after retries:', error);
    return { success: false, remaining: currentRemaining };
  }

  return { success: true, remaining: newRemaining };
}

// ── getScanStatus ─────────────────────────────────────────────
async function getRateLimitStatus(userId, profile, supabase) {
  const plan = profile.plan || 'free';
  const isPaid = plan !== 'free';
  let remaining = Math.max(0, profile.scans_remaining ?? 0);
  const maxScans = profile.scans_per_month ?? PLAN_CONFIG[plan]?.maxScans ?? 3;

  if (!isPaid && CLUSTER_ENFORCE) {
    const cluster = await getFreeClusterRemaining(userId, profile, supabase, maxScans);
    if (cluster && cluster.members > 1) remaining = Math.min(remaining, cluster.remaining);
  }

  return { isPaid, plan, remaining, maxScans };
}

module.exports = { checkRateLimit, commitScanDeduction, getRateLimitStatus, PLAN_CONFIG };
```

**How the check behaves**

- Paid plans skip the cluster check entirely.
- `cluster.members > 1` means an account with no links is never affected.
- The account's own `scans_remaining` still applies. The cluster limit only ever lowers the effective remaining.
- The scan response still reports the account-level balance. Only `getRateLimitStatus` is cluster-aware.
- A lookup error logs `[CLUSTER] lookup failed` and allows the scan.

---

## Appendix C – Verification and troubleshooting commands

Replace `<app-name>` with the real PM2 name (`mediacrater-api` for live, `mediacrater-api-test` for test) and leave out the angle brackets.

### Check which mode is running

```bash
grep -n "POOL_ENFORCE" /var/www/mediacrater-api/rateLimiter.js
grep -c '^POOL_ENFORCE=true' /var/www/mediacrater-api/.env

sudo -u echobeehive223 pm2 restart mediacrater-api --update-env
sleep 3
sudo -u echobeehive223 pm2 logs mediacrater-api --lines 50 --nostream 2>&1 | grep ABUSE-LINK
```

You want `[ABUSE-LINK] mode: ENFORCE`. If it says `SHADOW`, `POOL_ENFORCE=true` isn't reaching the process: check `.env` for quotes or trailing spaces. Restarts kill scans in progress, so pick a quiet moment.

### Watch for real blocks

```bash
sudo -u echobeehive223 pm2 logs mediacrater-api --lines 1000 --nostream 2>&1 | grep "ABUSE-LINK\] blocked"
```

No output means no linked account has tried to scan yet. `grep` exits 1 on no match, so a red x on its own isn't an error.

### Direct check of `checkRateLimit` (run from the **live** folder)

This reads the database and writes nothing. The line `profile.scans_remaining = 3` is in memory only. It pretends the account is brand new, so the group logic is tested and not the account-level quota. `POOL_ENFORCE=true` on the command line applies to this run only.

```bash
cd /var/www/mediacrater-api
POOL_ENFORCE=true node -e "
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit } = require('./rateLimiter');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const id = '<abuser account uuid>';
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', id).single();
  profile.scans_remaining = 3;   // in memory only
  const r = await checkRateLimit(id, profile, supabase, 1);
  console.log(JSON.stringify({ allowed: r.allowed, message: r.message }));
  process.exit();
})();
"
```

### What the output means

| Output | Meaning |
|---|---|
| `"allowed":false` with the "free scans for this device or network" message, plus `[ABUSE-LINK] blocked … members:4` | Working |
| `"allowed":true` plus `SHADOW would block` | The enforce switch isn't on. Check how `POOL_ENFORCE=true` was typed or set |
| `"allowed":false` with the generic "Free plan limit: 3 scans per month" message | The account's `plan` isn't `free`, or the cluster lookup failed. Look for a `[CLUSTER] lookup failed` line above it |
| A crash about a missing profile | The ID isn't in this database (test and live are separate projects) |
| No `ABUSE-LINK` lines at all | Nobody linked has scanned yet, or the abuser's accounts aren't matching. Run the step 0 query and the dry run |

### Optional A/B test (two throwaway accounts on a site with the SQL installed)

A plays the old account, B the new one.

1. Create two free accounts and confirm both emails. Find their IDs with `select id, email, created_at from profiles order by created_at desc limit 5;`.
2. Log in as A and run 3 scans.
3. Lock A: `update profiles set account_status = 'action_required', flagged_at = now() where id = '<A>';`
4. Give B A's IP: `update profiles set ip_at_creation = (select ip_at_creation from profiles where id = '<A>') where id = '<B>';`
5. Scan as B. Expect a 429 with the shared-quota message and a `[ABUSE-LINK] blocked user:<B> …` line.
6. Undo: set A back to `active`, and delete both throwaway users in Supabase → Authentication → Users.

The sweep (every 5 minutes) may change the accounts' lock state while you do this, which is why we used the direct check instead.

### Test app note

The test app uses a different database. Until the step 1 SQL exists in the test project, the test app logs `[CLUSTER] lookup failed` and allows scans. That's harmless and fails open.

---

## Appendix D – Rollback and maintenance

### Roll back `rateLimiter.js`

```bash
cd /var/www/mediacrater-api
cp rateLimiter.js.bak rateLimiter.js
sudo -u echobeehive223 pm2 restart mediacrater-api --update-env
```

### Switch to shadow mode without rolling back

Remove the `POOL_ENFORCE` line from live's `.env` (or set it to anything other than `true`), then restart with `--update-env`. This only works with the strict `=== 'true'` check. With the truthy version, `POOL_ENFORCE=false` would still enforce, so delete the line instead. The logs then say `SHADOW would block` and the scan goes through.

### Remove the SQL (only if you abandon the check)

The app falls back to the per-account limit if the function is missing, because it fails open. To remove it:

```sql
drop function if exists public.free_cluster_usage(uuid, timestamptz, int);
drop function if exists public.ip_bucket(text);
drop index if exists public.profiles_ip_bucket_idx;
drop index if exists public.account_devices_device_fp_idx;
```

### Un-link a wrongly blocked real user

```sql
update profiles set abuse_lock_exempt = true where id = '<user uuid>';
```

If the same shared IP keeps catching real users, tell me. The fix is to require a strong link before the IP rule applies.

### Routine

- Don't delete locked abuser accounts. The IP rule needs a locked account at that IP.
- Keep the sweep running (and apply the RPC stopgap from the 05oct26 file, Appendix D).
- When the abuser returns, check for `[ABUSE-LINK] blocked` lines, then compare their accounts' `device_id` / `device_fp` with the step 0 query.

---

*End of index.  
Conversation: https://claude.ai/chat/344c1200-b593-4d05-bab9-cd0f70039e9c*
