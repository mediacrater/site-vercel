# Security Review – Phase 1: VPS Lockdown, Scan-Route Hardening, Supabase Privileges, Origin Protection & Drift Monitor

| | |
|---|---|
| **Date** | 7 October 2026 (`07oct26`) |
| **Conversation** | https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d |
| **Related prior work** | None referenced in this conversation |
| **Stack** | Next.js web app on Vercel (TEST repo `mediacrater/test-site-vercel`), Node/Express API on the VPS behind nginx + Cloudflare (PM2: `mediacrater-api` LIVE on `:3000`, `mediacrater-api-test` TEST on `:3001`), Supabase (**separate projects for TEST and LIVE**), Stripe (Edge Functions), drift monitor (systemd, `:3876`) |
| **Starting trigger** | You asked for a review of the project's security: what was done wrong and what was done right. Phase 1 (VPS lockdown) was ranked hardest and implemented first |

> **Redaction note:** no secrets, keys, IP addresses, user IDs or email addresses are included. `<VPS_PUBLIC_IP>`, `<tools hostname>`, `<test web origin>`, `<origin secret>` and `<project-ref>` stand in for them.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied (expected output is given). ⏳ = open.

> **Files:** every final file referenced here is in the `phase1/` folder delivered with this index (`server.js`, `rateLimiter.js`, `routes/…`, `security/…`, `utils/netGuard.js`, `sql/…`, `nginx/…`). [Appendix A](#appendix-a--live-rollout-runbook) is the step-by-step LIVE rollout.

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
9. [Appendix A – LIVE rollout runbook](#appendix-a--live-rollout-runbook)
10. [Appendix B – SQL](#appendix-b--sql)
11. [Appendix C – Code changes](#appendix-c--code-changes)
12. [Appendix D – nginx, Cloudflare and systemd](#appendix-d--nginx-cloudflare-and-systemd)
13. [Appendix E – Verification and troubleshooting commands](#appendix-e--verification-and-troubleshooting-commands)
14. [Appendix F – Rollback and maintenance](#appendix-f--rollback-and-maintenance)

---

## 1. Summary

The review found a mix of strong work and real gaps. Phase 1 closed the gaps on the VPS, in Supabase, and on the server itself. **TEST is complete. LIVE has the server-wide parts (Node 24, nginx origin secret, firewall, drift monitor), but not yet the Phase 1 API code or SQL** ([Appendix A](#appendix-a--live-rollout-runbook)).

**Main outcomes**

- **The VPS defends itself.** Every user route already verified the Supabase token; Supabase outages now return 503 instead of 401 (users aren't signed out), and the scan routes no longer call `getUser` a second time.
- **Queue hijack closed.** `scanVideo.js` / `scanImage.js` accepted anyone's running job ID (`isJobRunning(incomingJobId)`); job IDs are sequential, so this let one account skip the queue and run scans in parallel against one balance. All four scan routes now use `claimRunningJob(jobId, userId)` (owner only, once). `/queue-status` and `/queue-timing` are scoped to the caller.
- **Scan deduction is atomic** (`deduct_scans` RPC, negative costs rejected, callable by `service_role` only).
- **SSRF hardened.** One shared definition of "private address" (ipaddr.js) for `resolve-url`, the URL scan routes and the ffprobe proxy; DNS-rebinding-safe pinned fetch; redirects re-checked; ports 80/443 only.
- **Input checks on scan routes:** platform allowlist (from `policies/`), frame shape, image size cap (20 MB default), audio MIME type, scan type, scan ID and thumbnail path.
- **Slack log injection fixed** (`logSafe`), and the CORS diagnostic can no longer be used to hammer Supabase Auth.
- **Dead payment code removed:** VPS `/checkout/create` (unauthenticated, used the service-role key), Edge Functions `create-checkout`, `create-checkout-extension`, `verify-session`, and the web pages `buy-tokens` and `purchase-success`.
- **Supabase (TEST):** the open INSERT policy on `scans` dropped; anon-callable `check_and_log_form_attempt` and others revoked; table privileges for `anon` / `authenticated` reduced to what RLS policies allow.
- **Server:** Node 24 (undici needs ≥ 22.19); nginx only accepts requests carrying a secret header added by **your** Cloudflare zone (TEST and LIVE); SSH rate-limited; drift monitor bound to `127.0.0.1`, running as your user on Node 24 instead of root on Node 20.

**Confirmed already good:** RLS on every table, users can't edit `profiles` (no UPDATE policy), SSH key-only, Cloudflare-only firewall on 80/443, nginx real-IP restoration, `server_tokens off`, the ffprobe CONNECT proxy, `scanFeedback.js` and `resolveClientBatch.js` ownership checks, `create-checkout-webapp` identity handling, Stripe webhook signature + replay window.

**Most important open item outside the LIVE rollout:** the Stripe webhook takes the plan from subscription **metadata**, not from the price paid. You just enabled plan switching in the TEST customer portal, which makes this exploitable in TEST (subscribe Agency → switch to Startup → keep 1,000 scans/month). Fix before enabling it in LIVE ([§7](#7-open-items-checklist)).

---

## 2. Status at a glance

### TEST VPS (`/var/www/mediacrater-api-test`)

| Area | Status | Notes |
|---|---|---|
| `server.js` (Phase 1 final) | ✅ Deployed | `/checkout/create` returns Express's 404 page |
| `rateLimiter.js` (atomic deduction) | ✅ Deployed | `deduct_scans` exists in TEST DB (audit 3a) |
| All four scan routes + `scanIdentity.js` | ✅ Deployed | Scans work |
| `scanIdentity.js` thumbnail fix (own-folder UUID) | ⚠️ Not confirmed | Expected: a new paid-plan scan shows its thumbnail in history |
| `utils/netGuard.js` (ipaddr-backed) | ✅ Deployed | |
| `security/ssrf.js` + `npm i undici ipaddr.js` | ✅ Deployed | App runs on Node 24 |
| `node --test security/ssrf.test.js` | ✅ 28/28 | Run with `/usr/local/bin/node`; your shell was still on nvm's Node 20 |
| `npm audit fix` | ✅ | `proxy-addr`, `body-parser`, `qs` fixed; 4 scan types pass afterwards |
| `uuid@8.3.2` (direct dependency, moderate) | ✅ Removed | Not used anywhere (`grep` found nothing); `npm uninstall uuid`. Both PM2 apps restarted cleanly |
| `npm audit --omit=dev` after the fixes | ⚠️ Not shown | Expected: `found 0 vulnerabilities` |
| `checkout.js` deleted | ✅ | 404 confirmed |
| `npm uninstall node-fetch` | ✅ | `up to date`: `node-fetch` was never a TEST dependency |
| `MAX_IMAGE_MB` in `.env` | ⚠️ Default 20 | Set above your largest real image |
| `SSRF_BLOCKED_IPS` in `.env` | ⚠️ Not set | Optional: the VPS's own public IPv4/IPv6 |

### LIVE VPS (`/var/www/mediacrater-api`)

| Area | Status | Notes |
|---|---|---|
| Node 24 | ✅ | Upgrade caused a crash loop (`node-fetch`), fixed ([§5](#5-errors-and-surprises) #9) |
| `node-fetch@2` reinstalled | ✅ | Temporary; removed with `checkout.js` in the rollout |
| nginx origin secret | ✅ | `exit 52` without the header, `{"status":"ok"}` through Cloudflare |
| Phase 1 API code | ⏳ | [Appendix A](#appendix-a--live-rollout-runbook) |

### Supabase

| Area | TEST | LIVE |
|---|---|---|
| `deduct_scans` (phase1.sql block 1) | ✅ | ⏳ |
| Drop `"Service role can insert scans"` | ✅ | ⏳ |
| Function revokes (part2 block 3) | ✅ | ⏳ |
| Table privilege revokes (part2 block 4) | ✅ (sign-up works afterwards) | ⏳ |
| Re-run audit 3c to confirm grants | ⚠️ | ⏳ |
| `initialize_extension_entitlements` from `authenticated` | ⏳ Optional | ⏳ Optional |

### Edge Functions and Stripe

| Area | Status | Notes |
|---|---|---|
| `create-checkout`, `create-checkout-extension` deleted | ✅ | ⚠️ Confirm in **both** Supabase projects |
| `verify-session` deleted | ✅ | Read-only status poller with no callers. ⚠️ Confirm in both projects |
| `create-checkout-webapp` | ✅ Reviewed | Identity from token only. Error text passthrough → Phase 5 |
| `stripe-webhook` plan from metadata | ⏳ **Exploitable in TEST** | Portal plan switching now on in TEST |
| `stripe-webhook` invoice field location | ⏳ Unknown | Depends on the endpoint's API version |

### Server and infrastructure (shared by TEST and LIVE)

| Area | Status | Notes |
|---|---|---|
| ufw: 80/443 from Cloudflare ranges only | ✅ | Origin curl from home: exit 28 |
| SSH key-only, no root login | ✅ | `sshd -T` |
| `ufw limit 22/tcp` | ✅ | IPv4 and IPv6 show `LIMIT` |
| nginx real-IP (`cloudflare-realip.conf`) | ✅ | Matches ufw list |
| `server_tokens off` | ✅ | |
| Origin secret (Transform Rule + snippet) | ✅ | TEST and LIVE `exit 52`; normal path OK |
| Drift monitor on `127.0.0.1:3876` | ✅ | |
| Drift monitor as `echobeehive223` on Node 24 | ✅ | systemd override |
| Drift monitor login | ✅ | `401` without credentials |
| `nvm use 24 && nvm uninstall 20` | ⚠️ Not confirmed | First attempt refused (Node 20 was active). Expected afterwards: `node -v` → `v24.21.0` in a new terminal |
| Drift monitor base unit still names nvm Node 20 | ⚠️ Not confirmed | Override already replaces it. Expected after the `sed`: `grep -rn v20.20.2 /etc/systemd/system/ ~/mediacrater-drift-monitor-live/*.service` prints nothing |

### Web app (TEST repo)

| Area | Status | Notes |
|---|---|---|
| Next.js 16.4.0, `npm audit` 0 vulnerabilities | ✅ | Lockfile regenerated correctly |
| `.gitignore` has `.env*` and `.vercel` | ✅ | |
| `buy-tokens`, `purchase-success`, `deployment.md` deleted | ✅ | Commits `055acdd`, `75d3c5c`, `6c1996f` |
| Leaked `sb_secret_…` key | ✅ Rotated (your report) | ⚠️ Confirm the old key is gone from the API Keys list |
| Delete `app/api/[...path]/route.ts` | ⏳ | Still in the repo |
| `lib/mediacrater/scanApi.ts` (`encodeURIComponent(jobId)`) | ⏳ | Not applied yet |
| Delete `pnpm-lock.yaml` stub | ⏳ | Still in the repo |

---

## 3. Starting point

- **Web app** (Next.js on Vercel): a middleware proxy-secret gate on `/api/*`, DB-backed atomic rate limiting that fails closed, server-side Turnstile, httpOnly device cookie, Slack escaping. No security headers, `ignoreBuildErrors: true`, raw error passthrough, IP-only rate limits.
- **Initial findings (round 1):** a real `sb_secret_…` key in git history (commits `9f07973`, `941d87d`), Next.js 16.0.10 behind several advisories, `/buy-tokens` trusting `userId`/`email` from the URL, the VPS URL public with the scan API called directly from the browser, no security headers, the contact form keying on the wrong IP, an unused `/db` rewrite, a Host-header-derived reset link, no input validation, raw errors, IP-only limits.
- **VPS:** Express on `127.0.0.1` behind nginx, nginx behind Cloudflare. It already had `authenticateUser`, a per-user `requestLimit`, a redirect-checking SSRF guard, a one-active-scan-per-user queue, and a well-built ffprobe proxy.
- **One server runs both environments** (one Node install for PM2, one PM2 daemon, one nginx). Your shell additionally used an nvm Node 20.
- **Supabase:** RLS on every table, but `anon`/`authenticated` held every privilege (incl. `TRUNCATE`) on every table, some `security definer` functions were anon-callable, and `scans` had an INSERT policy open to everyone.

---

## 4. Timeline: what we did, in order

### Step 1 – Review

I cloned the repo and reviewed the middleware, rate limiter, API routes, client code, git history and `npm audit`. Findings were grouped as critical (leaked key), high, medium and low, plus what was done right.

### Step 2 – Your fixes, and the ranking

- **Key:** you reported it was already rotated. Caveat: Supabase secret keys can coexist, so the old one must be **deleted**, not just superseded.
- **Next.js:** upgraded to 16.4.0. I verified the lockfile (`integrity` matched the registry, transitive `postcss`/`sharp` updated, `npm audit` 0). The `pnpm-lock.yaml` left behind is a 4-line stub; delete it.
- **`/buy-tokens`:** deleted (extension no longer handles payments).
- **Password minimum:** stays at 6 by your decision; Phase 8 covers where to set it in Supabase.

Ranking, hardest to easiest (phase numbers):

| Phase | Item |
|---|---|
| 1 | VPS lockdown (auth, ownership, SSRF, per-user limits, origin reachability) |
| 2 | Security headers / CSP |
| 3 | Per-email rate limits |
| 4 | Input validation (zod) |
| 5 | Generic error messages (same files as 4) |
| 6 | Password-reset link |
| 7 | Contact form IP + shared Turnstile helper |
| 8 | Supabase password setting |
| 9 | Remove the `/db` rewrite |

### Step 3 – Phase 1, first pass (before seeing the VPS code)

- **Correction to my round-1 advice:** the VPS URL isn't a secret (the extension ships it), and the web app sends base64 frames and audio larger than Vercel's 4.5 MB request limit, so proxying through Vercel isn't viable. The VPS must defend itself.
- Delivered generic drop-ins (`auth.js`, `rateLimit.js`, `ssrf.js`) with 31 tests, plus web-side changes: delete the unused `app/api/[...path]/route.ts`, and `encodeURIComponent(jobId)` in `scanApi.ts` (both ⏳).

### Step 4 – `server.js`, `rateLimiter.js`, `helpers.js`

Your existing code already covered auth and per-user limits, so I **dropped `auth.js` and `rateLimit.js`** and changed your files instead. Changes to `server.js` ([Appendix C](#appendix-c--code-changes)):

| Change | Why |
|---|---|
| `safeFetch` uses the pinned fetcher | `dns.lookup` then `fetch` did two lookups: DNS rebinding could pass the check and connect to `127.0.0.1` |
| `assertUrlPolicy` shared by first request and every redirect | Keeps HTTPS-only + host allowlist on each hop |
| `/queue-timing` validated and scoped (`.eq('user_id', req.user.id)`) | Any user could overwrite any job's timing with any value |
| `validatePlatform` on four scan routes | `loadPlatformPolicy` builds a file path from `req.body.platform` |
| `logSafe()` on client-controlled log values | `/log-client-error` text went to Slack unescaped (`<!channel>`, fake lines) |
| CORS diagnostic capped at 20 Supabase lookups/min, regex fixed | Unauthenticated callers could trigger unlimited `getUser` calls |
| `authenticateUser`: strict bearer parse, try/catch, 503 on outages | Outages returned 401 and signed users out |
| `/resolve-url` only shows our own error messages | DNS/TLS errors could leak internals |
| `app.disable('x-powered-by')` | Hides the framework |

`rateLimiter.js`: `commitScanDeduction` now calls `deduct_scans` (one atomic UPDATE). I first called the read-then-write race "the most impactful finding"; see [§6](#6-corrections--important-decisions) for how that changed.

`helpers.js`: unchanged. The platform path issue is fixed in `server.js` instead.

Testing: I booted your real `server.js` against a mock Supabase with stubs for files I hadn't seen (17 end-to-end tests, then up to 34), plus 28 SSRF unit tests.

### Step 5 – URL routes, queue, checkout, feedback, netGuard, limiter, first RLS audit

| File | Finding | Fix |
|---|---|---|
| `checkout.js` | `const { plan, userId, email } = req.body;` with no auth, then calls an Edge Function with the service-role key | Removed from `server.js`; file deleted |
| `queueManager.js` | `getJobStatus(jobId, userId)` already supported ownership; `server.js` didn't pass the user | `/queue-status` passes `req.user.id` |
| `scanVideoUrl.js` / `scanImageUrl.js` | Client `scanId` became the `scans` primary key unchecked; thumbnail path unchecked; deep scans checked as cost 1; second `getUser` | `scanIdentity.js`, cost passed, `req.user` used, URL errors explained |
| `utils/netGuard.js` | Missed 6to4, Teredo, IPv4-compatible IPv6, documentation ranges | Delegates to `ssrf.js` (same export) |
| `utils/probeVideoDuration.js` | **Good:** CONNECT proxy pins the checked IP, 443 only, byte cap, no `file` protocol, `execFile` | No change |
| `scanFeedback.js`, `requestLimiter.js` | **Good** | No change |
| Supabase `pg_policies` | `"Service role can insert scans"`: `INSERT`, roles `{public}`, `with_check true` | Dropped (the service role bypasses RLS anyway) |
| Supabase `profiles` | No UPDATE policy | **Good:** users can't edit `scans_remaining` / `plan` |

While testing I found ipaddr.js labels `::7f00:1` (IPv4-compatible `127.0.0.1`) as public, so `ssrf.js` now blocks all of `::/96`.

### Step 6 – Full audit and Phase 1 part 2 SQL

Audit 3a–3d results (TEST): RLS on for all 9 tables; `deduct_scans`, `check_and_log_rate_limit`, `free_cluster_usage`, the signup hook and `verified_user_ids` not anon-callable; storage policies limit thumbnails to the user's folder. Problems: `check_and_log_form_attempt` was `security definer` **and** anon-callable (anyone could lock real visitors out of a form); `anon`/`authenticated` held every privilege on every table. `phase1-part2.sql` fixes both ([Appendix B](#appendix-b--sql)).

Edge Functions reviewed: `create-checkout` accepted `userId`/`email` from the body (only check: `profile.email !== email`; Supabase's default JWT check accepts the public anon key). Deleted, along with `create-checkout-extension`.

### Step 7 – TEST crash loop (`File is not defined`) → Node upgrade

`undici` 8 needs Node ≥ 22.19. TEST's PM2 ran Node 20, so the app crashed at startup and nginx answered with a 502 that has no CORS headers; the browser reported a **CORS error** on `/resolve-url`. Fix: Node 24 for the PM2 install (`/usr/local/bin/node`), `npm rebuild`, `pm2 update`. `ssrf.js` now refuses to start on old Node with a readable message.

### Step 8 – LIVE outage after the Node upgrade

`pm2 update` restarted **both** apps on Node 24. LIVE crashed with `Cannot find module 'node-fetch'` (required by its `checkout.js`). Fix: `npm ls node-fetch`, `npm install node-fetch@2` (v3 is ESM-only and would return an object, not a function), `npm rebuild`, check for other missing modules, `pm2 restart mediacrater-api`, `pm2 save`. You confirmed LIVE stable and scans working.

### Step 9 – `scanVideo.js`, `scanImage.js`, `resolveClientBatch.js`

- **Queue hijack** (`isJobRunning(incomingJobId)` with no owner) → `claimRunningJob(incomingJobId, user.id)`.
- `scanImage.js` had no size check (`imageBytes` only logged) → `MAX_IMAGE_MB` (default 20).
- `scanType = reqScanType || 'regular'` stored any string → only `deep`/`regular`.
- Malformed frames crashed inside helpers → `isValidFrameList` (400).
- Audio `mimeType` goes into a `data:` URL → restricted to `audio/<subtype>`.
- `scanIdentity.js` and `req.user` as in the URL routes.
- `resolveClientBatch.js`: **good** (ownership, paid-plan rule, UUID and position bounds). No change.

### Step 10 – Two Node installs

`node --test security/ssrf.test.js` failed with `requires Node >= 22.19 (this server runs 20.20.2)`. Your shell uses nvm (`~/.nvm/…/v20.20.2`), PM2 uses `/usr/local/bin/node` (v24). Fix: `nvm alias default 24` (v24.21.0 was already installed), `npm rebuild`, rerun. I corrected my deploy note that said to reinstall PM2 under nvm.

### Step 11 – Scans failing after part 2 SQL

`/scan-image` showed a CORS preflight failure. The SQL can't affect a preflight; the TEST API wasn't answering. I gave a diagnosis (PM2 logs, `curl -X OPTIONS` with the origin: 204 up and allowed, 502 down, 403 origin rejected). You resolved it on your side (cause not reported) and scans worked again.

### Step 12 – Thumbnails missing from history

My check required the thumbnail path to be `{user_id}/{scanId}.jpg`, but `scan-workspace.tsx` uploads the thumbnail under its own UUID (`thumbnailScanId`) and each scan gets a different `scanId`. Every web-app thumbnail was dropped. Fixed: accept `{user_id}/{any UUID}.jpg`, using a plain prefix check (no regex built from the user ID). `/checkout/create` confirmed 404.

### Step 13 – Origin reachability

- Direct curl to the origin printed nothing: `-s` hides errors, and my Host header was wrong (`host.` instead of `test.`). With `-S`: **exit 28** (firewall drop).
- `ufw status verbose`: default deny, 80/443 only from Cloudflare ranges (current list, v4 and v6), 22 and 51820/udp from anywhere.
- `ss -tlnp`: APIs on `127.0.0.1:3000/3001`, nginx public (firewalled), **`*:3876`** (drift monitor) on all interfaces.
- `sshd -T`: `permitrootlogin no`, `passwordauthentication no`, `kbdinteractiveauthentication no` ✅.
- Remaining gap: anyone can point their own Cloudflare account at your IP. Fix chosen: a secret header added by **your** zone's Transform Rule, checked by nginx.

### Step 14 – nginx origin secret

New `mediacrater-api` and `mediacrater-test` site files plus `/etc/nginx/snippets/cloudflare-origin-auth.conf` ([Appendix D](#appendix-d--nginx-cloudflare-and-systemd)). Tested locally against your real files: with secret → proxied, header stripped before the app; without / wrong → connection dropped (curl exit 52); port-80 redirects and catch-all blocks unchanged.

TEST first returned `exit 0` (config not active yet; you fixed it, cause not reported), then **exit 52**. LIVE: **exit 52**. A later `exit 0` came from `--resolve host.…` with a `test.…` URL, which goes through Cloudflare (correct). From home: both `/health` return OK, the tools hostname returns `401`.

### Step 15 – Drift monitor

- It **does** have a web UI (`/codediff/:id`, `/api/reports/:id`, `/api/check`) behind Basic Auth; Slack actions are signature-checked; GitHub apply needs `GITHUB_APPLY_ENABLED=true`, an allowlisted Slack user and a matching fingerprint. Good design.
- Bound to localhost: `src/index.js` line 783, `app.listen(port, "127.0.0.1", …)`.
- It ran as **root** (no `User=`) on nvm's Node 20. My `sudo systemctl edit` instructions didn't take (text below the "discarded" marker); writing `override.conf` with `tee` worked: now `echobeehive223`, `/usr/local/bin/node`, `127.0.0.1:3876`.

### Step 16 – Final checks

| Check | Result |
|---|---|
| part2 block 2 | `handle_new_user` and `initialize_extension_entitlements` return `trigger` (not callable through the API) |
| `grep -rn real_ip /etc/nginx/` | `cloudflare-realip.conf` with all ranges + `real_ip_header CF-Connecting-IP`. `Permission denied` on the snippet is the `chmod 600` working |
| `server_tokens off` | Already set |
| `sudo ufw limit 22/tcp` | `22/tcp LIMIT` and `22/tcp (v6) LIMIT` |
| `verify-session` | Read-only (asks Stripe if paid, reads the profile). No callers. Deleted |
| `stripe-webhook` | Signature + 5-minute replay window, dedup by session ID, old subscription cancelled only after the new one is paid. Two issues open ([§7](#7-open-items-checklist)) |
| Customer portal | LIVE: no plan switching. TEST: **just enabled** for testing |

### Step 17 – After the first version of this index

| What | Result |
|---|---|
| `node --test security/ssrf.test.js` | Failed again with `this server runs 20.20.2`: the terminal (VS Code) still had nvm's Node 20 first in its PATH. `/usr/local/bin/node --test security/ssrf.test.js` → **28/28** |
| `pm2 show mediacrater-api-test` | `node.js version 24.21.0`, so the app itself was never affected |
| `grep -rn "v20.20.2" /etc/systemd/system/` | Found line 8 of the drift monitor's **base** unit. Expected: the override's empty `ExecStart=` replaces it. I had said "expected: no output", which was wrong. Advised updating the base file and the repo copy with `sed` so the old path can't come back |
| `crontab`, `.nvmrc` | Nothing references Node 20 |
| `nvm uninstall 20` | `Cannot uninstall currently-active node version`. Fix: `nvm use 24` first |
| URL scans have no thumbnails | **Not caused by Phase 1.** `scan-workspace.tsx` passes `null` as the thumbnail for `video_url` / `image_url`, and frames are only extracted for uploaded files. You're handling this yourself (server-side first-frame capture is the reliable route, since most CDNs block reading other sites' video frames in the browser) |
| `npm uninstall node-fetch` (TEST) | `up to date`: it was never a TEST dependency |
| `npm audit --omit=dev` | TEST and LIVE: `proxy-addr` (critical), `qs` and `uuid` (moderate), `body-parser` (low). None exploitable as configured: no `trust proxy` / `req.ip` (nginx's `X-Real-IP` is used), fixed body limits, Express 5's default query parser. Fixed anyway |
| `npm audit fix` (TEST) | Fixed `proxy-addr`, `body-parser`, `qs`; 4 scan types pass. `uuid` remained (fix needs `--force`, a major-version jump) |
| `npm ls uuid` | `uuid@8.3.2` is a **direct** dependency |
| `grep … require('uuid') …` | No output: unused. `npm uninstall uuid`, both PM2 apps restarted without a restart loop |

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Real `sb_secret_…` key and project URL in git history (`ip-handling.test.mjs`) | Test file committed with a live key | Rotated (your report). ⚠️ Confirm the old key is deleted |
| 2 | `npm audit`: 1 critical, 3 high | Next.js 16.0.10 | Upgraded to 16.4.0, audit 0 |
| 3 | My first plan implied proxying the scan API through Vercel | Didn't account for the extension calling the VPS, or Vercel's 4.5 MB body limit | VPS defends itself; unused proxy route to be deleted |
| 4 | Generic `auth.js` / `rateLimit.js` duplicated your code | Written before I saw `server.js` | Dropped; your `authenticateUser` / `requestLimit` hardened instead |
| 5 | e2e: `http://169.254.169.254/` returned "Destination not allowed" instead of "Only HTTPS URLs are supported" | Generic check ran before the HTTPS check | HTTPS check moved first (same message as before) |
| 6 | ipaddr.js treats `::7f00:1` as public | Deprecated IPv4-compatible IPv6 labelled `unicast` | `ssrf.js` blocks `::/96` |
| 7 | TEST crash loop `ReferenceError: File is not defined`; browser showed a **CORS error** and "Failed to fetch" | `undici` 8 needs Node ≥ 22.19; PM2 ran Node 20. nginx's 502 has no CORS headers | Node 24, `npm rebuild`, `pm2 update`; startup guard in `ssrf.js` |
| 8 | My deploy note said "Node ≥ 20" | I didn't check undici's `engines` field | Corrected to ≥ 22.19 |
| 9 | **LIVE outage**: `Cannot find module 'node-fetch'` crash loop | Node and PM2 are shared; `pm2 update` restarted LIVE on Node 24, where `node-fetch` wasn't resolvable | `npm install node-fetch@2`, `npm rebuild`, restart, `pm2 save` |
| 10 | `ssrf.js requires Node >= 22.19 (this server runs 20.20.2)` in your shell | Shell uses nvm Node 20, PM2 uses `/usr/local/bin/node` 24 | `nvm alias default 24`, `npm rebuild` |
| 11 | `/scan-image` CORS preflight failure after part2 SQL | TEST API not answering (SQL can't affect a preflight) | Resolved on your side (cause not reported) |
| 12 | Thumbnails missing from history | My check required the thumbnail UUID to equal `scanId`; the web app uses two different UUIDs | Accept `{user_id}/{any UUID}.jpg` |
| 13 | My first `scanIdentity` fix failed its own tests | It assumed user IDs match the v1–v5 UUID pattern | Plain string prefix check |
| 14 | Origin curl printed nothing | `-s` hides errors; my Host header was `host.` not `test.` | `-S` + exit code: 28 (firewall drop) |
| 15 | `*:3876` listening on all interfaces | Drift monitor called `app.listen(port)` with no host | `app.listen(port, "127.0.0.1", …)` |
| 16 | TEST origin check `exit 0` | New nginx config not active yet | Fixed on your side (cause not reported) → `exit 52` |
| 17 | Later `exit 0` on TEST | `--resolve` only redirects the hostname named in it; that request went through Cloudflare | Expected behaviour |
| 18 | `sudo systemctl edit` override had no effect (still root, still Node 20) | Text below "Edits below this comment will be discarded" is thrown away | Wrote `override.conf` with `sudo tee` |
| 19 | First `tee` heredoc cancelled with `^C` | — | Nothing written; second run worked |
| 20 | `grep … real_ip`: `Permission denied` on the snippet | Snippet is `chmod 600` (root only) | Expected |
| 21 | Drift monitor ran as root from your home folder | Unit had no `User=` | Override sets `User=echobeehive223` |
| 22a | `ssrf.test.js` still reported Node 20.20.2 after `nvm alias default 24` | VS Code's terminal keeps the PATH from when its server started | Run with `/usr/local/bin/node`; remove Node 20; reconnect the terminal |
| 22b | `grep v20.20.2` found the drift monitor's base unit | My "expected: no output" was wrong: the override replaces `ExecStart` but the base file still contains it | `sed` the base file and repo copy to `/usr/local/bin/node` |
| 22c | URL scans show no thumbnail | Pre-existing: the web app sends `null` for URL scans | You're handling it (not a Phase 1 regression) |
| 22d | `npm uninstall node-fetch` printed `up to date` | It was never a TEST dependency | Nothing to do |
| 22e | `uuid@8.3.2` vulnerability needed `--force` | Direct dependency, unused | `npm uninstall uuid` |
| 22 | `nvm: Cannot uninstall currently-active node version` | The shell was still using Node 20 | `nvm use 24` first |
| 23 | `npm audit`: 1 critical (`proxy-addr`), 2 moderate (`qs`, `uuid`), 1 low (`body-parser`) | Outdated transitive and direct dependencies | `npm audit fix`; none were exploitable as configured (no `trust proxy`, fixed body limits). `uuid` pending |
| 24 | Sandbox-only: nginx test needed `server_names_hash_bucket_size 128` and no IPv6 `listen` | My test machine, not your server | Not applicable to your server |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. **Proxying the scan API through Vercel** (implied in round 1) doesn't work: the extension calls the VPS directly and payloads exceed 4.5 MB.
2. **Generic drop-ins written blind** duplicated your existing auth and limiter. I should have asked for `server.js` first.
3. **"The deduction race is the most impactful finding"**, then **"it isn't exploitable because of one-scan-per-user"**. Both were wrong in different ways: the queue hijack in `scanVideo.js` / `scanImage.js` bypassed the one-scan rule, so parallel overspend was real. `claimRunningJob` closes it; the atomic deduction is defence in depth.
4. **"Node ≥ 20"** in the deploy notes. Correct requirement: ≥ 22.19.
5. **"Upgrade LIVE's Node before Phase 1 reaches LIVE"** treated TEST and LIVE as separate. They share Node and the PM2 daemon. This caused the LIVE outage.
6. **"Reinstall pm2 under nvm"**: wrong for your setup (PM2 lives in `/usr/local`).
7. **"Optional: `nvm uninstall 20`"** would have broken the drift monitor (it used nvm's Node 20). Safe only now.
8. **Thumbnail check** assumed `thumbnail UUID == scanId` from a code comment instead of the calling code.
9. **Origin curl** used `-s` and the wrong Host header.
10. **`verify-session`** deletion was suggested conditionally without seeing its code. Reviewed afterwards: read-only, no callers.
11. **`systemctl edit` instructions** didn't warn about the "discarded" marker.
12. **"Expected: no output" for `grep v20.20.2 /etc/systemd/system/`** ignored the base unit file, which the override replaces but doesn't change.

### Decisions

1. **The VPS enforces its own security** (token, ownership, SSRF, limits). The VPS URL is not treated as secret.
2. **Ownership is enforced with `claimRunningJob`** (owner only, single use) on all four scan routes.
3. **Deduction is one atomic UPDATE** (`deduct_scans`), callable only by `service_role`, rejecting costs outside 1–10.
4. **Bad client values degrade instead of failing:** an unusable `scanId` falls back to a database ID; an invalid thumbnail path is dropped; malformed audio is dropped. Invalid platform, frames or image data return 400.
5. **One definition of "private address"** (`security/ssrf.js`, ipaddr.js) shared by `assertPublicFetchUrl`, `safeFetch` and the ffprobe proxy.
6. **Origin protection = Cloudflare-only firewall + secret header** from your zone's Transform Rule. A Cloudflare Tunnel would be stronger but is a bigger change.
7. **Supabase privileges mirror the RLS policies** (defence in depth). Nothing that worked stopped working.
8. **Dead payment code deleted** rather than secured.
9. **Drift monitor:** localhost-only, non-root, Node 24, Basic Auth kept, still reachable through nginx + Cloudflare.
10. **Password minimum stays at 6** (your decision).

### Known limits

- **`requestLimit` and the queue are in-memory.** They reset on restart, and PM2 cluster mode would split them per worker.
- **Basic Auth on the drift monitor has no attempt limit.** The password is the only defence; use a long random one.
- **Cloudflare IP ranges are maintained by hand** in two places (ufw and `cloudflare-realip.conf`).
- **The origin secret is static.** Rotation procedure in [Appendix F](#appendix-f--rollback-and-maintenance).
- **Supabase grants full privileges on every new table by default.** Repeat block 4 for new tables.
- **Thumbnails from the buggy window** (Step 12) aren't linked to their scans; the files remain in storage.
- **`MAX_IMAGE_MB` = 20 is a guess.** The web app sends original files uncompressed.
- **`bigJson` allows 150 MB**, while `optimizeFramePayload` caps deep scans at 25 MB.

---

## 7. Open items checklist

### Do next

- [x] **`uuid@8.3.2`** removed from TEST (unused). LIVE: same step in [Appendix A.2](#a2-live-api-code)
- [x] `npm audit fix` on TEST
- [ ] **LIVE rollout** ([Appendix A](#appendix-a--live-rollout-runbook))
- [ ] **Stripe webhook: derive the plan from the price ID** (`items.data[0].price.id` matched against `STARTUP_PID` etc.) in all four handlers. TEST is exploitable now that portal plan switching is on; **don't enable plan switching in LIVE until this is fixed**
- [ ] **Stripe webhook API version:** check Stripe → Developers → Webhooks → your endpoint. On `2025-03-31.basil` or later, `invoice.subscription_details` moved to `invoice.parent.subscription_details` and renewals are skipped. Search the webhook logs for `Renewal invoice is missing valid subscription metadata`
- [ ] **Web repo (TEST, then LIVE):** delete `app/api/[...path]/route.ts`, apply `encodeURIComponent(jobId)` in `lib/mediacrater/scanApi.ts`, delete the `pnpm-lock.yaml` stub

### Verify

- [ ] Thumbnail fix: a new paid-plan scan on TEST shows its thumbnail in history
- [x] `node --test security/ssrf.test.js` on TEST: 28/28
- [x] `npm uninstall node-fetch` on TEST (was never a dependency)
- [ ] `npm audit --omit=dev` on TEST. Expected: `found 0 vulnerabilities`
- [ ] Re-run audit 3c on TEST. Expected rows (only `authenticated`, no `anon`): `extension_versions` INSERT, SELECT, UPDATE · `profiles` SELECT · `purchases` SELECT · `scan_batches` DELETE, INSERT, SELECT · `scan_queue` SELECT · `scans` SELECT
- [ ] Edge Functions `create-checkout`, `create-checkout-extension`, `verify-session` are gone in **both** Supabase projects
- [ ] The leaked `sb_secret_…` key no longer appears in Supabase → API Keys
- [ ] `buy-tokens` / `purchase-success` pages are also gone from the **LIVE** web repo

### Improvements (not urgent)

- [ ] `revoke execute on function public.initialize_extension_entitlements() from authenticated;` (both projects)
- [ ] Set `MAX_IMAGE_MB` and `SSRF_BLOCKED_IPS` (the VPS's own public IPs) in both `.env` files
- [ ] Lower `bigJson` from 150 MB to just above your largest real payload
- [ ] `"engines": { "node": ">=22.19" }` in the API's `package.json`
- [ ] `nvm use 24 && nvm uninstall 20` (nvm refuses to remove the active version)
- [ ] Drift monitor base unit: replace the nvm Node 20 path with `/usr/local/bin/node` in `/etc/systemd/system/mediacrater-drift-monitor.service` and the repo copy, then `sudo systemctl daemon-reload`
- [ ] Pin each PM2 app's interpreter (`--interpreter /usr/local/bin/node`) so TEST and LIVE can be upgraded separately in future
- [ ] Drift monitor: long random Basic Auth password, delete `public/codediff.html.backup`, send `src/slack.js` to check the Slack timestamp window
- [ ] Stripe webhook: constant-time signature compare (`crypto.subtle.verify`), stop logging the full subscription object, unique constraint on `purchases.stripe_session_id`
- [ ] Automate the Cloudflare IP list (ufw + `cloudflare-realip.conf`)
- [ ] **URL scan thumbnails** (you're handling it): the web app sends `null` for `video_url` / `image_url`

### Next phases

- [ ] **Phase 2** – Security headers / CSP
- [ ] **Phase 3** – Per-email rate limits
- [ ] **Phase 4** – Input validation (zod)
- [ ] **Phase 5** – Generic error messages (include `create-checkout-webapp`'s error text and Express's HTML 404 page)
- [ ] **Phase 6** – Password-reset link (env-based, existing page)
- [ ] **Phase 7** – Contact form IP + shared Turnstile helper
- [ ] **Phase 8** – Supabase password setting (minimum stays 6)
- [ ] **Phase 9** – Remove the `/db` rewrite

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| LIVE API | PM2 `mediacrater-api`, `/var/www/mediacrater-api`, `127.0.0.1:3000`, `host.mediacrater.com` |
| TEST API | PM2 `mediacrater-api-test`, `/var/www/mediacrater-api-test`, `127.0.0.1:3001`, `test.mediacrater.com` |
| Drift monitor | systemd `mediacrater-drift-monitor`, `~/mediacrater-drift-monitor-live`, `127.0.0.1:3876`, `<tools hostname>`, Basic Auth |
| Node | PM2 + drift monitor: `/usr/local/bin/node` v24.21.0. Shell: nvm, default 24 |
| Minimum Node for the API | 22.19 (`undici` 8) |
| npm packages | Added: `undici`, `ipaddr.js`. Removed: `node-fetch` (LIVE), `uuid` (TEST done, LIVE in rollout). `npm audit fix` applied |
| nginx | `/etc/nginx/sites-available/mediacrater-api`, `…/mediacrater-test`, `/etc/nginx/snippets/cloudflare-origin-auth.conf` (`chmod 600`), `/etc/nginx/conf.d/cloudflare-realip.conf` |
| Origin secret | Header `X-Origin-Auth`, added by a Cloudflare Request Header Transform Rule for the three API hostnames; stripped before reaching the apps |
| Firewall | Default deny; 80/443 from Cloudflare ranges only; `22/tcp LIMIT`; `51820/udp` open |
| Drift monitor override | `/etc/systemd/system/mediacrater-drift-monitor.service.d/override.conf` |
| `.env` (API) | `MAX_IMAGE_MB` (default 20), `SSRF_BLOCKED_IPS` (optional), existing `URL_SCAN_ALLOWED_HOSTS`, `WEBSITE1`, `WEBSITE2` |
| SQL objects | `deduct_scans(uuid, integer, integer)` (`service_role` only) |
| Who can call the sensitive functions | `service_role` only: `deduct_scans`, `check_and_log_*`, `free_cluster_usage`, `detect_duplicate_free_ips`, `verified_user_ids`, `increment_queue_depth_behind` |
| New error responses | `400 Invalid platform`, `400 Invalid job ID`, `400 Invalid timing data`, `400 Invalid frames`, `400 Invalid image data`, `400 File too large` (image), `400 URL_NOT_ALLOWED` + reason, `503` "Authentication is temporarily unavailable" |
| New log lines | `[AUTH] Supabase Auth unavailable`, `[AUTH] getUser threw`, `[RESOLVE-URL] failed`, `[SCAN DEDUCTION] …`, `[🚨 SUSPICIOUS_PAYLOAD][IMAGE_OVER_LIMIT]` |
| Tests | `security/ssrf.test.js` (28). The end-to-end harness (34 tests) ran in my sandbox against your real `server.js` with stubbed modules |

---

## Appendix A – LIVE rollout runbook

Do the steps in order. Each has its expected result; stop and send me the output if anything differs.

### A.0 Before you start

- TEST is green: the [§7 "Verify"](#verify) items above, plus one scan of each type on TEST.
- Back up LIVE (includes `.env` and `node_modules`; keep it on the server):

```bash
sudo cp -a /var/www/mediacrater-api /var/www/mediacrater-api.bak-07oct26
pm2 save
```

- Check the drift monitor for **LIVE-only** changes in the files below. Copying from TEST overwrites them.

### A.1 LIVE Supabase (SQL Editor, **LIVE project**, one block at a time)

1. **Audit first.** Run `phase1.sql` audits 3a, 3b, 3c and this policy query:

   ```sql
   select tablename, policyname, cmd, roles, qual, with_check
   from pg_policies where schemaname = 'public' order by tablename, cmd;
   ```

   **Stop and send me the output if LIVE differs from TEST:** extra tables, different function arguments, or different policies. The revoke statements use TEST's exact function signatures, and block 4 lists TEST's tables.

2. `phase1.sql` **block 1** (`deduct_scans`). Expected: `Success. No rows returned`.
3. `phase1-part2.sql` **block 1** (drop the open `scans` INSERT policy).
4. `phase1-part2.sql` **block 3** (function revokes). If you get `function … does not exist`, LIVE's arguments differ; use the signature from audit 3a.
5. `phase1-part2.sql` **block 4** (table privileges).
6. **Confirm.** Re-run audit 3a: `deduct_scans`, `check_and_log_form_attempt` and `increment_queue_depth_behind` show `anon_can_execute = false`, `authed_can_execute = false`. Re-run audit 3c. Expected (no `anon` rows):

   | table_name | grantee | privileges |
   |---|---|---|
   | extension_versions | authenticated | INSERT, SELECT, UPDATE |
   | profiles | authenticated | SELECT |
   | purchases | authenticated | SELECT |
   | scan_batches | authenticated | DELETE, INSERT, SELECT |
   | scan_queue | authenticated | SELECT |
   | scans | authenticated | SELECT |

7. **Sign up a fresh LIVE account** and confirm its `profiles` row exists (the `handle_new_user` trigger still fires). Delete the account afterwards.

### A.2 LIVE API code

```bash
cd /var/www/mediacrater-api
cp package-lock.json package-lock.json.bak
npm i undici ipaddr.js
npm audit fix                                # no --force; fixes proxy-addr, body-parser, qs
grep -rn "require('uuid')\|require(\"uuid\")\|from 'uuid'" --exclude-dir=node_modules .   # expected: no output
npm uninstall uuid                           # only if the grep printed nothing
mkdir -p security routes/_shared utils

T=/var/www/mediacrater-api-test
for f in server.js rateLimiter.js \
         routes/scanVideo.js routes/scanImage.js routes/scanVideoUrl.js routes/scanImageUrl.js \
         routes/_shared/scanIdentity.js utils/netGuard.js \
         security/ssrf.js security/ssrf.test.js; do
  cp "$T/$f" "$f"
done

rm checkout.js
grep -rn "node-fetch\|require('./checkout')" --exclude-dir=node_modules .   # expected: no output
npm uninstall node-fetch

/usr/local/bin/node --test security/ssrf.test.js   # expected: # pass 28, # fail 0
npm audit --omit=dev                         # expected: found 0 vulnerabilities
node --check server.js                       # expected: no output
node -e "require.resolve('undici'); require.resolve('ipaddr.js'); console.log('deps ok')"
```

Optional `.env` additions (LIVE and TEST): `MAX_IMAGE_MB=<above your largest real image>`, `SSRF_BLOCKED_IPS=<VPS public IPv4>,<VPS public IPv6>`.

```bash
pm2 restart mediacrater-api --update-env
pm2 logs mediacrater-api --lines 40 --nostream
pm2 save
```

Expected in the logs: `[ABUSE-LINK] mode: …` and `Mediacrater Video API running on port 3000`; no `MODULE_NOT_FOUND`, no `requires Node >= 22.19`.

### A.3 LIVE smoke tests

| Test | Expected |
|---|---|
| `curl -s https://host.mediacrater.com/health` | `{"status":"ok",…}` |
| `curl -s -X POST https://host.mediacrater.com/checkout/create` | Express page `Cannot POST /checkout/create` |
| On the VPS: `curl -sk --resolve host.mediacrater.com:443:127.0.0.1 https://host.mediacrater.com/health; echo "exit $?"` | `exit 52` |
| Web app: video file, image file, video URL, image URL | Success; `scans_remaining` drops by 1 |
| Web app: deep scan (paid) | Success; drops by 2 |
| Web app: batch scan (paid) | Success |
| Scan history (paid) | Thumbnail shows for the new scans |
| Web app: URL `https://127.0.0.1/a.mp4` | Error "Destination not allowed" |
| Extension: one scan | Success |
| `pm2 logs mediacrater-api --lines 100 --nostream` | No `[UNHANDLED]`, no `[SCAN DEDUCTION]` errors |

### A.4 LIVE web app

After TEST: delete `app/api/[...path]/route.ts`, apply `encodeURIComponent(jobId)` in `scanApi.ts`, delete the `pnpm-lock.yaml` stub, and confirm `buy-tokens` / `purchase-success` are gone.

### A.5 Afterwards

- Delete the backup once you're satisfied: `sudo rm -r /var/www/mediacrater-api.bak-07oct26`.
- The drift monitor should show no drift for the copied files.

---

## Appendix B – SQL

Run in the Supabase SQL Editor, one numbered block at a time (the editor only shows the last result). TEST is done; LIVE follows [Appendix A.1](#a1-live-supabase-sql-editor-live-project-one-block-at-a-time).

### B.1 `sql/phase1.sql`

Block 1 creates `deduct_scans`. Block 2 is repeated in `phase1-part2.sql`. Block 3 is the read-only audit (3a–3e).

```sql
-- =====================================================================
-- PHASE 1 — run in Supabase SQL Editor (TEST project first, then LIVE)
-- The SQL Editor only shows the LAST result when you run several
-- statements at once, so run each numbered block on its own.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Atomic scan deduction (used by rateLimiter.js commitScanDeduction)
-- Run BEFORE deploying the new rateLimiter.js. If the new code runs first,
-- scans still succeed but deductions fail and are logged.
-- ---------------------------------------------------------------------
create or replace function public.deduct_scans(
  p_user uuid,
  p_cost integer,
  p_fallback integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining integer;
begin
  -- A negative cost would ADD scans. Never trust the caller on this.
  if p_cost is null or p_cost < 1 or p_cost > 10 then
    raise exception 'invalid scan cost';
  end if;

  update public.profiles
     set scans_remaining = greatest(
           0,
           coalesce(scans_remaining, greatest(0, coalesce(p_fallback, 0))) - p_cost
         )
   where id = p_user
  returning scans_remaining into v_remaining;

  return v_remaining; -- NULL if the profile row doesn't exist
end;
$$;

-- Supabase exposes public functions to anon/authenticated through the API
-- by default. Only the VPS (service_role) may call this one.
revoke all on function public.deduct_scans(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.deduct_scans(uuid, integer, integer) to service_role;


-- ---------------------------------------------------------------------
-- 2. Close the open INSERT on scans (from your audit output)
-- "Service role can insert scans" applies to role PUBLIC with CHECK (true),
-- so anyone with the anon key can insert scan rows for ANY user_id. The
-- service role bypasses RLS, so the VPS never needed this policy.
-- The web app never inserts into scans directly. Confirm the extension
-- doesn't either before running this.
-- ---------------------------------------------------------------------
drop policy if exists "Service role can insert scans" on public.scans;


-- ---------------------------------------------------------------------
-- 3. AUDIT (read-only). Run each one separately and send me the output.
-- ---------------------------------------------------------------------

-- 3a. Which public functions can browsers call with the anon key?
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- 3b. RLS on/off per table. Tables with RLS OFF are fully readable and
-- writable with the anon key (rate_limits and account_devices are the ones
-- to watch; they had no policies in your output, which is only safe if RLS
-- is ON).
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- 3c. Table privileges held by browser roles.
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;

-- 3d. Storage policies (scan-thumbnails uploads must be limited to the
-- user's own {user_id}/ folder).
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage'
order by policyname;

-- 3e. Edge Functions can't be listed from SQL: in the dashboard, open
-- Edge Functions and tell me whether create-checkout still exists.
```

### B.2 `sql/phase1-part2.sql`

```sql
-- =====================================================================
-- PHASE 1, PART 2 — based on your audit output. TEST first, then LIVE.
-- Run each numbered block on its own.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Drop the open INSERT policy on scans (block 2 of phase1.sql).
-- Safe to re-run if you already did it.
-- ---------------------------------------------------------------------
drop policy if exists "Service role can insert scans" on public.scans;


-- ---------------------------------------------------------------------
-- 2. Check the return types before block 3.
-- Functions returning "trigger" can't be called through the API at all.
-- Send me the full definition of initialize_extension_entitlements if it
-- returns anything other than trigger.
-- ---------------------------------------------------------------------
select p.proname, pg_get_function_result(p.oid) as returns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('check_and_log_form_attempt', 'increment_queue_depth_behind',
                    'handle_new_user', 'initialize_extension_entitlements');


-- ---------------------------------------------------------------------
-- 3. Functions anyone could call with the public anon key.
--
-- check_and_log_form_attempt is SECURITY DEFINER and anon-callable: anyone
-- can log fake attempts for any IP and lock real visitors out of whatever
-- form uses it. Nothing in the web app calls it anymore (the contact form
-- uses check_and_log_rate_limit), so only the service role keeps access.
--
-- increment_queue_depth_behind is only called by the VPS (service role).
--
-- Revoking EXECUTE doesn't stop triggers from firing: Postgres checks that
-- privilege when the trigger is created, not each time it runs.
-- After running this, sign up a fresh TEST account to confirm the profile
-- row is still created.
-- ---------------------------------------------------------------------
revoke execute on function public.check_and_log_form_attempt(text, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_and_log_form_attempt(text, uuid, integer, integer)
  to service_role;

revoke execute on function public.increment_queue_depth_behind(text[])
  from public, anon, authenticated;
grant execute on function public.increment_queue_depth_behind(text[])
  to service_role;

revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

-- Anon only, until block 2 confirms nothing signed-in calls it.
revoke execute on function public.initialize_extension_entitlements()
  from public, anon;


-- ---------------------------------------------------------------------
-- 4. Table privileges: defense in depth behind RLS.
--
-- Today anon and authenticated hold ALL privileges (incl. TRUNCATE) on
-- every table, so RLS is the only thing stopping writes. One mistaken
-- policy or one table with RLS switched off would expose everything.
--
-- This removes only what your policies already deny, so nothing that
-- works today should change:
--   - anon: no policy grants it anything (every policy needs auth.uid()
--     or the authenticated role), and logged-out flows use Vercel API
--     routes with the service role.
--   - authenticated keeps exactly the operations its policies allow.
--   - All server code (VPS, Vercel routes, Edge Functions) uses the
--     service role, which these revokes don't touch.
-- ---------------------------------------------------------------------
revoke all on table
  public.extension_versions,
  public.flagged_ip_clusters,
  public.profiles,
  public.purchases,
  public.scan_batches,
  public.scan_queue,
  public.scans
from anon;

revoke all on table public.flagged_ip_clusters from authenticated;

-- SELECT-only tables (policies: SELECT only)
revoke insert, update, delete, truncate, references, trigger on table
  public.profiles,
  public.purchases,
  public.scan_queue,
  public.scans
from authenticated;

-- scan_batches policies: SELECT, INSERT, DELETE
revoke update, truncate, references, trigger on table public.scan_batches from authenticated;

-- extension_versions policies: SELECT, INSERT, UPDATE
revoke delete, truncate, references, trigger on table public.extension_versions from authenticated;


-- ---------------------------------------------------------------------
-- 5. Re-run audit 3c from phase1.sql to confirm the result.
-- Note: Supabase grants anon/authenticated full access on every NEW table
-- by default, so repeat block 4 for any table you add later.
-- ---------------------------------------------------------------------
```

---

## Appendix C – Code changes

All final files are in the `phase1/` folder. Every security change inside them is marked with a `PHASE 1:` comment, so `grep -n "PHASE 1" <file>` lists them.

### C.1 File list

| File | Status | Change |
|---|---|---|
| `server.js` | Replaced | Pinned `safeFetch` + `assertUrlPolicy`; `/resolve-url` safe errors; `logSafe`; CORS diagnostic cap + strict bearer regex; `authenticateUser` 503 on outages; `validatePlatform` (from `policies/`); `validateJobId`; `/queue-status` passes the user; `/queue-cancel` rate limit; `/queue-timing` validation + ownership + rate limit; `/log-client-error` escaping; `x-powered-by` off; `/checkout` removed |
| `rateLimiter.js` | Replaced | `commitScanDeduction` uses the `deduct_scans` RPC; `withRetry` now actually retries network errors |
| `routes/scanVideo.js` | Replaced | `claimRunningJob`; `req.user`; `scanType` normalised; frame validation; audio MIME check; `resolveScanIdentity` |
| `routes/scanImage.js` | Replaced | `claimRunningJob`; `req.user`; image type and size check (`MAX_IMAGE_MB`); explicit cost 1; `resolveScanIdentity` |
| `routes/scanVideoUrl.js` | Replaced | `req.user`; URL errors returned as `URL_NOT_ALLOWED`; deep-scan cost passed to `checkRateLimit`; `resolveScanIdentity` |
| `routes/scanImageUrl.js` | Replaced | `req.user`; `URL_NOT_ALLOWED`; explicit cost; `resolveScanIdentity` |
| `routes/_shared/scanIdentity.js` | **New** | Scan ID and thumbnail path validation |
| `utils/netGuard.js` | Replaced | Delegates to `security/ssrf.js` |
| `security/ssrf.js` | **New** | Pinned, rebinding-safe fetch; private-address check; Node version guard |
| `security/ssrf.test.js` | **New** | 28 tests |
| `checkout.js` | **Deleted** | Unauthenticated checkout proxy |
| `utils/probeVideoDuration.js`, `queueManager.js`, `requestLimiter.js`, `routes/scanFeedback.js`, `routes/_shared/resolveClientBatch.js`, `helpers.js` | Unchanged | Reviewed |
| Drift monitor `src/index.js` line 783 | Edited | `app.listen(port, "127.0.0.1", …)` |
| Web: `lib/mediacrater/scanApi.ts` | ⏳ | `encodeURIComponent(jobId)` in three URLs |
| Web: `app/api/[...path]/route.ts` | ⏳ Delete | Unused proxy |

### C.2 Key snippets (before → after)

**Queue claim** (`scanVideo.js`, `scanImage.js`):

```js
// before
if (incomingJobId && queueManager.isJobRunning(incomingJobId)) {
// after
if (incomingJobId && queueManager.claimRunningJob(incomingJobId, user.id)) {
```

**Auth** (all four scan routes):

```js
// before
const { data: { user: authedUser }, error: authError } = await supabase.auth.getUser(
  authHeader.replace('Bearer ', '')
);
// after (authenticateUser in server.js already verified the token)
if (!req.user?.id) {
  return res.status(401).json({ error: 'Unauthorized' });
}
user = req.user;
```

**Queue status** (`server.js`):

```js
// before
const status = queueManager.getJobStatus(req.params.jobId);
// after
const status = queueManager.getJobStatus(req.params.jobId, req.user.id);
```

**Queue timing** (`server.js`): values validated by `readTiming()` (finite number, 0 to 24 h) and the update scoped with `.eq('id', req.params.jobId).eq('user_id', req.user.id)`.

**Drift monitor** (`src/index.js`):

```js
// before
app.listen(
  port,

  () => {
// after
app.listen(
  port,
  "127.0.0.1",

  () => {
```

### C.3 `routes/_shared/scanIdentity.js` (final)

```js
// routes/_shared/scanIdentity.js
//
// PHASE 1: validates the client-supplied scanId and thumbnail path before
// they're written to the `scans` row.
//
// - scanId becomes the row's primary key (logScan inserts it as `id`). A
//   non-UUID or an ID that already exists makes the insert fail, so the scan
//   would run and be charged to the balance but never be recorded in `scans`.
//   Either case now falls back to a database-generated ID.
// - The thumbnail path must be a file in this user's own folder of the
//   scan-thumbnails bucket: "{user_id}/{uuid}.jpg". The web app uploads the
//   thumbnail under its own UUID (separate from scanId, see
//   scan-workspace.tsx), so the two are deliberately not required to match.
//   This still blocks arbitrary URLs and other users' folders.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Plain string comparison for the folder (no regex built from userId).
function isOwnThumbnailPath(userId, value) {
  if (typeof value !== 'string' || typeof userId !== 'string' || !userId) return false;
  const prefix = `${userId}/`;
  if (!value.startsWith(prefix)) return false;
  const fileName = value.slice(prefix.length);
  if (!fileName.toLowerCase().endsWith('.jpg')) return false;
  return UUID_PATTERN.test(fileName.slice(0, -'.jpg'.length));
}

async function resolveScanIdentity(supabase, userId, rawScanId, rawThumbnailPath) {
  let scanId = typeof rawScanId === 'string' && UUID_PATTERN.test(rawScanId)
    ? rawScanId
    : null;

  if (scanId) {
    const { data, error } = await supabase
      .from('scans')
      .select('id')
      .eq('id', scanId)
      .maybeSingle();

    // Already used, or we can't tell: let Postgres generate the ID.
    if (error || data) scanId = null;
  }

  const thumbnailUrl = isOwnThumbnailPath(userId, rawThumbnailPath)
    ? rawThumbnailPath
    : null;

  return { scanId, thumbnailUrl };
}

module.exports = { resolveScanIdentity, isOwnThumbnailPath, UUID_PATTERN };
```

### C.4 `utils/netGuard.js` (final)

```js
// utils/netGuard.js
//
// PHASE 1: now backed by security/ssrf.js (ipaddr.js range checks), so the
// ffprobe proxy, assertPublicFetchUrl, and safeFetch all share one
// definition of "private". The old hand-written prefix checks missed some
// ranges (6to4, Teredo, IPv4-compatible IPv6, documentation ranges), and
// this version also honors SSRF_BLOCKED_IPS (the VPS's own public IPs).
// Same export and same fail-closed behavior: anything that isn't a valid,
// public IP address counts as private.

const { isPublicAddress } = require('../security/ssrf');

function isPrivateAddress(address) {
  return !isPublicAddress(String(address ?? ''));
}

module.exports = { isPrivateAddress };
```

### C.5 `rateLimiter.js` (final)

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
const CLUSTER_ENFORCE = process.env.POOL_ENFORCE === 'true';
console.log(`[ABUSE-LINK] mode: ${CLUSTER_ENFORCE ? 'ENFORCE' : 'SHADOW'}`);

// ── Retry wrapper ─────────────────────────────────────────────
function isNetworkErrorMessage(message) {
  return Boolean(
    message?.includes('502') ||
    message?.includes('503') ||
    message?.includes('fetch failed') ||
    message?.includes('ECONNRESET') ||
    message?.includes('ETIMEDOUT')
  );
}

async function withRetry(fn, retries = 3, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      const isNetworkError = isNetworkErrorMessage(error.message);

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
//
// PHASE 1: the deduction is now one atomic UPDATE in Postgres
// (deduct_scans RPC, see sql/phase1.sql) instead of "write back the balance
// we read before the scan started". The old version lost deductions when
// scans overlapped: two scans that both started at 20 each wrote 19, so the
// user paid for one. currentRemaining is only used as the starting balance
// when scans_remaining is NULL, matching the old `?? maxScans` behavior.
async function commitScanDeduction(userId, currentRemaining, scanCost, supabase) {
  if (!Number.isInteger(scanCost) || scanCost < 1) {
    console.error(`[SCAN DEDUCTION] Invalid scan cost ${scanCost} for user:${userId}`);
    return { success: false, remaining: currentRemaining };
  }

  const fallback = Number.isInteger(currentRemaining) ? Math.max(0, currentRemaining) : 0;

  try {
    const { data, error } = await withRetry(async () => {
      const result = await supabase.rpc('deduct_scans', {
        p_user: userId,
        p_cost: scanCost,
        p_fallback: fallback
      });
      // supabase-js returns network failures instead of throwing them;
      // rethrow those so withRetry actually retries.
      if (result.error && isNetworkErrorMessage(result.error.message)) {
        throw new Error(result.error.message);
      }
      return result;
    });

    if (error) {
      console.error('Scan deduction error:', error);
      // The scan already succeeded at this point — we don't want to
      // fail the response over a deduction write error. Log it for
      // manual reconciliation instead.
      return { success: false, remaining: currentRemaining };
    }

    if (!Number.isInteger(data)) {
      console.error(`[SCAN DEDUCTION] No profile row updated for user:${userId}`);
      return { success: false, remaining: currentRemaining };
    }

    return { success: true, remaining: data };
  } catch (error) {
    console.error('Scan deduction failed after retries:', error);
    return { success: false, remaining: currentRemaining };
  }
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

### C.6 `security/ssrf.js` (final)

```js
// security/ssrf.js
//
// SSRF-safe outbound HTTP for any route that fetches a user-supplied URL
// (/resolve-url, /scan-video-url, /scan-image-url, thumbnailUrl handling).
//
// Why this design:
// - IP checks happen inside the socket's DNS lookup, so the address that is
//   validated is the address that is connected to. Checking DNS first and
//   fetching second (two lookups) is vulnerable to DNS rebinding.
// - Node skips the lookup hook for IP literals, so literals are checked
//   separately in assertSafeUrl().
// - Redirects are followed manually so every hop is re-validated.
// - Bodies are size-capped while streaming; Content-Length is not trusted.
//
// Requires: Node >= 22.19, `npm i undici ipaddr.js`

'use strict';

// Fail fast with a readable message. undici 8 needs Node >= 22.19; on older
// Node it crashes at require time with "ReferenceError: File is not defined".
{
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 19)) {
    throw new Error(
      `security/ssrf.js requires Node >= 22.19 (this server runs ${process.versions.node}). ` +
      'Upgrade Node (24 LTS recommended), then run npm rebuild and pm2 update.'
    );
  }
}

const dns = require('node:dns');
const net = require('node:net');
const fs = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const ipaddr = require('ipaddr.js');
const { Agent, fetch: undiciFetch } = require('undici');

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set([80, 443]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_URL_LENGTH = 2048;

// Optional: comma-separated public IPs of this VPS. Traffic from the box to
// its own public IP is routed over loopback and can reach local services.
const EXTRA_BLOCKED = new Set(
  (process.env.SSRF_BLOCKED_IPS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeIp)
    .filter(Boolean)
);

class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SsrfError';
    this.code = 'SSRF_BLOCKED';
  }
}

function normalizeIp(address) {
  if (!ipaddr.isValid(address)) return null;
  let addr = ipaddr.parse(address);
  if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
    addr = addr.toIPv4Address();
  }
  return addr.kind() === 'ipv6' ? addr.toNormalizedString() : addr.toString();
}

// Only globally routable unicast is allowed. ipaddr.js labels loopback,
// private (RFC1918), link-local (incl. 169.254.169.254 metadata), CGNAT,
// unique-local IPv6, multicast, reserved, 6to4, Teredo, NAT64, etc. as
// something other than 'unicast'.
function isPublicAddress(address) {
  if (!ipaddr.isValid(address)) return false;
  let addr = ipaddr.parse(address);
  if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
    addr = addr.toIPv4Address();
  }
  if (addr.range() !== 'unicast') return false;
  // ipaddr.js labels deprecated IPv4-compatible IPv6 (::/96, e.g. ::7f00:1
  // for 127.0.0.1) as unicast. Nothing legitimate uses it, so block it.
  if (addr.kind() === 'ipv6' && addr.parts.slice(0, 6).every((part) => part === 0)) {
    return false;
  }
  return !EXTRA_BLOCKED.has(normalizeIp(address));
}

function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    // Reject if ANY record is non-public, so mixed public/private answers
    // can't be used to slip through.
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      const blocked = new Error(`Blocked destination for host ${hostname}`);
      blocked.code = 'ESSRFBLOCKED';
      return callback(blocked);
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

const agent = new Agent({
  connect: { lookup: safeLookup, timeout: 10_000 },
  headersTimeout: 15_000,
  bodyTimeout: 30_000,
});

function assertSafeUrl(input) {
  const raw = String(input ?? '');
  if (!raw || raw.length > MAX_URL_LENGTH) throw new SsrfError('Invalid URL');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('Invalid URL');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new SsrfError('Unsupported URL scheme');
  if (url.username || url.password) throw new SsrfError('Credentials in URL are not allowed');

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) throw new SsrfError('Port not allowed');

  // WHATWG URL already normalizes tricks like http://2130706433/ and
  // http://0x7f.1/ to 127.0.0.1, so net.isIP sees the real address.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host)) throw new SsrfError('Destination not allowed');

  return url;
}

function isBlockedFetchError(err) {
  let cur = err;
  for (let i = 0; cur && i < 5; i++) {
    if (cur.code === 'ESSRFBLOCKED') return true;
    cur = cur.cause;
  }
  return false;
}

/**
 * GET/HEAD a user-supplied URL safely.
 * Returns { response, finalUrl }. Caller must consume or cancel response.body.
 *
 * options.assertUrl (optional, sync or async): extra app policy run on the
 * first URL and on every redirect hop, e.g. HTTPS-only or a host allowlist.
 * Throw to reject.
 */
async function safeFetch(input, options = {}) {
  const {
    method = 'GET',
    headers = {},
    maxRedirects = 5,
    timeoutMs = 20_000,
    signal,
    assertUrl,
  } = options;

  if (method !== 'GET' && method !== 'HEAD') {
    throw new SsrfError('Only GET and HEAD are allowed');
  }

  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  const combinedSignal = AbortSignal.any(signals);

  let current = assertSafeUrl(input);
  if (assertUrl) await assertUrl(current.toString());

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let response;
    try {
      response = await undiciFetch(current, {
        method,
        // Never forward caller headers like Authorization or cookies.
        headers: { 'user-agent': 'MediacraterFetcher/1.0', accept: '*/*', ...headers },
        redirect: 'manual',
        dispatcher: agent,
        signal: combinedSignal,
      });
    } catch (err) {
      if (isBlockedFetchError(err)) throw new SsrfError('Destination not allowed');
      throw err;
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: current.toString() };
    }

    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => {});
    if (!location) throw new SsrfError('Redirect without location');

    const next = assertSafeUrl(new URL(location, current).toString());
    if (current.protocol === 'https:' && next.protocol === 'http:') {
      throw new SsrfError('HTTPS to HTTP redirect not allowed');
    }
    if (assertUrl) await assertUrl(next.toString());
    current = next;
  }

  throw new SsrfError('Too many redirects');
}

function sizeLimiter(maxBytes) {
  let total = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) return cb(new SsrfError('Response too large'));
      cb(null, chunk);
    },
  });
}

function assertDeclaredSize(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SsrfError('Response too large');
  }
}

/** Read a safeFetch response into a Buffer, enforcing maxBytes while streaming. */
async function readBodyWithLimit(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  try {
    assertDeclaredSize(response, maxBytes);
  } catch (err) {
    await response.body.cancel().catch(() => {});
    throw err;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) {
      await response.body.cancel().catch(() => {});
      throw new SsrfError('Response too large');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

/**
 * Download a user-supplied URL to a local file (e.g. before ffmpeg).
 * Never hand the remote URL to ffmpeg/yt-dlp directly: they do their own
 * fetching, follow redirects, and support non-HTTP protocols.
 */
async function downloadToFile(input, destPath, { maxBytes, ...fetchOptions }) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('maxBytes is required');
  const { response, finalUrl } = await safeFetch(input, fetchOptions);

  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new SsrfError(`Upstream responded with ${response.status}`);
  }
  try {
    assertDeclaredSize(response, maxBytes);
  } catch (err) {
    await response.body.cancel().catch(() => {});
    throw err;
  }

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      sizeLimiter(maxBytes),
      fs.createWriteStream(destPath, { flags: 'wx', mode: 0o600 })
    );
  } catch (err) {
    await fs.promises.unlink(destPath).catch(() => {});
    throw err;
  }

  return { finalUrl, contentType: response.headers.get('content-type') || '' };
}

module.exports = {
  SsrfError,
  isPublicAddress,
  assertSafeUrl,
  safeFetch,
  readBodyWithLimit,
  downloadToFile,
};
```

---

## Appendix D – nginx, Cloudflare and systemd

### D.1 Cloudflare Transform Rule (do this before the nginx change)

1. Generate the secret on the VPS: `openssl rand -hex 32`.
2. Cloudflare dashboard → `mediacrater.com` → Rules → create a **Request Header Transform Rule**.
3. **Match:** Hostname is in `host.mediacrater.com`, `test.mediacrater.com`, `<tools hostname>`. (Scoped so the secret isn't also sent to Vercel.)
4. **Action:** Set static, header `X-Origin-Auth`, value = the secret. Deploy.

### D.2 `/etc/nginx/snippets/cloudflare-origin-auth.conf`

Create with `sudo nano`, paste, replace the placeholder with the secret, then `sudo chmod 600` it.

```nginx
# /etc/nginx/snippets/cloudflare-origin-auth.conf
#
# Rejects any request that didn't come through YOUR Cloudflare zone.
# The firewall only proves a request came from Cloudflare; anyone can point
# their own Cloudflare account at this server's IP. Only your zone's
# Transform Rule adds this header with this value.
#
# Keep this file root-only (chmod 600). Generate the value with:
#   openssl rand -hex 32
# and paste the SAME value into the Cloudflare Transform Rule.

if ($http_x_origin_auth != "REPLACE_WITH_OUTPUT_OF_openssl_rand_hex_32") {
    return 444;
}
```

### D.3 `/etc/nginx/sites-available/mediacrater-test` (final)

Apply with: `sudo cp /etc/nginx/sites-available/mediacrater-test{,.bak}`, replace the file, `sudo nginx -t && sudo systemctl reload nginx`.

```nginx
# /etc/nginx/sites-available/mediacrater-test

# ── TEST site ─────────────────────────────────────────────
server {
    server_name test.mediacrater.com;

    # Only requests that came through our own Cloudflare zone.
    include /etc/nginx/snippets/cloudflare-origin-auth.conf;

    location / {
        client_max_body_size 200m;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Don't pass the origin secret on to the app (keeps it out of app logs).
        proxy_set_header X-Origin-Auth "";
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        # Connecting to Node on localhost takes milliseconds; 300s only hid outages.
        proxy_connect_timeout 10s;
        proxy_send_timeout 300s;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/test.mediacrater.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/test.mediacrater.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = test.mediacrater.com) {
        return 301 https://$host$request_uri;
    }
    server_name test.mediacrater.com;
    listen 80;
    return 404;
}
```

### D.4 `/etc/nginx/sites-available/mediacrater-api` (final, LIVE + drift monitor)

Same apply steps with `mediacrater-api`. Your server already has a large enough `server_names_hash_bucket_size` for the long tools hostname.

```nginx
# /etc/nginx/sites-available/mediacrater-api

# Drop anything that is not an exact known Host
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;

    # Dummy self-signed cert just so Nginx can complete the handshake then close
    # Generate once with:
    # openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    #   -keyout /etc/ssl/private/dummy.key -out /etc/ssl/certs/dummy.crt \
    #   -subj "/CN=invalid"
    ssl_certificate     /etc/ssl/certs/dummy.crt;
    ssl_certificate_key /etc/ssl/private/dummy.key;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    return 444;
}

server {
    server_name host.mediacrater.com;

    # Only requests that came through our own Cloudflare zone.
    include /etc/nginx/snippets/cloudflare-origin-auth.conf;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Don't pass the origin secret on to the app (keeps it out of app logs).
        proxy_set_header X-Origin-Auth "";
        proxy_cache_bypass $http_upgrade;
        
        # Large payloads
        client_max_body_size 250M;
       
        #Timeout for long deep scans
        proxy_read_timeout 300s;
        # Connecting to Node on localhost takes milliseconds; 300s only hid outages.
        proxy_connect_timeout 10s;
        proxy_send_timeout 300s;

    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/host.mediacrater.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/host.mediacrater.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}
server {
    if ($host = host.mediacrater.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name host.mediacrater.com;
    return 404; # managed by Certbot


}
server {
    server_name <tools hostname>;

    # Only requests that came through our own Cloudflare zone.
    include /etc/nginx/snippets/cloudflare-origin-auth.conf;

    location / {
        proxy_pass http://127.0.0.1:3876;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Origin-Auth "";
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/<tools hostname>/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/<tools hostname>/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}

server {
    if ($host = <tools hostname>) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    server_name <tools hostname>;

    listen 80;
    return 404; # managed by Certbot


}
```

### D.5 Drift monitor systemd override

`sudo systemctl edit` discards anything pasted below its "discarded" marker, so write the file directly:

```bash
sudo mkdir -p /etc/systemd/system/mediacrater-drift-monitor.service.d
sudo tee /etc/systemd/system/mediacrater-drift-monitor.service.d/override.conf >/dev/null <<'EOF'
[Service]
User=echobeehive223
Group=echobeehive223
ExecStart=
ExecStart=/usr/local/bin/node /home/echobeehive223/mediacrater-drift-monitor-live/src/index.js
NoNewPrivileges=true
PrivateTmp=true
EOF
sudo chown -R echobeehive223:echobeehive223 ~/mediacrater-drift-monitor-live
sudo systemctl daemon-reload && sudo systemctl restart mediacrater-drift-monitor
ps -o user=,args= -p "$(systemctl show -p MainPID --value mediacrater-drift-monitor)"
sudo ss -tlnp | grep 3876
```

Your result: `echobee+ /usr/local/bin/node /home/echobeehive223/mediacrater-drift-monitor-live/src/index.js` and `127.0.0.1:3876` (`ps` shortens long usernames; Node 24 names the process `MainThread`).

### D.6 Firewall and SSH

```bash
sudo ufw limit 22/tcp
sudo ufw status | grep 22      # 22/tcp LIMIT Anywhere, 22/tcp (v6) LIMIT Anywhere (v6)
sudo sshd -T | grep -Ei "^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication) "
# permitrootlogin no / passwordauthentication no / kbdinteractiveauthentication no
```

---

## Appendix E – Verification and troubleshooting commands

### Health and origin

```bash
# From any machine (normal path through Cloudflare)
curl -s https://host.mediacrater.com/health; echo                  # {"status":"ok",...}
curl -s https://test.mediacrater.com/health; echo                  # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" https://<tools hostname>/health   # 401

# From home, straight to the server (must fail)
curl -kS -m 5 -o /dev/null -w "%{http_code}\n" https://<VPS_PUBLIC_IP>/health -H "Host: test.mediacrater.com"; echo "exit $?"   # exit 28

# On the VPS, skipping Cloudflare (must be dropped). The --resolve hostname must match the URL
curl -sk --resolve test.mediacrater.com:443:127.0.0.1 https://test.mediacrater.com/health; echo "exit $?"   # exit 52
curl -sk --resolve host.mediacrater.com:443:127.0.0.1 https://host.mediacrater.com/health; echo "exit $?"   # exit 52
```

| curl exit | Meaning |
|---|---|
| 28 | Timeout: a firewall dropped the request |
| 7 | Connection refused: nothing listening |
| 52 | Empty reply: nginx closed it (`return 444`) |
| 0 + HTTP code | Reached the server |

### Is the API up? (CORS errors in the browser usually mean "no")

```bash
pm2 status
pm2 logs mediacrater-api-test --lines 40 --nostream
pm2 show mediacrater-api-test | grep -iE "node.js version|interpreter"
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS https://test.mediacrater.com/scan-image \
  -H "Origin: <test web origin>" -H "Access-Control-Request-Method: POST"
```

`204` = up and the origin is allowed · `502` = API down (read the logs) · `403` = origin not in `WEBSITE1`/`WEBSITE2`.

| Log line | Fix |
|---|---|
| `Cannot find module 'undici'` / `'ipaddr.js'` | `npm i undici ipaddr.js` |
| `Cannot find module './security/ssrf'` / `'./_shared/scanIdentity'` | File not copied |
| `requires Node >= 22.19 (this server runs 20.x)` | That process runs on Node 20 (see below) |
| `ReferenceError: File is not defined` (inside undici) | Same cause, before the version guard existed |
| `Cannot find module 'node-fetch'` | Old `checkout.js` still present; remove it, or `npm install node-fetch@2` as a stopgap |

### Which Node is running what

```bash
which -a node && node -v                   # your shell (nvm)
/usr/local/bin/node -v                     # PM2's and the drift monitor's
pm2 show mediacrater-api | grep -i "node.js version"
pm2 show mediacrater-api-test | grep -i "node.js version"
ps -o user=,args= -p "$(systemctl show -p MainPID --value mediacrater-drift-monitor)"
```

Re-register only TEST on a specific Node (doesn't restart LIVE):

```bash
pm2 delete mediacrater-api-test
pm2 start server.js --name mediacrater-api-test --interpreter /usr/local/bin/node
pm2 save
```

Avoid `pm2 kill` and `pm2 update` unless you mean to restart **both** apps.

### Listening ports and firewall

```bash
sudo ss -tlnp                 # APIs and 3876 must show 127.0.0.1
sudo ufw status verbose
sudo nginx -t
sudo nginx -T 2>/dev/null | grep -nE "cloudflare-origin-auth|server_name"
ls -l /etc/nginx/sites-enabled/   # should be links (->) to sites-available
grep -rn "real_ip" /etc/nginx/    # "Permission denied" on the snippet is expected
```

### Supabase

Audits 3a–3d are in [Appendix B](#appendix-b--sql). Return types of specific functions:

```sql
select p.proname, pg_get_function_result(p.oid) as returns
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('<function>', '<function>');
```

### Tests

```bash
cd /var/www/mediacrater-api-test && node --test security/ssrf.test.js     # # pass 28
```

---

## Appendix F – Rollback and maintenance

### Roll back the LIVE API code

```bash
pm2 stop mediacrater-api
sudo rsync -a --delete /var/www/mediacrater-api.bak-07oct26/ /var/www/mediacrater-api/
pm2 restart mediacrater-api && pm2 logs mediacrater-api --lines 30 --nostream
```

`deduct_scans` can stay in the database; the old code doesn't call it.

### Roll back the Supabase privilege changes (only if something broke)

Prefer fixing the single missing privilege. As a last resort, this restores Supabase's defaults for one table:

```sql
grant all on table public.<table> to anon, authenticated;
```

Don't restore `"Service role can insert scans"`; the service role never needed it.

### Roll back nginx

```bash
sudo cp /etc/nginx/sites-available/mediacrater-test.bak /etc/nginx/sites-available/mediacrater-test   # or mediacrater-api
sudo nginx -t && sudo systemctl reload nginx
```

If the Cloudflare rule is ever deleted or broken, every API request is dropped. Comment out the `include …cloudflare-origin-auth.conf;` lines and reload to restore access while you fix it.

### Rotate the origin secret without downtime

1. Generate a new value (`openssl rand -hex 32`).
2. Temporarily accept both values in the snippet, then reload nginx:

   ```nginx
   if ($http_x_origin_auth !~ "^(OLD_VALUE|NEW_VALUE)$") {
       return 444;
   }
   ```

3. Change the Cloudflare Transform Rule to the new value.
4. Remove the old value from the snippet and reload again.

### Remove the drift monitor override

```bash
sudo rm -r /etc/systemd/system/mediacrater-drift-monitor.service.d
sudo systemctl daemon-reload && sudo systemctl restart mediacrater-drift-monitor
```

(This brings back root and Node 20; only for emergencies.)

### Routine

- **Cloudflare IP ranges change rarely.** When they do, update both ufw and `/etc/nginx/conf.d/cloudflare-realip.conf` from `https://www.cloudflare.com/ips-v4` and `/ips-v6`.
- **New Supabase table:** revoke `anon` and match `authenticated` privileges to its policies (block 4 pattern).
- **New `security definer` function:** `revoke execute … from public, anon, authenticated; grant execute … to service_role;`.
- **Server-wide changes** (Node, PM2, nginx, ufw) affect TEST **and** LIVE. Check both apps' logs afterwards.
- **Before upgrading Node:** check `npm view undici engines` and the drift monitor's override.

---

*End of index.  
Conversation: (add this chat's link)*
