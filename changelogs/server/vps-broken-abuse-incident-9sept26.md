# Mediacrater live abuse-sweep incident

**Date:** 2026-09-09  
**Environment:** live VPS `srv1411064` (`/var/www/mediacrater-api`, pm2 process `mediacrater-api`)  
**Not affected:** test (`/var/www/mediacrater-api-test`, pm2 process `mediacrater-api-test`)  
**Symptom:** `[ABUSE] Resolution peer check failed: Gateway Timeout` plus what looked like the VPS rebooting day and night.

This file is the ordered record of what we found, what was run on the box, and what to change. It is not a deploy log — code/SQL listed under “Apply these” still has to be applied on live.

---

## 1. Summary (read this first)

The **machine was not rebooting**. Only the live Node process was dying (`restart_time` 19 → 21, `exit_code: 0`). Test on the same box had `restart_time: 0`.

The 504 was not a mystery “peer node.” It is this query in `abuseDetection.js` → `resolveClearedClusters()`:

```js
const { data: peers, error: peerError } = await supabase
  .from('profiles')
  .select('id')
  .eq('ip_at_creation', ip)
  .eq('plan', 'free')
  .neq('id', acc.id)
  .limit(1);

if (peerError) {
  console.error('[ABUSE] Resolution peer check failed:', summarizeError(peerError));
}
```

Live Supabase (`https://wwnpgzgvwsbdipysvobb.supabase.co`) was being **hammered by the abuse sweep**, which:

1. Runs every **5 minutes** (comments and `server.js` still say 45 minutes).
2. Has **no re-entrancy lock**, so overlapping sweeps stack.
3. Treats a failed `maybeSingle()` as “this IP is brand new” and **inserts another `flagged_ip_clusters` row**.

Concrete proof: IP `45.84.107.97` (QuxLabs AB, **2 bot accounts**) had **80+ cluster rows** with different IDs. The error log printed `New IP cluster flagged: 2 accounts sharing IP 45.84.107.97` dozens of times in a row.

That insert/lock storm is why live returned `Gateway Timeout`, `TypeError: fetch failed`, and Envoy `delayed connect error: 111`. Test never entered the loop (no real locked clusters).

---

## 2. Timeline (everything in order)

### 2.1 Report

Live-only log line:

```text
[2026-09-09T16:45:15.120Z] [ABUSE] Resolution peer check failed: Gateway Timeout
```

Plus “VPS randomly restarting” day and night. Test environment did not show it.

### 2.2 Code that produces that line

User pasted `abuseDetection.js` (extracted from `server.js`). Relevant facts from the file:

| Item | Value |
|---|---|
| Interval constant | `IP_CHECK_INTERVAL_MS = 5 * 60 * 1000` (**5 minutes**) |
| Comments / `server.js` | still say **45-minute** cycle |
| Start behaviour | `setInterval(runSweep, …)` **and** `runSweep()` immediately on process start |
| Lock | none — a second sweep can start while the first is hung |
| Detection RPC | `detect_duplicate_free_ips`, retry once after 30s |
| Cluster lookup | `.maybeSingle()` — **error ignored** |
| Peer check | one `profiles` query **per locked account** (N+1) |

User also pasted live `server.js`:

- Same Supabase client for scans, `/health`, auth, **and** the sweep.
- `initAbuseDetection(supabase)` runs **before** `app.listen`.
- `express.json({ limit: '150mb' })`.
- `connect-timeout('280s')` applies to HTTP requests only, **not** to `setInterval`.
- `authenticateUser` writes `last_active_platform` on every authenticated call (including `/queue-status` polls every 3s).

Frontends cloned for comparison (Vercel only — the sweep does **not** live here):

- Live site: `https://github.com/mediacrater/site-vercel`
- Test site: `https://github.com/mediacrater/test-site-vercel`
- Live Supabase project ref: `wwnpgzgvwsbdipysvobb`
- Test Supabase project ref: `bguzibvmgmcdeqemrdco`

### 2.3 First VPS commands (live process)

Ran as `echobeehive223@srv1411064:/var/www/mediacrater-api`:

```bash
pm2 show mediacrater-api
dmesg -T | grep -i 'killed process'
journalctl -u pm2 --since "2 days ago" | grep -i restart
```

**Result (live):**

| Field | Value |
|---|---|
| status | online |
| restarts | **19** |
| uptime | **97s** |
| created at | `2026-09-09T18:49:06.252Z` |
| script | `/var/www/mediacrater-api/server.js` |
| heap | ~14 MB / 17 MB (fresh process, almost no traffic) |
| HTTP | 0.02 req/min |
| `dmesg` | `Operation not permitted` (user not allowed to read kernel buffer) |
| `journalctl` | no access (`adm` / `systemd-journal` required) |

`profiles_ip_plan_idx` was proposed as a **Postgres index** (not a new column) on existing `ip_at_creation` + `plan`. It is **optional** if the N+1 peer query is batched. It was **not** required to explain the 80 duplicate cluster rows.

### 2.4 Full pm2 dump (live + test)

`pm2 jlist` / prettylist for both processes.

| | `mediacrater-api` (live) | `mediacrater-api-test` |
|---|---|---|
| cwd | `/var/www/mediacrater-api` | `/var/www/mediacrater-api-test` |
| `restart_time` | **21** | **0** |
| `exit_code` | **0** (clean / SIGTERM, not OOM) | never exited |
| `unstable_restarts` | 0 | 0 |
| `autorestart` | true | true |
| `watch` | false | false |
| heap | ~18–24 MB | ~15–22 MB |
| HTTP | 0.01 req/min, p95 ~640 ms | none |
| Secrets in pm2 env | none (dotenv `.env`) | none (dotenv `.env`) |

**Conclusion from this dump:** if the **VPS** were rebooting, test would have restarted too (`autostart: true` on both). Only live Node is being relaunched. OOM would be exit **137**, not 0. Heap is tiny — this is not 150 MB scan bodies killing the box.

`restart_time` moved 19 → 21 while we were debugging (manual `pm2 restart` / process coming back). That is part of the 21, not 21 mystery kernel panics.

### 2.5 Error log + live `SUPABASE_URL`

```bash
grep -n -E 'ABUSE|exit|SIGTERM|EADDRINUSE|uncaught|Unhandled' \
  ~/.pm2/logs/mediacrater-api-error.log | tail -80
```

```bash
grep '^SUPABASE_URL=' /var/www/mediacrater-api/.env
```

**Live URL (correct, not a Cloudflare custom hostname):**

```text
SUPABASE_URL=https://wwnpgzgvwsbdipysvobb.supabase.co
```

**Log highlights (line numbers from that grep):**

| Lines | What |
|---|---|
| 7 | `[ABUSE] Detection query failed: TypeError: fetch failed` |
| 3221–3232 | Lock then **immediately auto-unlock** the same IP (`70.30.221.39`) |
| 3263–3268 | `upstream connect error … delayed connect error: 111` (ECONNREFUSED via Supabase’s proxy) on both detection RPC and resolution fetch |
| 3318–3355 | **`New IP cluster flagged: 2 accounts sharing IP 45.84.107.97` repeated ~27 times in a row** |
| 3356–3363, 3380–3388 | Auto-unlocks of Tor / hosting IPs (`185.220.*`, `192.42.116.*`, `107.189.30.*`) |
| 3372–3373 | `Locked 2 account(s) for IP 162.158.127.106` — **Cloudflare edge** (`162.158.0.0/15`), i.e. `getClientIp()` stored the proxy |

### 2.6 Table confirmation

User checked `flagged_ip_clusters`: **≥ 80 rows** for `45.84.107.97`, each with a different `id`.  
ASN for that IP: **QuxLabs AB**. Only **2 accounts** actually use it (bots). The extra 78+ rows are the sweep, not new bots.

### 2.7 Code-order clarification

A draft that checked `if (!existing)` **before** `existingError` would still insert row 81. Lookup **error must be handled first**. The `insert …` in an earlier note was shorthand, not code — the real insert is the existing `.insert({ ip_address, account_count, notified: false })` block.

---

## 3. Root cause (short)

```
5-minute unlocked setInterval
  → overlapping runSweep()
    → maybeSingle() error ignored when duplicates already exist
      → INSERT another flagged_ip_clusters row every cycle
        → 2 QuxLabs bots → 80+ rows for one IP
          → live PostgREST / pool / Cloudflare in front of supabase.co time out
            → [ABUSE] Resolution peer check failed: Gateway Timeout
```

Secondary bugs in the same module:

- **Lock/unlock flap:** `checkForAbusiveIPs()` locks, then `resolveClearedClusters()` in the same turn unlocks (“no free peers remain”) because the peer query does not match the comment (comment: *another free, still-locked* account; code: *any other free* account).
- **False-positive IPs:** Cloudflare `162.158.*` and Tor exits stored as `ip_at_creation` when `cf-connecting-ip` is missing.
- **`server.js` comment drift:** still documents a 45-minute interval.

Why **live only:** test’s `resolveClearedClusters` returns immediately when there are no `action_required` rows; test never inserts duplicate clusters; test Supabase is not under this write storm.

Why **restarts looked like a VPS reboot:** pm2 `autorestart: true` on live, `exit_code: 0`. Test never died, so the host stayed up. Some of the 21 restarts were investigation (`created at` 18:49Z, 97s uptime). The 504 path is try/catch’d and does **not** by itself `process.exit`.

---

## 4. Commands already run on the VPS

All as user `echobeehive223` on `srv1411064`.

```bash
# 1. Process status (live). Restarts=19, uptime=97s, created=2026-09-09T18:49:06.252Z
pm2 show mediacrater-api

# 2. Kernel OOM? Denied — not in adm / cannot read dmesg.
dmesg -T | grep -i 'killed process'

# 3. systemd pm2 unit history? Denied — not in systemd-journal.
journalctl -u pm2 --since "2 days ago" | grep -i restart

# 4. Full dump of live + test (restart_time 21 vs 0, exit_code 0)
#    (pm2 jlist / prettylist — pasted in chat)

# 5. Abuse / crash lines in live error log
grep -n -E 'ABUSE|exit|SIGTERM|EADDRINUSE|uncaught|Unhandled' \
  ~/.pm2/logs/mediacrater-api-error.log | tail -80

# 6. Confirm live Supabase host (do not dump the service-role key)
grep '^SUPABASE_URL=' /var/www/mediacrater-api/.env
# → SUPABASE_URL=https://wwnpgzgvwsbdipysvobb.supabase.co
```

**Restarts during this incident**

| When (UTC) | What |
|---|---|
| `2026-09-09T18:49:06Z` | Live process start recorded by `pm2 show` (`created at`), uptime 97s when inspected ~18:52Z |
| Between first `pm2 show` and jlist | `restart_time` 19 → 21 (investigation / autorestart) |
| Historical | 21 live restarts vs **0** test restarts on the same host |

Suggested but **not confirmed run** in this thread:

```bash
pm2 restart mediacrater-api --update-env --node-args="--dns-result-order=ipv4first"
```

That is optional (Node 18 + `fetch failed` / ECONNREFUSED 111). Only do it after the code/SQL fixes, and record it here if you run it.

Log paths:

- Live out: `/home/echobeehive223/.pm2/logs/mediacrater-api-out.log`
- Live err: `/home/echobeehive223/.pm2/logs/mediacrater-api-error.log`
- Test err: `/home/echobeehive223/.pm2/logs/mediacrater-api-test-error.log`

---

## 5. Apply these — database (live Supabase)

Run in order. Step 3 is what actually stops row 81.

```sql
-- A. See duplicate cluster rows
select ip_address, count(*) as rows
from flagged_ip_clusters
group by 1
having count(*) > 1
order by rows desc;

-- B. Point profiles at the canonical (earliest) cluster row per IP
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

-- C. Delete the duplicate cluster rows
delete from flagged_ip_clusters f
using (
  select distinct on (ip_address) id as keep_id, ip_address
  from flagged_ip_clusters
  order by ip_address, id
) k
where f.ip_address = k.ip_address
  and f.id <> k.keep_id;

-- D. Make a second insert for the same IP impossible
create unique index if not exists flagged_ip_clusters_ip_uq
  on flagged_ip_clusters (ip_address);
```

Optional (only if you keep the per-account peer query):

```sql
create index concurrently if not exists profiles_ip_plan_idx
  on profiles (ip_at_creation, plan)
  where ip_at_creation is not null;
```

This is an **index**, not a new column. It does not change `profiles` shape.

---

## 6. Apply these — `abuseDetection.js`

### 6.1 Sweep lock (do this; put the interval back to 45 min until stable)

Replace the interval helper so a second sweep cannot start:

```js
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

Also restore:

```js
const IP_CHECK_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes — matches server.js comment
```

(Keep 5 minutes only after the lock + unique index are in and the log is quiet.)

### 6.2 Cluster lookup — error **before** insert

Replace the `maybeSingle` / insert block in `checkForAbusiveIPs` with this, exactly. Do not check `if (!existing)` first.

```js
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

After the unique index exists, a raced second insert becomes `insertError` (already handled) instead of another row.

### 6.3 Still recommended, not pasted as a full patch in this thread

- Do **not** auto-unlock in the same turn you locked. Run resolution on the next interval, or require another **locked** free peer (the file comment already says this; the query does not).
- Batch the peer check to one `.in('ip_at_creation', ips)` instead of one query per locked account.
- `getClientIp()`: never persist `162.158.0.0/15` (Cloudflare) or known Tor exits as `ip_at_creation`.

---

## 7. Optional follow-ups (not done in this thread)

```bash
# Node 18 happy-eyeballs / IPv6: TypeError fetch failed + connect error 111
pm2 restart mediacrater-api --update-env --node-args="--dns-result-order=ipv4first"

# After deploy of abuseDetection.js
cd /var/www/mediacrater-api
pm2 restart mediacrater-api

# Confirm the unique index and leftover dupes
# (SQL editor on live project wwnpgzgvwsbdipysvobb)
```

```sql
select ip_address, count(*) as rows
from flagged_ip_clusters
group by 1
having count(*) > 1;
-- expect: 0 rows
```

```bash
grep 'New IP cluster flagged' ~/.pm2/logs/mediacrater-api-error.log | tail
# same IP must not repeat unless it is genuinely first-time
```

---

## 8. What we explicitly did **not** change

- Live `SUPABASE_URL` — already the raw project URL; left as-is.
- Test process / test Supabase — not involved.
- `autorestart: true` — leave on; it is why live comes back, not why it dies.
- No new `profiles` column.
- Frontends `site-vercel` / `test-site-vercel` — no sweep code there.
- Did not get kernel OOM proof (`dmesg` / `journalctl` permission denied).

---

## 9. Files involved

| Path | Role |
|---|---|
| `/var/www/mediacrater-api/abuseDetection.js` | Sweep, the 504 log line, duplicate inserts |
| `/var/www/mediacrater-api/server.js` | `initAbuseDetection(supabase)`, still says 45-min interval |
| `/var/www/mediacrater-api/.env` | `SUPABASE_URL=https://wwnpgzgvwsbdipysvobb.supabase.co` |
| Live table `flagged_ip_clusters` | 80+ rows for `45.84.107.97` |
| Live table `profiles` | `ip_at_creation`, `account_status`, `flagged_cluster_id` |
| pm2 `mediacrater-api` | 21 restarts, exit 0 |
| pm2 `mediacrater-api-test` | 0 restarts |

---

## 10. Quick “is it fixed?” checklist

1. Unique index `flagged_ip_clusters_ip_uq` exists.
2. Duplicate query in §5.A returns **no rows**.
3. `45.84.107.97` has **exactly one** cluster row.
4. Error log: no more repeated `New IP cluster flagged` for an IP that already exists.
5. Error log: `Previous sweep still running, skipping` appears if a sweep overruns (lock works).
6. `[ABUSE] Resolution peer check failed: Gateway Timeout` stops on live.
7. Test still at `restart_time: 0`; live restarts only when you `pm2 restart` after a deploy.
