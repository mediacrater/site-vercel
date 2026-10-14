# URL Scans: SSRF Protection Review and Verification (IP-Range Test, Redirect Test, Code Audit, Remaining Gaps)

| | |
|---|---|
| **Date** | 14 October 2026 (`14oct26`) |
| **Destination** | changelogs/server |
| **Conversation** | Not available to me. Paste this chat's URL here when you file this. |
| **Related prior work** | `url-scan-thumbnail-download-via-safefetch-14oct26.md`<br>`live-api-rollout-and-production-process-audit-14oct26.md`<br>`url-scan-expired-link-error-message-14oct26.md` |
| **Stack** | Node API on the VPS (`security/ssrf.js`, `utils/netGuard.js`, `utils/probeVideoDuration.js`, `utils/urlThumbnail.js`, `routes/scanVideoUrl.js`, `/resolve-url` in `server.js`) |
| **Starting trigger** | URL scans make your VPS fetch user-supplied links. Before relying on that you asked me to look at the code and confirm it blocks private and internal addresses |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included. `VPS_IPV4`, `VPS_IPV6`, `<customer uuid>`, `<your test account uuid>` and similar placeholders stand in for them. Real accounts are described by what happened, not by ID.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied (an expected output is given). ⏳ = open.

---
## Contents

1. [1. Summary](#1-summary)
2. [2. Status at a glance](#2-status-at-a-glance)
3. [3. Starting point](#3-starting-point)
4. [4. Timeline: what we did, in order](#4-timeline-what-we-did-in-order)
5. [5. Errors and surprises](#5-errors-and-surprises)
6. [6. Corrections / important decisions](#6-corrections--important-decisions)
7. [7. Open items checklist](#7-open-items-checklist)
8. [8. Reference: key settings](#8-reference-key-settings)
9. [Appendix A – IP-range test (as run)](#appendix-a--ip-range-test-as-run)
10. [Appendix B – Code audit commands and output](#appendix-b--code-audit-commands-and-output)
11. [Appendix C – Hostname and scheme tests (not yet run)](#appendix-c--hostname-and-scheme-tests-not-yet-run)
12. [Appendix D – Rollback and maintenance](#appendix-d--rollback-and-maintenance)

---

## 1. Summary

This file is a **review and test record**. The only code change that came out of it is in `url-scan-thumbnail-download-via-safefetch-14oct26.md`.

**Main outcomes**

- **IP rules verified.** A 31-case test of `isPrivateAddress` (28 addresses that must be blocked, including `127.1`, `2130706433`, `0x7f000001`, IPv4-mapped, NAT64, 6to4, `::127.0.0.1`, plus 3 public ones that must be allowed) printed `all ok`.
- **Redirect to loopback blocked.** `https://httpbin.org/redirect-to?url=https%3A%2F%2F127.0.0.1%2Fx.mp4` was rejected with "URL not supported / Destination not allowed" (from `/resolve-url`).
- **The server runs a Node version `ssrf.js` accepts.** On live, `require('./security/ssrf')` printed `ssrf ok` (it needs Node 22.19 or newer).
- **Design review of `security/ssrf.js`:** the address is validated inside the socket's DNS lookup (`safeLookup`), so there is no second lookup to rebind. IP literals are checked separately, every redirect hop is re-validated, https-to-http downgrades are refused, ports are limited to 80 and 443, credentials in URLs are refused, bodies are size-capped while streaming, and the whole DNS answer is rejected if **any** record is non-public.
- **Fetch audit:** every `fetch(` call left in the test API goes to a fixed endpoint, except one I couldn't see (`routes/_shared/accountDevice.js:143`). Every `spawn` and `execFile` uses an argument array, so there is no shell.
- **`/resolve-url`:** authenticated, rate-limited to 10 requests a minute, and only `SsrfError` messages reach the client.
- **`assertPublicFetchUrl`** does its own separate DNS lookup. That is acceptable for URLs handed to the AI provider (it fetches from its own network). Everything the server fetches itself should go through `safeFetch`.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| IP-range test (`isPrivateAddress`) | ✅ Verified | Output: `all ok` |
| Redirect-to-loopback test via httpbin | ✅ Verified | "Destination not allowed" (through `/resolve-url`) |
| `ssrf.js` loads on live (Node version) | ✅ Verified | `ssrf ok`, `safeFetch` appears 4 times, `undici` and `ipaddr.js` installed |
| Fetch and exec audit (`grep`) | ✅ Done | Output in Appendix B |
| Thumbnail download moved to `safeFetch` | ✅ Done | `url-scan-thumbnail-download-via-safefetch-14oct26.md` |
| Hostname, scheme and port tests (`localtest.me`, `http://`, `[::1]`, `169.254.169.254`, `2130706433`) | ⚠️ Not run | Expected: each is refused with a reason (Appendix C) |
| `SSRF_BLOCKED_IPS` set (blocks the box's own public addresses) | ⏳ Open | See `live-api-rollout-and-production-process-audit-14oct26.md` |
| `routes/_shared/accountDevice.js:143` URL building checked | ⏳ Open | I haven't seen the file |
| `assertUrlPolicy` and `fetchUrlMetadata` reviewed | ⏳ Open | Not seen. They live in `server.js` |
| Global concurrency limit on ffprobe | ⏳ Open | Only one probe per user at a time |

---

## 3. Starting point

- `routes/scanVideoUrl.js`: validates the URL (`assertPublicFetchUrl`), checks scans remaining before fetching, allows one URL probe per user at a time, probes the length with ffprobe (121 second limit, results cached for 15 minutes), then hands the URL to the AI provider. The VPS only downloads the first 8 MB of a video for the thumbnail.
- `utils/probeVideoDuration.js`: ffprobe runs through a local CONNECT proxy that resolves the hostname itself, refuses any private address, allows port 443 only, and cuts the connection at 10 MB. ffprobe runs with a protocol whitelist and an `https://`-only input check, so a URL can't be read as an option.
- `utils/netGuard.js` is a thin wrapper: `isPrivateAddress(address)` returns `!isPublicAddress(address)` from `security/ssrf.js`. Anything that isn't a valid, public IP counts as private.

---

## 4. Timeline: what we did, in order

### Phase 1 – First review

I read `scanApiUrl.ts` (client) and `scanVideoUrl.js`, `urlThumbnail.js`, `probeVideoDuration.js` that you pasted. I flagged: the thumbnail download wasn't IP-pinned, `SSRF_BLOCKED_IPS` might be unset, no global ffprobe concurrency limit, and the 121 s check runs on the VPS while the AI provider fetches separately (a cost risk, not a safety one).

### Phase 2 – IP-range test

I wrote the script in Appendix A. You ran it on live: `all ok`.

### Phase 3 – `ssrf.js` and the wider code

You pasted `security/ssrf.js`, `utils/netGuard.js`, the `/resolve-url` handler and `assertPublicFetchUrl`. I reviewed them (Summary above).

### Phase 4 – Redirect test and grep audit

You ran the httpbin redirect test and the two `grep` commands in Appendix B.

### Phase 5 – The follow-up fix

The thumbnail download was moved onto `safeFetch` (`url-scan-thumbnail-download-via-safefetch-14oct26.md`).

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | I treated the redirect test as a thumbnail test | It ran through `/resolve-url` | Clarified in `url-scan-thumbnail-download-via-safefetch-14oct26.md` |
| 2 | My `pm2 env` check failed | Wrong daemon and argument (see `live-api-rollout-and-production-process-audit-14oct26.md`) | Use `pm2 env <numeric id>` on the right daemon, or check `.env` |
| 3 | `ssrf.js` would crash on an old Node | undici 8 needs Node 22.19 or newer | `ssrf ok` on live shows Node is fine |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. I first said my SSRF concern was "mostly answered" before I had seen `ssrf.js`. After reading it, the remaining concern was the code **outside** it.
2. I said a hostname-resolving test was needed, then you ran only the redirect test. Hostname tests remain open.

### Decisions

1. Keep `security/ssrf.js` as is.
2. Route everything the server fetches itself through `safeFetch`.
3. Keep `assertPublicFetchUrl` as an extra policy layer.
4. Don't block Tor or any host outright. Handle abuse through signup friction instead.

### Known limits

- The unit test covers IP rules only. It doesn't exercise DNS or redirects.
- `assertPublicFetchUrl` does a separate lookup (fine for the AI provider).
- The 121 s limit is checked on the VPS only.
- `isPublicAddress` has one custom rule on top of ipaddr.js (blocking `::/96`) that I read but did not independently test beyond the script above.

---

## 7. Open items checklist

- [x] IP-range test passed
- [x] Redirect-to-loopback test passed
- [x] Thumbnail download moved to `safeFetch`
- [ ] Run the hostname, scheme and port tests in Appendix C
- [ ] Set `SSRF_BLOCKED_IPS` (`live-api-rollout-and-production-process-audit-14oct26.md`)
- [ ] Review `routes/_shared/accountDevice.js:143`: make sure the visitor IP in that URL passes `net.isIP()` and is URL-encoded, especially if it comes from `X-Forwarded-For`
- [ ] Confirm the Slack webhook URL (`slackLogger.js:59`) comes from the environment
- [ ] Review `assertUrlPolicy` and `fetchUrlMetadata` in `server.js`
- [ ] Optional: a global cap on concurrent ffprobe processes
- [ ] Optional: log `SsrfError` reasons, not just `SSRF_BLOCKED`

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Fetcher | `safeFetch()` in `security/ssrf.js` (undici agent, `connect.lookup` hook) |
| Allowed schemes / ports | http and https / 80 and 443 |
| Redirects | followed manually, each hop re-validated, https to http refused, default maximum 5 (3 for thumbnails) |
| URL length limit | 2048 |
| Optional env | `SSRF_BLOCKED_IPS` (comma-separated public IPs of this VPS) |
| `/resolve-url` | authenticated, 10 requests per minute |
| Probe limits | 15 s timeout, 10 MB through the proxy, one probe per user |
| Node requirement | 22.19 or newer |

---

## Appendix A – IP-range test (as run)

Run on live, from the live folder. Output: `all ok`.

```bash
cd /var/www/mediacrater-api
node <<'EOF'
const { isPrivateAddress } = require('./utils/netGuard');
const blocked = [
  '127.0.0.1', '0.0.0.0', '0.1.2.3', '10.0.0.1', '172.16.0.1', '192.168.1.1',
  '169.254.169.254', '100.64.0.1', '192.0.2.1', '198.18.0.1', '224.0.0.1',
  '255.255.255.255', '127.1', '2130706433', '0x7f000001',
  '::1', '::', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::127.0.0.1',
  'fc00::1', 'fe80::1', '2001:db8::1', '64:ff9b::7f00:1', '2002:7f00:1::',
  '2001::1', '', 'not-an-ip'
];
const allowed = ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'];
let bad = 0;
for (const ip of blocked) if (!isPrivateAddress(ip)) { bad++; console.log('NOT BLOCKED:', JSON.stringify(ip)); }
for (const ip of allowed) if (isPrivateAddress(ip)) { bad++; console.log('WRONGLY BLOCKED:', ip); }
console.log(bad === 0 ? 'all ok' : bad + ' problem(s)');
EOF
```

---

## Appendix B – Code audit commands and output

```bash
cd /var/www/mediacrater-api-test
grep -rn --include=*.js -E "\bfetch\(|https?\.get\(|axios|got\(" . --exclude-dir=node_modules
grep -rn --include=*.js -E "execFile|spawn\(|exec\(" . --exclude-dir=node_modules
```

Output (test API):

```text
./helpers.js:1001:    const response = await fetch(qwenCloudConfig.apiUrl, {
./helpers.js:1105:  const response = await fetch(ASR_ENDPOINT, {
./helpers.js:1234:    const response = await fetch(qwenCloudConfig.apiUrl, {
./server.js:237:// PHASE 1: replaced the global fetch() with the pinned fetcher. Before, the
./server.js:238:// address was checked with one DNS lookup and fetch() did a second one, so a
./slackLogger.js:59:    const res = await fetch(url, {
./routes/_shared/accountDevice.js:143:    const res = await fetch(url, {
./routes/_shared/authGuards.js:69:    const res = await fetch(TURNSTILE_VERIFY_URL, {
./helpers.js:585:  while ((match = quoteRegex.exec(text)) !== null) {
./server.js:353:  const match = BEARER_RE.exec(authHeader.trim());
./utils/urlThumbnail.js:20:// - ffmpeg runs via spawn() with an argument array (no shell = no command
./utils/urlThumbnail.js:80:      child = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
./utils/probeVideoDuration.js:2:const { execFile } = require('child_process');
./utils/probeVideoDuration.js:74:    execFile(
```

How to read it: `helpers.js` fetches go to the AI provider and ASR endpoints from configuration, `slackLogger.js` posts to a webhook, `accountDevice.js` and `authGuards.js` call fixed services (the Turnstile verify URL is a constant), and the two `.exec(` matches are regular expressions. `spawn` and `execFile` appear only in `urlThumbnail.js` and `probeVideoDuration.js`, both with argument arrays.

---

## Appendix C – Hostname and scheme tests (not yet run)

On the test site, paste each into "Add URL". **Expected:** every one is rejected with "URL not supported" plus a reason, and no scan starts.

| URL | Expected reason |
|---|---|
| `https://localhost/x.mp4` | Destination not allowed (or similar) |
| `https://127.0.0.1/x.mp4` | Destination not allowed |
| `https://[::1]/x.mp4` | Destination not allowed |
| `https://169.254.169.254/latest/meta-data/` | Destination not allowed |
| `https://localtest.me/x.mp4` | Destination not allowed (a public name that resolves to 127.0.0.1, so it tests the DNS check) |
| `https://2130706433/x.mp4` | Destination not allowed |
| `http://example.com/x.mp4` | Only HTTPS URLs are supported |

---

## Appendix D – Rollback and maintenance

Nothing in this review changed code, so there is nothing to roll back. Re-run Appendix A whenever `security/ssrf.js` or `utils/netGuard.js` changes.

---

*End of index.*
