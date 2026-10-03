# VPS Hardening: Cloudflare-Only Firewall, Nginx Catch-All, SSH Lockdown, n8n Removal & SSRF Fix

| | |
|---|---|
| **Date** | 2 October 2026 (`02oct26`) |
| **Conversation** | https://claude.ai/chat/344c1200-b593-4d05-bab9-cd0f70039e9c |
| **Server** | Ubuntu 24.04 VPS, Nginx, PM2, Node 18, Certbot, Cloudflare (proxied) |
| **Apps** | Live API (`:3000`), Test API (`:3001`), Tools app (`:3876`) |
| **Starting trigger** | Scanner traffic hitting `/graphql` paths with a harvested `Origin: test.mediacrater.com` header, visible in the app's `[CORS-BLOCKED]` log lines |

> **Redaction note:** IP addresses, emails, API keys, signed URLs and the full `tools-…` hostname are left out on purpose. `YOUR_VPS_IP` and similar placeholders stand in for them. This file contains no secrets.

---

## Contents

1. [Summary](#1-summary)
2. [Status at a glance](#2-status-at-a-glance)
3. [Starting point and review of the Grok advice](#3-starting-point-and-review-of-the-grok-advice)
4. [Timeline: what we did, in order](#4-timeline-what-we-did-in-order)
5. [Errors and surprises](#5-errors-and-surprises)
6. [Corrections to my own advice](#6-corrections-to-my-own-advice)
7. [Open items checklist](#7-open-items-checklist)
8. [Reference: key paths and settings](#8-reference-key-paths-and-settings)
9. [Appendix A–F: final configs and code](#appendix-a--cf-syncsh-cloudflare-firewall--real-ip-sync)

---

## 1. Summary

We reviewed a Grok export about blocking subdomain probes, found gaps in its advice, and hardened the VPS step by step.

**Main outcomes**

- The origin now accepts ports 80/443 **only from Cloudflare IP ranges**. Direct-to-IP scanners time out at the firewall (verified).
- Nginx has a **catch-all default server** that closes unknown-Host requests with `444`.
- Nginx restores **real client IPs** from Cloudflare via a generated `cloudflare-realip.conf`.
- **SSH is key-only** (password login disabled, verified).
- **n8n was removed**. It was exposed to the internet on port 5678 through Docker, which bypasses UFW. Its data volume was inspected and deleted.
- A **Cloudflare WAF rule** blocks `/graphql` probe paths on the API hostnames (verified 403).
- A **525 outage** was diagnosed and fixed. The cause was TLS settings on the new default server block, plus a duplicate nginx master process.
- A **blind SSRF hole** in the video-URL duration check (`ffprobe` following redirects) was closed with a loopback guard proxy, without downloading the video. This was tested on the test copy.
- Test-environment code changes were rolled out to live. Two rollout errors were fixed.
- Backup strategy was discussed (git for code, pull-to-PC for secrets, host snapshots for the machine).

**Still open:** see [section 7](#7-open-items-checklist). The most important are `pm2 save`, the stale root PM2 daemon check, the `:3876` bind, the Resend key revocation, the pending `apt upgrade` and reboot, and a few unconfirmed code edits.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| UFW: Cloudflare-only 80/443 (v4 + v6) | ✅ Done, verified | 15 IPv4 + 7 IPv6 ranges; world-open 80/443 rules deleted; direct curl times out |
| Nginx real-IP restoration | ✅ Done, verified | Access log shows real client IPs, not Cloudflare IPs |
| Nginx default server (444) on 80 + 443 | ✅ Done, verified | 443 block needed the Certbot SSL options include (see 525 incident) |
| Nginx `proxy_pass` → `127.0.0.1`, `X-Forwarded-For` → `$remote_addr` | ✅ Done | Applied with `sed`; `nginx -t` passed |
| SSH key-only login | ✅ Done, verified | `sshd -T` shows password, kbd-interactive, root login all `no` |
| n8n removal | ✅ Done, verified | Container removed, UFW rule removed, volume deleted, `docker ps` empty |
| Cloudflare SSL/TLS mode | ✅ Changed to Full (strict) | Was "Automatic" |
| Cloudflare WAF rule (block `/graphql` paths) | ✅ Deployed, verified | `/graphql` returns 403 |
| 525 incident | ✅ Fixed | Both hostnames return 200 |
| Health-check cron moved off Cloudflare | ✅ Done | Now hits `127.0.0.1:3000/health` with retries |
| SSRF guard for `ffprobe` (test copy) | ✅ Done, tested | Short video scans, long video rejected, redirect-to-loopback blocked |
| Test → live rollout | ✅ Done | Fixed by copying the whole `queueManager.js`; all 4 scan types working |
| `/scan-image` route fix, new `getClientIp`, `logRequestOrigin` cleanup | ⚠️ Unconfirmed | Advised, but not confirmed applied |
| `scanImageUrl.js` replacement, `/queue-timing` ownership check | ⏳ Open | Not applied |
| Stale root PM2 daemon + `pm2 save` | ⏳ Open | `sudo pm2 list` output never reported |
| Tools app bind to `127.0.0.1` (`:3876`) | ⏳ Open | Still listening on all interfaces (UFW blocks it from outside) |
| Revoke old Resend key | ⏳ Open | Key lived in the deleted n8n instance |
| `apt upgrade` + reboot (kernel update) | ⏳ Open | Running kernel is behind the installed one |
| `certbot renew --dry-run`, `error_log` back to `warn` | ⚠️ Unconfirmed | Dry-run reported done once; log level not confirmed |

---

## 3. Starting point and review of the Grok advice

**What was shared:** a PDF export of a Grok conversation, plus:
- `ufw status` (22, 80, 443, 51820, 5678 all open to "Anywhere", v4 and v6)
- `server.js` for the API
- pasted PM2 logs showing `[CORS-BLOCKED]` hits on `/graphql`, `/api/graphql`, `/v1/graphql` from a GCP IP
- Nginx site files for `host.`, `test.` and a `tools-…` subdomain (no `default_server`)

**What Grok got right:** the `default_server` + `return 444` pattern is standard, and the probes were classic automated recon.

**Gaps I flagged in that advice**

1. `444` only catches wrong Host headers. Scanners get hostnames from certificate-transparency logs and send the right Host, so those requests still reach Node. The firewall is the real fix for direct-IP traffic.
2. "`cf-connecting-ip` is present, so you're behind Cloudflare" is a bad inference. With 80/443 open to the world, anyone can forge that header. `getClientIp()` trusted it first, so per-IP logic was spoofable.
3. A Cloudflare IP allowlist alone isn't airtight: another Cloudflare customer can proxy to your IP with your Host header. Authenticated Origin Pulls is the optional later fix.
4. Grok missed `5678/tcp` (n8n) open to the world, and SSH open to everyone.
5. Grok never confirmed `host.` and `test.` were actually proxied (orange cloud). A DNS-only record would break when the firewall closes.
6. Restricting port 80 can break Certbot HTTP-01 renewals, so a dry run is needed afterwards.

---

## 4. Timeline: what we did, in order

### Phase 1: Review and first plan

- I reviewed the Grok export and gave the critique above.
- I advised: confirm what is proxied by Cloudflare, generate the Cloudflare firewall rules and real-IP config with a script, fix `X-Forwarded-For`, update `server.js`, close or restrict `5678`, and use a WAF rule for `/graphql`.
- I also flagged other `server.js` issues:
  - `fetchUrlMetadata` follows redirects (SSRF), and `isPrivateAddress` misses several ranges.
  - `express.json({ limit: '150mb' })` runs before authentication.
  - The `tools-…` hostname is in CT logs, so its obscurity is not a secret.
  - The pasted log contained a user email and a signed CDN URL.

### Phase 2: Firewall lockdown to Cloudflare

**Commands (full script in [Appendix A](#appendix-a--cf-syncsh-cloudflare-firewall--real-ip-sync))**

1. Open a **second SSH session** as a safety net.
2. Save and run `/usr/local/sbin/cf-sync.sh` as root. It validates Cloudflare's published ranges, adds UFW rules, writes `/etc/nginx/conf.d/cloudflare-realip.conf`, and reloads nginx.
3. Remove the world-open rules, then test:

```bash
sudo ufw delete allow 80/tcp
sudo ufw delete allow 443/tcp
sudo ufw status numbered   # only 'cloudflare' comment rules should remain for 80/443

# Through Cloudflare (should work):
curl -s -o /dev/null -w '%{http_code}\n' https://host.mediacrater.com/health

# Direct to the VPS IP (should time out, exit 28):
curl -k --max-time 5 https://YOUR_VPS_IP/ ; echo "exit: $?"
```

**Your question:** "Why delete 80 and 443? Aren't those Cloudflare's ports?" They are, and they stay open, but only for Cloudflare's ranges. UFW allows a packet if any rule matches, so the "Anywhere" rules made the Cloudflare-only rules decorative. `ufw delete allow 80/tcp` removes only the exact "Anywhere" rule.

**Result:** `200` through Cloudflare, and `curl: (28) Connection timed out` direct to the IP (exit 28). Your pasted direct-IP command had markdown link syntax mixed in, so I noted the test only counts if the real IP was typed.

### Phase 3: Verification pass

**Commands**

```bash
sudo ufw status numbered | grep -E '80|443'
curl -s -o /dev/null -w '%{http_code}\n' https://test.mediacrater.com/
curl -s -o /dev/null -w '%{http_code}\n' https://<tools-hostname>/
sudo certbot renew --dry-run
sudo tail -n 20 /var/log/nginx/access.log
```

**Results**

- Screenshot showed all Cloudflare ranges present (v4 and v6) and no world-open 80/443 rules.
- `test.` returned **404** and the tools subdomain returned **401**, so both are proxied. The 404 body size matched Express's default, so test is a live API.
- `certbot renew --dry-run` was reported done (output not pasted).
- The access log showed your own IP (not a Cloudflare IP), so real-IP restoration works. Let's Encrypt validations from non-Cloudflare IPv6 addresses were most likely forwarded through Cloudflare. That was an inference, so I asked you to confirm with direct-IP curls.

I also found that the extension origin (`chrome-extension://…`) was being 403'd on `/scan-video`, meaning real extension scans were failing.

### Phase 4: Extension pivot, IPv6, n8n and test lockdown

- **Direct-IP curls timed out** (IPv4 and IPv6). You didn't think you had IPv6; later `ip -6 addr` showed a public IPv6 address.
- **Extension pivot:** you moved the extension to a standalone, local-only addon. So I said to skip the extension-origin snippet, leave `allowedOrigins` as `WEBSITE1`/`WEBSITE2`, and unset `CHROME_EXTENSION_ID`.
  - Pushbacks: an extension listing gives little SEO value, and Meta's terms restrict automated collection from the Ad Library.
- **n8n:** you didn't use it, so deleting it was the better path.
- **WAF action:** use **Block** (Managed Challenge is for ambiguous traffic). Scope the rule to the API hostnames.
- **Test hostname lock:** I suggested an IP-allow rule for `test.`. You declined because your ISP rotates your IP monthly. Cloudflare Access (one-time PIN) was noted as a later option.
- `sed` command to switch `proxy_pass` to `127.0.0.1` and `X-Forwarded-For` to `$remote_addr` (see [Appendix B](#appendix-b--nginx-default-server-blocks-final-and-sed-edits)).

### Phase 5: Consolidated to-do list and step-by-step plan

You asked for a list of everything not yet done (17 items), then ran checks #6, #7, #8:

```bash
sudo ufw status verbose | grep Default      # deny (incoming), allow (outgoing), deny (routed)
sudo sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin)'
ip -6 addr show scope global
```

**Results:** default deny incoming (good); `permitrootlogin no` but **`passwordauthentication yes`** (a real risk with SSH open to the world); the VPS has a public IPv6 address.

I then gave a six-step plan. What you ran, with results:

| Step | Commands | Result |
|---|---|---|
| **1. Remove n8n** | `ss -tlnp \| grep 5678`, `docker ps`, `pm2 list`, then `docker stop` / `docker rm n8n-introspel-n8n-1`, `ufw delete allow 5678/tcp` | `docker-proxy` was listening on 5678. Container stopped and removed; both v4 and v6 UFW rules deleted |
| Compromise checks | `last -a`, `ps aux --sort=-%cpu`, `crontab -l`, `ls /etc/cron.d`, `cat ~/.ssh/authorized_keys` | Nothing suspicious; root's `authorized_keys` was empty |
| **2. SSH key-only** | Key login test, then the `00-hardening.conf` drop-in ([Appendix C](#appendix-c--ssh-hardening-drop-in)), `sshd -t`, reload | `sshd -T` shows `no` for password, kbd-interactive and root login |
| **3. Nginx edits** | Backup + `sed` + `nginx -t` + reload | Syntax OK |
| **4a. IP-header grep** | `grep -rniE "cf-connecting-ip\|x-forwarded-for\|true-client-ip" --include=*.js . --exclude-dir=node_modules` | Hits in `server.js` lines 74, 80, 86 (`getClientIp`) and 450 (`logRequestOrigin`) |
| **5. WAF rule** | Dashboard rule (screenshot taken before clicking Deploy) | Not yet live at that point |

Two findings from that output:

- **Two PM2 daemons** (root and your user) and two `server.js` processes, one running as root.
- The root crontab runs `curl https://host.mediacrater.com/health || pm2 restart mediacrater-api` every 5 minutes. That became important in the 525 incident.

I also noted the `apt` backlog (87 updates, kernel update pending).

### Phase 6: The 525 incident

**Symptoms**

- `curl https://host.mediacrater.com/health` returned **525** (SSL handshake failed), and `/graphql` also showed 525 because the WAF rule wasn't live yet.
- The dashboard showed "Failed to fetch", CORS preflight errors, `X-Frame-Options` errors in the `/cf-ok` iframe, and a `525` on `/cf-ok`. All were side effects of Cloudflare's error page being returned.
- Risk: the cron health check went through Cloudflare, so during the 525 it could restart the API every 5 minutes and kill in-flight scans.

**Commands and results (in order)**

1. Cron fix (you did this):
   ```
   */5 * * * * curl -sf --max-time 10 --retry 2 --retry-delay 15 --retry-all-errors http://127.0.0.1:3000/health >/dev/null || sudo -u echobeehive223 pm2 restart mediacrater-api
   ```
2. Local handshake test: `curl --resolve host.mediacrater.com:443:127.0.0.1 https://host.mediacrater.com/health` returned **200**. `nginx error.log` showed `connect() failed (111)` to `[::1]:3000`. That was harmless (IPv6 loopback fallback) and the `127.0.0.1` change removes it.
3. n8n data inspection (before deletion):
   ```bash
   sudo apt install -y sqlite3
   sudo sqlite3 /var/lib/docker/volumes/n8n-introspel_n8n_data/_data/database.sqlite \
     "select name,type from credentials_entity; select name,active from workflow_entity;"
   ```
   Found one stored **Resend API key**, an inactive "My workflow", and an active "Church Schedule Monitor" (you built it yourself, so the box was **not** treated as compromised). Then `docker volume rm n8n-introspel_n8n_data`.
4. Listening-port audit: `sudo ss -tulnp | grep -vE '127\.0\.0\.|\[::1\]'` showed only 22, 80, 443, and Node on `*:3876`. `docker ps` was empty.
5. Per-hostname certificate check, `certbot certificates`, `nginx -T | grep …`: all three certs valid (48 to 67 days left), default 444 block present.
6. You changed Cloudflare SSL/TLS to **Full (strict)** (was Automatic). Retest from your PC still returned 525.
7. Enabled handshake logging:
   ```bash
   sudo sed -i 's#^\(\s*error_log /var/log/nginx/error.log\).*#\1 info;#' /etc/nginx/nginx.conf
   sudo nginx -t && sudo systemctl reload nginx
   sudo grep -iE 'ssl|handshake' /var/log/nginx/error.log | grep -v '\[::1\]' | tail -n 20
   ```
   Found `SSL_do_handshake() failed (SSL: error:0A0000BA:SSL routines::bad cipher)` from Cloudflare IPs.
8. **Fix:** added `include /etc/letsencrypt/options-ssl-nginx.conf;` to the default 443 server block, then did a **full restart** (earlier output showed two nginx master PIDs, which a reload doesn't clean up):
   ```bash
   sudo nginx -t && sudo systemctl restart nginx
   ps -ef | grep '[n]ginx: master'      # exactly one line
   ```
9. **Result:** `host.` and `test.` both return **200**.

**Cause (honest uncertainty):** either the missing cipher settings in the default block or the duplicate master process (or both). The fix addressed both, so we can't say which one mattered.

**Follow-up advice:** set `error_log` back to `warn`; confirm the catch-all still drops unknown hosts (`curl -sk --resolve bogus.example:443:127.0.0.1 https://bogus.example/` should print `000`); add `ssl_protocols TLSv1.2 TLSv1.3;` to the default block (global config still allows TLS 1.0/1.1).

### Phase 7: `server.js` and request-handling review

**On your pasted test `server.js` I flagged**

- `/scan-image` was routed to **`handleScanVideo`** (my "do the same for /scan-image" wording had invited a copy-paste error). Fixed route: `handleScanImage`, `requestLimit` 7, `bigJson`, `logRequestOrigin`.
- `getClientIp` still trusted three client-settable headers. Replacement reads `X-Real-IP` (set by nginx after real-IP restoration), falling back to the socket address.
- Cleanups: `logRequestOrigin` no longer needs the extension check, and `fetchUrlMetadata` should cancel the response body after reading headers.

**PM2 and ports**

- `ss -tlnp | grep -E ':3000|:3001'` showed both apps on `127.0.0.1`, owned by the `echobeehive223` PM2 daemon. So the bind change worked.
- Advice: run `sudo pm2 list`. If root has a stale `mediacrater-api`, delete it, then `pm2 save` for both daemons.

**`requestLimiter.js` review**

- It keys on user ID + route, so my `req.ip` worry didn't apply.
- Gaps: it only protects authenticated routes (junk tokens still cost a Supabase call each; per-IP limits belong in nginx/Cloudflare), and `/queue-timing/:jobId` has no ownership check or rate limit.

**`scanImageUrl.js` vs `scanVideoUrl.js`**

- The video handler had `claimRunningJob` (ownership-checked job claiming) and `failEarly` (frees the queue slot on early errors). The image handler lacked both. I provided a full replacement `scanImageUrl.js` in the chat (apply after confirming `claimRunningJob` exists in `queueManager.js`).

### Phase 8: SSRF in the video-URL duration check

**Review of `helpers.js` and `utils/probeVideoDuration.js`**

- `analyzeVideoUrlWithAI` and `analyzeImageUrlWithAI` pass the URL to Qwen, which fetches it, so your server isn't exposed there.
- `ffprobe` opens the URL **itself**, follows redirects on its own, and does its own DNS lookup. A public URL could 302 to `127.0.0.1` services (blind SSRF). The `-protocol_whitelist` and HTTPS check only cover the first URL.
- Other notes: the image prompt in `helpers.js` is out of sync with the video prompt; AI output must be rendered as plain text; DashScope error text may echo signed URLs; `aiData` and `[ASR] raw` logs are noisy.

**First fix (rejected):** download the file to a temp path with `undici`, then probe locally. **You objected** (the point of this feature is to check duration *without* downloading). I withdrew it. If you installed it: `npm un undici` in both folders.

**Final fix:** a tiny loopback-only CONNECT proxy inside the Node process. It does DNS itself, refuses private IPs, connects to the validated IP, only tunnels port 443, and cuts off after 10 MB. `ffprobe` is forced through it with `-http_proxy`. Code: [Appendix E](#appendix-e--final-ssrf-guard-code).

**Testing, errors and results (in order)**

| # | Test | Result |
|---|---|---|
| 1 | Fail-closed test: `ffprobe -http_proxy http://127.0.0.1:1 … <url>` | `Connection refused` on `tcp://127.0.0.1:1`, so the proxy flag is honoured. Your URL wasn't quoted, so the shell treated each `&` as "run in background" (the `[1] Done` job spam). Always single-quote URLs |
| 2 | Applied files and scanned both videos | **Both rejected.** Log: `Protocol 'httpproxy' not on whitelist 'http,https,tcp,tls,crypto'`. My omission |
| 3 | Added `httpproxy` to `-protocol_whitelist` | **Short video scans, long video returns `URL_VIDEO_TOO_LONG`** |
| 4 | `httpbin` redirect-to-loopback pasted into the web app | Blocked earlier with "Only HTTPS URLs are supported". That comes from the server-side `assertPublicFetchUrl` (the redirect guard in `safeFetch`), not ffprobe |
| 5 | `node -e` direct probe of the redirect URL | `REJECTED … Server returned 403 Forbidden (access denied)` |
| 6 | `pm2 logs … \| grep -i health` | Empty, but meaningless: `server.js` doesn't log requests, so this proved nothing |
| 7 | Throwaway listener on `127.0.0.1:3999` + redirect to it | `REJECTED … 403`, **no `HIT LOOPBACK`**. Redirect and DNS-rebinding paths are closed |

**Untested:** redirects to private IPs over HTTPS, or to hostnames that resolve to private IPs. The proxy blocks them in code, but we didn't prove it.

### Phase 9: Rollout to live and the errors it caused

- I advised diffing test against live before copying, then restarting live and running four scans (video upload, image upload, video URL, image URL).
- **Errors on live**
  - `queueManager.userHasPendingScan is not a function` (from `routes/scanVideoUrl.js`)
  - `MODULE_NOT_FOUND` (the first line naming the module was cut off in the paste)
  - Image upload, video upload and image URL worked; **only video URL failed**.
- **Cause (inferred):** live's `queueManager.js` was older than test's.
- **Fix (yours):** copied the **entire** test `queueManager.js` over live's. All scans then worked. The `MODULE_NOT_FOUND` was probably stale, but we never saw its first line, so its exact cause is unconfirmed.
- I warned that copying whole files can overwrite live-only changes. You explained your workflow (always edit test first, env-driven values via `process.env`, identical code in both), so live should never hold changes test lacks.

### Phase 10: Workflow and backups

- **Test is not a backup:** same disk as live, no history, and often mid-edit.
- **Suggested:** `git init` in test (with `.env`, `node_modules/` and `*.log` gitignored), a private repo, and an `rsync --dry-run --itemize-changes` deploy from test to live (no `--delete`). Also an `.env` variable-name diff between the two environments (names only, never values):
  ```bash
  diff <(cut -d= -f1 /var/www/mediacrater-api-test/.env | sort) <(cut -d= -f1 /var/www/mediacrater-api/.env | sort)
  ```
- **Zip to Slack, pushback:**
  - Zips would include both `.env` files, and Slack is a third party.
  - There's no history or diffing.
  - Slack's upload API needs a bot token with `files:write`.
  - A restart trigger would spam during crash loops.
  - Better: Slack as a **failure notification**, not storage.
- **Recommended setup:**
  - Daily git push of the test repo (deploy key, one repo).
  - Encrypted offsite backup with `restic` for secrets and configs.
  - Host snapshots for the whole machine.
- **Your idea (keep `.env` files on your PC):** agreed, with a **pull-from-PC** script (the server never holds credentials to the backup location). It copies both `.env` files, `sites-enabled`, `cf-sync.sh` and the crontab, and keeps 30 days. Caveats: encrypt the PC disk, keep a second copy of keys in a password manager, and remember the copy goes stale if you rotate keys.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | **525 on `host.` and `test.`**, dashboard "Failed to fetch" | Default 443 block had no cipher settings (and a duplicate nginx master process existed) | Added the Certbot SSL options include; full `systemctl restart nginx` |
| 2 | CORS preflight errors, `X-Frame-Options` errors, `/cf-ok` 525 | Side effects of Cloudflare's 525 error page | Went away with the 525 fix |
| 3 | Cron health check could restart the API every 5 minutes | It curled through Cloudflare; a 525 counted as failure | Pointed it at `127.0.0.1:3000/health` with retries |
| 4 | `[::1]:3000 connection refused` in nginx error log | `localhost` resolved to IPv6 loopback first; Node listened on IPv4 | Harmless; `127.0.0.1` in `proxy_pass` removes it |
| 5 | Direct-IP curl command pasted with markdown link syntax | Copy-paste artifact | Re-run with the plain IP |
| 6 | `sudo # comment…` printed sudo's usage text | Comment line pasted after `sudo` | Harmless |
| 7 | `diff: /root/sites-enabled.bak: Permission denied` | Needed `sudo` | Not important at that point |
| 8 | n8n port 5678 stayed reachable after being closed in UFW (design point) | **Docker publishes ports through its own iptables rules, bypassing UFW** | Removing the container closed it. `docker ps` empty afterwards |
| 9 | `[1] Done` job spam when testing `ffprobe` | Unquoted URL containing `&` | Single-quote URLs |
| 10 | `Protocol 'httpproxy' not on whitelist` | My whitelist omitted `httpproxy` | Added to `-protocol_whitelist` |
| 11 | `httpbin` redirect test blocked in the web app | Server-side `assertPublicFetchUrl` rejects the redirected `http://` hop | Used a direct `node -e` probe instead |
| 12 | `/scan-image` routed to `handleScanVideo` | Copy-paste from my "do the same" instruction | Corrected route provided |
| 13 | `queueManager.userHasPendingScan is not a function` on live | Live `queueManager.js` older than test's | Copied the whole test `queueManager.js` to live |
| 14 | `MODULE_NOT_FOUND` on live | Probably stale from an earlier restart (first line not captured) | Not reproduced after the sync |

---

## 6. Corrections to my own advice

These were mistakes or weak spots in what I told you during the session:

1. **Test ordering for the firewall lockdown:** I told you to test with the world-open rules still active, which passes whether or not the Cloudflare rules work. The meaningful test is *after* deleting them.
2. **Cron health check dependency:** I missed that your root crontab restarts PM2 when `/health` fails through Cloudflare. A 525 would have caused restart loops.
3. **"Cron the sync script":** it only adds ranges and never removes retired ones. Re-run manually every few months instead.
4. **`ufw delete allow 5678/tcp`:** moot, because Docker bypassed UFW. Removing the container was the real fix.
5. **Download-to-VPS probe fix:** it contradicted your core requirement. Replaced with the proxy approach.
6. **`httpproxy` omission** in the first proxy version of the whitelist.
7. **`pm2 logs | grep health`** as a redirect test proved nothing, because requests aren't logged.
8. **`claimRunningJob` "already exists":** true on test only, not live, until `queueManager.js` was synced.
9. **Early 525 explanation:** I first treated it as a VPS-only curl quirk. It was a real TLS problem.

---

## 7. Open items checklist

### Do next (highest value)

- [ ] `sudo pm2 list`. If root lists `mediacrater-api`, `sudo pm2 delete mediacrater-api && sudo pm2 save`. Then `sudo -u echobeehive223 pm2 save`
- [ ] Bind the tools app (`:3876`) to `127.0.0.1`. Check: `nc -zv -w5 YOUR_VPS_IP 3876` should time out from outside
- [ ] Revoke the old **Resend API key** that lived in n8n
- [ ] `sudo apt update && sudo apt upgrade`, then **reboot** (kernel update pending). Do it when no scans are running
- [ ] `sudo certbot renew --dry-run`
- [ ] Set `error_log` back to `warn` in `/etc/nginx/nginx.conf`, then `sudo nginx -t && sudo systemctl reload nginx`

### Confirm / apply code changes

- [ ] Confirm these are applied in **both** test and live `server.js`:
  - `/scan-image` route uses `handleScanImage`
  - new `getClientIp` (reads `X-Real-IP`)
  - `logRequestOrigin` simplified to `allowedOrigins.includes(origin)`
  - `await response.body?.cancel()` in `fetchUrlMetadata`
- [ ] Apply the replacement `routes/scanImageUrl.js` (after `grep -c claimRunningJob queueManager.js` ≥ 1), then test one queued image-URL scan
- [ ] Add `.eq('user_id', req.user.id)` to `/queue-timing/:jobId` (if `scan_queue` has `user_id`) and a `requestLimit`
- [ ] Unset `CHROME_EXTENSION_ID` in `.env` and restart PM2 with `--update-env`
- [ ] Run the IP-header grep in `/var/www/mediacrater-api` (not just test)
- [ ] `npm un undici` in both folders, if you installed it

### Security checks to finish

- [ ] Confirm password SSH is refused: `ssh -o PubkeyAuthentication=no echobeehive223@YOUR_VPS_IP` should say `Permission denied (publickey)`
- [ ] Read `/home/echobeehive223/.ssh/authorized_keys` and confirm every key is yours
- [ ] Confirm the 28 June logins (root and your user) from the unfamiliar IP were you
- [ ] Add `ssl_protocols TLSv1.2 TLSv1.3;` to the default 443 server block
- [ ] Re-test the catch-all: `curl -sk -o /dev/null -w '%{http_code}\n' --resolve bogus.example:443:127.0.0.1 https://bogus.example/` should print `000`
- [ ] Optionally test the SSRF guard against a redirect to a hostname resolving to a private IP

### Later / lower priority

- [ ] Deploy the SSRF guard (already in live via the test sync). Re-test the four scan types after any further changes
- [ ] Fix the stale image prompt in `helpers.js` (starts with a truncated line and lacks the newer IP / subjective-comparison / speculative-findings rules)
- [ ] Scrub URLs from DashScope error text; drop the `aiData` and `[ASR] raw` logs
- [ ] Log user IDs, not emails
- [ ] nginx `limit_req` per IP (I offered to write it)
- [ ] Lock down `test.mediacrater.com` with Cloudflare Access (not an IP rule, given your rotating IP) and put the `tools-…` hostname behind Access
- [ ] Authenticated Origin Pulls (stops other Cloudflare tenants proxying to your IP)
- [ ] Re-run `cf-sync.sh` manually every few months
- [ ] Move off Node 18 (Supabase client deprecation warning)
- [ ] Check Meta's Ad Library terms before building distribution around the addon
- [ ] Backups: git + private repo, pull-to-PC script, host snapshots (see Phase 10)
- [ ] Add an external uptime monitor (the local health check can't see nginx/cert outages)

---

## 8. Reference: key paths and settings

| Item | Value |
|---|---|
| Live app | `/var/www/mediacrater-api` (port 3000) |
| Test app | `/var/www/mediacrater-api-test` (port 3001) |
| PM2 apps | `mediacrater-api`, `mediacrater-api-test` (under the `echobeehive223` daemon) |
| Tools app | Port 3876 (nginx proxies to it; still bound to all interfaces) |
| Nginx sites | `/etc/nginx/sites-enabled/mediacrater-api` (also holds the default server blocks), `/etc/nginx/sites-enabled/mediacrater-test` |
| Real-IP config | `/etc/nginx/conf.d/cloudflare-realip.conf` (generated) |
| Cloudflare sync script | `/usr/local/sbin/cf-sync.sh` |
| Dummy certificate (default server) | `/etc/ssl/certs/dummy.crt`, `/etc/ssl/private/dummy.key` |
| SSH hardening drop-in | `/etc/ssh/sshd_config.d/00-hardening.conf` |
| Nginx backup of site files | `/root/sites-enabled.bak` |
| Cloudflare SSL/TLS mode | Full (strict) |
| WAF rule | Custom rule, action **Block**, `/graphql` paths on `host.` and `test.` |
| Health check | Root and user crontab: `curl http://127.0.0.1:3000/health` every 5 min |
| Docker | Empty (`docker ps`); n8n volume deleted |

---

## Appendix A — `cf-sync.sh` (Cloudflare firewall + real-IP sync)

Save as `/usr/local/sbin/cf-sync.sh`, run as root with a second SSH session open.

```bash
#!/usr/bin/env bash
set -euo pipefail

fetch() {  # $1 = v4|v6, $2 = validation regex
  local out
  out=$(curl -fsS --proto '=https' --tlsv1.2 --max-time 20 "https://www.cloudflare.com/ips-$1")
  [ -n "$out" ] || { echo "empty $1 list" >&2; exit 1; }
  while IFS= read -r line; do
    [[ $line =~ $2 ]] || { echo "unexpected entry: $line" >&2; exit 1; }
  done <<< "$out"
  printf '%s\n' "$out"
}

mapfile -t V4 < <(fetch v4 '^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$')
mapfile -t V6 < <(fetch v6 '^[0-9a-fA-F:]+/[0-9]{1,3}$')
[ "${#V4[@]}" -gt 5 ] && [ "${#V6[@]}" -gt 3 ] || { echo "list validation failed" >&2; exit 1; }

for c in "${V4[@]}" "${V6[@]}"; do
  ufw allow proto tcp from "$c" to any port 80,443 comment 'cloudflare'
done

{
  echo "# generated by cf-sync.sh"
  for c in "${V4[@]}" "${V6[@]}"; do echo "set_real_ip_from $c;"; done
  echo "real_ip_header CF-Connecting-IP;"
} > /etc/nginx/conf.d/cloudflare-realip.conf

nginx -t && systemctl reload nginx
```

Then remove the world-open rules (`sudo ufw delete allow 80/tcp`, `sudo ufw delete allow 443/tcp`) and verify as in Phase 2.

---

## Appendix B — Nginx default server blocks (final) and `sed` edits

**Top of `/etc/nginx/sites-enabled/mediacrater-api`** (before the other server blocks). Only one pair of default servers should exist across all site files.

```nginx
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

    # Dummy self-signed cert, generated once with:
    # sudo openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    #   -keyout /etc/ssl/private/dummy.key -out /etc/ssl/certs/dummy.crt \
    #   -subj "/CN=invalid"
    ssl_certificate     /etc/ssl/certs/dummy.crt;
    ssl_certificate_key /etc/ssl/private/dummy.key;
    include /etc/letsencrypt/options-ssl-nginx.conf;   # the 525 fix
    # Recommended addition: ssl_protocols TLSv1.2 TLSv1.3;

    return 444;
}
```

**`proxy_pass` and `X-Forwarded-For` edits**

```bash
sudo cp -rL /etc/nginx/sites-enabled /root/sites-enabled.bak
sudo sed -i --follow-symlinks \
  -e 's#proxy_pass http://localhost:#proxy_pass http://127.0.0.1:#' \
  -e 's#\$proxy_add_x_forwarded_for#$remote_addr#' \
  /etc/nginx/sites-enabled/mediacrater-api /etc/nginx/sites-enabled/mediacrater-test
sudo nginx -t && sudo systemctl reload nginx
```

`--follow-symlinks` matters because plain `sed -i` would replace the symlinks in `sites-enabled` with regular files.

---

## Appendix C — SSH hardening drop-in

Confirm key login works from a **second terminal** before applying.

```bash
ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no echobeehive223@YOUR_VPS_IP

sudo tee /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sudo sshd -t && sudo systemctl reload ssh
sudo sshd -T | grep -Ei '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin)'
```

The `00-` prefix matters because sshd uses the first value it sees, and cloud images often ship a drop-in that re-enables passwords.

---

## Appendix D — Cloudflare WAF rule

Zone → Security → WAF → Custom rules → Create rule. Action: **Block**. Give it a descriptive name, since it appears in audit logs.

```
(http.host in {"host.mediacrater.com" "test.mediacrater.com"} and http.request.uri.path in {"/graphql" "/api/graphql" "/v1/graphql"})
```

Verify:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://host.mediacrater.com/graphql   # 403
curl -s -o /dev/null -w '%{http_code}\n' https://host.mediacrater.com/health    # 200
```

If you ever add an IP-allow rule for `test.`, it must not block `/.well-known/acme-challenge/*`, or Certbot renewals for that hostname will fail.

---

## Appendix E — Final SSRF guard code

### `utils/netGuard.js`

```js
const net = require('net');

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family === 6) {
    const n = address.toLowerCase();
    if (n === '::' || n === '::1') return true;
    const mapped = n.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      n.startsWith('::ffff:') || n.startsWith('64:ff9b:') ||
      n.startsWith('fc') || n.startsWith('fd') ||
      /^fe[89ab]/.test(n) || n.startsWith('ff')
    );
  }
  return true;
}

module.exports = { isPrivateAddress };
```

In `server.js`: delete the local `isPrivateAddress` and add `const { isPrivateAddress } = require('./utils/netGuard');`.

### `utils/probeVideoDuration.js` (with the `httpproxy` fix)

```js
const { execFile } = require('child_process');
const http = require('http');
const net = require('net');
const dns = require('dns').promises;
const { isPrivateAddress } = require('./netGuard');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_PROXY_BYTES = 10 * 1024 * 1024; // hard cap on what ffprobe can pull

let proxyPromise = null;

function startProbeProxy() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => { res.writeHead(403); res.end(); });

    server.on('connect', async (req, client) => {
      client.on('error', () => client.destroy());
      try {
        const u = new URL('https://' + req.url);
        const host = u.hostname.replace(/^\[|\]$/g, '');
        const port = Number(u.port || 443);
        if (port !== 443) throw new Error('port');

        const addrs = await dns.lookup(host, { all: true });
        if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
          throw new Error('blocked');
        }

        const upstream = net.connect({ host: addrs[0].address, port });
        upstream.setTimeout(20000, () => upstream.destroy());
        let bytes = 0;
        upstream.on('data', (c) => {
          bytes += c.length;
          if (bytes > MAX_PROXY_BYTES) { upstream.destroy(); client.destroy(); }
        });
        upstream.on('error', () => client.destroy());
        upstream.on('close', () => client.destroy());
        client.on('close', () => upstream.destroy());
        upstream.once('connect', () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          upstream.pipe(client);
          client.pipe(upstream);
        });
      } catch {
        client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function getProxy() {
  if (!proxyPromise) proxyPromise = startProbeProxy();
  return proxyPromise;
}

async function probeVideoDurationSeconds(sourceUrl, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ffprobePath = process.env.FFPROBE_PATH || 'ffprobe',
  } = options;

  if (typeof sourceUrl !== 'string' || !/^https:\/\//i.test(sourceUrl)) {
    throw new Error('Only HTTPS video URLs can be checked.');
  }

  const proxy = await getProxy();
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;

  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      [
        '-v', 'error',
        '-protocol_whitelist', 'http,https,tcp,tls,crypto,httpproxy',
        '-http_proxy', proxyUrl,
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        sourceUrl,
      ],
      {
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH, http_proxy: proxyUrl },
      },
      (error, stdout) => {
        if (error) return reject(error);
        const d = Number.parseFloat(String(stdout).trim());
        if (!Number.isFinite(d)) return reject(new Error('Could not determine video duration.'));
        resolve(d);
      }
    );
  });
}

module.exports = { probeVideoDurationSeconds };
```

`scanVideoUrl.js` needs no change (it still calls `probeVideoDurationSeconds(sourceUrl)`).

**Tradeoffs:** a video whose header sits at the end of the file (with no range support) fails with "duration unknown" once it hits the 10 MB cap (fails closed). Redirects to plain `http://` are blocked (the proxy only tunnels port 443). If `URL_SCAN_ALLOWED_HOSTS` is set, only the first hop is allowlisted; later hops only need a public IP.

**Redirect-guard test (listener):**

```bash
node -e "
const http = require('http');
http.createServer((q, r) => { console.log('HIT LOOPBACK', q.url); r.end('x'); })
  .listen(3999, '127.0.0.1', async () => {
    try {
      const d = await require('./utils/probeVideoDuration')
        .probeVideoDurationSeconds('https://httpbin.org/redirect-to?url=http://127.0.0.1:3999/hit');
      console.log('DURATION', d);
    } catch (e) {
      console.log('REJECTED', e.message.split('\n').slice(1).join(' | ').slice(0, 200));
    }
    process.exit();
  });
"
```

Expected: `REJECTED` and **no** `HIT LOOPBACK` line.

---

## Appendix F — Other `server.js` changes advised

```js
// getClientIp: nginx overwrites X-Real-IP, and Node only listens on loopback
function getClientIp(req) {
  return String(req.headers['x-real-ip'] || req.socket.remoteAddress || '')
    .replace(/^::ffff:/, '')
    .trim();
}

// Bind to loopback only
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Mediacrater Video API running on port ${PORT}`);
});

// Replace the global 150 MB JSON parser; big bodies only after auth on the scan routes
const bigJson = express.json({ limit: '150mb' });
const smallJson = express.json({ limit: '1mb' });
const BIG_BODY_PATHS = new Set(['/scan-video', '/scan-image']);
app.use((req, res, next) =>
  BIG_BODY_PATHS.has(req.path) ? next() : smallJson(req, res, next)
);

// Corrected /scan-image route (note handleScanImage, not handleScanVideo)
app.post('/scan-image', authenticateUser,
  requestLimit({ maxRequests: 7, windowMs: 60_000 }),
  bigJson,
  logRequestOrigin,
  (req, res) => handleScanImage(req, res, supabase, qwenCloudConfig, helpers, queueManager)
);
```

Other changes provided in the chat, not repeated here (open the conversation link for the full code):

- Replacement `isPrivateAddress` (now in `netGuard.js`, see Appendix E).
- `safeFetch` + `fetchUrlMetadata` that validate every redirect hop (`redirect: 'manual'`, max 3 hops, 10 s timeout).
- Full replacement `routes/scanImageUrl.js` (adds `claimRunningJob` ownership check and `failEarly` queue-slot cleanup).

---

*End of index. Conversation: https://claude.ai/chat/344c1200-b593-4d05-bab9-cd0f70039e9c*
