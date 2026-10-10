# Drift Monitor: Supabase `rate_limits` Privilege Drift & "Hidden" File Differences

| | |
|---|---|
| **Date** | 9 October 2026 (`09oct26`) |
| **Destination** | changelogs/server |
| **Conversation** | https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d |
| **Related prior work** | `security-review-phase1-vps-lockdown-07oct26.md` (7 Oct 2026, Supabase privilege lockdown)<br>`security-review-phase2-headers-csp-08oct26.md` (8 Oct 2026) |
| **Stack** | Drift monitor (systemd, `~/mediacrater-drift-monitor-live`, Slack alerts), Supabase (**separate TEST and LIVE projects**), VPS folders `/var/www/mediacrater-api` (LIVE) and `/var/www/mediacrater-api-test` (TEST) |
| **Starting trigger** | The drift monitor reported 14 Supabase differences (which you had ignored for 7 days from Slack) and "Environment Drift Detected: 2 file(s) · 0 code change(s) · 0 whitespace change(s)" without naming the 2 files |

> **Redaction note:** no secrets, keys, IP addresses, user IDs or email addresses are included.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied (expected output is given). ⏳ = open.

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
10. [Appendix B – Finding drifted files](#appendix-b--finding-drifted-files)
11. [Appendix C – Removing the temporary ignores](#appendix-c--removing-the-temporary-ignores)

---

## 1. Summary

Both reports had simple causes, and LIVE now matches TEST.

- **The 14 Supabase entries were one table:** `public.rate_limits`. LIVE gave `anon` and `authenticated` all 7 table privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER); TEST gave none. TEST was already hardened; LIVE still had Supabase's defaults, because Phase 1's privilege block only listed the tables your RLS policies cover.
- **Fixed by revoking on LIVE**, not by granting on TEST: nothing in the app uses these privileges (the rate limiter runs with the service role and a `security definer` function), and `TRUNCATE` bypasses RLS.
- **The 2 "hidden" files were files that exist in only one environment**: the Phase 2 backup files. You deleted them.
- **The monitor's message has a bug:** it counts files that differ in ways other than code or whitespace (only in one environment, permissions, line endings, binary) but doesn't list them. Not fixed yet.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| Revoke `rate_limits` privileges on **LIVE** | ✅ Your report | `revoke all on table public.rate_limits from anon, authenticated;` |
| Confirm with the check query (LIVE and TEST) | ⚠️ Output not shown | Expected: no rows on either |
| TEST `rate_limits` | ✅ Unchanged | Already had no browser-role privileges |
| Sign-in and password reset still work on LIVE (rate limiter) | ⚠️ Not confirmed | Expected: both work exactly as before |
| Phase 2 backup files deleted | ✅ Your report | |
| 14 temporary ignores removed from `ignores.json` | ⚠️ Not confirmed | Expected: no `rate_limits` entries left in `temporaryIgnores`. They expire by 15 Oct anyway |
| Next drift check is clean | ⚠️ Not confirmed | Expected: no Supabase drift for `rate_limits`, no file drift |
| Monitor lists every drifted file | ⏳ Open | Needs `src/check.js` and `src/slack.js` |

---

## 3. Starting point

- The drift monitor compares TEST and LIVE (code folders, Supabase, GitHub) and posts to Slack with **Ignore 7 days / Ignore forever / Apply** buttons.
- Your `data/ignores.json` held 14 `temporaryIgnores`, all `"type": "supabase"`, paths like `Privilege — public.rate_limits → anon (DELETE)`, created 5–8 October, expiring 12–15 October.
- Phase 1 (7 Oct) audit 3c on TEST listed no `rate_limits` rows for `anon`/`authenticated`. Phase 1's block 4 revoked privileges on `extension_versions`, `flagged_ip_clusters`, `profiles`, `purchases`, `scan_batches`, `scan_queue` and `scans` only.
- Phase 2 left backup files on the VPS (`server.js.bak-phase2` on TEST, a manually named `server.js` backup on LIVE).

---

## 4. Timeline: what we did, in order

### Step 1 – Reading the ignored entries

14 entries = 7 privileges × 2 roles on one table. Combined with Phase 1's TEST audit, the conclusion was: **LIVE has all 14 privileges, TEST has none.**

Risk today: low but real. RLS is on and `rate_limits` has no policies, so the API can't read or write rows with the anon key. But `TRUNCATE` ignores RLS (PostgREST doesn't expose it today), and one mistaken policy later would expose the table.

### Step 2 – The "2 file(s), 0 code changes" message

A file that differs in neither code nor whitespace is almost always one of:
- a file that exists in only one environment (the Phase 1/2 backups fit)
- a permissions-only difference
- a line-ending difference (CRLF vs LF)
- a binary file

The monitor counts these but only lists code and whitespace changes. Commands to find them: [Appendix B](#appendix-b--finding-drifted-files).

### Step 3 – "Shouldn't we add them to TEST instead?"

You asked why LIVE should lose privileges rather than TEST gain them. The answer: matching should move toward the **safer** side.
1. Nothing uses them: `lib/rate-limit.ts` uses the service role, and `check_and_log_rate_limit` is `security definer`. Both bypass these grants.
2. TEST already proves the app works without them: sign-in, sign-up, reset and the contact form all use the rate limiter on TEST.
3. Adding them to TEST widens access for no gain.

The drift monitor can say the environments differ, but not which side is right. For permissions, the narrower side is the target.

### Step 4 – Fix applied

You revoked the privileges on LIVE and deleted the Phase 2 backup files.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | 14 privilege differences on one table | LIVE still had Supabase's default grants on `rate_limits`; Phase 1's revoke list didn't include it | Revoked on LIVE |
| 2 | "2 file(s) · 0 code change(s) · 0 whitespace change(s)" with no file names | Files present in only one environment (Phase 2 backups); the monitor doesn't list that category | Backups deleted; monitor fix open |
| 3 | Which side was "correct" wasn't obvious | The monitor reports differences, not intent | Least privilege: match the stricter side |

---

## 6. Corrections / important decisions

1. **Revoke on LIVE; don't grant on TEST.**
2. **Delete backup files after each rollout** (or add an ignore pattern for `*.bak*`), so they don't show up as drift.
3. **Remove the 14 temporary ignores** rather than waiting for them to expire, so a regression alerts instead of being silenced.

**Known limit:** Supabase grants full privileges to `anon`/`authenticated` on every **new** table by default. Every new table needs the same revoke (Phase 1 block 4 pattern), or the monitor will flag the difference again.

---

## 7. Open items checklist

- [ ] Run the check query on LIVE and TEST ([Appendix A](#appendix-a--sql)). Expected: no rows on either
- [ ] Remove the 14 `rate_limits` entries from `temporaryIgnores` ([Appendix C](#appendix-c--removing-the-temporary-ignores))
- [ ] Sign in and request a password reset on LIVE. Expected: both work
- [ ] Send `src/check.js` and `src/slack.js` so the monitor's message lists every drifted file and its type (only in TEST, only in LIVE, permissions, line endings, binary)
- [ ] Optional: an ignore pattern for `*.bak*` files in the monitor

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Table | `public.rate_limits` (RLS on, no policies) |
| Correct privileges for `anon` / `authenticated` | None |
| Who writes to it | Vercel API routes via `check_and_log_rate_limit` (service role, `security definer`) |
| Monitor ignores file | `~/mediacrater-drift-monitor-live/data/ignores.json` (`temporaryIgnores`, `ignores`) |
| Monitor restart | `sudo systemctl restart mediacrater-drift-monitor` |
| Monitor reports | `~/mediacrater-drift-monitor-live/data/reports/` |

---

## Appendix A – SQL

Run each block separately in the Supabase SQL Editor.

```sql
-- 1. Which browser roles hold privileges on rate_limits? (run on LIVE, then TEST)
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'rate_limits'
  and grantee in ('anon', 'authenticated')
group by grantee;
```
Before the fix: LIVE showed two rows with all 7 privileges; TEST showed no rows.

```sql
-- 2. LIVE only: remove them
revoke all on table public.rate_limits from anon, authenticated;
```

```sql
-- 3. Re-run query 1. Expected: no rows on LIVE.
```

---

## Appendix B – Finding drifted files

```bash
# VPS code: "Only in …" lines = files present in one environment only
cd /var/www
diff -rq --exclude=node_modules --exclude=.git --exclude=.env mediacrater-api mediacrater-api-test

# What the monitor recorded in its latest report
cd ~/mediacrater-drift-monitor-live/data/reports
ls -t | head -3
grep -o '"path": *"[^"]*"' "$(ls -t | head -1)" | sort | uniq -c
```

---

## Appendix C – Removing the temporary ignores

1. Open `~/mediacrater-drift-monitor-live/data/ignores.json`.
2. In `"temporaryIgnores"`, delete the 14 objects whose `"path"` starts with `Privilege — public.rate_limits`. Keep the JSON valid: no trailing comma after the last remaining entry.
3. Check it still parses and restart:
   ```bash
   node -e "JSON.parse(require('fs').readFileSync(process.env.HOME + '/mediacrater-drift-monitor-live/data/ignores.json','utf8')); console.log('valid')"
   sudo systemctl restart mediacrater-drift-monitor
   ```

---

*End of index.  
Conversation: https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d*
