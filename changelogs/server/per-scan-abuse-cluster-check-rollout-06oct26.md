# Per-Scan Free-Tier Abuse Check: Linked-Account Shared Quota, Verified-Only Sweep, Live Rollout & Verification

| | |
|---|---|
| **Date** | 6 October 2026 (`06oct26`) |
| **Conversation** | https://claude.ai/chat/344c1200-b593-4d05-bab9-cd0f70039e9c |
| **Related prior work** | `vps-hardening-cloudflare-lockdown-ssrf-fix-02oct26.md` (2 Oct 2026)<br>`auth-hardening-turnstile-supabase-origin-secret-05oct26.md` (5 Oct 2026) |
| **Stack** | Node API on the VPS (`rateLimiter.js`, `abuseDetection.js`, PM2), Supabase Postgres (**separate databases for test and live**) |
| **Starting trigger** | One IP address creating a new free account each time the old one was locked, then immediately running 3 scans on the new account. Later, the same investigation showed the old sweep was also locking real people who had mistyped their email |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included. `ABUSER_IP`, `<abuser account uuid>` and similar placeholders stand in for them. Real accounts are described by what happened, not by ID.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied. ⏳ = open.

> **This file replaces two parts of the 05oct26 index.** Appendices E and F of that file describe a stored-pool design (`scan_pools`, `profiles.pool_id`, `assign_pool`) that we did **not** use, and its RPC stopgap (Appendix D) is superseded by the verified-only version in [Appendix C](#appendix-c--verified-only-sweep) below. If you haven't run that pool SQL, skip it.

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
9. [Appendix A – SQL: cluster check](#appendix-a--sql-cluster-check)
10. [Appendix B – rateLimiter.js (final)](#appendix-b--ratelimiterjs-final)
11. [Appendix C – Verified-only sweep](#appendix-c--verified-only-sweep)
12. [Appendix D – Scoring accounts from account_devices](#appendix-d--scoring-accounts-from-account_devices)
13. [Appendix E – Verification and troubleshooting commands](#appendix-e--verification-and-troubleshooting-commands)
14. [Appendix F – Rollback and maintenance](#appendix-f--rollback-and-maintenance)

---

## 1. Summary

The abuser's pattern was: scan on the old account, get blocked (`Blocked scan attempt by flagged account`), create a new account, and immediately run 3 scans. The timed sweep couldn't stop that, because a new account stays `active` until the next run. We moved the check into the scan path. While validating it on live data, we found the sweep was also locking real users, so we made it verified-only.

**Main outcomes**

- Every free-plan scan now checks whether the account is **linked** to other free accounts and, if so, whether the **group's shared quota** for the month is used up. If it is, the scan gets a **429** before anything runs.
- An account is linked to another in two ways:
  1. **Strong link:** the same `device_id`, or the same `device_fp` (fingerprints shared by more than 10 accounts are ignored).
  2. **IP link:** the same IP at creation (IPv6 `/64`) **and the same OS**, but only when another account at that IP is a **source**: it has **used up its monthly quota**, or it is **currently locked** (flagged within 30 days). Shared networks are not pooled unless a source exists.
- Quota is counted from the `scans` table, so there is no counter to reset, no stored pool to go stale, and no migration.
- **The sweep is now verified-only.** It no longer counts or locks accounts whose email isn't confirmed. All three false locks we found (typo re-signups and a duplicate signup) had an unverified account in the pair.
- The SQL function and the new `rateLimiter.js` are **live and enforcing**. A direct check on one of the abuser's accounts returned `allowed: false` with the shared-quota message, and a two-account test through the site hit the same message.
- The abuser's four accounts used **9 scans** across them before this.
- We scored every pair of recent signups from `account_devices` (read-only). The score finds the abuser, but it can't tell a typo re-signup from abuse, so it is **not** used to lock anyone.
- **The sweep stays on and still locks** (verified accounts only). Making it alert-only is deferred, because a spread-out abuser (2 scans per account on many accounts) would otherwise never be linked.

**Not yet seen:** a real `[ABUSE-LINK] blocked` log line from live traffic. That only appears when an active free account linked to a source tries to scan, and the abuser hasn't been back since the switch.

---

## 2. Status at a glance

### Per-scan check

| Area | Status | Notes |
|---|---|---|
| SQL in the **live** database (`ip_bucket`, indexes, `free_cluster_usage` v2) | ✅ Done | v2 replaced v1. Dry run on an abuser account: `used_scans` 9, `member_count` 4, `strong_count` 1, `flagged_count` 3. A normal account returned 1 member |
| SQL in the **test** database | ⏳ Not applied | Test uses a separate Supabase project. The test app logs `[CLUSTER] lookup failed` and allows scans |
| New `rateLimiter.js` on live (strict `=== 'true'`, passes `p_quota`) | ✅ Done | Live runs the Appendix B version. `rateLimiter.js.bak` is only an unused backup |
| `POOL_ENFORCE=true` in live `.env`, PM2 restarted | ✅ Done | Logs show `[ABUSE-LINK] mode: ENFORCE` (once per restart) |
| Direct check of `checkRateLimit` on an abuser account | ✅ Verified | Re-run after v2: `blocked … clusterRemaining:0 members:4 strongLinks:1 flaggedIpLinks:3`, `allowed: false` |
| Two-account test through the site (same browser) | ✅ Verified | The second account was blocked on its first scan. You didn't say which site you used, and the log line wasn't checked |
| Frontend shows the 429 message | ✅ Verified | The UI showed the shared-quota text under an "Analysis failed" heading |
| A real blocked scan from live traffic | ⏳ Waiting | No `[ABUSE-LINK] blocked` line from real traffic yet |
| OS-mismatch rule | ⏳ Not tested | Every test came from one machine, so the OS always matched |
| `scanVideo.js` / `scanImage.js` load the full profile row | ⏳ Unverified | I only saw the two URL handlers |

### Sweep and cleanup

| Area | Status | Notes |
|---|---|---|
| `verified_user_ids(uuid[])` function | ✅ Done | Created in live, returned success |
| `detect_duplicate_free_ips()` (verified-only) | ✅ Done | Returns **no rows**, which is correct: all four abuser accounts are locked, and the function only returns an IP when a verified account there is still `active` |
| `abuseDetection.js` verified-only edit | ✅ Done | Your pasted `lockAndNotifyCluster` matched the intended code. App restarted |
| Verified-only behaviour tests | ✅ Verified | Your three findings: a new verified account at a flagged IP is locked, an unverified one is not, and a lone verified account with an unverified sibling is untouched |
| Typo and duplicate accounts | ✅ Cleaned up | Unverified accounts deleted, verified ones unlocked |
| Abuser's 4 accounts | ✅ Locked | All four locked with `flagged_at` set |
| Your three test accounts deleted | ⏳ Open | Locked ones keep your own IP flagged for 30 days |
| `resolveClearedClusters` counting unverified peers | ⏳ Open | Minor |
| Alert-only sweep | ⏳ Deferred | See Phase 14 |
| Score-based Slack alerts | ⏳ Later | Read-only analysis only so far |

### Analysis

| Area | Status | Notes |
|---|---|---|
| `ip_prefix` helper | ✅ Created | In the test and live databases |
| Scoring queries on test and live | ✅ Run (read-only) | Live: 47 signups in 30 days, 14 pairs flagged |
| Thresholds for any score-based action | ⏳ Not set | Needs more live data |

---

## 3. Starting point

- The free plan has 3 scans per month. Scan handlers call `checkRateLimit` (read-only), then `commitScanDeduction` after a successful scan.
- `abuseDetection.js` sweeps every **5 minutes**: it calls the `detect_duplicate_free_ips` RPC, locks accounts (`account_status = 'action_required'`, `flagged_at` set), emails them, and a second sweep unlocks accounts when no free peers remain.
- The scan handlers return **403 `ACCOUNT_FLAGGED`** for locked accounts **before** they call `checkRateLimit`. A locked account never reaches the new code.
- `account_devices` (signup and login events with `device_id`, `device_fp`, IP, ASN, city, timezone, OS, browser, VPN and hosting flags) already exists and is written by the website's signup route.
- **Email confirmation is on** (the 05oct26 bypass test returned a user but no session), so an unverified account can't sign in or scan.
- A new account is `active` until the next sweep, so the abuser got up to 3 fresh scans per account.
- **The original RPC counted unverified accounts and only active ones**, which caused two problems: typo re-signups were locked, and a third account at an already-locked IP was missed.
- **Test and live use separate Supabase databases.** The abuser's data exists only in live.

---

## 4. Timeline: what we did, in order

### Phase 1 – The trigger

You saw one IP repeating the same pattern and asked for the per-scan check to be implemented now. The earlier plan (from the 05oct26 file) was a stored-pool design and a week of shadow mode. Because the abuse was active, we simplified.

### Phase 2 – Design: a narrow IP rule plus device links, checked on every scan

*This is the first version of the function (v1). Phase 14 replaces its IP-link source rule.*

**The rule:** a free account is linked to another when they share a strong signal, or when they share an IP **and** a locked account already lives there. Everyone linked shares one monthly quota counted from `scans`. For your abuser, the new account starts at 3 minus whatever the locked accounts already used (at least 3), so its first scan is blocked.

**What the SQL does** (`free_cluster_usage`, read-only):

| Step | What it finds |
|---|---|
| `strong` | Other accounts whose **signup** row shares this account's `device_id` or `device_fp`. Fingerprints shared by more than 10 accounts are ignored |
| `flagged_here` (v1) | Other free accounts at the same IP bucket that are currently locked, flagged within 30 days, and not `abuse_lock_exempt` |
| `ip_cluster` | Every account at that IP bucket, **only if a source exists** |
| `members` | This account, plus `strong` and `ip_cluster`, limited to free plans |

It returns `used_scans` (completed scans this month summed across all members), `member_count`, `strong_count` and `flagged_count`. The helper `ip_bucket` turns an IP into a comparison key (IPv4 as is, `::ffff:` mapped addresses unwrapped, IPv6 reduced to its `/64`). The function is `security definer`, so it is revoked from `anon` and `authenticated` and granted only to `service_role`.

**Worked example (your abuser):**

1. Old account A is locked and used its 3 scans.
2. New account B has the same IP, so A is a source, and A and B become members.
3. `used_scans` is 3, so B's remaining quota is 3 minus 3, which is 0.
4. B's first scan returns 429.

**The plan I gave:** step 0 (inspect the abuser's rows), step 1 (SQL and a dry run, [Appendix A](#appendix-a--sql-cluster-check)), step 2 (replace `rateLimiter.js`, [Appendix B](#appendix-b--ratelimiterjs-final)), step 3 (deploy, test, watch the logs).

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

I added the IP rule because your abuser is on one IP and creates fresh accounts. If they clear cookies, strong signals alone would miss them. I reversed "stop IP locks" because the IP rule needed a locked account at that IP. I should have flagged that conflict at the time.

**"So this doesn't actually lock anyone out?"** It blocks **scanning**, not the account:

| | Account lock (the sweep) | Per-scan check |
|---|---|---|
| What it does | Sets `action_required` and emails the user | Returns a 429 when the group's shared quota is used up |
| When | Up to 5 minutes after the accounts exist | On every scan, immediately |
| Marks the account? | Yes | No |
| Log line | `Blocked scan attempt by flagged account` | `[ABUSE-LINK] blocked ...` |

Conditions for it to block: `POOL_ENFORCE=true` and a PM2 restart with `--update-env`, the new account's `ip_at_creation` matching the old account's, a source at that IP, and the new account on the free plan. The new account can still log in. It just can't scan.

### Phase 4 – The enforce switch

- You thought the file already set enforcement to true. The shipped line is `const CLUSTER_ENFORCE = process.env.POOL_ENFORCE === 'true';`. It reads the environment variable, and when it's unset the code falls back to shadow mode (logs `SHADOW would block`, lets the scan through).
- You changed the line to `const CLUSTER_ENFORCE = process.env.POOL_ENFORCE;` and set the variable. **Footgun:** any non-empty value is truthy, so `POOL_ENFORCE=false` or `=0` would also enforce. I advised restoring the strict `=== 'true'` check.
- **Update:** you restored the strict check, and live runs the `rateLimiter.js` printed in [Appendix B](#appendix-b--ratelimiterjs-final).

### Phase 5 – Preparing the abuser's accounts

- Step 0's query returned **4 accounts** at the abuser's IP. One was not locked, so you locked it by hand.
- **Problem:** a manual lock leaves `flagged_at` empty, and the v1 rule only counted locked accounts flagged within the last 30 days. That account would be invisible to it.
- **Fix attempt:** `update profiles set flagged_at = now() where id = '…' and flagged_at is null` failed with `42601: syntax error at or near "update"`. The Supabase SQL editor appends `limit 100` to the last statement, which breaks an `update`.
- **Fix:** choose **No limit** in the dropdown next to Run, run the update by itself, and match by IP so no UUID is needed ([Appendix A](#appendix-a--sql-cluster-check)).
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

**The empty `grep ABUSE-LINK`:** `grep` exits with code 1 when nothing matches, which the terminal shows as a red x. Nothing had triggered the line yet, because locked accounts get a 403 before `checkRateLimit` runs. You were also reading the **test** app's logs while the abuser is on **live**. Don't type `<app-name>` literally; the shell reads `<` as a redirect.

### Phase 7 – Testing options, and the two-databases discovery

**A/B test (not used in the end).** Two throwaway accounts recreate the abuser: A uses its 3 scans and gets locked, B is the new account. B's first scan should return 429. You found it hard to run because the sweep is fast. The steps are in [Appendix E](#appendix-e--verification-and-troubleshooting-commands).

**Direct function check (used instead).** A one-off `node -e` script calls `checkRateLimit` on an abuser account. It reads the database and writes nothing. The line `profile.scans_remaining = 3` changes a value in memory only, to pretend the account is brand new, so the group logic is exercised and not the account-level quota.

**"Why would the abuser be using my test environment?"** They aren't. You run the script on your own server. The abuser's ID is used only because their four accounts are the ready-made linked-and-locked case in the database.

**The catch:** the script only works against a database that contains that ID. Checking `SUPABASE_URL` showed **test and live are different Supabase projects**. So the abuser's data, the locks and the SQL function exist only in live. The script has to run from the live folder, and the test app can't exercise this logic until the SQL is also run in the test project.

### Phase 8 – Rollout to live

1. **Back up** live's `rateLimiter.js` (it was the only copy of the old code).
2. **Check** the file being copied has the strict enforce line, and optionally add a mode log line.
3. **Copy** test's `rateLimiter.js` to live.
4. **Run the direct check** from live's folder with `POOL_ENFORCE=true` on the command line (for that run only).

**Output:**

```
[ABUSE-LINK] mode: ENFORCE
[ABUSE-LINK] blocked user:<abuser account uuid> | clusterRemaining:0 members:4 strongLinks:1 flaggedIpLinks:3
{"allowed":false,"message":"The free scans for this device or network have been used up. Upgrade for more scans."}
```

5. **Turned it on for real:** `POOL_ENFORCE=true` in live's `.env` and a PM2 restart with `--update-env`. The logs then showed `[ABUSE-LINK] mode: ENFORCE`. It printed twice because the restart commands were run separately, so there were two restarts.

**Result:** live is enforcing. The next new free account on the abuser's IP should be blocked on its first scan.

### Phase 9 – First end-to-end test through the site

- You created an account in test mode, ran 3 scans, created a second account and tried to scan. The UI showed **"Analysis failed"** and, under it, **"The free scans for this device or network have been used up. Upgrade for more scans."**
- **That is the expected result.** That exact message only comes from the shared-quota check, so the SQL function ran and your frontend displays the 429 text.
- **Why it blocked:** both accounts came from the same browser, so they share a `device_id` (a strong link) and the same IP. No locked account is needed for a device link. The first account used all 3 scans, so the group's remaining quota was 0, even though the second account's own balance was still 3.
- **Not checked:** which log line fired. I expected `strongLinks:1 flaggedIpLinks:0`.
- **Side effects to watch:** the "Analysis failed" heading above a quota message can read as a bug, and the sweep may lock throwaway accounts that share your IP, which flags your IP for 30 days.

### Phase 10 – What to do with the 5-minute sweep

You asked whether to keep the sweep, point it at `account_devices`, and add smarter pattern detection (OS, IP, ASN, ASN org, city, timezone, browser, browser version).

**Position: keep the sweep, but change what it detects with.** The per-scan check is now the main defence. The sweep still does three things it can't: it creates the locks, it locks and emails at the account level, and it unlocks accounts when their peers disappear. Keep the 5-minute interval, since it's cheap if it only processes recent signups.

**How I'd use each signal:**

| Signal | Role | Why |
|---|---|---|
| IP, or same /24 (IPv4) or /64 (IPv6) | Main signal | Most discriminating. Ignore it when either row is VPN or hosting, since thousands share those IPs |
| Signup timing and sequence | Main signal (not on your list) | A new account created shortly after a sibling was locked or used up is your abuser's exact pattern |
| OS | Consistency check | Survives browser switches. A match is weak alone, because most users share an OS. A mismatch lowers the score |
| ASN, org, city, timezone | Corroboration only | They aren't independent of each other or of the IP |
| Browser, version | Bonus only | They change when the abuser switches browsers, so a mismatch never lowers the score |

**The main flaw in scoring:** a classroom signing up from one IP looks identical to your abuser on signup attributes. Scores can't separate them, but behaviour and cluster size can. So:

- **Auto-lock only** on a strong link, or on an IP or prefix match plus an OS match plus sequence evidence.
- **A cluster of more than about 5 accounts** at one IP or prefix in a day is a shared network: alert only.
- **Weak signals alone** (OS, ASN, city, timezone, browser, with no IP link): a Slack alert at most.
- **Widening the per-scan IP rule to the same /24** only when OS and ASN also match and the IP isn't VPN or hosting would cover the "last digits changed" pattern. This was a suggestion, held off in Phase 11.

**Caveats:** `account_devices` rows exist only for accounts created since logging started. Old rows have client-supplied browser and OS values from before the header patch. The signin route doesn't record login events, which would show one device signing into many accounts. My weights are guesses, and a few known abuser accounts are too few to tune on. Store the score and matched signals whenever you lock an account, so you can explain a lock to a disputing user.

### Phase 11 – Scoring accounts from account_devices (read-only)

Nothing here changes data. The queries are in [Appendix D](#appendix-d--scoring-accounts-from-account_devices).

**Weights used** (all guesses):

| Signal | Points |
|---|---|
| Same exact IP | +30 (same /24 instead: +15). Skipped if either row is VPN or hosting |
| OS | +10 if equal, **−15 if different**, 0 if either is unknown |
| ASN | +5 (skipped for VPN or hosting) |
| City | +5 |
| Timezone | +5 |
| Browser and version both equal | +10 |
| Signup within 1 hour | +20 (within 24 hours: +10) |
| **Maximum** | **85** |

A **strong link** (same `device_id` or `device_fp`) is reported separately from the score.

**Test database (all five accounts were yours):** ten pairs, all scoring 40 or more. Two groups were strong-linked at 85. Six pairs **between** the groups scored 75 with no device link, which is the "same person, new device ID" case. This showed the scoring can link accounts when the device ID changes, but it says nothing about false positives, because every signal matches on one machine.

**Live database:** 47 signups in the last 30 days, so about 1,080 possible pairs, and **14 flagged** (6 strong-link pairs, 8 without a device link). The band query failed with `relation "scored" does not exist`, because `scored` is a CTE that only exists inside the statement that defines it. It wasn't needed with only 14 rows.

**What the live data showed:**

- **Your abuser's cluster:** four accounts, all six pairs present, all locked, sharing one exact IP. They form **two device groups joined only by the IP**, which is why the IP rule matters: clearing storage split their device link but not their IP.
- **Your own three test accounts:** two were locked and one was still active at the same IP (see Phase 13). The old RPC missed the third because it counted only active accounts.
- **A same-/24, different-exact-IP pair with a device link, both active:** scans of 1 and 2, which is exactly one 3-scan quota across two accounts. The per-scan check now pools them through the device link. The old sweep groups by exact IP, so it would have missed them.
- **One pair scoring 40 with no location overlap:** same OS, same browser and version, signed up within an hour, but a different IP, ASN, city and timezone. Probably two different people. Non-strong pairs should require an IP overlap.
- **Three locked pairs at 85:** these turned out to be typo and duplicate signups, not abuse (Phase 12).
- **ASN, city and timezone were redundant:** 5/5/5 when the IP matched, 0/0/0 when it didn't.
- **OS distribution** (30-day signups): Windows 23, macOS 13, Android 8, Linux 3 (the Linux ones are your tests). A random pair matches on OS about 40% of the time, so a match is weak. A **mismatch** is the strong signal.

**Adjustments suggested:**

1. A non-strong pair needs an IP overlap before it counts.
2. Hold off widening the per-scan rule to /24, because the one same-/24 pair already has a device link.
3. **Never lock from the score.** A household and your abuser look alike on signup attributes.

### Phase 12 – The cases behind the false locks, and the verified-only rule

You explained the three locked pairs scoring 85:

| Pair | What happened | Verified account | Scans |
|---|---|---|---|
| 1 | One person mistyped their email once (`.copm`), then signed up again with the same address ending `.com`. They locked themselves out. You contacted them and were going to unlock them | The corrected one | 2 (the typo account: 0) |
| 2 | Two emails one letter apart. The one with the missing letter never verified | The other one | 1 (the unverified one: 0) |
| 3 | Same email with one character changed and a different domain. The first account was verified, with no scans. About 30 minutes later a second account was created and never verified | The first one | 0 and 0 |

**Your note, which is now a rule: do not lock accounts that have not been email verified.**

Why it matters more than a note:

- With email confirmation on, an unverified account can't sign in or scan, so locking it protects nothing. It only catches typos.
- A lock flags the IP for the per-scan IP rule for 30 days.
- The score can't tell a typo re-signup from abuse. Both land at 85.
- **Unlocking alone doesn't stick.** The sweep re-locks any two accounts sharing an IP within 5 minutes, so delete the unverified duplicate first, or ship the fix first.

### Phase 13 – Cleanup and the verified-only sweep

**Cleanup you did:**

1. Checked verification and scan counts for the named accounts.
2. **Deleted the unverified accounts** in Authentication → Users (the `.copm` one, the missing-letter one, and the unverified one in pair 3).
3. **Unlocked the verified ones.** The verified accounts in pairs 1 and 2 have 2 and 1 scans.
4. Your three Linux test accounts: two were locked (flagged at signup, before today's changes) and the third was created last night, before the changes, and wasn't locked. **Deleting them is still open.**

**Code changes** ([Appendix C](#appendix-c--verified-only-sweep)):

1. `verified_user_ids(uuid[])` returns which of a list of users have a confirmed email. Created in live, returned success.
2. A new `detect_duplicate_free_ips()` that counts only verified accounts, and still flags an IP only when at least one of them is `active`. This also fixes the third-account bug. Returned success.
3. `lockAndNotifyCluster` in `abuseDetection.js` filters the IP's accounts through `verified_user_ids`, skips the cluster if fewer than 2 are verified, and locks only verified `active` accounts. If the lookup fails, it skips the cluster, which fails safe.

I reviewed your pasted `lockAndNotifyCluster`. It matched the intended code. One loose end: `resolveClearedClusters` still counts unverified accounts as peers when deciding whether to unlock someone.

### Phase 14 – Reworking the cluster function (v2)

**Why not alert-only yet.** I planned to make the sweep alert-only, with a new rule that an account becomes an IP source when it **has used up its quota**. But an abuser who spreads 2 scans each across many accounts on one IP never exhausts any account, so nothing would link them. The sweep's locks (verified-only now) are what link those accounts. So **auto-locking stays on**, and alert-only is revisited after a few weeks of live data.

**What changed in `free_cluster_usage` (v2):**

| Change | Effect |
|---|---|
| **Sources** are accounts at the same IP that have **used up their monthly quota**, or are **currently locked** (flagged within 30 days, not exempt) | A source no longer needs a sweep lock, which closes the 5-minute gap for any account that has used its quota |
| **IP links require the same OS** (`p_require_os`, default `true`; unknown OS passes) | Fewer false positives on shared networks |
| New arguments `p_quota` (default 3) and `p_require_os` | `rateLimiter.js` passes `p_quota` from `PLAN_CONFIG` |

**Unverified accounts** can still be members of an IP cluster, but they never have scans and never become sources, so they add nothing to the group's usage.

The old function was dropped and the new one created in a single transaction, so there is no gap. The SQL is in [Appendix A](#appendix-a--sql-cluster-check), and the old (v1) version is in [Appendix F](#appendix-f--rollback-and-maintenance) for rollback.

**Your results:** the abuser's account returned the same `9 / 4 / 1 / 3` as before. A normal account returned 1 scan and 1 member. You changed the `rpc` call in `rateLimiter.js` to pass `p_quota: quota`, then restarted live.

### Phase 15 – Verification after v2

- **Restart logs:** `[ABUSE-LINK] mode: ENFORCE` appeared several times, once per restart (`--lines 50` includes older restarts).
- **I warned the app call wasn't verified yet.** The app talks to the database through Supabase's API layer. If that layer had cached the old function, the call would fail open with a single `[CLUSTER] lookup failed` line. The fix would have been `notify pgrst, 'reload schema';`.
- **Direct check, run from the live folder:** `[ABUSE-LINK] blocked … clusterRemaining:0 members:4 strongLinks:1 flaggedIpLinks:3` and `{"allowed":false,"message":"The free scans for this device or network have been used up. Upgrade for more scans."}`, with no lookup error. The app-to-database path works.
- **`select * from public.detect_duplicate_free_ips();`** returned no rows. I had expected the abuser's IP. That was my mistake: the function only returns an IP when a verified account there is still `active`, and all four abuser accounts are locked.
- **Your three findings:**
  1. With previously flagged accounts, a new **verified** account gets locked.
  2. An **unverified** account is not locked.
  3. A verified account with no linked IP or other value is **not** blocked, even when another email failed verification.

**What these tests don't cover:** an OS mismatch (every test came from one machine), the abuser returning, and `resolveClearedClusters`. To test the OS rule, sign up from a phone on the same Wi-Fi and verify the account. Then dry-run `free_cluster_usage` on it. You'd expect `member_count` of 1, but 2 or more with `p_require_os` set to `false`.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | The abuser's new accounts scanned immediately | A new account stays `active` until the next 5-minute sweep | Per-scan check in `checkRateLimit` |
| 2 | One of the abuser's four accounts was not locked | The third-and-later-account gap in the old RPC | Locked by hand, then fixed by the verified-only RPC |
| 3 | Manually locked account invisible to the v1 IP rule | A manual lock leaves `flagged_at` empty | `update … set flagged_at = now()` for that IP |
| 4 | `ERROR 42601: syntax error at or near "update"` | The Supabase SQL editor appends `limit 100` to the last statement | Select **No limit** and run the update by itself |
| 5 | Enforcement line edited to `process.env.POOL_ENFORCE` | Misread of how the switch works | Strict `=== 'true'` check restored |
| 6 | `grep ABUSE-LINK` printed nothing, with a red x | grep exits 1 on no match. Nothing had triggered the line, and the logs were the **test** app's | Expected result; check the live app's logs |
| 7 | A locked account can't exercise the new code | Handlers return 403 `ACCOUNT_FLAGGED` before `checkRateLimit` runs | Test with a direct function call |
| 8 | A/B test impractical | The sweep runs every 5 minutes and is fast (your report) | Direct function check |
| 9 | Test can't run the check against the abuser's data | Test and live use different Supabase projects | Run the script from the **live** folder |
| 10 | The test app would log `[CLUSTER] lookup failed` | The SQL function doesn't exist in the test database | Harmless (fails open) |
| 11 | `[ABUSE-LINK] mode: ENFORCE` printed several times | Each restart logs the line, and `--lines 50` shows older restarts | Nothing to fix |
| 12 | `relation "scored" does not exist` | The band query referenced a CTE that only exists inside the first query | Not needed. My query design mistake |
| 13 | Real people were locked: typo re-signups and a duplicate signup | The old sweep counted unverified accounts as cluster members | Verified-only rule |
| 14 | Unlocking a wrongly locked account would not have stuck | The sweep re-locks any two accounts sharing an IP within 5 minutes | Delete unverified duplicates and ship the verified-only fix first |
| 15 | The score put typo re-signups at 85, the same as abuse | Signup attributes can't separate the two | Score is not used to lock |
| 16 | `detect_duplicate_free_ips()` returned no rows when I expected one | The function only returns an IP with at least one verified, **active** account, and all four abuser accounts are locked | Correct behaviour. My expectation was wrong |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. **Reversed "stop IP locks."** My earlier plan said to make the sweep alert-only. The IP rule depended on locked accounts, so the sweep had to keep locking. I should have flagged that when I made the change, and you caught it.
2. **Reversed "alert-only sweep" a second time** (Phase 14), because a spread-out abuser would never be linked.
3. **Test instructions assumed one database.** I told you to run the check in the test folder using the abuser's ID, then asked about the Supabase projects afterwards. I should have checked first.
4. **"In the test folder" was confusing.** It made it sound as if the abuser used the test site. They don't.
5. **I called the stored-pool design "recommended" and then replaced it.** The 05oct26 file's Appendices E and F no longer apply.
6. **I read the 85-scoring locked pairs as abuse candidates.** Two were typos and one was a duplicate signup. The scoring can't separate them.
7. **The band query was wrong.** It referenced a CTE that doesn't exist outside its own statement.
8. **I expected `detect_duplicate_free_ips()` to return the abuser's IP.** It can't, because all four accounts are locked.
9. **The RPC stopgap I gave in the 05oct26 file counted unverified accounts.** The verified-only version replaces it.

### Decisions

1. **Narrow IP rule:** an IP links accounts only when a source (an account that used up its quota, or a locked account) lives there, and the OS matches. Shared networks aren't pooled otherwise.
2. **Compute linked accounts on the fly,** not stored pools. Nothing goes stale, no migration.
3. **Shared quota comes from the `scans` table** (completed scans this calendar month, UTC).
4. **Strong signals:** `device_id` or `device_fp` from **signup** rows. Fingerprints shared by more than 10 accounts are ignored (a guess, tune it from your data).
5. **Fails open:** if the lookup errors, the scan is allowed and the error is logged.
6. **Escape hatch:** `abuse_lock_exempt = true` skips the check for that account.
7. **Enforcement is a strict `POOL_ENFORCE === 'true'`.** Unset means shadow mode.
8. **The per-scan check returns a 429. It doesn't lock the account.** The sweep still does the locking and emailing.
9. **The sweep only counts and locks email-verified accounts.** If the verification lookup fails, it skips the cluster.
10. **The sweep keeps auto-locking.** Alert-only is deferred.
11. **The score is read-only analysis.** It doesn't lock or block anyone. A non-strong pair needs an IP overlap.
12. **Don't delete flagged accounts.** Deleting a locked account removes the evidence the IP rule needs (and, if `scans.user_id` cascades, the scan history).

### Known limits

- **Worst case is about 6 scans per IP.** Two accounts can each use 3 scans before the sweep or the quota rule links them. Later accounts are blocked immediately.
- **The OS requirement lets a device-switcher through.** An abuser who signs up from a phone after a Windows account isn't linked by IP. A device link still catches them if the fingerprint matches. Set `p_require_os` to `false` for fewer escapes and more false positives.
- **Households.** Once one verified account has used its 3 scans, a family member on the same IP and OS is pooled with it. The exempt flag covers wrongly pooled users.
- **Accounts created before a source ran out are pooled too.** Restricting the IP link to accounts created after a source exhausted its quota would cut false positives on households, but I haven't written or tested that.
- **An abuser who verifies each account** isn't affected by the verified-only rule. Blocking disposable email domains would help.
- **The sweep still locks any two verified accounts on one IP,** including households. It is still blunt, but now only for verified accounts.
- **Links aren't transitive** (A to B by device, B to C by IP). The window is 30 days, and quota resets on the 1st (UTC), so a persistent abuser returns each month.
- **Determined abusers still win.** A VPN or phone hotspot gives a new IP, and a new browser profile changes the fingerprint. The $0 card setup is the next step if this continues.
- **Matching depends on `ip_at_creation`.** Accounts with a null or Cloudflare-edge IP (anything created before the 05oct26 IP fix) can't be matched by IP.
- **Device links apply even with no lock.** Two people sharing one browser profile share a quota.
- **`security definer` plus access to `auth.users`** in the verified-only functions is the part I'm least sure of. It worked in your tests, so it is fine for now.

---

## 7. Open items checklist

### Do next

- [x] Live's `rateLimiter.js` has the **strict** `=== 'true'` line (you restored it) and passes `p_quota`
- [x] Verified-only sweep: `verified_user_ids`, the new `detect_duplicate_free_ips`, and the `abuseDetection.js` edit
- [x] Typo and duplicate accounts cleaned up (unverified deleted, verified unlocked)
- [x] Live runs the new `rateLimiter.js` from Appendix B. `rateLimiter.js.bak` is only an unused backup of the old file
- [ ] **Delete your three test accounts** in Supabase → Authentication → Users (live). The locked ones keep your IP flagged for 30 days, and the unlocked one counts as a peer
- [ ] Watch for the first real block:
  ```bash
  sudo -u echobeehive223 pm2 logs mediacrater-api --lines 1000 --nostream 2>&1 | grep "ABUSE-LINK\] blocked"
  ```
- [ ] Don't delete the locked abuser accounts

### Verify

- [x] Frontend displays the 429 message (seen in your two-account test)
- [ ] Test the **OS mismatch**: sign up from a phone on the same Wi-Fi, verify, then dry-run `free_cluster_usage`. Expect 1 member, or 2 or more with `p_require_os` set to `false`
- [ ] Confirm which link fired in the two-account test (use `mediacrater-api-test` instead if that's the site you used). You want `strongLinks:1 flaggedIpLinks:0`:
  ```bash
  sudo -u echobeehive223 pm2 logs mediacrater-api --lines 1000 --nostream 2>&1 | grep "ABUSE-LINK\] blocked"
  ```
- [ ] Confirm `scanVideo.js` and `scanImage.js` load the profile with `select('*')`, since `checkRateLimit` needs `plan`, `scans_remaining`, `abuse_lock_exempt` and `ip_at_creation`
- [ ] When the abuser returns, run the step 0 query again and compare `device_id` / `device_fp` across the accounts

### Improvements (not urgent)

- [ ] `resolveClearedClusters`: ignore unverified accounts when counting peers
- [ ] Optional: reply to the people who were wrongly locked (you already contacted one)
- [ ] Block disposable email domains, so an abuser can't verify many throwaway accounts
- [ ] Optional: show the 429 as its own state (for example with an upgrade button) instead of under "Analysis failed"
- [ ] Optional: restrict the IP link to accounts created after a source ran out of quota
- [ ] **Alert-only sweep and score-based Slack alerts:** revisit after a few weeks of live data. Store the score and matched signals with any lock
- [ ] Run the step 1 SQL in the **test** Supabase project if you want to test the check on the test site
- [ ] A small tombstone table, if you ever need to delete flagged accounts without losing the link
- [ ] $0 card setup (Stripe SetupIntent) and a link on `card.fingerprint`, if abuse continues
- [ ] Fix the stale 45-minute comment in `server.js` (the sweep runs every 5 minutes)
- [ ] Update the 05oct26 index so its Appendices D, E and F match this file

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
| SQL objects (live database) | `ip_bucket(text)`, `ip_prefix(text, int, int)`, `profiles_ip_bucket_idx`, `account_devices_device_fp_idx`, `free_cluster_usage(uuid, timestamptz, int, int, boolean)`, `verified_user_ids(uuid[])`, `detect_duplicate_free_ips()` |
| `free_cluster_usage` arguments | `p_user`, `p_since`, `p_flag_days` (default 30), `p_quota` (default 3), `p_require_os` (default `true`) |
| Who can call the functions | `service_role` only (revoked from `public`, `anon`, `authenticated`) |
| Quota | 3 free scans per month (`PLAN_CONFIG.free.maxScans`), counted per calendar month in UTC |
| IP source | An account at the same IP bucket (and OS) that used up its quota, or is locked and flagged within 30 days and not exempt |
| Device link | Same `device_id`, or same `device_fp` shared by 10 or fewer accounts, from **signup** rows |
| IP key | IPv4 as is, IPv6 reduced to `/64`, `::ffff:` mapped addresses unwrapped |
| Skip the check | `abuse_lock_exempt = true`, or any non-free plan |
| Sweep | `abuseDetection.js`, every 5 minutes. Counts and locks **verified** accounts only |
| Blocked response | HTTP 429, `error: "Scan limit reached"`, message: "The free scans for this device or network have been used up. Upgrade for more scans." |
| Log lines | `[ABUSE-LINK] mode: ENFORCE\|SHADOW`, `[ABUSE-LINK] blocked user:… \| clusterRemaining:… members:… strongLinks:… flaggedIpLinks:…`, `[ABUSE-LINK] SHADOW would block …`, `[CLUSTER] lookup failed …`, `[ABUSE] verification lookup failed, skipping cluster …` |
| `flaggedIpLinks` / `flagged_count` | Number of **source** accounts (used up quota or locked) |
| Scoring weights (analysis only) | IP 30 / same /24 15, OS +10 / −15, ASN 5, city 5, timezone 5, browser and version 10, signup within 1 h 20 / 24 h 10. Max 85 |
| Log commands use `console.warn` | They don't flood Slack. Switch to `console.error` if you want alerts |

---

## Appendix A – SQL: cluster check

Run each statement **by itself**, with **No limit** selected in the Supabase SQL editor (it appends `limit 100` to the last statement, which breaks `update`s). Run these in the **live** project. Assumed columns: `profiles.ip_at_creation`, `plan`, `account_status`, `flagged_at`, `abuse_lock_exempt`, and `scans.user_id`, `tokens_deducted`, `status`, `created_at`.

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

### Helper and indexes

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
```

### `free_cluster_usage` v2 (current)

Untested when written. Run the dry runs below before restarting anything. The old function is dropped and the new one created in one transaction, so there is no gap (and a call in between would fail open anyway).

```sql
begin;

drop function if exists public.free_cluster_usage(uuid, timestamptz, int);

create or replace function public.free_cluster_usage(
  p_user uuid,
  p_since timestamptz,
  p_flag_days int default 30,
  p_quota int default 3,
  p_require_os boolean default true
) returns table(used_scans int, member_count int, strong_count int, flagged_count int)
language sql stable security definer set search_path = public as $$
  with me as (
    select public.ip_bucket(p.ip_at_creation) as ipb,
           (select d.os from account_devices d
             where d.user_id = p.id and d.event = 'signup'
             order by d.created_at limit 1) as os
    from profiles p where p.id = p_user
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
  at_ip as (
    select p.id as uid, p.account_status, p.abuse_lock_exempt, p.flagged_at,
           (select d.os from account_devices d
             where d.user_id = p.id and d.event = 'signup'
             order by d.created_at limit 1) as os
    from profiles p
    where p.id <> p_user
      and p.plan = 'free'
      and (select ipb from me) is not null
      and public.ip_bucket(p.ip_at_creation) = (select ipb from me)
  ),
  cand as (
    select a.* from at_ip a
    where not p_require_os
       or (select os from me) is null
       or a.os is null
       or a.os = (select os from me)
  ),
  quota_used as (
    select s.user_id as uid, coalesce(sum(s.tokens_deducted), 0) as used
    from scans s
    where s.user_id in (select uid from cand)
      and s.status = 'completed'
      and s.created_at >= p_since
    group by s.user_id
  ),
  sources as (
    select c.uid from cand c
    left join quota_used q on q.uid = c.uid
    where c.abuse_lock_exempt is not true
      and (
        coalesce(q.used, 0) >= p_quota
        or (c.account_status = 'action_required'
            and c.flagged_at > now() - make_interval(days => p_flag_days))
      )
  ),
  ip_cluster as (
    select uid from cand where exists (select 1 from sources)
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
    (select count(*) from sources)::int;
$$;

revoke execute on function public.free_cluster_usage(uuid, timestamptz, int, int, boolean) from public, anon, authenticated;
grant execute on function public.free_cluster_usage(uuid, timestamptz, int, int, boolean) to service_role;

commit;
```

### Dry runs

Use any account in the cluster, including a locked one. Your results: `9 / 4 / 1 / 3` for an abuser account, and 1 scan and 1 member for a normal account.

```sql
-- Abuser account: expect used_scans >= 3, member_count > 1, flagged_count >= 1
select * from public.free_cluster_usage(
  '<abuser account uuid>',
  (date_trunc('month', now() at time zone 'utc')) at time zone 'utc',
  30);

-- Same account with the OS requirement off. The numbers should match if all four accounts share an OS
select * from public.free_cluster_usage(
  '<abuser account uuid>',
  (date_trunc('month', now() at time zone 'utc')) at time zone 'utc',
  30, 3, false);

-- A normal account: expect member_count 1
select * from public.free_cluster_usage(
  '<normal account uuid>',
  (date_trunc('month', now() at time zone 'utc')) at time zone 'utc',
  30);
```

### Fix a manually locked account

A manual lock leaves `flagged_at` empty, so the lock can't be recognised as recent. Fill it in for every locked account at the IP:

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

Full replacement. `withRetry` and `commitScanDeduction` are unchanged from the original. The log lines use `console.warn`, so they don't flood Slack. The mode line near the top is optional but useful, because it shows in the logs after each restart. The `rpc` call passes `p_quota`.

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
      p_flag_days: 30,
      p_quota: quota
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
// same IP and OS as an account that used up its quota or is locked) — see
// free_cluster_usage().
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

## Appendix C – Verified-only sweep

Run the SQL in the Supabase project that the app running the sweep uses. If the function is missing, the sweep logs a failure and skips locking, which fails safe.

### `verified_user_ids`

Returns the users from a list whose email is confirmed.

```sql
create or replace function public.verified_user_ids(p_ids uuid[])
returns setof uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where id = any(p_ids) and email_confirmed_at is not null;
$$;
revoke execute on function public.verified_user_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.verified_user_ids(uuid[]) to service_role;
```

### `detect_duplicate_free_ips` (verified-only)

Counts only verified accounts, and flags an IP only when it has 2 or more of them and at least one is still `active`. This also fixes the third-account bug and replaces the stopgap in the 05oct26 file.

```sql
create or replace function public.detect_duplicate_free_ips()
 returns table(ip_at_creation text, account_count bigint)
 language sql stable security definer set search_path = public, auth
as $function$
  select p.ip_at_creation, count(*) as account_count
  from profiles p
  join auth.users u on u.id = p.id and u.email_confirmed_at is not null
  where p.ip_at_creation is not null
    and not exists (select 1 from purchases pu where pu.user_id = p.id)
  group by p.ip_at_creation
  having count(*) >= 2
     and count(*) filter (where p.account_status = 'active') >= 1;
$function$;
revoke execute on function public.detect_duplicate_free_ips() from public, anon, authenticated;
grant execute on function public.detect_duplicate_free_ips() to service_role;
```

An empty result is normal when every verified account at an IP is already locked.

### `lockAndNotifyCluster` in `abuseDetection.js`

The whole function as deployed (reviewed and matching the intended code). The new part is the verification block between the `accounts.length < 2` check and `toLock`.

```js
async function lockAndNotifyCluster(supabase, ip, clusterId) {
  const { data: accounts, error: fetchError } = await supabase
    .from('profiles')
    .select('id, email, account_status, abuse_lock_exempt')
    .eq('ip_at_creation', ip)
    .eq('plan', 'free');

  if (fetchError) {
    console.error('[ABUSE] Failed to fetch accounts for cluster:', summarizeError(fetchError));
    return;
  }

  if (!accounts || accounts.length < 2) {
    return;
  }

  // Only email-verified accounts count. An unverified account can't sign in,
  // so locking it protects nothing and only catches typo re-signups.
  const { data: verifiedRows, error: verifyError } = await supabase
    .rpc('verified_user_ids', { p_ids: accounts.map((a) => a.id) });

  if (verifyError) {
    console.error('[ABUSE] verification lookup failed, skipping cluster:', summarizeError(verifyError));
    return;
  }

  const verifiedSet = new Set(
    (verifiedRows || []).map((r) => (typeof r === 'string' ? r : r.verified_user_ids))
  );
  const verifiedAccounts = accounts.filter((a) => verifiedSet.has(a.id));

  if (verifiedAccounts.length < 2) return;

  const toLock = verifiedAccounts.filter(
    (a) => a.account_status === 'active' && a.abuse_lock_exempt !== true
  );

  if (toLock.length === 0) {
    return;
  }

  const { error: lockError } = await supabase
    .from('profiles')
    .update({
      account_status: 'action_required',
      previously_flagged: true,
      flagged_cluster_id: clusterId,
      flagged_at: new Date().toISOString()
    })
    .in('id', toLock.map((a) => a.id));

  if (lockError) {
    console.error('[ABUSE] Failed to lock accounts:', summarizeError(lockError));
    return;
  }

  console.error(`[ABUSE] Locked ${toLock.length} account(s) for IP ${ip}`);

  await supabase
    .from('flagged_ip_clusters')
    .update({ resolved_at: null })
    .eq('id', clusterId);

  const emailResults = await Promise.allSettled(
    toLock.map((a) =>
      sendAbuseClusterEmail({
        to: a.email,
        clusterId,
        userId: a.id,
        currentPlan: 'free', // every account here is 'free' — filtered by .eq('plan', 'free') above
      })
    )
  );

  let anyFailed = false;
  emailResults.forEach((r, i) => {
    if (r.status === 'rejected') {
      anyFailed = true;
      console.error(`[ABUSE] Email failed for ${toLock[i].email}:`, summarizeError(r.reason));
    }
  });

  if (!anyFailed) {
    const nowIso = new Date().toISOString();
    await supabase.from('flagged_ip_clusters').update({ notified: true }).eq('id', clusterId);

    await supabase
      .from('profiles')
      .update({ last_notified_at: nowIso })
      .in('id', toLock.map((a) => a.id));
  }
}
```

**Limit:** `resolveClearedClusters` still counts unverified accounts as peers when deciding whether to unlock a locked account.

### Cleanup commands used

Check verification and scans for specific accounts (fill in the ID prefixes, and run with No limit):

```sql
select left(p.id::text, 6) as acct, p.account_status,
       (u.email_confirmed_at is not null) as verified,
       (select count(*) from scans s where s.user_id = p.id and s.status = 'completed') as scans_done
from profiles p join auth.users u on u.id = p.id
where left(p.id::text, 6) in ('<prefix 1>', '<prefix 2>');
```

Unlock the verified accounts (after deleting the unverified duplicates, or the sweep may re-lock them):

```sql
update profiles set account_status = 'active'
where left(id::text, 6) in ('<verified 1>', '<verified 2>', '<verified 3>')
  and account_status = 'action_required';
```

---

## Appendix D – Scoring accounts from account_devices

All read-only. Run each statement by itself. Run it in the **live** project (test has only your own accounts), and check the size first: the pair comparison grows quadratically.

### Helper

```sql
create or replace function public.ip_prefix(p text, v4_len int default 24, v6_len int default 64)
returns text language plpgsql immutable as $$
begin
  if p is null then return null; end if;
  if p like '::ffff:%' then p := substring(p from 8); end if;
  if position(':' in p) > 0 then
    return host(network(set_masklen(p::inet, v6_len)));
  end if;
  return host(network(set_masklen(p::inet, v4_len)));
exception when others then
  return null;
end $$;
```

### Size check (yours returned 47; if it returns more than about 5,000, don't run the pair queries)

```sql
select count(*) from account_devices where event = 'signup' and created_at > now() - interval '30 days';
```

### Scored pairs with a per-signal breakdown and short labels

Uses 6-character labels and account status instead of full IDs. The score is reported alongside a separate `strong_link` flag.

```sql
with s as (
  select d.user_id, d.created_at, d.device_id, d.device_fp, d.ip,
         d.asn, d.city, d.timezone, d.os, d.browser, d.browser_version,
         coalesce(d.is_vpn, false) or coalesce(d.is_hosting, false) as shared_ip,
         public.ip_prefix(d.ip) as pfx
  from account_devices d
  join profiles p on p.id = d.user_id
  where d.event = 'signup' and p.plan = 'free'
    and d.created_at > now() - interval '30 days'
),
pairs as (
  select a.user_id as user_a, b.user_id as user_b,
    (a.device_id = b.device_id
      or (a.device_fp is not null and a.device_fp = b.device_fp)) as strong_link,
    (case when not (a.shared_ip or b.shared_ip) and a.ip = b.ip then 30
          when not (a.shared_ip or b.shared_ip) and a.pfx = b.pfx then 15 else 0 end) as ip_pts,
    (case when a.os is not null and b.os is not null
          then (case when a.os = b.os then 10 else -15 end) else 0 end) as os_pts,
    (case when not (a.shared_ip or b.shared_ip) and a.asn = b.asn then 5 else 0 end) as asn_pts,
    (case when a.city = b.city then 5 else 0 end) as city_pts,
    (case when a.timezone = b.timezone then 5 else 0 end) as tz_pts,
    (case when a.browser = b.browser and a.browser_version = b.browser_version then 10 else 0 end) as browser_pts,
    (case when abs(extract(epoch from a.created_at - b.created_at)) < 3600 then 20
          when abs(extract(epoch from a.created_at - b.created_at)) < 86400 then 10 else 0 end) as time_pts
  from s a join s b on a.user_id < b.user_id
),
scored as (
  select *, ip_pts + os_pts + asn_pts + city_pts + tz_pts + browser_pts + time_pts as score
  from pairs
)
select left(sc.user_a::text, 6) as a, pa.account_status as status_a,
       left(sc.user_b::text, 6) as b, pb.account_status as status_b,
       sc.strong_link, sc.ip_pts, sc.os_pts, sc.browser_pts, sc.time_pts, sc.score
from scored sc
join profiles pa on pa.id = sc.user_a
join profiles pb on pb.id = sc.user_b
where sc.strong_link or sc.score >= 40
order by sc.strong_link desc, sc.score desc;
```

To see the score bands instead, replace only the **final** `select` of the same statement with this. It can't run on its own, because `scored` only exists inside the statement that defines it:

```sql
select (score / 10) * 10 as band,
       count(*) filter (where strong_link) as strong_pairs,
       count(*) filter (where not strong_link) as other_pairs
from scored
where score >= 20
group by 1 order by 1 desc;
```

### OS distribution

```sql
select os, count(*) from account_devices
where event = 'signup' and created_at > now() - interval '30 days'
group by 1 order by 2 desc;
```

### Status, OS, browser, signup time and scans for specific accounts

Fill in the ID prefixes from the labels above:

```sql
select left(p.id::text, 6) as acct, p.account_status, d.os, d.browser,
       date_trunc('minute', d.created_at) as signed_up,
       (select count(*) from scans s where s.user_id = p.id and s.status = 'completed') as scans_done
from profiles p
join account_devices d on d.user_id = p.id and d.event = 'signup'
where left(p.id::text, 6) in ('<prefix 1>', '<prefix 2>')
order by d.created_at;
```

### What the live results showed (47 signups, 30 days)

- Six strong-link pairs: four at 85, one at 60, one at 55.
- Eight pairs without a device link: seven with an exact IP match, one at 40 with no location overlap.
- The abuser's four accounts: all six pairs present, two device groups joined by the IP.
- Three locked pairs at 85 were typo and duplicate signups, so the score can't separate them from abuse.

---

## Appendix E – Verification and troubleshooting commands

Replace `<app-name>` with the real PM2 name (`mediacrater-api` for live, `mediacrater-api-test` for test) and leave out the angle brackets.

### Check which mode is running

```bash
grep -n "POOL_ENFORCE" /var/www/mediacrater-api/rateLimiter.js
grep -c '^POOL_ENFORCE=true' /var/www/mediacrater-api/.env

sudo -u echobeehive223 pm2 restart mediacrater-api --update-env
sleep 3
sudo -u echobeehive223 pm2 logs mediacrater-api --lines 50 --nostream 2>&1 | grep -E "ABUSE-LINK|CLUSTER"
```

You want `[ABUSE-LINK] mode: ENFORCE` and no `[CLUSTER] lookup failed`. If it says `SHADOW`, `POOL_ENFORCE=true` isn't reaching the process: check `.env` for quotes or trailing spaces. Restarts kill scans in progress, so pick a quiet moment. Each restart adds one mode line, and `--lines` includes older ones.

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
| `[CLUSTER] lookup failed … schema cache` | Supabase's API layer hasn't picked up a changed function. Run `notify pgrst, 'reload schema';` in the SQL editor and repeat |
| A crash about a missing profile | The ID isn't in this database (test and live are separate projects) |
| No `ABUSE-LINK` lines at all | Nobody linked has scanned yet, or the abuser's accounts aren't matching. Run the step 0 query and the dry run |

### Verified-only sweep tests

```sql
select * from public.detect_duplicate_free_ips();
```

An empty result is normal when every verified account at an IP is already locked. Then test end to end (these were your three findings):

1. Create a new **verified** account at a flagged IP. Within 5 minutes it should be locked.
2. Create an **unverified** account at that IP. It should not be locked.
3. Create a **verified** account with no other linked values, even if another email failed verification. It should not be blocked.

### Test the OS rule

Sign up from a phone on the same Wi-Fi as an account that is a source (locked, or out of quota), and verify it. Then dry-run `free_cluster_usage` on it. Expect `member_count` 1, and 2 or more with `p_require_os` set to `false` (Appendix A).

### Optional A/B test (two throwaway accounts on a site with the SQL installed)

A plays the old account, B the new one.

1. Create two free accounts and confirm both emails. Find their IDs with `select id, email, created_at from profiles order by created_at desc limit 5;`.
2. Log in as A and run 3 scans.
3. Lock A: `update profiles set account_status = 'action_required', flagged_at = now() where id = '<A>';`
4. Give B A's IP: `update profiles set ip_at_creation = (select ip_at_creation from profiles where id = '<A>') where id = '<B>';`
5. Scan as B. Expect a 429 with the shared-quota message and a `[ABUSE-LINK] blocked user:<B> …` line.
6. Undo: set A back to `active`, and delete both throwaway users in Supabase → Authentication → Users.

The sweep (every 5 minutes) may change the accounts' lock state while you do this. The direct check avoids that.

### Test app note

The test app uses a different database. Until the cluster SQL exists in the test project, the test app logs `[CLUSTER] lookup failed` and allows scans. That's harmless and fails open.

---

## Appendix F – Rollback and maintenance

### Roll back `rateLimiter.js`

Only possible if you kept the backup of the old file. Otherwise, the Appendix B version is the current code.

```bash
cd /var/www/mediacrater-api
cp rateLimiter.js.bak rateLimiter.js
sudo -u echobeehive223 pm2 restart mediacrater-api --update-env
```

### Switch to shadow mode without rolling back

Remove the `POOL_ENFORCE` line from live's `.env` (or set it to anything other than `true`), then restart with `--update-env`. This only works with the strict `=== 'true'` check. The logs then say `SHADOW would block` and the scan goes through.

### Restore `free_cluster_usage` v1

Drop the v2 function first, because the signatures differ. This is the old IP rule (a locked account is the only source, and there is no OS requirement). Rolling back also needs `rateLimiter.js` to call it without `p_quota`, which is harmless, because Postgres rejects unknown arguments. If you restore v1, remove `p_quota` from the `rpc` call.

```sql
drop function if exists public.free_cluster_usage(uuid, timestamptz, int, int, boolean);

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

### Revert the verified-only sweep

Not recommended, because it reintroduces the false locks. To revert, remove the verification block from `lockAndNotifyCluster` (so `toLock` filters `accounts` directly), then restore the original RPC. The original reintroduces the third-account bug:

```sql
CREATE OR REPLACE FUNCTION public.detect_duplicate_free_ips()
 RETURNS TABLE(ip_at_creation text, account_count bigint)
 LANGUAGE sql
AS $function$SELECT
  p.ip_at_creation,
  COUNT(*) AS account_count
FROM profiles p
WHERE p.ip_at_creation IS NOT NULL
  AND p.account_status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM purchases pu WHERE pu.user_id = p.id
  )
GROUP BY p.ip_at_creation
HAVING COUNT(*) >= 2;$function$
```

### Remove the cluster SQL (only if you abandon the check)

The app falls back to the per-account limit if the function is missing, because it fails open:

```sql
drop function if exists public.free_cluster_usage(uuid, timestamptz, int, int, boolean);
drop function if exists public.verified_user_ids(uuid[]);
drop function if exists public.ip_bucket(text);
drop function if exists public.ip_prefix(text, int, int);
drop index if exists public.profiles_ip_bucket_idx;
drop index if exists public.account_devices_device_fp_idx;
```

(The sweep needs `verified_user_ids` and fails safe without it, so only drop it together with the verified-only edit.)

### Un-link a wrongly blocked real user

```sql
update profiles set abuse_lock_exempt = true where id = '<user uuid>';
```

If the same shared IP keeps catching real users, the fix is to require a strong link before the IP rule applies.

### Routine

- Don't delete locked abuser accounts. The IP rule needs a source at that IP.
- Keep the sweep running (verified-only).
- When the abuser returns, check for `[ABUSE-LINK] blocked` lines, then compare their accounts' `device_id` / `device_fp` with the step 0 query.
- After a few weeks of live data, revisit the alert-only sweep and the score-based Slack alerts.

---

*End of index.  
Conversation: https://claude.ai/chat/344c1200-b593-4d05-bab9-cd0f70039e9c*
