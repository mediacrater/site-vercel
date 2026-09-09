# Mediacrater — VPS Restarts & Gateway Timeout Incident
**Date:** 2026-09-09
**Server:** `srv1411064` (`echobeehive223`)
**Apps involved:** `mediacrater-api` (live), `mediacrater-api-test` (test)

This incident had **two distinct root causes**, found in sequence. Phase 1 was diagnosed with Grok; phase 2 (after Grok's session ended without a final answer) was diagnosed and fixed with Claude. Both are documented here in one place since they affected the same symptom (live restarting, test unaffected).

---

## Original symptom

```
[2026-09-09T16:45:15.120Z] [ABUSE] Resolution peer check failed: Gateway Timeout
```
Plus: `mediacrater-api` restarting throughout the day/night. Only on **live**, never on **test**.

---

## Phase 1 — Abuse-sweep insert storm (diagnosed with Grok)

### Timeline

| Time | What happened |
|---|---|
| 14:27 | Symptom reported. |
| 14:31 | Asked to check project files instead of guessing — the Mediacrater backend wasn't in the chat workspace, so `server.js` had to be pasted in manually. |
| 14:38 | `server.js` pasted. |
| 14:45 | Found a stale comment: `initAbuseDetection` claims a "45-minute interval," but `abuseDetection.js` actually runs the sweep every **5 minutes**. Ran: |

```bash
pm2 show mediacrater-api
dmesg -T | grep -i 'killed process'
journalctl -u pm2 --since "2 days ago" | grep -i restart
```
Result: `restarts: 19`, `uptime: 97s`, `dmesg` blocked by permissions (not in `adm`/`systemd-journal`).

| Time | What happened |
|---|---|
| 14:52 | Explained the recommended `profiles (ip_at_creation, plan)` index is a lookup index, not a new column/column change. Pasted full `pm2 jlist` dump for both apps. |
| 15:01 | `pm2 jlist` showed `mediacrater-api-test` had **never restarted** (`restart_time: 0`) while live had 21, all exiting cleanly (code 0) — ruled out a hypervisor/VM-level reboot. Asked to check `.env` and grep the error log: |

```bash
grep '^SUPABASE_URL=' /var/www/mediacrater-api/.env
grep '^SUPABASE_URL=' /var/www/mediacrater-api-test/.env
grep -n -E 'ABUSE|exit|SIGTERM|EADDRINUSE|uncaught|Unhandled' \
  ~/.pm2/logs/mediacrater-api-error.log | tail -80
```

| Time | What happened |
|---|---|
| 15:04 | Confirmed `SUPABASE_URL=https://wwnpgzgvwsbdipysvobb.supabase.co` — correct, not routed through a Cloudflare-proxied hostname. Error log showed **"New IP cluster flagged"** for IP `45.84.107.97` logged **27 times in a row**. |
| 15:12 | Root cause identified: `checkForAbusiveIPs()` in `abuseDetection.js` ran a `.maybeSingle()` lookup on `flagged_ip_clusters` and **discarded the error**. Once 2+ rows existed for the same IP, `maybeSingle()` always errors, `data` comes back `null`, and the code treated that as "no existing row" — inserting a new row every 5-minute sweep, forever. Confirmed independently: **~80 duplicate rows** found in `flagged_ip_clusters` for IP `45.84.107.97` (2 real bot accounts, ASN QuxLabs AB). That insert storm was hammering `profiles`/`flagged_ip_clusters` hard enough to cause the `Gateway Timeout` on the peer check. Also flagged as a side issue: Cloudflare edge IPs (`162.158.0.0/15`) and Tor exit nodes were being logged as "abusers" because `getClientIp()` falls back to `x-forwarded-for`. |
| 15:17 | Clarified exact ordering for the fix (lookup-error check must come **before** treating `!existing` as "new"). |
| 15:21 | Asked for a changelog — Grok wrote `MEDIACRATER-ABUSE-INCIDENT-2026-09-09.md`, explicitly noting: **nothing below was deployed yet**, only diagnosed. |
| 19:19 | Reported the server was *still* restarting periodically, but now with **zero errors logged** — just the boot banner. This is a different symptom shape than the storm above, and Grok's session ended here without a reply. This is where Phase 2 picks up. |

### Fixes recommended in Phase 1

**Diagnostic SQL — see the damage:**
```sql
select ip_address, count(*) as rows
from flagged_ip_clusters
group by 1
having count(*) > 1
order by rows desc;
```

**Cleanup SQL — dedupe, then make it structurally impossible:**
```sql
-- 1. Canonical row = earliest id per IP
with keeper as (
  select distinct on (ip_address) id as keep_id, ip_address
  from flagged_ip_clusters
  order by ip_address, id
)
update profiles p
set flagged_cluster_id = k.keep_id
from flagged_ip_clusters f
join keeper k on k.ip_address = f.ip_address
where p.flagged_cluster_id = f.id
  and f.id <> k.keep_id;

-- 2. Drop duplicates
delete from flagged_ip_clusters f
using (
  select distinct on (ip_address) id as keep_id, ip_address
  from flagged_ip_clusters
  order by ip_address, id
) k
where f.ip_address = k.ip_address
  and f.id <> k.keep_id;

-- 3. Prevent this forever
create unique index if not exists flagged_ip_clusters_ip_uq
on flagged_ip_clusters (ip_address);
```

**Optional insurance index (not required if the batched query below is used instead):**
```sql
create index concurrently if not exists profiles_ip_plan_idx
on profiles (ip_at_creation, plan)
where ip_at_creation is not null;
```

**Code fix 1 — sweep lock (`abuseDetection.js`), stop overlapping runs:**
```javascript
let sweepRunning = false;
async function runSweep() {
  if (sweepRunning) {
    console.error('[ABUSE] Previous sweep still running, skipping');
    return;
  }
  sweepRunning = true;
  try {
    await checkForAbusiveIPs();
    await resolveClearedClusters();
  } catch (err) {
    console.error('[ABUSE] sweep crashed:', summarizeError(err));
  } finally {
    sweepRunning = false;
  }
}
```

**Code fix 2 — check the lookup error before treating a row as "new" (`checkForAbusiveIPs`), exact replacement block:**
```javascript
const { data: existing, error: existingError } = await supabase
  .from('flagged_ip_clusters')
  .select('id')
  .eq('ip_address', cluster.ip_at_creation)
  .maybeSingle();

if (existingError) {
  console.error('[ABUSE] cluster lookup failed:', summarizeError(existingError));
  continue;
}

let clusterId = existing?.id;
if (!existing) {
  const { data: inserted, error: insertError } = await supabase
    .from('flagged_ip_clusters')
    .insert({
      ip_address: cluster.ip_at_creation,
      account_count: cluster.account_count,
      notified: false
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[ABUSE] Failed to log cluster:', summarizeError(insertError));
    continue;
  }
  clusterId = inserted.id;
  console.error(
    `[ABUSE] New IP cluster flagged: ${cluster.account_count} accounts sharing IP ${cluster.ip_at_creation}`
  );
}
await lockAndNotifyCluster(supabase, cluster.ip_at_creation, clusterId);
```

**Optional follow-ups mentioned, not confirmed run:**
- Revert the sweep interval to 45 minutes (or keep 5 minutes only once the lock above is in place).
- IPv4-first flag, for the `fetch failed` / `error 111` connection blips seen in the log:
  ```bash
  pm2 restart mediacrater-api --update-env --node-args="--dns-result-order=ipv4first"
  ```

> **⚠️ Status: not fully confirmed.** Grok's own session explicitly stated nothing above had been deployed yet — only diagnosed. The 19:19 update showed no more insert-storm errors, which is *consistent with* this having been deployed at some point, but the transcript never shows the actual deploy commands, and a stray `[ABUSE] Resolution peer check failed: Gateway Timeout` line still turned up later (see Phase 2, step 9's log dump). **Worth explicitly re-verifying** the SQL and both code patches are actually live before considering Phase 1 closed.

---

## Phase 2 — Clean, error-free restarts (diagnosed and fixed with Claude)

Picked up from: server still restarting periodically, but with **no errors at all** — just the Node.js 18 deprecation warning and `Mediacrater Video API running on port 3000`. A clean, silent restart like this means something *external* is asking the process to stop — not a crash.

### Step 1 — Added shutdown tracing, since nothing was logging *why* it stopped

`server.js`, added near the top:
```javascript
function logShutdown(signal) {
  console.error(
    `[SHUTDOWN] Received ${signal} at ${new Date().toISOString()} | uptime: ${process.uptime().toFixed(1)}s | pid: ${process.pid}`
  );
}
process.on('SIGTERM', () => { logShutdown('SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { logShutdown('SIGINT'); process.exit(0); });
process.on('exit', (code) => {
  console.error(`[SHUTDOWN] process exiting with code ${code} at ${new Date().toISOString()}`);
});
```
**Status: deployed** — confirmed later, this handler's `[SHUTDOWN]` lines do appear in the logs.

### Step 2 — Ruled out internal/scheduled triggers

```bash
crontab -l
sudo crontab -l
systemctl list-timers --all --no-pager
pm2 jlist | jq '.[] | select(.name=="mediacrater-api") | {cron_restart: .pm2_env.cron_restart, max_memory_restart: .pm2_env.max_memory_restart, restart_delay: .pm2_env.restart_delay, exp_backoff_restart_delay: .pm2_env.exp_backoff_restart_delay, watch: .pm2_env.watch}'
tail -n 200 ~/.pm2/pm2.log | grep -i -E "mediacrater-api|restart|stop|SIGTERM|SIGKILL"
grep -rn "process.exit\|pm2 restart\|pm2 reload" /var/www/mediacrater-api --include=*.js | grep -v node_modules
```

**Findings:**
- `crontab -l` (own user): empty.
- `sudo crontab -l` (root): found the actual trigger —
  ```
  */5 * * * * curl -sf https://host.mediacrater.com/health || pm2 restart mediacrater-api
  ```
- `systemctl list-timers`: nothing app-relevant, all standard OS timers.
- `pm2 jlist`: `cron_restart`, `max_memory_restart`, `restart_delay`, `exp_backoff_restart_delay` all `null`, `watch: false` — ruled out pm2-level auto-restart settings.
- `pm2.log`: every restart was `Stopping app:mediacrater-api id:0` → `exited with code [0] via signal [SIGINT]` → restart. A **requested** stop, not a crash — confirming the cron job above as the source.
- No app code calls `process.exit`/`pm2 restart` on its own (aside from the new shutdown handler and `slackLogger.js`'s existing SIGINT-flush).

### Root cause: the restart cron's `/health` check queried the database

```bash
grep -n -A15 "app.get('/health'" /var/www/mediacrater-api/server.js
```
showed `/health` doing a live `profiles` query before responding — the same hot table the abuse sweep uses. Any DB slowness (including from the Phase 1 sweep) could fail the health check and trigger a restart of an otherwise-healthy process, killing in-flight scans for no real reason.

### Step 3 — Split liveness from readiness

Renamed the DB-dependent check to `/health/db` (unchanged logic), and added a genuinely dependency-free `/health`, placed directly above it in `server.js`:

```javascript
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/health/db', async (req, res) => {
  try {
    const { error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      return res.status(503).json({
        status: 'degraded',
        message: 'Server unreachable',
        error: 'Service unavailable. Please Try again later.'
      });
    }

    res.json({ status: 'ok', message: 'Mediacrater API running', supabase: 'connected' });
  } catch (error) {
    res.status(503).json({ status: 'error', message: 'Service unavailable' });
  }
});
```
**Status: deployed** — confirmed by pasted `server.js` showing both routes correctly split.

### Step 4 — Hardened the cron (recommended)

```
*/5 * * * * curl -sf --max-time 5 https://host.mediacrater.com/health || pm2 restart mediacrater-api
```
`--max-time 5` stops a hung curl from bleeding into the next 5-minute tick. **Status: recommended, not confirmed applied yet** (superseded in importance by Step 6 below, since the `pm2 restart` target itself turned out to be wrong).

### Verification run at this point

```bash
for i in 1 2 3 4 5; do curl -sf -o /dev/null -w "%{http_code} %{time_total}s\n" https://host.mediacrater.com/health; sleep 2; done
curl -sf -o /dev/null -w "%{http_code} %{time_total}s\n" http://localhost:3000/health
grep -n "SHUTDOWN" ~/.pm2/logs/mediacrater-api-error.log | tail -20
```
- `/health` over Cloudflare: five clean `200`s, 0.1–0.27s each.
- `/health` on localhost: `200`, 0.09s.
- **`SHUTDOWN` grep came back empty** — despite the handler being deployed. This was the first clue toward Step 5.

Also reported at this point: needing `sudo pm2 restart` *and then* a plain `pm2 restart` to reliably make a restart "take."

### Step 5 — Discovered two separate PM2 daemons running two copies of the same app

```bash
sudo lsof -i :3000
sudo ss -ltnp | grep :3000
sudo pm2 list
pm2 list
systemctl list-units --type=service | grep -i pm2
```

**Findings:**
| Daemon | id | PID | User | Restarts | Bound to :3000? |
|---|---|---|---|---|---|
| root's (`sudo pm2`) | 1 | 2519397 | root | 35 | **No** |
| own (`pm2`) | 0 | 2519467 | echobeehive223 | 23 | **Yes** |
| own (`pm2`) | 1 | 2472785 | echobeehive223 | 123 | n/a (`mediacrater-api-test`) |

Two systemd units confirmed both daemons persist across reboot: `pm2-echobeehive223.service`, `pm2-root.service`.

`lsof`/`ss` were unambiguous: **only the `echobeehive223` copy (PID 2519467) was actually serving traffic.** Root's copy of `mediacrater-api` was a live, fully-functional, but silently redundant duplicate — running its own Slack logger, its own abuse sweep, its own shutdown handler — just never bound to the real port.

Before deleting anything, ran one more free confirmation:
```bash
sudo pm2 logs mediacrater-api --lines 30 --nostream
```
This confirmed root's copy exits cleanly (`[SHUTDOWN] Received SIGINT ... exiting with code 0`) and restarts successfully every time — a genuine second instance, not a crash loop. This explained the `sudo pm2 restart` → `pm2 restart` workaround: the `sudo` version had only ever been restarting the phantom, and the plain version was the one actually reaching the real, internet-facing process. It also explained why the `SHUTDOWN` grep came back empty on `~/.pm2/logs/...` — those lines had been landing in `/root/.pm2/logs/...` instead.

### Step 6 — Removed the phantom, one command at a time with verification between each

```bash
# 1. Delete root's redundant copy
sudo pm2 delete mediacrater-api

# 2. Verify the real process (PID 2519467) is untouched
sudo lsof -i :3000
```
Confirmed: root's app list came back empty; PID `2519467` still bound to :3000, unaffected.

```bash
# 3. Persist the deletion so pm2-root.service can't resurrect it on reboot
sudo pm2 save

# 4. Confirm
sudo pm2 list
```
**Status of steps 3–4: instructed, not yet confirmed run in this transcript — verify these were actually executed.**

### Step 7 — Crontab fix (recommended)

Since root's daemon no longer has `mediacrater-api` registered, root's crontab needs to target the correct daemon explicitly:
```bash
sudo crontab -e
```
Change:
```
*/5 * * * * curl -sf --max-time 5 https://host.mediacrater.com/health || pm2 restart mediacrater-api
```
to:
```
*/5 * * * * curl -sf --max-time 5 https://host.mediacrater.com/health || sudo -u echobeehive223 pm2 restart mediacrater-api
```
**Status: recommended, not yet confirmed applied.**

### Confirmed end state

Restarting the live app going forward is just:
```bash
pm2 restart mediacrater-api
```
No `sudo` needed — the only reason the `sudo` variant ever seemed necessary was the phantom root-owned copy, which no longer exists.

---

## Open items / worth re-checking

1. **Re-verify Phase 1 deployment.** Confirm the SQL cleanup + unique index on `flagged_ip_clusters`, the sweep lock, and the lookup-error-before-insert code are actually live — a stray `[ABUSE] Resolution peer check failed: Gateway Timeout` line was still seen in one of the later log pulls.
2. **Confirm `sudo pm2 save`** was run after deleting root's phantom (Step 6, commands 3–4 above) — without it, a reboot could bring the duplicate back via `pm2-root.service`.
3. **Update root's crontab** (Step 7) to restart via the correct user, and add `--max-time 5` to the health-check curl if not already done.
4. **Optional, not yet applied:** revert the abuse sweep interval to 45 minutes (or confirm 5 minutes is fine now that the lock exists), and consider the `--dns-result-order=ipv4first` flag if the `fetch failed` / `error 111` connection blips recur.
5. **Consider monitoring `/health/db` separately** (e.g. from an uptime service) now that the restart cron only checks the lightweight `/health`.
