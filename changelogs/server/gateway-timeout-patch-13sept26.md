# Gateway Timeout Patch — abuseDetection.js
**AI conversation link:** https://claude.ai/chat/5cc52007-76e3-47ab-801e-1ab844b085a9
**Date:** September 13, 2026
**File touched:** `abuseDetection.js` (production: `/var/www/mediacrater-api/`)
**Status:** Root cause confirmed, fix written, **not yet deployed to production**

---

## Symptom

Slack alerts repeating every ~45 minutes for 17+ hours straight:

```
[ABUSE] Resolution peer check failed: Gateway Timeout
```

Always the same IP cluster (`174.94.116.35`, 2 locked free-plan accounts), always in `resolveClearedClusters()`'s peer-check query.

## Investigation timeline (what we ruled out, and how)

1. **Query/index problem?** No. `EXPLAIN ANALYZE` on the exact failing query, run against both real account IDs, returned in **0.070–0.071 ms** via a Seq Scan. Postgres was never the bottleneck.
2. **Missing index?** No. `idx_profiles_ip_at_creation_plan` (partial btree on `ip_at_creation, plan WHERE plan='free'`) matches the query shape. (Irrelevant in the end, since the table is small enough that Postgres chooses a Seq Scan anyway — also fine, at 0.07ms.)
3. **RLS policies?** No. `profiles` has two policies (`Service role can do everything` — unconditional; `Users can read own profile` — `auth.uid() = id`). Neither references `last_ip` or affects service-role queries.
4. **Triggers?** No. Only trigger on `profiles` is `handle_updated_at()`, fires on `UPDATE` only — irrelevant to a `SELECT`.
5. **`last_ip` column being `NULL` on one account?** No. Not referenced anywhere in the failing query, and not touched by RLS or triggers (per #3/#4).
6. **Duplicate/double sweep interval (the "11-minute gap" red herring)?** No. Confirmed exactly one call site for `initAbuseDetection()` in production `server.js`. Confirmed via Supabase dashboard logs that production's sweep fires **exactly every 45 minutes**, on the dot, every time. The irregular gap originally seen was from the **separate `mediacrater-api-test` app/Supabase project**, most likely test-instance restarts during manual testing — not a bug in this file.
7. **Two separate Supabase projects/apps causing confusion during diagnosis:** `mediacrater-api` (prod) and `mediacrater-api-test` (test) run independently, on separate Supabase projects, each with a single unpatched copy of `abuseDetection.js`. Several early log screenshots were later found to be from the test project, not prod — this cost real time and is why LIVE/TEST log tagging is recommended below for next time.

**Conclusion:** Genuine transient network/infra blip between the Node app and Supabase's edge/gateway layer (Cloudflare/PostgREST/Kong) — same class of issue the original code already anticipated for the detection RPC. It appeared concentrated on one IP purely because that cluster was the only locked account set in the system during the affected window, so 100% of sweeps in that stretch queried it.

## Fix applied (in `abuseDetection.js`)

1. **New generic helper `retryOnce(fn, label, delayMs)`** — retries a Supabase call once after a delay; only surfaces/logs an error if **both** the original call and the retry fail.
2. **`callDetectionRpcWithRetry` refactored to call `retryOnce`** internally (same 30s delay, identical behavior — no functional change to detection).
3. **Resolution sweep's peer-check query wrapped in `retryOnce`** with a new, shorter **3-second** delay (`QUERY_RETRY_DELAY_MS`), since log evidence showed successful 200s landing seconds after a 504 on the same query shape.
4. **No other logic changed** — locking, notification/email dedup, cluster resolution, `summarizeError`, sweep interval, all identical to the original.

**Net effect:** A lone transient Gateway Timeout now retries silently and produces zero log/Slack noise. Only a real, retry-exhausted failure reaches the alert channel going forward.

## Outstanding / recommended next steps

- [ ] **Deploy patched `abuseDetection.js` to production** (`/var/www/mediacrater-api/`) — confirmed via grep that production is still running the original, unpatched version.
- [ ] Optional: add `[LIVE]` / `[TEST]` tags to `console.error` calls in each app's copy of the file, so future log output is unambiguous about which environment produced it (this diagnosis lost time to cross-environment confusion).
- [ ] No data cleanup needed — the `last_ip` NULL discrepancy was investigated and found unrelated to this issue, though it may be worth a separate look if it matters for other features.
