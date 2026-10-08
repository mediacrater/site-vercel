# Security Review – Phase 2: Security Headers, Baseline CSP (Report-Only), CSP Reporting to Slack & HSTS

| | |
|---|---|
| **Date** | 8 October 2026 (`08oct26`) |
| **Conversation** | https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d |
| **Related prior work** | `security-review-phase1-vps-lockdown-07oct26.md` (7 Oct 2026) |
| **Stack** | Next.js 16 web app on Vercel (separate TEST and LIVE projects/repos), Node/Express API on the VPS behind nginx + Cloudflare (PM2: `mediacrater-api` LIVE, `mediacrater-api-test` TEST), Cloudflare zone `mediacrater.com`, Supabase (separate TEST and LIVE projects), Slack |
| **Starting trigger** | Phase 2 of the security review: the web app sent no security headers and no Content Security Policy (CSP), so an XSS would have no second line of defence. Your Supabase session lives in `localStorage`, so an XSS means account takeover |

> **Redaction note:** no secrets, webhook URLs, keys, IP addresses, user IDs, passwords or email addresses are included. `<test web host>`, `<test-project-ref>`, `<live-project-ref>`, `<slack webhook url>` and `<vercel.app host>` stand in for them.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied (expected output is given). ⏳ = open.

> **Phase 2 is parked, not finished.** Both sites run the CSP in **report-only** mode, which blocks nothing and posts any violation to Slack. By agreement we move on to the smaller phases while that data builds up, then come back to enforce ([§7](#7-open-items-checklist), [Appendix G](#appendix-g--enforcement-runbook-and-rollback)).

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
9. [Appendix A – `next.config.mjs` (final)](#appendix-a--nextconfigmjs-final)
10. [Appendix B – `app/api/csp-report/route.ts` (as deployed)](#appendix-b--appapicsp-reportroutets-as-deployed)
11. [Appendix C – VPS headers (`server.js` block)](#appendix-c--vps-headers-serverjs-block)
12. [Appendix D – Other code changes](#appendix-d--other-code-changes)
13. [Appendix E – Cloudflare, Vercel and Slack settings](#appendix-e--cloudflare-vercel-and-slack-settings)
14. [Appendix F – Verification and troubleshooting commands](#appendix-f--verification-and-troubleshooting-commands)
15. [Appendix G – Enforcement runbook and rollback](#appendix-g--enforcement-runbook-and-rollback)
16. [Appendix H – The rejected hash pipeline (for later)](#appendix-h--the-rejected-hash-pipeline-for-later)

---

## 1. Summary

Both the TEST and LIVE web apps now send a full set of security headers and a **report-only CSP**, and the VPS API sends its own headers on every response. HSTS is on for the whole Cloudflare zone. Violation reports go to `/api/csp-report`, which logs them and forwards them to Slack, because Vercel's Hobby plan only keeps logs for about an hour.

**Main outcomes**

- **Security headers on every web page and API route** (TEST and LIVE): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Permissions-Policy` (camera, microphone, geolocation, payment, USB off). `X-Powered-By: Next.js` removed.
- **CSP in report-only mode**, built from each environment's own Supabase and VPS origins at build time, and switchable with one Vercel variable, `CSP_MODE` (`report-only` default, `enforce`, `off`).
- **Report endpoint** `/api/csp-report`: size-capped, tokens stripped from URLs, logs to Vercel, and posts distinct violations to Slack (deduplicated, rate-capped, browser-extension noise skipped).
- **VPS API headers** (TEST and LIVE): `nosniff`, `no-referrer`, `Cache-Control: no-store`, `default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`. `/cf-ok` keeps its own frameable policy.
- **HSTS:** Cloudflare's zone setting, `max-age=31536000` (1 year), with no `includeSubDomains` and no `preload`. Exactly one header on every host checked.
- **Policy adjusted from real traffic:** Cloudflare Web Analytics beacon allowed (LIVE's automatic setup injects it zone-wide); `https:` images and media allowed (previews of pasted URLs); `browsing-topics` removed from `Permissions-Policy`.

**Key decision:** the strict, hash-based CSP was tested and found feasible, but deferred in favour of a baseline policy with `script-src 'unsafe-inline'` ([§6](#6-corrections--important-decisions), [Appendix H](#appendix-h--the-rejected-hash-pipeline-for-later)). Everything except the protection against injected inline scripts is in place.

**Not yet done:** enforcement on TEST and LIVE, pending Slack data.

---

## 2. Status at a glance

### Web app

| Area | TEST | LIVE | Notes |
|---|---|---|---|
| `next.config.mjs` (headers + CSP) | ✅ | ✅ | Final version includes beacon, `https:` images/media, no `browsing-topics` |
| CSP mode | ✅ report-only | ✅ report-only | `CSP_MODE` not set (= report-only) |
| `/api/csp-report` | ✅ `204` | ✅ `204` | LIVE first returned `404` (file in the wrong folder, fixed) |
| Slack forwarding (`CSP_SLACK_WEBHOOK_URL`) | ✅ | ✅ | Test message received |
| `NEXT_PUBLIC_STATE` prefix on report lines | ✅ | ✅ | Your own edit; values `TEST_ENVIRONMENT` / `LIVE` |
| `lib/mediacrater/scanApi.ts` (`encodeURIComponent(jobId)`) | ✅ | ✅ | Expected: the three queue URLs read `…/queue-status/${encodeURIComponent(jobId)}` (and `queue-cancel`, `queue-timing`) |
| `app/api/[...path]/route.ts` deleted | ✅ | ✅ | TEST: commit `a9b725b` (I checked the repo). LIVE expected: no `app/api/[...path]` folder |
| `pnpm-lock.yaml` stub deleted | ✅ | ✅ | Expected: the file no longer appears in the repo root |
| CSP enforced | ⏳ | ⏳ | After the Slack data review |

### VPS API

| Area | TEST | LIVE | Notes |
|---|---|---|---|
| Phase 2 headers block in `server.js` | ✅ | ✅ | `/health` shows all five headers |
| `/cf-ok` stays frameable | ✅ | ✅ | No `X-Frame-Options`; own `frame-ancestors` |
| LIVE `server.js` matches TEST + the block | ✅ | | You pasted the file instead of running the `diff`. Expected from `diff <backup> server.js`: only the added `// PHASE 2: security headers…` block |

### Cloudflare and HSTS

| Area | Status | Notes |
|---|---|---|
| HSTS (zone setting) | ✅ `max-age=31536000` | One header on `test.`, `host.`, `mediacrater.com`, `<test web host>` |
| `includeSubDomains` / `preload` | ✅ Off | Not present in the header |
| `HSTS TEST` Transform Rule | ✅ Deleted | Was redundant once the zone setting was on |
| Web Analytics automatic setup | ✅ Left on | Allowed in the CSP instead |

---

## 3. Starting point

- **No security headers** in `next.config.mjs` or `middleware.ts`, and no `vercel.json`. The only header Vercel added was its own HSTS (`max-age=63072000`).
- **A report-only CSP message** in an earlier console screenshot did not come from your code (most likely Turnstile's iframe).
- **Every page is static.** A sandbox build showed all 18 pages as `○ (Static)`, including the dashboard, history and settings; only the 5 API routes were dynamic. Pages render in the browser and fetch user data client-side.
- **What the site loads** (inventory from the code): Next.js chunks and inline startup scripts, Turnstile (`next/script` on 4 pages), Vercel Analytics (same origin), Supabase (auth, database, signed thumbnail URLs), the VPS API, the `cf-ok` clearance iframe (`ApiHostClearance.tsx`), an audio worker, `blob:` / `data:` previews, self-hosted fonts, inline styles, and Stripe (by navigation only).
- **Cloudflare HSTS** showed as disabled.
- **Origins** — TEST: VPS `https://test.mediacrater.com`, Supabase `https://<test-project-ref>.supabase.co`. LIVE: VPS `https://host.mediacrater.com`, Supabase `https://<live-project-ref>.supabase.co`.

---

## 4. Timeline: what we did, in order

### Step 1 – `scanApi.ts` and the first plan

- The repo was readable again. `app/api/[...path]/route.ts` was already deleted; the `pnpm-lock.yaml` stub was still there.
- `scanApi.ts`: the three job-ID URLs now use `encodeURIComponent(jobId)` ([Appendix D](#appendix-d--other-code-changes)).
- First Phase 2 plan: an inventory of everything the site loads (see [§3](#3-starting-point)), a nonce-based CSP set in `middleware.ts`, static headers in `next.config.mjs`, report-only first, HSTS ramped up.

### Step 2 – Your inputs

- Cloudflare HSTS: disabled.
- `NEXT_PUBLIC_VPS_API_URL` and `NEXT_PUBLIC_SUPABASE_URL` for TEST and LIVE.
- Your direction: no nonces on every page; nonces where pages render dynamically, hashes or SRI for static content.

### Step 3 – What the build showed

I built the web app in my sandbox (Google Fonts stubbed and dummy env values; only the route table mattered):

```
○ /, /about, /buy-scans, /changelog, /chrome-extension-privacy, /cookies, /dashboard,
  /forgot-password, /privacy, /refund, /scan-history, /settings, /signin, /signup,
  /solutions, /terms, /_not-found                                    (Static)
ƒ /api/auth/reset-password, /api/custom-solutions-form, /api/resend-verification,
  /api/signin, /api/signup                                           (Dynamic)
```

- **No page needs a nonce:** none renders on the server.
- **Next.js's built-in SRI** is experimental, webpack-only (Next 16 builds with Turbopack by default), and only covers external `<script src>` files.
- **Each static page has 4 inline scripts**, and one contains the build ID, which is random on every build. Hashes are therefore only known after the build.
- **Two builds with a fixed build ID** (`generateBuildId`) produced **identical hashes on all 18 pages**, so a two-pass build would work ([Appendix H](#appendix-h--the-rejected-hash-pipeline-for-later)).

### Step 4 – Is the hash pipeline worth it?

You confirmed double build time was acceptable and the Vercel build command isn't overridden (`npm run build` from `package.json` would run), then asked whether it was worth doing.

| Option | Blocks injected inline JS | Everything else | Effort and risk |
|---|---|---|---|
| A. Hash pipeline | ✅ | ✅ | High, ongoing |
| **B. Baseline CSP** | ❌ | ✅ | Low: one config file |
| C. No CSP | ❌ | ❌ | None |

**Chosen: B.** Reasons: React escapes all rendered values, the only `dangerouslySetInnerHTML` (`chart.tsx`) writes CSS your own code generates, and the likelier attack (a compromised npm package) runs as your own bundled code, which no CSP blocks. Revisit A if you start rendering user-supplied HTML/Markdown, add more third-party scripts, get a compliance or customer request, or take on more sensitive data.

### Step 5 – Implementation and sandbox tests

| File | What it does |
|---|---|
| `next.config.mjs` | Security headers for `/:path*`; CSP built from env origins; `CSP_MODE` switch; build fails on a bad `CSP_MODE` or a missing Supabase/VPS URL; no CSP in `next dev`; `poweredByHeader: false` |
| `app/api/csp-report/route.ts` (new) | Accepts both report formats, 16 KB cap, max 20 reports per request, strips query strings and fragments, neutralises control characters, 60 log lines per IP per minute per instance, logs `[CSP] …` |
| VPS `server.js` | One middleware with five headers; `/cf-ok` excluded from the CSP and `X-Frame-Options` |

Sandbox results: all pages stayed static; headers present on every route including 404s and `/api/*`; each `CSP_MODE` value behaved as intended (a bogus value and a missing VPS URL both failed the build). The report endpoint returned `204` for both formats, `400` for bad JSON, `413` for oversized bodies and `405` for `GET`, and stripped `?access_token=…` from logged URLs. VPS: 3 new header tests passed and the 34 Phase 1 end-to-end tests still passed.

### Step 6 – TEST deployment (Parts A and B)

| Check | Result |
|---|---|
| A7 headers on `/dashboard` | ✅ All present, no `x-powered-by`, CSP contains TEST origins. Vercel already sent `strict-transport-security: max-age=63072000` |
| A8 report endpoint | ✅ `204`; Vercel Logs: `[CSP] report \| directive:script-src-elem \| blocked:https://example.com/manual-test.js \| page:https://example.com/test` |
| B4 `/health` | ✅ `nosniff`, `no-referrer`, `no-store`, `default-src 'none'; frame-ancestors 'none'`, `DENY` |
| B4 `/cf-ok` | ✅ No `x-frame-options`; `frame-ancestors <test web host> <vercel.app host>`. No `chrome-extension://` because TEST's `.env` has no `CHROME_EXTENSION_ID` |

### Step 7 – Browser checks and the sanity test

- "Preserve log" is in the **Console's own gear icon** (top right of the Console panel), not the main DevTools settings.
- My console filter instructions were wrong ([§5](#5-errors-and-surprises) #6). Chrome writes "…violates the following Content Security Policy directive… The policy is report-only…"; the working filter is `Content Security Policy`.
- **Sanity test** (proves a real browser sends reports):
  ```js
  fetch('https://example.com/csp-sanity-check').catch(() => {})
  ```
  Console showed the `connect-src` violation; Vercel Logs showed `[CSP] report | directive:connect-src | blocked:https://example.com/csp-sanity-check | page:…`. Confirmed on `/`, `/signin`, `/solutions`, `/dashboard`, `/scan-history`, `/buy-scans`.

### Step 8 – What the click-through found (TEST)

| Finding | Type | Action |
|---|---|---|
| `script-src-elem` blocked `https://static.cloudflareinsights.com/beacon.min.js/…` | Real violation | Step 9 |
| `Error with Permissions-Policy header: Unrecognized feature: 'browsing-topics'` | My mistake | Removed from `Permissions-Policy` |
| Turnstile messages (`Ignored message from unexpected source`, `postMessage … does not match the recipient window's origin`, `No available adapters`, `document.write()`, `OTS parsing error`) | Not CSP | Turnstile's own output inside the `/cf-ok` iframe |
| `Minified React error #418` on `/scan-history` | Not CSP | Hydration mismatch (pre-existing bug) |
| `…preloaded using link preload but not used…` | Not CSP | Performance note |
| The audio worker ran with no violation | Pass | |

### Step 9 – Cloudflare Web Analytics beacon

Your TEST site's Web Analytics entry asked for a manual snippet, so it looked off. But Cloudflare's **automatic setup is zone-wide**: because LIVE has it on, Cloudflare inserts the beacon into every proxied hostname in `mediacrater.com`, including TEST and the VPS `/cf-ok` page. Choice: allow it in the CSP (keeps LIVE stats, same policy on TEST and LIVE) rather than turn it off everywhere. Added `https://static.cloudflareinsights.com` to `script-src` and `https://cloudflareinsights.com` to `connect-src`.

### Step 10 – HSTS

1. A Cloudflare **Response Header Transform Rule** `HSTS TEST` (hostname `test.mediacrater.com`, set `Strict-Transport-Security: max-age=300`) gave **two** headers:
   ```
   strict-transport-security: max-age=0
   strict-transport-security: max-age=300
   ```
   Browsers use only the first one, and `max-age=0` turns HSTS off.
2. Cause: Cloudflare's own HSTS setting was **enabled with Max Age 0**.
3. You set that setting to **12 months** (I had suggested turning it off and ramping up). Since every hostname already serves HTTPS through Cloudflare and `includeSubDomains`/`preload` are off, we kept it: 1 year is where the ramp would have ended.
4. Transform Rule deleted. Final check: one `strict-transport-security: max-age=31536000` on `test.mediacrater.com`, `host.mediacrater.com`, `mediacrater.com` and `<test web host>` (Cloudflare's header replaced Vercel's).

### Step 11 – LIVE rollout (report-only)

| Check | Result |
|---|---|
| L6 headers on `https://mediacrater.com/dashboard` | ✅ All present; CSP contains LIVE origins |
| L7 report endpoint | First `404`: the route file was placed directly in `app/`. Moved to `app/api/csp-report/route.ts` → ✅ `204` |
| L8 extension | ✅ It only links to the website, so `X-Frame-Options: DENY` affects nothing |
| L9/L10 VPS | ✅ `/health` has all five headers. You pasted the new `server.js` after a manual backup instead of using `diff` |
| `/cf-ok` on LIVE | No `chrome-extension://` in `frame-ancestors` (no `CHROME_EXTENSION_ID` in `.env`). Not needed: the extension doesn't embed `/cf-ok` |

### Step 12 – LIVE browser check

- **Real violation** on `/dashboard`: `img-src` blocked a pasted image URL (`https://scontent-…fbcdn.net/…`). The dashboard previews pasted URLs directly (`previewUrl: resolved.url`), and `createVideoUrlThumbnail()` loads pasted video URLs to grab a frame (a `media-src` violation waiting to happen). Added `https:` to `img-src` and `media-src`; deployed to both repos.
- **Password exposed in a screenshot:** the sign-in console warning printed the password field's HTML, including its value. You changed that password (the `/db/auth/v1/verify` request in the LIVE logs was that reset).
- Chrome asked for `autocomplete="current-password"` on the password input (moved to Phase 4).

### Step 13 – Logs expire after about an hour → Slack

Your LIVE Vercel Logs showed "The older logs have expired": Hobby keeps runtime logs for about an hour, so a 2–3-day wait followed by a log search wouldn't work. `route.ts` now also posts to Slack when `CSP_SLACK_WEBHOOK_URL` is set:

- the same directive + blocked URL + page path at most once per hour per server instance;
- at most 10 Slack messages per minute per instance;
- browser-extension sources (`chrome-extension:`, `moz-extension:`, `safari-web-extension:`, `ms-browser-extension:`) skipped;
- `<`, `>`, `&` escaped (no `@channel` or fake links);
- the request is awaited (3-second timeout) so the function isn't frozen before sending.

Mock-Slack test: 3 identical reports → 1 message; extension reports skipped; 14 distinct reports → capped at 10. Testing found extension URLs logged as `null/…` (opaque origin), which slipped past the filter; fixed. Deployed to both projects; your test `curl` returned `204` and the message arrived in Slack.

**Your edit:** both the Slack-failure line and the report line now start with `${process.env.NEXT_PUBLIC_STATE}` (`TEST_ENVIRONMENT` or `LIVE`). Reviewed: searching for `[CSP]` still works, the prefix is escaped with the rest of the line, deduplication is unaffected. Optional: a `?? 'UNKNOWN_ENV'` fallback so a missing variable doesn't print `undefined`.

### Step 14 – The `/db` rewrite is used

`GET 303 /db/auth/v1/verify` in the LIVE logs was your password-reset email link passing through `mediacrater.com/db/…` to Supabase. Nothing in the web code calls `/db`, but Supabase's email links do. **Phase 9 changes from "remove the `/db` rewrite" to "narrow it to the auth paths the emails use".**

### Step 15 – Parking Phase 2

You confirmed `CSP_MODE` stays unset until the Slack data is reviewed. Decision: park Phase 2 in report-only mode and continue with the smaller phases while violations (if any) collect in Slack. The smaller phases touch more pages, which makes the data more complete.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Report-only CSP message in an early console screenshot | Not from your code (no CSP existed); most likely Turnstile's iframe | None needed |
| 2 | "Use nonces where pages are dynamic" had nothing to apply to | All 18 pages are static | Hash vs baseline decision instead |
| 3 | Next.js SRI not usable for this | Experimental, webpack-only, external scripts only | Not used |
| 4 | Inline-script hashes differ on every build | The build ID is random | Fixed build ID + two-pass build (tested, then deferred) |
| 5 | Sandbox builds failed (`supabaseKey is required`, Google Fonts) | My sandbox had no env values or font access | Dummy values, stubbed fonts (sandbox only) |
| 6 | No CSP messages visible in the console | My filter text (`[Report Only]`, `Content-Security-Policy`) didn't match Chrome's wording | Filter on `Content Security Policy` |
| 7 | "Preserve log" not found | It's in the Console's own gear icon | — |
| 8 | `GET https://example.com/csp-sanity-check net::ERR_NAME_NOT_RESOLVED` | Your network doesn't resolve example.com | Irrelevant: the CSP check runs first |
| 9 | Cloudflare beacon reported on TEST although TEST's Web Analytics looked off | LIVE's automatic setup injects it zone-wide | Allowed in the CSP |
| 10 | `Unrecognized feature: 'browsing-topics'` | Current Chrome dropped the feature; I included it | Removed |
| 11 | `React error #418` on `/scan-history` | Hydration mismatch, not CSP | Open bug ([§7](#7-open-items-checklist)) |
| 12 | Two HSTS headers, the first `max-age=0` | Cloudflare HSTS enabled with Max Age 0, plus the Transform Rule | Zone HSTS set to 12 months; rule deleted |
| 13 | HSTS set straight to 1 year (no ramp) | You chose 12 months in the Cloudflare setting | Kept; no subdomains, no preload |
| 14 | LIVE `/api/csp-report` returned `404` | `route.ts` placed in `app/` instead of `app/api/csp-report/` | Moved |
| 15 | `/cf-ok` lacks `chrome-extension://` on TEST and LIVE | No `CHROME_EXTENSION_ID` in either `.env` | Not needed (the extension only links to the site) |
| 16 | Pasted-URL image preview blocked | Dashboard shows remote images directly | `img-src https:` |
| 17 | Video URL previews would be blocked | `createVideoUrlThumbnail()` loads remote video | `media-src https:` |
| 18 | Password visible in a console screenshot | Chrome's `[DOM]` warning prints the input's HTML including its value | Password changed |
| 19 | "The older logs have expired" | Vercel Hobby keeps runtime logs ~1 hour | Slack forwarding |
| 20 | Extension URLs logged as `null/…` | `new URL('chrome-extension://…').origin` is `"null"` | Use protocol + host for opaque origins |
| 21 | `/db/auth/v1/verify` in LIVE logs | Supabase email links use the `/db` rewrite | Phase 9 redefined |
| 22 | Empty `curl` output | Hostname typo (`mediacrater.com` missing) | Re-run with the full host |
| 23 | Probes for `/.git/config`, `/this_is_a_404.html`, `SiteLockSpider` | Internet scanners | All `404`; nothing exposed |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. **Nonce-based CSP as the first recommendation** assumed server-rendered pages; all pages are static.
2. **Console instructions** used Chrome's old wording (`[Report Only]`) and a hyphenated filter that hid the messages.
3. **"Wait 2–3 days, then search Vercel Logs"** didn't account for ~1-hour log retention on Hobby.
4. **`browsing-topics`** in `Permissions-Policy` is no longer recognised by Chrome.
5. **"The `/db` rewrite is unused"** (from round 1) was wrong: Supabase email links use it.
6. **L10 expected `chrome-extension://` in `/cf-ok`** on LIVE; LIVE's `.env` doesn't have the ID.
7. **A troubleshooting checklist** when your report-only output was exactly right (you were correctly waiting).

### Decisions

1. **Baseline CSP (Option B)**, not the hash pipeline. `script-src` keeps `'unsafe-inline'`; every other directive is strict.
2. **One policy for every route**, built from environment variables at build time, so TEST and LIVE each get their own Supabase and VPS origins from the same file.
3. **`CSP_MODE` switch** with a build failure on any other value, and on a missing Supabase or VPS URL.
4. **Report-only first on both TEST and LIVE**, enforcement later.
5. **Cloudflare Web Analytics allowed** rather than turned off zone-wide.
6. **`https:` images and media allowed** for pasted-URL previews (images and video can't run code).
7. **HSTS via Cloudflare's zone setting**, 1 year, no subdomains, no preload.
8. **Reports to Slack**, deduplicated and capped, with your environment prefix.
9. **Park Phase 2** and collect data while doing the smaller phases.

### Known limits

- `script-src 'unsafe-inline'`: an injected inline script would still run.
- `style-src 'unsafe-inline'` (needed for React `style={}` and the chart component).
- `img-src https:` / `media-src https:` allow images and video from any HTTPS host.
- The CSP is fixed at build time: changing `CSP_MODE` or an origin needs a redeploy.
- Slack deduplication and caps are per server instance and reset when an instance restarts.
- `/api/csp-report` accepts posts from anyone (bounded by the size and rate caps).
- Cloudflare's HSTS setting applies to every proxied hostname in the zone.
- `X-Frame-Options: DENY` prevents any embedding of the web app (intended).

---

## 7. Open items checklist

### Phase 2 completion (after the smaller phases)

- [ ] Review the Slack channel: anything other than your own tests and the `csp-sanity-check` URL?
- [ ] Enforce on **TEST** ([Appendix G](#appendix-g--enforcement-runbook-and-rollback)), click through, wait a day
- [ ] Enforce on **LIVE**

### Verify

- [ ] `pnpm-lock.yaml` stub deleted in TEST and LIVE. Expected: not in the repo root
- [ ] `scanApi.ts` updated in TEST and LIVE. Expected: `encodeURIComponent(jobId)` in the `queue-status`, `queue-cancel` and `queue-timing` URLs
- [ ] `app/api/[...path]/route.ts` gone from the LIVE repo
- [ ] `diff <your LIVE server.js backup> /var/www/mediacrater-api/server.js`. Expected: only the added `// PHASE 2: security headers…` block

### Improvements and follow-ups

- [ ] Optional: `?? 'UNKNOWN_ENV'` fallback for `NEXT_PUBLIC_STATE` in `route.ts` (two places)
- [ ] Fix the React #418 hydration error on `/scan-history`
- [ ] Remove the unused testimonial-image preloads (performance)
- [ ] `autocomplete="current-password"` on the sign-in password input → **Phase 4**
- [ ] Revisit the hash pipeline (Option A) if the criteria in Step 4 become true
- [ ] `includeSubDomains` for HSTS: only after checking every DNS record serves HTTPS
- [ ] If the extension ever embeds `/cf-ok`: add `CHROME_EXTENSION_ID` to the API `.env`

### Carried over from Phase 1

- [ ] Stripe webhook: plan from the price ID, not metadata (exploitable on TEST while portal plan switching is on)
- [ ] Stripe webhook endpoint API version check

### Next phases (updated)

- [ ] **Phase 3** – Per-email rate limits
- [ ] **Phase 4** – Input validation (zod), plus `autocomplete` attributes
- [ ] **Phase 5** – Generic error messages (incl. `create-checkout-webapp`, Express's HTML 404)
- [ ] **Phase 6** – Password-reset link (env-based, existing page)
- [ ] **Phase 7** – Contact form IP + shared Turnstile helper
- [ ] **Phase 8** – Supabase password setting (minimum stays 6)
- [ ] **Phase 9** – **Narrow** the `/db` rewrite to the Supabase auth paths used by email links (changed from "remove")

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| CSP switch | Vercel env `CSP_MODE`: unset/`report-only` → `Content-Security-Policy-Report-Only`; `enforce` → `Content-Security-Policy` (+ `upgrade-insecure-requests`); `off` → no CSP. Any other value fails the build. Needs a redeploy |
| CSP origins | From `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_VPS_API_URL` at build time |
| Report endpoint | `POST /api/csp-report` (behind the existing `/api` proxy-secret gate), returns `204` |
| Slack | Vercel env `CSP_SLACK_WEBHOOK_URL` (secret); 1 message per distinct violation per hour per instance; max 10/min per instance; extensions skipped |
| Log prefix | `NEXT_PUBLIC_STATE` (`TEST_ENVIRONMENT` / `LIVE`) |
| Web headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, no `X-Powered-By` |
| VPS headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY` (all except `/cf-ok`, which only gets the first three plus its own `frame-ancestors`) |
| HSTS | Cloudflare → SSL/TLS → Edge Certificates → HSTS: on, Max Age 12 months, includeSubDomains off, Preload off, No-Sniff off |
| Third parties allowed | `https://challenges.cloudflare.com` (Turnstile: script, connect, frame), `https://static.cloudflareinsights.com` (script), `https://cloudflareinsights.com` (connect), Supabase origin (connect, img), VPS origin (connect, frame) |

### Final CSP (TEST, report-only)

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://<test-project-ref>.supabase.co https:;
font-src 'self' data:;
connect-src 'self' https://<test-project-ref>.supabase.co https://test.mediacrater.com https://challenges.cloudflare.com https://cloudflareinsights.com;
frame-src https://challenges.cloudflare.com https://test.mediacrater.com;
worker-src 'self' blob:;
media-src 'self' blob: https:;
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
report-uri /api/csp-report
```

LIVE is identical with `<live-project-ref>` and `https://host.mediacrater.com`. With `CSP_MODE=enforce`, `upgrade-insecure-requests` is appended.


---

## Appendix A – `next.config.mjs` (final)

Same file in the TEST and LIVE repos (each project's environment variables supply its own origins).

```js
// next.config.mjs
//
// PHASE 2: security headers + baseline Content Security Policy.
//
// CSP_MODE (Vercel environment variable, read at BUILD time, so redeploy
// after changing it):
//   unset / "report-only"  -> Content-Security-Policy-Report-Only (nothing blocked,
//                             violations reported to /api/csp-report)
//   "enforce"              -> Content-Security-Policy (violations blocked AND reported)
//   "off"                  -> no CSP header (emergency switch)
//
// The CSP is skipped in `next dev`, because the dev server relies on eval and
// inline scripts that would trip it.

/** Returns the origin ("https://host") of a URL env var, or null. */
function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const isProductionBuild = process.env.NODE_ENV === 'production';
const supabaseOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const vpsOrigin = originOf(process.env.NEXT_PUBLIC_VPS_API_URL);
const cspMode = (process.env.CSP_MODE || 'report-only').trim().toLowerCase();

if (!['report-only', 'enforce', 'off'].includes(cspMode)) {
  throw new Error(`CSP_MODE must be "report-only", "enforce" or "off" (got "${cspMode}")`);
}

// Fail the build instead of shipping a policy that blocks Supabase or the VPS.
if (isProductionBuild && cspMode !== 'off' && (!supabaseOrigin || !vpsOrigin)) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_VPS_API_URL must be valid URLs to build the Content Security Policy'
  );
}

const TURNSTILE = 'https://challenges.cloudflare.com';
// Cloudflare Web Analytics: Cloudflare inserts this beacon into every proxied
// page in the mediacrater.com zone (LIVE uses these stats), and it sends its
// data to cloudflareinsights.com.
const CF_INSIGHTS_SCRIPT = 'https://static.cloudflareinsights.com';
const CF_INSIGHTS_CONNECT = 'https://cloudflareinsights.com';

function buildCsp() {
  const directives = {
    'default-src': ["'self'"],
    // 'unsafe-inline' is required for Next.js's inline scripts on static pages.
    // Replacing it with per-page hashes is the possible future upgrade.
    'script-src': ["'self'", "'unsafe-inline'", TURNSTILE, CF_INSIGHTS_SCRIPT],
    // React style={} attributes and the chart component's <style> need this.
    'style-src': ["'self'", "'unsafe-inline'"],
    // data:/blob: = canvas and video thumbnails; Supabase = signed thumbnail URLs;
    // https: = previews of image URLs users paste into the scanner, which can be
    // on any host (e.g. fbcdn.net). Images can't run code.
    'img-src': ["'self'", 'data:', 'blob:', supabaseOrigin, 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", supabaseOrigin, vpsOrigin, TURNSTILE, CF_INSIGHTS_CONNECT],
    // Turnstile widget + the VPS cf-ok clearance iframe (ApiHostClearance.tsx).
    'frame-src': [TURNSTILE, vpsOrigin],
    // Audio extraction worker; blob: covers bundlers that start workers from blob URLs.
    'worker-src': ["'self'", 'blob:'],
    // https: = createVideoUrlThumbnail() loads pasted video URLs to grab a frame.
    'media-src': ["'self'", 'blob:', 'https:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'report-uri': ['/api/csp-report'],
  };

  const parts = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.filter(Boolean).join(' ')}`
  );

  // Browsers ignore (and warn about) this directive in report-only mode.
  if (cspMode === 'enforce') parts.push('upgrade-insecure-requests');

  return parts.join('; ');
}

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // same-origin-allow-popups keeps window.open() (Stripe billing portal) working.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  {
    // browsing-topics was removed: current Chrome no longer recognises it and
    // logs a console error on every page.
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
];

if (isProductionBuild && cspMode !== 'off') {
  securityHeaders.push({
    key: cspMode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    value: buildCsp(),
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // PHASE 2: stop advertising "X-Powered-By: Next.js".
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/db/:path*",
        destination: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/:path*`,
      },
    ];
  },
}

export default nextConfig
```

---

## Appendix B – `app/api/csp-report/route.ts` (as deployed)

Includes your `NEXT_PUBLIC_STATE` prefix (two lines). Optional hardening for both lines: `${process.env.NEXT_PUBLIC_STATE ?? 'UNKNOWN_ENV'}`.

```ts
// app/api/csp-report/route.ts
//
// PHASE 2: receives Content Security Policy violation reports and writes a
// one-line summary of each to the Vercel logs (search for "[CSP]").
//
// Abuse limits: anyone can POST here, so bodies are capped at 16 KB, at most
// 20 reports are read per request, every logged value is length-capped and
// stripped of control characters, URLs lose their query string and fragment
// (they can carry tokens), and each server instance logs at most 60 requests
// per IP per minute. Nothing is written to the database.
//
// Slack (optional): Vercel's Hobby plan keeps runtime logs for about an hour,
// so reports would disappear before anyone reads them. If
// CSP_SLACK_WEBHOOK_URL is set, each distinct violation is also posted to
// Slack: at most once per hour per server instance (keyed on directive,
// blocked URL and page path), at most 10 messages per minute per instance,
// and never for browser-extension sources.

import { NextRequest, NextResponse } from 'next/server';
import { clientIpFrom } from '@/lib/rate-limit';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTS_PER_REQUEST = 20;
const PER_IP_PER_MINUTE = 60;

// Best effort only: serverless instances don't share memory.
const recentByIp = new Map<string, { windowStart: number; count: number }>();

const SLACK_WEBHOOK_URL = process.env.CSP_SLACK_WEBHOOK_URL || '';
const SLACK_DEDUPE_MS = 60 * 60 * 1000;
const SLACK_MAX_PER_MINUTE = 10;
const slackSentAt = new Map<string, number>();
let slackWindowStart = 0;
let slackWindowCount = 0;

const EXTENSION_SCHEME = /^(chrome|moz|safari-web|ms-browser)-extension:/i;

function isExtensionNoise(r: Normalized): boolean {
  return EXTENSION_SCHEME.test(r.blocked) || EXTENSION_SCHEME.test(r.source);
}

// Slack treats <, > and & as markup (links, @channel mentions).
function slackEscape(value: string): string {
  return value.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
}

function takeSlackSlot(key: string): boolean {
  const now = Date.now();

  const last = slackSentAt.get(key);
  if (last && now - last < SLACK_DEDUPE_MS) return false;

  if (now - slackWindowStart >= 60_000) {
    slackWindowStart = now;
    slackWindowCount = 0;
  }
  if (slackWindowCount >= SLACK_MAX_PER_MINUTE) return false;

  slackWindowCount += 1;
  if (slackSentAt.size > 1_000) slackSentAt.clear();
  slackSentAt.set(key, now);
  return true;
}

function pagePath(page: string): string {
  try {
    return new URL(page).pathname;
  } catch {
    return page;
  }
}

async function notifySlack(lines: string[]): Promise<void> {
  if (!SLACK_WEBHOOK_URL || lines.length === 0) return;
  try {
    // Awaited (with a short timeout) because a serverless function can be
    // frozen as soon as the response is sent.
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch (error) {
    console.error(`${process.env.NEXT_PUBLIC_STATE} [CSP] Slack notification failed:`, error instanceof Error ? error.message : error);
  }
}

function allowLog(ip: string): boolean {
  const now = Date.now();
  const entry = recentByIp.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    if (recentByIp.size > 5_000) recentByIp.clear();
    recentByIp.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= PER_IP_PER_MINUTE;
}

function clean(value: unknown, maxLength = 200): string {
  return String(value ?? '')
    .slice(0, maxLength)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ');
}

// Keeps origin + path only: query strings and fragments can hold tokens.
function cleanUrl(value: unknown): string {
  const raw = String(value ?? '');
  try {
    const url = new URL(raw);
    // Extension URLs (chrome-extension://…) have an opaque "null" origin.
    const base = url.origin !== 'null' ? url.origin : `${url.protocol}//${url.host}`;
    return clean(base + url.pathname);
  } catch {
    return clean(raw.split(/[?#]/)[0]); // keywords like "inline", "eval", "data"
  }
}

type Normalized = {
  directive: string;
  blocked: string;
  page: string;
  source: string;
  line: string;
  disposition: string;
};

// Handles both formats: the older report-uri body ({"csp-report": {...}},
// application/csp-report) and the Reporting API array
// ([{type: "csp-violation", body: {...}}], application/reports+json).
function normalize(payload: unknown): Normalized[] {
  const items: Record<string, unknown>[] = [];

  if (Array.isArray(payload)) {
    for (const entry of payload.slice(0, MAX_REPORTS_PER_REQUEST)) {
      const body = (entry as { body?: unknown })?.body;
      if (body && typeof body === 'object') items.push(body as Record<string, unknown>);
    }
  } else if (payload && typeof payload === 'object') {
    const legacy = (payload as Record<string, unknown>)['csp-report'];
    if (legacy && typeof legacy === 'object') items.push(legacy as Record<string, unknown>);
  }

  return items.map((r) => ({
    directive: clean(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'], 60),
    blocked: cleanUrl(r['blocked-uri'] ?? r.blockedURL),
    page: cleanUrl(r['document-uri'] ?? r.documentURL),
    source: cleanUrl(r['source-file'] ?? r.sourceFile),
    line: clean(r['line-number'] ?? r.lineNumber, 10),
    disposition: clean(r.disposition, 20),
  }));
}

export async function POST(req: NextRequest) {
  const declaredLength = Number(req.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (text.length > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  if (allowLog(clientIpFrom(req) || 'unknown')) {
    const slackLines: string[] = [];

    for (const r of normalize(payload)) {
      const line =
        `${process.env.NEXT_PUBLIC_STATE} [CSP] ${r.disposition || 'report'} | directive:${r.directive} | blocked:${r.blocked} | page:${r.page}` +
        (r.source ? ` | source:${r.source}:${r.line}` : '');
      console.warn(line);

      if (!isExtensionNoise(r) && takeSlackSlot(`${r.directive}|${r.blocked}|${pagePath(r.page)}`)) {
        slackLines.push(slackEscape(line));
      }
    }

    await notifySlack(slackLines);
  }

  // 204 either way, so the browser doesn't retry.
  return new NextResponse(null, { status: 204 });
}
```

---

## Appendix C – VPS headers (`server.js` block)

Added to the Phase 1 `server.js` (TEST and LIVE), directly after `app.disable('x-powered-by');`. Nothing else in the file changed.

```js
// PHASE 2: security headers on every response. This API only returns JSON,
// so it never needs to load anything or be framed: the CSP denies all of it.
// /cf-ok is the exception: it's an HTML page the web app and extension embed
// in an iframe, and its route sets its own frame-ancestors policy.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  // Responses contain user data (scan results, balances); never cache them.
  res.set('Cache-Control', 'no-store');

  if (req.path !== '/cf-ok') {
    res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.set('X-Frame-Options', 'DENY');
  }

  next();
});
```

Applied on TEST with:

```bash
cd /var/www/mediacrater-api-test
cp server.js server.js.bak-phase2
# create server.js.new with the Phase 2 file, then:
diff server.js server.js.new          # expected: only the PHASE 2 block added
mv server.js.new server.js
node --check server.js
pm2 restart mediacrater-api-test
pm2 logs mediacrater-api-test --lines 20 --nostream
```

On LIVE you made a manual backup and pasted the file (see [§7](#7-open-items-checklist) for the `diff` check), then restarted `mediacrater-api`.

---

## Appendix D – Other code changes

### `lib/mediacrater/scanApi.ts`

Only three lines changed (path comment added at the top):

```ts
const response = await fetch(`${VPS_URL}/queue-status/${encodeURIComponent(jobId)}`, {
const response = await fetch(`${VPS_URL}/queue-cancel/${encodeURIComponent(jobId)}`, {
await fetch(`${VPS_URL}/queue-timing/${encodeURIComponent(jobId)}`, {
```

Job IDs (`MCDB-000…`) are URL-safe today; this stops `/`, `?` or `#` in a future ID from changing which route is called.

### Deleted

- `app/api/[...path]/route.ts` (unused proxy, Phase 1 finding)
- `pnpm-lock.yaml` (4-line stub) ⚠️

### Not changed

- `middleware.ts` (the `proxy.ts` rename in Next.js 16 is optional and was skipped)

---

## Appendix E – Cloudflare, Vercel and Slack settings

### HSTS (Cloudflare)

`mediacrater.com` → **SSL/TLS** → **Edge Certificates** → **HTTP Strict Transport Security (HSTS)** → Enable HSTS: **on**, Max Age **12 months**, Apply to subdomains **off**, Preload **off**, No-Sniff **off**.

Why not the other options: the setting applies to every proxied hostname at once, `includeSubDomains` makes any subdomain without HTTPS unreachable, and preload removal takes months. Undo: set Max Age to 0; browsers forget it on their next HTTPS visit.

### Removed: `HSTS TEST` Transform Rule

Was: Rules → Response Header Transform Rule, hostname `test.mediacrater.com`, Set static `Strict-Transport-Security: max-age=300`. Deleted once the zone setting was on (Cloudflare's header came first, so the rule had no effect).

### Web Analytics

Account level → **Analytics & Logs** → **Web Analytics**: LIVE has **automatic setup** on, which injects the beacon into every proxied hostname in the zone. Left on; allowed in the CSP.

### Slack webhook

1. `https://api.slack.com/apps` → your app (or **Create New App** → From scratch).
2. **Incoming Webhooks** → Activate → **Add New Webhook to Workspace** → choose the channel → **Allow** → copy the URL (secret, never commit).

### Vercel environment variables (each project, Environment: Production)

| Key | TEST | LIVE |
|---|---|---|
| `CSP_SLACK_WEBHOOK_URL` | `<slack webhook url>` | `<slack webhook url>` |
| `NEXT_PUBLIC_STATE` | `TEST_ENVIRONMENT` | `LIVE` |
| `CSP_MODE` | not set (report-only) | not set (report-only) |

Any change needs a redeploy: **Deployments** → newest → **…** → **Redeploy**.

---

## Appendix F – Verification and troubleshooting commands

### Headers

```bash
# Web app (replace with the TEST web host for TEST)
curl -sI https://mediacrater.com/dashboard | grep -iE "content-security|x-content-type|referrer-policy|x-frame|cross-origin-opener|permissions-policy|x-powered-by|strict-transport"

# VPS
curl -sI https://host.mediacrater.com/health | grep -iE "x-content-type|cache-control|referrer-policy|x-frame|content-security"
curl -sI https://host.mediacrater.com/cf-ok  | grep -iE "x-frame|content-security"

# HSTS (expect exactly one line each)
for h in test.mediacrater.com host.mediacrater.com mediacrater.com; do curl -sI https://$h/ | grep -i "^strict-transport"; done
```

### Report endpoint and Slack

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://mediacrater.com/api/csp-report \
  -H "content-type: application/csp-report" \
  -d '{"csp-report":{"document-uri":"https://example.com/slack-test","effective-directive":"img-src","blocked-uri":"https://example.com/slack-test.png"}}'
```

Expected: `204`, a `[CSP]` line in Vercel Logs, and a Slack message (the same report within an hour is not re-posted). `404` = route file not at `app/api/csp-report/route.ts`. `403` = the Cloudflare rule that adds the `/api` proxy-secret header isn't reaching the route.

### Browser sanity test

In the Console on any page:

```js
fetch('https://example.com/csp-sanity-check').catch(() => {})
```

Expected: "…violates the following Content Security Policy directive: "connect-src …" The policy is report-only…", plus a `[CSP]` line in Vercel/Slack. Console filter: `Content Security Policy`. Ignore anything from `chrome-extension://`, `moz-extension://` or `safari-web-extension://`.

| Console message | Meaning |
|---|---|
| "…violates … The policy is report-only…" | Would be blocked once enforced: send it to me |
| "Refused to …" | Blocked (only after `enforce`) |
| Turnstile `postMessage` / `No available adapters` / `OTS parsing error` | Turnstile's own noise inside `/cf-ok` |
| `ERR_BLOCKED_BY_CLIENT` on `beacon.min.js` | Your ad blocker |

---

## Appendix G – Enforcement runbook and rollback

### Enforce (TEST first, LIVE a day later)

1. Vercel → project → Settings → **Environment Variables** → **Add**: `CSP_MODE` = `enforce` (lowercase, no quotes), Environment: **Production** → Save.
2. **Deployments** → newest → **…** → **Redeploy** → wait for **Ready**.
3. Check:
   ```bash
   curl -sI <site>/dashboard | grep -i "^content-security-policy"
   ```
   Expected: the header is `content-security-policy:` (no `-report-only`) and ends with `upgrade-insecure-requests`.
4. Click through: sign in, sign up, forgot password, every scan type (including image and video URLs), scan history, buy scans, manage plan, a made-up URL (404). Watch Slack and the console for "Refused to …".

If it's still report-only after step 3, check: the right project, **Production** ticked, the exact value, and that the newest deployment was created after saving and is the current one.

### Rollback

| What | How |
|---|---|
| CSP breaks something | `CSP_MODE=off` → Redeploy (or `report-only` to keep the reports) |
| A header breaks something | Remove it from `securityHeaders` in `next.config.mjs`, commit |
| VPS headers | Restore `server.js.bak-phase2` (TEST) or your LIVE backup → `pm2 restart <app>` |
| HSTS | Cloudflare HSTS Max Age → 0 (browsers clear it on their next HTTPS visit) |
| Slack noise | Remove `CSP_SLACK_WEBHOOK_URL` → Redeploy (reports still go to Vercel Logs) |

---

## Appendix H – The rejected hash pipeline (for later)

Recorded in case the Step 4 criteria become true. Tested in the sandbox, not implemented.

1. **Fixed build ID:** `generateBuildId: async () => process.env.VERCEL_GIT_COMMIT_SHA || 'local-build'` in `next.config.mjs`.
2. **Build script:** `"build": "next build && node scripts/csp-hashes.mjs && next build && node scripts/csp-hashes.mjs --verify"`.
3. **`scripts/csp-hashes.mjs`:** read every `.next/server/app/*.html`, take each inline `<script>` (no `src`), SHA-256 → base64 → `'sha256-…'`, write the union to `csp-hashes.json`. With `--verify`, recompute and **fail the build** if anything differs from the file.
4. **`next.config.mjs`:** read `csp-hashes.json` and replace `'unsafe-inline'` in `script-src` with the hashes.

Measured: 4 inline scripts per page (one includes the build ID); with a fixed build ID, two builds gave identical hashes on all 18 pages. Costs: roughly double build time; a Next.js upgrade that changes the inline scripts fails deploys until the hashes regenerate (which the two-pass build does automatically). Any future server-rendered page would need a per-request nonce set in `middleware.ts` and must be excluded from the header in `next.config.mjs`.

---

*End of index.  
Conversation: https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d*
