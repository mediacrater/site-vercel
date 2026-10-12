# Sign In / Sign Up With Google: VPS OAuth Routes, Cloudflare Worker Proxy, Turnstile and Device Checks, Branding Verification & Live Rollout

| | |
|---|---|
| **Date** | 12 October 2026 (`12oct26`) |
| **Conversation** | `<add this conversation's URL>` |
| **Related prior work** | `vps-hardening-cloudflare-lockdown-ssrf-fix-02oct26.md` (2 Oct 2026, nginx origin-auth snippet, Transform Rule)<br>`auth-hardening-turnstile-supabase-origin-secret-05oct26.md` (5 Oct 2026, device data, Turnstile, `/api/signup`)<br>6 Oct 2026 per-scan abuse check index (`abuse_lock_exempt`, `action_required`, `detect_duplicate_free_ips`) |
| **Related work (same conversation)** | `server-verified-accounts-12oct26.md` (pending → active model that Google sign-in depends on)<br>`ipinfo-geolocation-12oct26.md`<br>`unverified-account-cleanup-job-12oct26.md` |
| **Stack** | Next.js web app on Vercel (Google button, `/auth/callback`), VPS Node/Express 5 API behind nginx + PM2 (`routes/api/oauth/*`), Cloudflare (Worker, Transform Rule, Turnstile, Bot Fight Mode), Supabase Auth + Postgres (**separate projects for test and live**), Google Auth Platform |
| **Starting trigger** | Add "Sign up with Google" for convenience (many users are on Gmail) **without** losing the IP, device and Turnstile checks that `/api/signup` performs, and build it on the VPS rather than Vercel, since you plan to leave Vercel |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included. `<test-website-host>` stands for the long random test site hostname, `<tools-host>` for the tools hostname, `<test-project-ref>` / `<prod-project-ref>` for the Supabase project references, `YOUR_IP` for your home IP. Secret values are shown as `<…>`.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied. ⏳ = open.

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
9. [Appendix A – How the flow works](#appendix-a--how-the-flow-works)
10. [Appendix B – server.js edits](#appendix-b--serverjs-edits)
11. [Appendix C – Cloudflare Worker (final, v4)](#appendix-c--cloudflare-worker-final-v4)
12. [Appendix D – SQL](#appendix-d--sql)
13. [Appendix E – VPS files (final)](#appendix-e--vps-files-final)
14. [Appendix F – Web app files](#appendix-f--web-app-files)
15. [Appendix G – Verification and troubleshooting commands](#appendix-g--verification-and-troubleshooting-commands)
16. [Appendix H – Rollback and kill switch](#appendix-h--rollback-and-kill-switch)
17. [Appendix I – Questions answered along the way](#appendix-i--questions-answered-along-the-way)

---

## 1. Summary

Google sign-in is **live on test and production**. Button click → `POST /api/oauth/start` (VPS, through a Cloudflare Worker on the site's own domain, so cookies are first-party) checks Turnstile, the per-IP rate limit and consent, then sets a signed 10-minute intent cookie → Google (via Supabase) → `/auth/callback` → `POST /api/oauth/complete` (VPS) verifies the token and the intent, records IP and device, records consent and activates the account.

**Main outcomes**

- New accounts start as `pending_verification` (see `server-verified-accounts-12oct26.md`). Only `/api/oauth/complete` (Google) or `/api/signup` (email) activates them, and scan routes refuse anything that isn't `active`.
- **Existing accounts merge automatically** when the Google email matches a confirmed account. You verified this on test and live.
- New Google users who start from **Sign in** get a "One last step" consent screen before activation.
- The real visitor IP and country reach the VPS through a secret-protected header (`x-mc-edge-secret`). Without it, every Google signup would have been recorded with a Cloudflare IP.
- The Worker adds nginx's `X-Origin-Auth` itself, because Transform Rules don't apply to requests a Worker makes.
- Google **branding verified** and the app **published**. The account chooser shows "Mediacrater", not the Supabase URL.
- Production rollout done: phases 0–6 were done in a different order than planned (see [Phase 16](#phase-16--production-rollout)).

**Not done / differs from plan:** production runs the **earlier** Google button **without** the on/off switch (`NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` has no effect). Your kill switch is the Google provider toggle in Supabase.

---

## 2. Status at a glance

### Test environment

| Area | Status | Notes |
|---|---|---|
| VPS OAuth routes + `_shared` helpers (test) | ✅ Done | `curl` to `/api/oauth/start` returned 400 `Invalid request.` (correct) |
| `server.js` edits (test) | ✅ Done | |
| Worker `oauth-proxy` (v4) + route `<test-website-host>/api/oauth/*` | ✅ Done | workers.dev and Preview toggles were off from the start |
| Worker variables `API_ORIGIN`, `EDGE_PROXY_SECRET`, `ORIGIN_AUTH_SECRET` | ✅ Done | |
| `TURNSTILE_SECRET_KEY` (test VPS) | ✅ Fixed | Was the wrong key (`invalid-input-secret`) |
| Supabase test: constraint + pending logic | ✅ Done | Via `04` (replaced the earlier `02` trigger) |
| Existing account merges with Google | ✅ Verified | |
| New Google signup | ✅ Verified | After the constraint fix |
| New Google user from `/signin` → consent screen → active, then scan | ✅ Verified | "Did that already, works as intended" |
| `abuse_lock_exempt` on your test accounts | ✅ Done | |
| Transform Rule no longer includes `<test-website-host>` | ⚠️ Unconfirmed | Advised, to stop the origin secret going to Vercel |

### Google

| Area | Status | Notes |
|---|---|---|
| Branding | ✅ Verified | "Your branding has been verified and is being shown to users" |
| Data access | ✅ Not required | Only `openid`, `email`, `profile` |
| Publishing status | ✅ In production | The "100 user cap" applies only to unapproved sensitive scopes |
| Privacy policy Google section | ✅ Added | You made the changes, then resubmitted |
| Bot Fight Mode | ✅ Back on | Was off temporarily for the review |
| Account chooser shows your app name | ✅ Verified | `supabase.co` text gone after verification |

### Production

| Area | Status | Notes |
|---|---|---|
| Supabase prod `00` (constraint) | ✅ Done | Constraint lists all three values |
| Prod `handle_new_user()` matched test's | ✅ Checked | So `04` lost nothing |
| Repair query run (before `04`) | ✅ Run | Changed nothing: no pending accounts existed yet |
| Supabase prod `04` | ✅ Done | Your drift check shows test = live |
| Prod VPS files + `server.js` | ✅ Done | You **copied test's whole `server.js`** to production |
| Prod `.env` secrets (new `OAUTH_INTENT_SECRET`, `EDGE_PROXY_SECRET`, `TURNSTILE_SECRET_KEY`, `IPINFO_TOKEN`) | ✅ Done | Turnstile check returned `invalid-input-response` (correct) |
| Prod `utils/urlThumbnail.js` | ✅ Fixed | Was missing; startup error |
| Worker `oauth-proxy-prod` + route `mediacrater.com/api/oauth/*` | ✅ Done | `curl` returned `{"error":"Invalid request."}` |
| Prod Supabase callback URL added to the Google client | ✅ Done | Added **before** `04` (gap, see Phase 16) |
| Email signups on prod end up active | ✅ Verified | You signed up several times |
| Google sign-in on prod (merge with existing account) | ✅ Verified | |
| Google signups between the redirect-URI fix and `04` checked | ⚠️ Not run | Query in [Appendix G](#appendix-g--verification-and-troubleshooting-commands) |
| On/off switch for the button | ⏳ Not deployed | Production runs the button version without the switch |
| `diff server.js.bak-google server.js` on prod | ⚠️ Not run | Shows whether test-only code went live |
| Prod PM2 restart count (898) stable | ⚠️ Not checked | |
| `www.mediacrater.com/api/oauth/*` route | ⚠️ Unknown | Only needed if you serve `www` |

---

## 3. Starting point

- Email signup on Vercel (`/api/signup`) checks Turnstile (inside Supabase `signUp`), applies a per-IP rate limit (`check_and_log_rate_limit`, 10 per 24 h) and writes `ip_at_creation`, `browser_id`, the consent timestamp and an `account_devices` row with the service-role key.
- Vercel middleware (`middleware.ts`) blocks `/api/*` requests without `x-mediacrater-proxy-secret`, which a Cloudflare Transform Rule adds.
- The VPS listens on `127.0.0.1` behind nginx. `getClientIp()` uses `X-Real-IP`. `authenticateUser` writes `ip_at_creation` if it's null. Scan routes refuse non-`active` accounts with 403 `ACCOUNT_FLAGGED`.
- nginx test block: `include /etc/nginx/snippets/cloudflare-origin-auth.conf;`, which returns `444` unless `X-Origin-Auth` matches the value the Transform Rule adds.
- The `mc_device_id` cookie is **host-only** (no `Domain`), set by Vercel middleware.
- Supabase trigger `on_auth_user_created` → `handle_new_user()` inserts `profiles` from `raw_user_meta_data`.
- `profiles_account_status_check` allowed only `'active'` and `'action_required'`.
- The Supabase browser client uses the **implicit** flow (tokens come back in the URL hash).

---

## 4. Timeline: what we did, in order

### Phase 1 – Do we lose IP and fingerprint data with Google sign-in?

No. Both are collected when the user returns to `/auth/callback`. What's lost and has to be rebuilt: Turnstile and the per-IP limit (Supabase doesn't apply captcha to OAuth, as far as I know), the "account exists before the server sees it" problem, and the consent timestamp. Gains: a Google-verified email (no typos, no confirmation email), costlier fake accounts, and no passwords.

### Phase 2 – VPS instead of Vercel, and the cookie blocker

You wanted routes in `routes/api/oauth/`. **Blocker:** `mc_device_id` is host-only, so `api.*` couldn't read it. Two options: (1) serve the VPS **under the site's domain by path** through Cloudflare (recommended), or (2) a shared `Domain=.mediacrater.com` cookie. **You chose option 1.** I also pushed back on putting `public/` (favicon, index.html) under `routes/api`, and on `route.ts` naming (the VPS is CommonJS JS).

### Phase 3 – Information gathering

You sent `server.js`, the folder listing, `package.json` dependencies and `.env` variable **names**, plus the `auth.users` trigger query (`on_auth_user_created → handle_new_user()`).

### Phase 4 – The build

Files are listed in [Appendix E](#appendix-e--vps-files-final), [B](#appendix-b--serverjs-edits), [C](#appendix-c--cloudflare-worker-final-v4), [D](#appendix-d--sql) and [F](#appendix-f--web-app-files). An integration test on real Express 5 with a fake Supabase passed:

| Test | Result |
|---|---|
| Signup without consent | 400 |
| Bad Turnstile token | 400 |
| Bad `mode` | 400 |
| Pending user, no intent cookie | 403 `INTENT_REQUIRED` |
| Signin intent, pending user, no consent | 409 `CONSENT_REQUIRED`, still pending |
| Tampered intent (forged consent flag) | 403 (HMAC check) |
| Consent given | 200, `active`, consent + `browser_id` + `ip_at_creation` set, device row `signup` |
| Replayed intent on a pending user | 403 (single use) |
| Flagged (`action_required`) user | 200 login recorded, status **unchanged** |
| Forged `x-mc-edge-secret` | Ignored; nginx `X-Real-IP` used, no country |

### Phase 5 – Your questions before implementing

Answered in [Appendix I](#appendix-i--questions-answered-along-the-way): existing Gmail accounts merge automatically; profiles still get the email (via `handle_new_user`); first name (only if you'll use it).

### Phase 6 – Google said "requires verification"; you paused, then applied everything to the test site anyway

The test setup pointed at `<test-website-host>` and `test.mediacrater.com`. I explained that **Testing mode allows up to 100 listed test users without verification**.

### Phase 7 – 404 on `/api/oauth/start`

The relative `fetch('/api/oauth/start')` is correct by design (same-origin, first-party cookies). The 404 came from Vercel because the Worker wasn't running for that path. You tried **Add Domain** (Custom Domain), which failed with "externally managed DNS records", and the existing route was `test.mediacrater.com/api/auth/*` (wrong host **and** `auth` instead of `oauth`). Fix: **Add Route** for `<test-website-host>/api/oauth/*`, and don't delete DNS records.

### Phase 8 – 500 from the Worker

Metrics showed **Subrequests: 0**, so the Worker crashed before forwarding. Likely `API_ORIGIN` without `https://`. **Worker v2** validates its config, trims secrets, and returns 503 or 502 JSON with a logged reason. You added `https://` to `API_ORIGIN` (correct) and to the route (unnecessary).

### Phase 9 – 520 (part 1): forwarding the website's Host header

**v3** stops forwarding `Host`, `cf-*`, `x-forwarded-*`, `x-real-ip`, `forwarded` and `cdn-loop`. Cloudflare honours a copied `Host` on same-zone subrequests, so nginx received the **website's** hostname.

### Phase 10 – 520 (part 2): nginx 444, origin-auth

Your diagnostics (exact commands in [Appendix G](#appendix-g--verification-and-troubleshooting-commands)):
- direct Node `curl` → 400 ✅; through Cloudflare and nginx → 400 ✅;
- nginx `access.log`: the Worker's requests (`2a06:98c0:3600::103`, Cloudflare's Worker address) got **444**;
- the temporary host-logging attempt: first all steps ran at once (deleted before the click), then the log stayed empty;
- `nginx -T` showed the test block includes `cloudflare-origin-auth.conf`: `if ($http_x_origin_auth != "<secret>") { return 444; }`.

Cause: the Transform Rule adds `X-Origin-Auth` to visitor traffic, but **not to requests a Worker makes**. **Worker v4** sends it itself, from a new secret `ORIGIN_AUTH_SECRET`, and strips any client-sent copy.

### Phase 11 – The Transform Rule included the website hostname

Your "protect VPS and tools" rule listed `host.mediacrater.com`, `test.mediacrater.com`, `<tools-host>` **and `<test-website-host>`** (the Vercel site). That sends the nginx origin secret to Vercel on every request. Advised: remove the website hostname, and keep each origin's secret to that origin (the Vercel secret rule must not set `X-Origin-Auth`, and vice versa).

### Phase 12 – 503, and the two different secrets

The 503 was v4's config check: `ORIGIN_AUTH_SECRET` was missing. You had `EDGE_PROXY_SECRET` and thought it was the same thing. They're **different** secrets for different layers:

| Secret | Lives in | Checked by |
|---|---|---|
| nginx origin secret | nginx snippet, Transform Rule, Worker `ORIGIN_AUTH_SECRET` | nginx (`444` otherwise) |
| edge secret | VPS `.env` `EDGE_PROXY_SECRET`, Worker `EDGE_PROXY_SECRET` | Node `getClientIp()` |

You found the grep value matched what was in the Worker. I explained both possible cases: (a) it matches the Transform Rule, which is expected, so copy it to `ORIGIN_AUTH_SECRET`; (b) it was reused as `EDGE_PROXY_SECRET`, in which case generate a new edge secret. You then set it up.

### Phase 13 – 400 "Verification failed": Turnstile

Logs showed `[TURNSTILE] siteverify HTTP error: 400` (my helper dropped the error codes; fixed in `authGuards.js` **v2**). Direct `siteverify` test from the VPS: `{"error-codes":["invalid-input-secret"]}` → **wrong `TURNSTILE_SECRET_KEY`** on the test VPS. Fixed with the secret of the widget whose site key the website uses. Then: **"FINALLY it works"**, and an existing account merged.

### Phase 14 – "Database error saving new user" for new Google users

Postgres logs: `new row for relation "profiles" violates check constraint "profiles_account_status_check"`. The constraint allowed only `active` / `action_required`, and my `02` trigger wrote `pending_verification`. Step `01` (the check) had been skipped. Fixed by recreating the constraint with all three values in one transaction ([Appendix D](#appendix-d--sql)). Logs also revealed an **Auth Hook** writing `[HOOK EVENT] {… "email": "…" …}` (personal data in logs), plus `SET LOCAL can only be used in transaction blocks` warnings. ⏳ The hook function was never provided.

### Phase 15 – Branding verification and costs

- Google's first verdict: privacy policy "insufficient", home page "behind a login", "not compliant… AI NCII". I fetched both pages: they were public and complete, **but the privacy policy never mentioned Google sign-in**. I gave you a Google Sign-In section, plus three fixes: "account creation **or sign in**" for device data, a Google entry under "how we use", and a "Third-party services" entry. Home page: likely **Bot Fight Mode** challenging Google's reviewer. You turned it off temporarily, and it **"worked right away"**. Branding verified; app published.
- Account chooser showed "to continue to `<test-project-ref>`.supabase.co". Removing that redirect URI broke sign-in (it must stay). Options were brand verification, a Supabase custom domain, or Google's own button. **Resolved by brand verification:** the text is gone.
- Costs: Google sign-in is free. Supabase MAU (Free 50k; Pro includes 100k, then $0.00325/MAU). Cloudflare Workers Free 100k requests/day (about 2 per Google sign-in). IPinfo: see `ipinfo-geolocation-12oct26.md`.

### Phase 16 – Production rollout

Planned order (0 → 8). **What actually happened:**

1. **Phase 0:** different Supabase projects for test and live; the prod Turnstile check said "missing" → you added `TURNSTILE_SECRET_KEY` → `invalid-input-response` ✅; new secrets generated; `server.js` backed up as `server.js.bak-google`.
2. **Prod `handle_new_user()`** compared to test: identical apart from formatting. One trigger (`on_auth_user_created`).
3. **Phase 1:** `00` run; constraint now lists all three values ✅.
4. **Phase 2:** prod failed to start until `utils/urlThumbnail.js` was moved into `utils/`. You **copied test's `server.js`** over production's instead of applying the 4 edits. PM2 showed **898 restarts** on prod (37 on test). The `curl` in the same command ran at uptime 0 s, so it printed nothing.
5. **Phase 3:** Worker `oauth-proxy-prod`; `curl https://mediacrater.com/api/oauth/start` → `{"error":"Invalid request."}` ✅.
6. **Phase 4 skipped** (you were impatient). A Google click on prod returned **"Access blocked: This app's request is invalid"** (`redirect_uri_mismatch`): the prod Supabase callback URL wasn't in the Google client.
7. I warned not to add the URL before `04`: without the pending logic, new Google users would be active immediately, with **no consent recorded** and no Turnstile. **You added it anyway** ("a 3rd URL"), and Google sign-in on prod worked and merged with your account.
8. I listed the risks and the safe order. You asked why not just run the SQL. Answer: you can, but email signups would stay pending until the new `/api/signup` is live, fixable with a repair query.
9. You ran the **repair query first** (no-op, nothing was pending), then **`04`**. Your drift check (everything except env and package files) showed **test = live**.
10. Email signups on prod: active ✅ (signed up several times, deleted, repeated).
11. The button was visible on prod **without** `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`. I checked the GitHub repo: `components/google-auth-button.tsx` has **no switch code**. It's the earlier version.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | "My app requires verification" | Google branding not yet verified | Testing mode (100 test users) first; later verified |
| 2 | 404 on `/api/oauth/start` | Worker route missing; existing route was `test.mediacrater.com/api/auth/*` | Route `<test-website-host>/api/oauth/*` |
| 3 | "Hostname … already has externally managed DNS records" | Used **Add Domain** (Custom Domain) instead of **Add Route** | Add Route; don't delete DNS |
| 4 | Worker editor preview: "Method not allowed" | The preview sends GET; the Worker only allows POST | Expected |
| 5 | 500 from the Worker, Subrequests 0 | Crash before fetch (`API_ORIGIN` without `https://`) | `https://` added; Worker v2 validates config |
| 6 | 520 (Worker trace: fetch → HTTP 520 after 101 ms) | v1/v2 forwarded the website's `Host` → nginx default server `return 444` | v3 strips `Host` and hop headers |
| 7 | 520 again with v3 | nginx origin-auth: no `X-Origin-Auth` on Worker requests | v4 sends `ORIGIN_AUTH_SECRET` |
| 8 | Host-debug log empty | First all commands ran together (file deleted before the click); then the 444 check in the server block | Diagnosed from `nginx -T` instead |
| 9 | nginx `access.log` showed `YOUR_IP` on earlier 444s, the Worker IP on later ones | v1/v2 forwarded the visitor's `cf-connecting-ip`; v3 stripped it | Confirmed v3 was live |
| 10 | Origin secret sent to Vercel | Transform Rule included `<test-website-host>` | ⚠️ Remove that hostname |
| 11 | 503 `Sign-in is temporarily unavailable.` | `ORIGIN_AUTH_SECRET` not set in the Worker | Added |
| 12 | Confusion between `EDGE_PROXY_SECRET` and the nginx secret | Two secrets for two layers | Table in Phase 12 |
| 13 | 400 `Verification failed` | Wrong `TURNSTILE_SECRET_KEY` on test (`invalid-input-secret`) | Correct widget secret |
| 14 | Log only showed `siteverify HTTP error: 400` | My helper didn't read the body on non-200 | `authGuards.js` v2 logs `error-codes` |
| 15 | "Database error saving new user" | `profiles_account_status_check` didn't allow `pending_verification` | Constraint recreated with three values |
| 16 | `[HOOK EVENT]` logs full user JSON incl. email; `SET LOCAL` warnings | Your Auth Hook | ⏳ Needs the hook function |
| 17 | Branding rejected (privacy, login wall, NCII) | No Google section in the privacy policy; Bot Fight Mode challenged the reviewer | Section added, Bot Fight Mode paused, resubmitted ✅ |
| 18 | Account chooser showed the Supabase URL; removing the redirect URI broke sign-in | Unverified app shows the redirect domain; Supabase needs that exact URI | Fixed by brand verification |
| 19 | Prod: Turnstile check "missing" | Prod `.env` had no `TURNSTILE_SECRET_KEY` (never needed before) | Added |
| 20 | Prod didn't start | `utils/urlThumbnail.js` missing on prod | You moved it in |
| 21 | Prod `curl` printed nothing | Ran in the same command as the restart (uptime 0 s) | Re-run later (the phase 3 test passed through the full chain) |
| 22 | Prod 898 PM2 restarts | Past crash loops (e.g. earlier `MODULE_NOT_FOUND` in `security/ssrf.js`) | ⚠️ Check it stays stable |
| 23 | "Use --update-env to update environment variables" | PM2 shell-env notice | Harmless: the app loads `.env` itself |
| 24 | Prod "Access blocked: This app's request is invalid" | `redirect_uri_mismatch`: prod Supabase callback not in the Google client | Added (before `04`, see Phase 16) |
| 25 | Button visible without the env var | Repo has the **pre-switch** button version | Explained; kill switch = Supabase provider toggle |
| 26 | Prod logs: `Exceeded limit on max data-uri per request: 250` (scan-video) | A client sent more than 250 frames | ⏳ Server-side frame cap |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. **Worker v1 forwarded the visitor's `Host` header**, which caused the first 520.
2. **I deleted `x-mediacrater-proxy-secret`** in the Worker without knowing nginx needed its own `X-Origin-Auth`. v4 fixes this.
3. **The host-debug log approach didn't work** (combined commands, then nginx dropped the connection before logging).
4. **The `02` trigger went in before the constraint was checked**, which broke new Google signups. Step `01` existed but wasn't enforced.
5. **I told you to use "the same `IPINFO_TOKEN` as on Vercel"**, assuming you had one. You had no IPinfo account (see `ipinfo-geolocation-12oct26.md`).
6. **I said a missing `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` hides the button.** That's only true for the switch version, which was never deployed.
7. **I misread the Worker toggles** in a greyed-out screenshot as "on". They were off from the start.
8. **The first Turnstile helper hid the error codes** on HTTP 400.

### Decisions

1. **VPS routes behind a path-routed Cloudflare Worker** (`/api/oauth/*` on the site domain) instead of a subdomain API, so cookies stay first-party and there's no CORS.
2. **Pending until verified by the server.** New Google accounts can't scan until `/complete` checks the intent cookie and consent (later generalised to all accounts).
3. **Signed, single-use intent cookie** (HMAC, 10 min, `Path=/api/oauth`), so Turnstile can't be skipped by opening Supabase's Google link directly.
4. **Separate secrets per hop** (origin-auth for nginx, edge secret for Node, intent secret for cookies, all different on test and live).
5. **Existing (non-pending) accounts never change status in `/complete`.** Intent is optional for them, so a slow Google login doesn't lock anyone out. Abuse locks are never lifted.
6. **Consent is required for new accounts**, from the signup checkbox or the callback "One last step" screen.
7. **Only basic scopes** (`openid`, `email`, `profile`), so no Google review and no user cap.
8. **Kill switch:** disable the Google provider in Supabase (instant).
9. **Implicit flow kept.** PKCE is stronger, but switching globally would break email-confirmation links opened in a different browser.

---

## 7. Open items checklist

### Do next

- [ ] Run the "Google signups before `04`" query on **prod** ([Appendix G](#appendix-g--verification-and-troubleshooting-commands)). Expected: only your own accounts. Any other row with `consent` NULL → set it to `pending_verification`, so it gets the consent screen
- [ ] Remove `<test-website-host>` from the "protect VPS and tools" Transform Rule, then test the Google button again
- [ ] `diff server.js.bak-google server.js` on prod. Expected: only the 4 OAuth edits
- [ ] `pm2 list` twice a minute apart. Expected: the prod `↺` count doesn't grow
- [ ] If you serve `www.mediacrater.com`, add the Worker route `www.mediacrater.com/api/oauth/*`

### Verify

- [ ] Prod `oauth-proxy-prod`: workers.dev and Preview toggles off
- [ ] Prod `account_devices` rows show real IPs, not `2a06:98c0:…`

### Improvements (not urgent)

- [ ] Deploy the switch version of the button (`NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`). **Set it to `true` in every environment before deploying**, or the button disappears
- [ ] Auth Hook cleanup: log the user ID only, and fix the `SET LOCAL` warnings (send the function)
- [ ] Separate origin-auth secrets for `host.` and `test.` (currently shared)
- [ ] Optional "Connect Google account" in Settings (`linkIdentity`, needs Manual linking enabled)
- [ ] Optional: switch to PKCE flow (test email confirmation in another browser first)

### Still open, unrelated to Google

- [ ] Server-side cap of 250 frames on video scans (prod error `Exceeded limit on max data-uri per request: 250`)
- [ ] Stop logging full `aiData` (customer ad descriptions) in `helpers.js`
- [ ] Rename `PATH` in `.env`
- [ ] `ignoreBuildErrors: true` in `next.config.mjs`

---

## 8. Reference: key settings

| Item | Test | Production |
|---|---|---|
| Site | `https://<test-website-host>` | `https://mediacrater.com` |
| API host (`API_ORIGIN`) | `https://test.mediacrater.com` | `https://host.mediacrater.com` |
| PM2 app / folder / port | `mediacrater-api-test` / `/var/www/mediacrater-api-test` / 3001 | `mediacrater-api` / `/var/www/mediacrater-api` / 3000 |
| Worker / route | `oauth-proxy` / `<test-website-host>/api/oauth/*` | `oauth-proxy-prod` / `mediacrater.com/api/oauth/*` |
| Supabase project | `<test-project-ref>` | `<prod-project-ref>` (separate) |
| Callback page | `/auth/callback` | `/auth/callback` |

| Item | Value |
|---|---|
| Worker variables | `API_ORIGIN` (text), `EDGE_PROXY_SECRET` (secret), `ORIGIN_AUTH_SECRET` (secret) |
| VPS `.env` additions | `OAUTH_INTENT_SECRET`, `EDGE_PROXY_SECRET`, `TURNSTILE_SECRET_KEY`, `IPINFO_TOKEN` |
| Intent cookie | `mc_oauth_intent`, HMAC-SHA256, `HttpOnly; Secure; SameSite=Lax; Path=/api/oauth`, 600 s, single use (in-memory, per process) |
| Device cookie | `mc_device_id` (host-only, `Path=/`, ~400 days) |
| Internal headers (Worker → VPS) | `x-origin-auth`, `x-mc-edge-secret`, `x-mc-client-ip`, `x-mc-client-country` |
| Rate limits (shared with Vercel routes) | `signup` 10 / 24 h, `signin` 8 / 2 min per IP; `/complete` 10 / min per user |
| `/complete` responses | 200 `{ ok, newUser }`, 409 `CONSENT_REQUIRED`, 403 `INTENT_REQUIRED` |
| Account status values | `active`, `action_required`, `pending_verification` |
| Google scopes | `openid`, `email`, `profile` |
| Google client redirect URIs | test Supabase callback, prod Supabase callback (plus one more you added) |
| Supabase Redirect URLs | `https://<site>/auth/callback` in each project |
| Log prefixes | `[OAUTH]`, `[OAUTH START]`, `[OAUTH COMPLETE]`, `[TURNSTILE]`, `[RATE LIMIT]`, `[DEVICE]`, Worker: `[oauth-proxy] misconfigured:` / `VPS unreachable:` |

---

## Appendix A – How the flow works

```
Browser (/signup or /signin)
  │ 1. POST /api/oauth/start {mode, acceptedTerms, turnstileToken}
  ▼
Cloudflare Worker (route <site>/api/oauth/*)
  │ strips Host, cf-*, x-forwarded-*, client copies of internal headers
  │ adds x-origin-auth, x-mc-edge-secret, x-mc-client-ip, x-mc-client-country
  ▼
nginx (444 unless X-Origin-Auth matches) → Node /api/oauth/start
  │ mode + consent → per-IP rate limit → Turnstile siteverify
  │ sets mc_device_id (if missing) + signed mc_oauth_intent (10 min)
  ▼
Browser → supabase.auth.signInWithOAuth('google') → Google → Supabase
  │ new user: trigger creates profile as pending_verification
  ▼
Browser /auth/callback
  │ waits for session, clears tokens from the URL
  │ 2. POST /api/oauth/complete (Bearer token, device fields, acceptedTerms?)
  ▼
Worker → nginx → Node /api/oauth/complete (authenticateUser)
  │ pending: needs intent + consent → device row "signup" → active,
  │          consent/browser_id/ip_at_creation filled if empty
  │ not pending: device row "login" only, status untouched
  ▼
200 → /dashboard   |   409 CONSENT_REQUIRED → "One last step"   |   403 → sign out, start again
```

---

## Appendix B – server.js edits

```js
// server.js — 4 edits for Google sign-in (search for each "FIND" line)
// Everything else in server.js stays exactly as it is.

// ─── EDIT 1 ────────────────────────────────────────────────────────────────
// FIND:
//   const net = require('net');
// ADD directly below it:
const crypto = require('crypto');

// ─── EDIT 2 ────────────────────────────────────────────────────────────────
// FIND:
//   const { handleScanFeedback } = require('./routes/scanFeedback');
// ADD directly below it:
const { createOAuthRouter } = require('./routes/api/oauth');

// ─── EDIT 3 ────────────────────────────────────────────────────────────────
// FIND the whole existing function (5 lines):
//   function getClientIp(req) {
//     // nginx overwrites X-Real-IP ...
//     return String(req.headers['x-real-ip'] || req.socket.remoteAddress || '')
//       .replace(/^::ffff:/, '')
//       .trim();
//   }
// REPLACE it with everything below:

// OAUTH: the Cloudflare Worker that serves /api/oauth/* on the main domain
// sends the visitor's real IP in x-mc-client-ip (otherwise every Google sign-up
// would be recorded with a Cloudflare IP). That header is only trusted when the
// request also carries the Worker's shared secret; anything else falls back to
// nginx's X-Real-IP exactly as before.
const EDGE_PROXY_SECRET = process.env.EDGE_PROXY_SECRET || '';

function isFromTrustedEdge(req) {
  const given = req.headers['x-mc-edge-secret'];
  if (!EDGE_PROXY_SECRET || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(EDGE_PROXY_SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getClientIp(req) {
  if (isFromTrustedEdge(req)) {
    const edgeIp = String(req.headers['x-mc-client-ip'] || '').trim();
    if (net.isIP(edgeIp)) return edgeIp;
  }
  // nginx overwrites X-Real-IP with the real-IP-restored address, and Node only
  // listens on 127.0.0.1, so a client can't set this header.
  return String(req.headers['x-real-ip'] || req.socket.remoteAddress || '')
    .replace(/^::ffff:/, '')
    .trim();
}

// OAUTH: visitor country from Cloudflare, same trust rule as the IP.
function getClientCountry(req) {
  if (!isFromTrustedEdge(req)) return null;
  const country = String(req.headers['x-mc-client-country'] || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

// ─── EDIT 4 ────────────────────────────────────────────────────────────────
// FIND (in "// 5. Routes"):
//   app.post('/capture-ip', authenticateUser,
// ADD directly ABOVE it:
app.use('/api/oauth', createOAuthRouter({
  supabase,
  authenticateUser,
  getClientIp,
  getClientCountry,
  logSafe,
  requestLimit,
}));
```

---

## Appendix C – Cloudflare Worker (final, v4)

Used for **both** `oauth-proxy` (test) and `oauth-proxy-prod`, each with its own variables.

```js
// cloudflare/oauth-proxy-worker.js
//
// Cloudflare Worker. Route: <site hostname>/api/oauth/*
// Forwards those requests to the VPS so the browser sees them as same-origin
// (first-party cookies, no CORS). Every other path never reaches this Worker.
//
// Worker settings → Variables and Secrets:
//   API_ORIGIN         text, scheme + host only, e.g. https://api-test.mediacrater.com
//                      (no path, no trailing slash)
//   EDGE_PROXY_SECRET  secret, the SAME value as EDGE_PROXY_SECRET in the VPS .env
//   ORIGIN_AUTH_SECRET secret, the SAME value your Cloudflare Transform Rule puts
//                      in the X-Origin-Auth header (and nginx checks in
//                      /etc/nginx/snippets/cloudflare-origin-auth.conf)
//
// v4: sends X-Origin-Auth. nginx drops (444 → Cloudflare 520) any request
// without it, and the zone's Transform Rule that normally adds it doesn't
// apply to requests the Worker makes itself.
//
// v3: the visitor's Host header (and Cloudflare's cf-* / forwarding headers)
// are no longer forwarded. Both hostnames are in the same Cloudflare zone, so
// Cloudflare honoured the copied Host header and the VPS received requests
// addressed to the WEBSITE's hostname; nginx had no matching server block,
// dropped the connection, and Cloudflare reported a 520.
//
// v2: configuration mistakes (missing https://, stray newline in the secret)
// and an unreachable VPS now return a clear JSON error and log the reason,
// instead of crashing with a bare 500. Secrets are never logged.
//
// The client IP/country come from Cloudflare (cf-connecting-ip, request.cf),
// which visitors can't fake. Client-sent copies of our internal headers are
// deleted first.

// Never forwarded: our internal headers (re-added below from trusted values),
// the Vercel secret, and headers that describe the ORIGINAL hop. fetch() sets
// the correct Host for API_ORIGIN, and Cloudflare adds fresh cf-* headers.
const STRIP_HEADERS = [
  'x-mc-edge-secret',
  'x-mc-client-ip',
  'x-mc-client-country',
  'x-origin-auth',
  'x-mediacrater-proxy-secret', // the Vercel secret, if a Transform Rule added it
  'host',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
  'cdn-loop',
];

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function readConfig(env) {
  let origin;
  try {
    origin = new URL(String(env.API_ORIGIN || '').trim());
  } catch {
    return { error: 'API_ORIGIN is missing or not a valid URL (it must start with https://)' };
  }
  if (origin.protocol !== 'https:') {
    return { error: 'API_ORIGIN must start with https://' };
  }
  if (origin.pathname !== '/' || origin.search || origin.hash) {
    return { error: 'API_ORIGIN must be scheme + host only, with no path' };
  }

  const secret = String(env.EDGE_PROXY_SECRET || '').trim();
  if (secret.length < 32) {
    return { error: 'EDGE_PROXY_SECRET is missing or shorter than 32 characters' };
  }
  if (!/^[\x21-\x7e]+$/.test(secret)) {
    return { error: 'EDGE_PROXY_SECRET contains spaces or invalid characters' };
  }

  const originAuth = String(env.ORIGIN_AUTH_SECRET || '').trim();
  if (originAuth.length < 32) {
    return { error: 'ORIGIN_AUTH_SECRET is missing or shorter than 32 characters' };
  }
  if (!/^[\x21-\x7e]+$/.test(originAuth)) {
    return { error: 'ORIGIN_AUTH_SECRET contains spaces or invalid characters' };
  }

  return { origin: origin.origin, secret, originAuth };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/oauth/')) {
      return jsonError(404, 'Not found');
    }
    if (request.method !== 'POST' && request.method !== 'OPTIONS') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST, OPTIONS' } });
    }

    const config = readConfig(env);
    if (config.error) {
      console.error('[oauth-proxy] misconfigured:', config.error);
      return jsonError(503, 'Sign-in is temporarily unavailable.');
    }

    const target = config.origin + url.pathname + url.search;

    const headers = new Headers(request.headers);
    for (const name of STRIP_HEADERS) headers.delete(name);
    for (const name of [...headers.keys()]) {
      if (name.startsWith('cf-')) headers.delete(name);
    }

    headers.set('x-origin-auth', config.originAuth);
    headers.set('x-mc-edge-secret', config.secret);
    headers.set('x-mc-client-ip', request.headers.get('cf-connecting-ip') || '');
    if (request.cf?.country) headers.set('x-mc-client-country', String(request.cf.country));

    try {
      return await fetch(target, {
        method: request.method,
        headers,
        body: request.method === 'POST' ? request.body : undefined,
        redirect: 'manual',
      });
    } catch (err) {
      console.error('[oauth-proxy] VPS unreachable:', err?.message || 'unknown error');
      return jsonError(502, 'Sign-in is temporarily unavailable.');
    }
  },
};
```

---

## Appendix D – SQL

### D1. Constraint fix (`00_allow_pending_status.sql`): run on test ✅ and prod ✅

```sql
-- sql/00_allow_pending_status.sql
-- Adds 'pending_verification' to the allowed account_status values.
-- Already applied on TEST. Run on PRODUCTION before 04.

begin;

alter table public.profiles
  drop constraint profiles_account_status_check;

alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status = any (array['active', 'action_required', 'pending_verification']));

commit;
```

### D2. The original Google-only trigger (`02_oauth_pending_trigger.sql`)

**Superseded by `04`** (see `server-verified-accounts-12oct26.md`), which drops this trigger and builds the pending status into `handle_new_user()`. Kept here because the rollback file restores it.

```sql
-- sql/02_oauth_pending_trigger.sql
--
-- New accounts created through Google (or any non-email provider) start as
-- account_status = 'pending_verification'. POST /api/oauth/complete on the VPS
-- switches them to 'active' after checking Turnstile (via the intent cookie),
-- consent, and recording IP + device. Scan routes refuse non-active accounts,
-- so skipping the web app's flow gives an account that can't scan.
--
-- Runs after on_auth_user_created (which inserts the profiles row): Postgres
-- fires triggers for the same event in name order, and
-- "on_auth_user_created" sorts before "on_auth_user_created_oauth_pending".
--
-- Email/password sign-ups (provider 'email') are untouched.
-- Not wrapped in an exception handler on purpose: if the update fails, the
-- sign-up fails loudly instead of silently creating an unverified, active account.

create or replace function public.mark_oauth_signup_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email' then
    update public.profiles
       set account_status = 'pending_verification'
     where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.mark_oauth_signup_pending() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_oauth_pending on auth.users;

create trigger on_auth_user_created_oauth_pending
  after insert on auth.users
  for each row execute function public.mark_oauth_signup_pending();
```

### D3. Trigger order check

```sql
select tgname from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal
order by tgname;
```
Expected after `04`: only `on_auth_user_created`.

---

## Appendix E – VPS files (final)

Same files in both VPS folders. Copy from test to prod:

```bash
cd /var/www/mediacrater-api
mkdir -p routes/api/oauth
cp ../mediacrater-api-test/routes/api/oauth/{index,start,complete}.js routes/api/oauth/
cp ../mediacrater-api-test/routes/_shared/{oauthIntent,authGuards,accountDevice,cookies}.js routes/_shared/
```

### `routes/api/oauth/index.js`

```js
// routes/api/oauth/index.js
//
// Express router for Google sign-in/sign-up. Mounted in server.js at
// /api/oauth. Only reachable on the main domain through the Cloudflare
// Worker (cloudflare/oauth-proxy-worker.js), which keeps cookies first-party.

'use strict';

const express = require('express');
const { createStartHandler } = require('./start');
const { createCompleteHandler } = require('./complete');
const { isIntentSecretConfigured } = require('../../_shared/oauthIntent');

function createOAuthRouter({
  supabase,
  authenticateUser,
  getClientIp,
  getClientCountry,
  logSafe,
  requestLimit,
}) {
  if (!isIntentSecretConfigured()) {
    console.error('[OAUTH] OAUTH_INTENT_SECRET is missing or too short. Google sign-in will fail.');
  }
  if (!process.env.TURNSTILE_SECRET_KEY) {
    console.error('[OAUTH] TURNSTILE_SECRET_KEY is not set. Google sign-in will fail.');
  }
  if (!process.env.EDGE_PROXY_SECRET) {
    console.error('[OAUTH] EDGE_PROXY_SECRET is not set. Real client IPs cannot be read behind the Worker.');
  }

  const router = express.Router();

  router.post('/start', createStartHandler({ supabase, getClientIp, logSafe }));

  router.post(
    '/complete',
    authenticateUser,
    requestLimit({ maxRequests: 10, windowMs: 60_000 }),
    createCompleteHandler({ supabase, getClientIp, getClientCountry, logSafe })
  );

  return router;
}

module.exports = { createOAuthRouter };
```

### `routes/api/oauth/start.js`

```js
// routes/api/oauth/start.js
//
// POST /api/oauth/start  (reached through the Cloudflare Worker on the main
// domain, so cookies are first-party)
//
// Runs BEFORE the browser is sent to Google:
//   1. Validates mode ("signup" | "signin") and, for sign-up, consent.
//   2. Per-IP rate limit, shared with the email routes on Vercel
//      (signup: 10 per 24h, signin: 8 per 2 min).
//   3. Verifies the Turnstile token server-side (Supabase doesn't apply
//      captcha to Google sign-in).
//   4. Makes sure mc_device_id exists, and sets the signed intent cookie
//      that /api/oauth/complete requires for new accounts.
//
// Body: { mode, acceptedTerms, turnstileToken }

'use strict';

const { checkAndLogRateLimit, verifyTurnstileToken } = require('../../_shared/authGuards');
const { readOrMintDeviceId, setDeviceCookie } = require('../../_shared/accountDevice');
const { issueIntent } = require('../../_shared/oauthIntent');

const LIMITS = {
  signup: { action: 'signup', maxAttempts: 10, windowSeconds: 24 * 60 * 60 },
  signin: { action: 'signin', maxAttempts: 8, windowSeconds: 120 },
};

function createStartHandler({ supabase, getClientIp, logSafe }) {
  return async function handleOAuthStart(req, res) {
    try {
      const { mode, acceptedTerms, turnstileToken } = req.body ?? {};

      const limit = LIMITS[mode];
      if (!limit) {
        return res.status(400).json({ error: 'Invalid request.' });
      }

      if (mode === 'signup' && acceptedTerms !== true) {
        return res.status(400).json({
          error: 'Please confirm you are 18+ and accept the Terms, Refund Policy, and Privacy Policy to continue.',
        });
      }

      if (typeof turnstileToken !== 'string' || !turnstileToken) {
        return res.status(400).json({ error: 'Please complete the verification check.' });
      }

      const ip = getClientIp(req);

      // Rate limit before siteverify, so bots can't burn Turnstile calls.
      const rateLimit = await checkAndLogRateLimit(
        supabase,
        limit.action,
        ip || 'unknown',
        limit.maxAttempts,
        limit.windowSeconds
      );

      if (rateLimit.error) {
        return res.status(500).json({ error: 'Something went wrong. Please try again.' });
      }

      if (!rateLimit.allowed) {
        res.set('Retry-After', String(rateLimit.retryAfterSeconds));
        return res.status(429).json({
          error: mode === 'signup'
            ? 'Too many signup attempts. Please try again later.'
            : 'Too many sign-in attempts. Please try again shortly.',
        });
      }

      const turnstileOk = await verifyTurnstileToken(turnstileToken, ip);
      if (!turnstileOk) {
        return res.status(400).json({ error: 'Verification failed. Please try again.' });
      }

      const { deviceId, minted } = readOrMintDeviceId(req);
      if (minted) setDeviceCookie(res, deviceId);

      issueIntent(res, { mode, consent: mode === 'signup' });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[OAUTH START] failed:', logSafe(err?.message || err));
      return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
}

module.exports = { createStartHandler };
```

### `routes/api/oauth/complete.js`

```js
// routes/api/oauth/complete.js
//
// POST /api/oauth/complete  (after Google, called by the web app's
// /auth/callback page with the new Supabase access token)
//
// - New Google accounts arrive as account_status = 'pending_verification'
//   (set by the on_auth_user_created_oauth_pending trigger). They are only
//   activated here, and only with a valid intent cookie from /start (which
//   proves Turnstile + rate limit passed) and recorded consent. Scan routes
//   already refuse anything that isn't 'active'.
// - Existing accounts (any other status) are never changed here; the
//   sign-in is just recorded in account_devices. Their intent is optional,
//   so someone who took more than 10 minutes at Google isn't locked out.
//
// Body: { acceptedTerms?, timezone, browser, browser_version, os, device_fp }
//
// Responses:
//   200 { ok: true, newUser }
//   409 { code: 'CONSENT_REQUIRED' }  new account, no consent yet
//   403 { code: 'INTENT_REQUIRED' }   new account without a valid /start

'use strict';

const {
  readOrMintDeviceId,
  setDeviceCookie,
  mergeDeviceFields,
  lookupIpIntel,
  recordAccountDevice,
} = require('../../_shared/accountDevice');
const { readIntent, consumeIntent } = require('../../_shared/oauthIntent');

const PENDING_STATUS = 'pending_verification';
const CONSENT_COLUMN = 'accept_tos_privacy_refund_emailconsent_age18plus';

function createCompleteHandler({ supabase, getClientIp, getClientCountry, logSafe }) {
  return async function handleOAuthComplete(req, res) {
    const user = req.user;

    try {
      const body = req.body ?? {};
      const intent = readIntent(req);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select(`id, account_status, browser_id, ip_at_creation, ${CONSENT_COLUMN}`)
        .eq('id', user.id)
        .single();

      if (profileError || !profile) {
        console.error('[OAUTH COMPLETE] profile missing for user:', user.id);
        return res.status(500).json({ error: 'Your account could not be loaded. Please try again.' });
      }

      const isPending = profile.account_status === PENDING_STATUS;

      if (isPending) {
        if (!intent) {
          return res.status(403).json({
            code: 'INTENT_REQUIRED',
            error: 'Your sign-up session expired. Please start again from the sign-up page.',
          });
        }

        const hasConsent =
          Boolean(profile[CONSENT_COLUMN]) || intent.consent || body.acceptedTerms === true;

        if (!hasConsent) {
          // Intent is NOT consumed: the user accepts on the callback page and retries.
          return res.status(409).json({
            code: 'CONSENT_REQUIRED',
            error: 'Please accept the terms to finish creating your account.',
          });
        }
      }

      const ip = getClientIp(req) || null;
      const { deviceId, minted } = readOrMintDeviceId(req);
      if (minted) setDeviceCookie(res, deviceId);

      const clientFields = mergeDeviceFields(req, body);
      const intel = await lookupIpIntel(ip, getClientCountry(req));

      const recorded = await recordAccountDevice(supabase, {
        userId: user.id,
        event: isPending ? 'signup' : 'login',
        deviceId,
        ip,
        client: clientFields,
        intel,
      });

      if (isPending) {
        // Status and consent together. Guarded on the pending status, so this
        // can never re-activate a flagged or locked account.
        const activation = {
          account_status: 'active',
        };
        if (!profile[CONSENT_COLUMN]) {
          activation[CONSENT_COLUMN] = new Date().toISOString();
        }

        const { error: activateError } = await supabase
          .from('profiles')
          .update(activation)
          .eq('id', user.id)
          .eq('account_status', PENDING_STATUS);

        if (activateError) {
          console.error('[OAUTH COMPLETE] activation failed:', activateError.message);
          return res.status(500).json({ error: 'Your account could not be activated. Please try again.' });
        }

        // Same fields /api/signup writes at creation. Only filled if still empty.
        if (!profile.browser_id) {
          await supabase.from('profiles').update({ browser_id: deviceId })
            .eq('id', user.id).is('browser_id', null);
        }
        if (!profile.ip_at_creation && ip) {
          await supabase.from('profiles').update({ ip_at_creation: ip })
            .eq('id', user.id).is('ip_at_creation', null);
        }
      }

      consumeIntent(res, intent);

      return res.json({ ok: true, newUser: isPending, deviceRecorded: recorded.ok });
    } catch (err) {
      console.error('[OAUTH COMPLETE] failed:', logSafe(err?.message || err));
      return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
}

module.exports = { createCompleteHandler };
```

### `routes/_shared/oauthIntent.js`

```js
// routes/_shared/oauthIntent.js
//
// The "intent" cookie links POST /api/oauth/start (Turnstile + rate limit
// passed) to POST /api/oauth/complete (after Google). Without it, someone
// could skip Turnstile by opening Supabase's Google sign-in URL directly.
//
// Format: <base64url(JSON)>.<base64url(HMAC-SHA256)>, signed with
// OAUTH_INTENT_SECRET. HttpOnly, Secure, SameSite=Lax, Path=/api/oauth,
// 10-minute lifetime. Single use: a completed intent's nonce is remembered
// in memory until it would have expired anyway.
//
// The used-nonce memory is per process. If you ever run the API as several
// processes (PM2 cluster, multiple servers), move it to a shared store.

'use strict';

const crypto = require('crypto');
const { parseCookies } = require('./cookies');

const INTENT_COOKIE = 'mc_oauth_intent';
const INTENT_PATH = '/api/oauth';
const INTENT_TTL_SECONDS = 600;
const MIN_SECRET_LENGTH = 32;

const usedNonces = new Map(); // nonce -> expiry (ms)

function getSecret() {
  const secret = process.env.OAUTH_INTENT_SECRET || '';
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error('OAUTH_INTENT_SECRET is missing or shorter than 32 characters');
  }
  return secret;
}

function isIntentSecretConfigured() {
  return (process.env.OAUTH_INTENT_SECRET || '').length >= MIN_SECRET_LENGTH;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function pruneUsedNonces() {
  const now = Date.now();
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt <= now) usedNonces.delete(nonce);
  }
}

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: INTENT_PATH,
};

function issueIntent(res, { mode, consent }) {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      n: crypto.randomBytes(16).toString('hex'),
      m: mode,
      c: consent === true,
      iat: Math.floor(Date.now() / 1000),
    })
  ).toString('base64url');

  res.cookie(INTENT_COOKIE, `${payload}.${sign(payload)}`, {
    ...cookieOptions,
    maxAge: INTENT_TTL_SECONDS * 1000,
  });
}

/** Returns { nonce, mode, consent } for a valid, unexpired, unused intent, else null. */
function readIntent(req) {
  const raw = parseCookies(req)[INTENT_COOKIE];
  if (typeof raw !== 'string' || raw.length > 1024) return null;

  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [payload, mac] = parts;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (
    !data ||
    data.v !== 1 ||
    typeof data.n !== 'string' ||
    !/^[0-9a-f]{32}$/.test(data.n) ||
    (data.m !== 'signup' && data.m !== 'signin') ||
    !Number.isInteger(data.iat)
  ) {
    return null;
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - data.iat;
  if (ageSeconds < 0 || ageSeconds > INTENT_TTL_SECONDS) return null;

  pruneUsedNonces();
  if (usedNonces.has(data.n)) return null;

  return { nonce: data.n, mode: data.m, consent: data.c === true };
}

/** Marks the intent used (if any) and deletes the cookie. */
function consumeIntent(res, intent) {
  if (intent) {
    usedNonces.set(intent.nonce, Date.now() + INTENT_TTL_SECONDS * 1000);
  }
  res.clearCookie(INTENT_COOKIE, cookieOptions);
}

module.exports = { issueIntent, readIntent, consumeIntent, isIntentSecretConfigured };
```

### `routes/_shared/authGuards.js`

```js
// routes/_shared/authGuards.js
//
// VPS ports of the web app's lib/rate-limit.ts helpers, so sign-in/sign-up
// routes on the VPS behave the same as the Vercel ones:
// - checkAndLogRateLimit(): same check_and_log_rate_limit RPC and the same
//   action names ("signup", "signin"), so limits are SHARED between the
//   email routes on Vercel and the Google routes here.
// - verifyTurnstileToken(): Cloudflare siteverify with TURNSTILE_SECRET_KEY.
// Both fail closed: any error means "not allowed".
//
// v2: siteverify error codes are logged on HTTP 400 too (they were dropped,
// which hid the actual reason, e.g. "invalid-input-secret").

'use strict';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 5000;

async function checkAndLogRateLimit(supabase, action, ip, maxAttempts, windowSeconds) {
  try {
    const { data, error } = await supabase
      .rpc('check_and_log_rate_limit', {
        p_action: action,
        p_ip: ip,
        p_user_id: null,
        p_max_attempts: maxAttempts,
        p_window_seconds: windowSeconds,
      })
      .single();

    if (error) {
      console.error(`[RATE LIMIT] RPC error for action "${action}":`, error.message);
      return { allowed: false, retryAfterSeconds: windowSeconds, error: error.message };
    }

    if (
      !data ||
      typeof data.allowed !== 'boolean' ||
      !Number.isInteger(data.retry_after_seconds) ||
      data.retry_after_seconds < 0 ||
      (!data.allowed && data.retry_after_seconds < 1)
    ) {
      console.error(`[RATE LIMIT] Invalid RPC response for action "${action}".`);
      return { allowed: false, retryAfterSeconds: windowSeconds, error: 'Invalid rate limit response.' };
    }

    return { allowed: data.allowed, retryAfterSeconds: data.retry_after_seconds };
  } catch (err) {
    console.error(`[RATE LIMIT] Request failed for action "${action}":`, err?.message || err);
    return { allowed: false, retryAfterSeconds: windowSeconds, error: 'Rate limit request failed.' };
  }
}

async function verifyTurnstileToken(token, ip) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.error('[TURNSTILE] TURNSTILE_SECRET_KEY is not set.');
    return false;
  }

  try {
    const params = new URLSearchParams();
    params.append('secret', secretKey);
    params.append('response', token);
    if (ip) params.append('remoteip', ip);

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });

    // Cloudflare includes error codes in the body even on HTTP 400, so read
    // them either way. Only the codes are logged, never the token or secret.
    const result = await res.json().catch(() => null);
    const errorCodes = JSON.stringify(result?.['error-codes'] || []);

    if (!res.ok) {
      console.error(`[TURNSTILE] siteverify HTTP ${res.status}:`, errorCodes);
      return false;
    }

    if (result?.success !== true) {
      console.warn('[TURNSTILE] verification failed:', errorCodes);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[TURNSTILE] siteverify request failed:', err?.name || 'error');
    return false;
  }
}

module.exports = { checkAndLogRateLimit, verifyTurnstileToken };
```

### `routes/_shared/accountDevice.js`

```js
// routes/_shared/accountDevice.js
//
// VPS port of the web app's lib/account-device.ts. Same cookie (mc_device_id),
// same account_devices columns and same profiles last_* snapshot, so a device
// recorded here is indistinguishable from one recorded by /api/signup.
//
// Differences from the Vercel version:
// - Country comes from the trusted x-mc-client-country header that the
//   Cloudflare Worker adds (passed in as countryHint), not Vercel headers.
// - Uses Node's global fetch (Node 18+).

'use strict';

const crypto = require('crypto');
const { parseCookies } = require('./cookies');

const DEVICE_COOKIE = 'mc_device_id';
const DEVICE_COOKIE_MAX_AGE_MS = 60 * 60 * 24 * 400 * 1000; // ~400d, Chrome's cap
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const HOSTING_ORG_RE =
  /\b(amazon|aws|google cloud|gcp|microsoft azure|azure|digitalocean|linode|akamai|ovh|hetzner|vultr|datacamp|m247|choopa|leaseweb|hivelocity|contabo|oracle cloud|alibaba)\b/i;

const VPN_ORG_RE =
  /\b(nordvpn|nord vpn|expressvpn|mullvad|surfshark|protonvpn|proton vpn|cyberghost|private internet access|\bpia\b|windscribe|ipvanish|tunnelbear|purevpn|ivpn|m247|datacamp|packethub|vpn)\b/i;

function asText(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length ? t : null;
}

function readOrMintDeviceId(req) {
  const existing = parseCookies(req)[DEVICE_COOKIE];
  if (existing && UUID_RE.test(existing)) {
    return { deviceId: existing, minted: false };
  }
  return { deviceId: crypto.randomUUID(), minted: true };
}

// Same attributes as attachDeviceCookie() on Vercel (host-only, Path=/), so
// it's the same cookie the site's middleware reads and writes.
function setDeviceCookie(res, deviceId) {
  res.cookie(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
  });
}

function parseUserAgent(ua) {
  if (!ua) return { browser: null, browser_version: null, os: null };

  let os = null;
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/CrOS/i.test(ua)) os = 'Chrome OS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  const rules = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  for (const [re, name] of rules) {
    const m = ua.match(re);
    if (m) return { browser: name, browser_version: m[1] ?? null, os };
  }
  return { browser: null, browser_version: null, os };
}

function parseSecChUa(header) {
  if (!header) return { browser: null, browser_version: null };
  const parts = [...String(header).matchAll(/"([^"]+)";v="([^"]+)"/g)].map((m) => ({
    brand: m[1],
    version: m[2],
  }));
  const real = parts.filter((p) => !/not.?a.?brand/i.test(p.brand));
  const pick =
    real.find((p) => /google chrome/i.test(p.brand)) ||
    real.find((p) => /microsoft edge/i.test(p.brand)) ||
    real.find((p) => /firefox|safari|opera|brave/i.test(p.brand)) ||
    real.find((p) => /chromium/i.test(p.brand)) ||
    real[0];
  return pick
    ? { browser: pick.brand, browser_version: pick.version }
    : { browser: null, browser_version: null };
}

function mergeDeviceFields(req, client) {
  const c = client && typeof client === 'object' ? client : {};
  const cap = (v, n) => asText(v)?.slice(0, n) ?? null;
  const uaParsed = parseUserAgent(asText(req.headers['user-agent'])?.slice(0, 512) ?? null);
  const ch = parseSecChUa(asText(req.headers['sec-ch-ua'])?.slice(0, 512) ?? null);
  const chOs = asText(req.headers['sec-ch-ua-platform'])?.replace(/"/g, '').slice(0, 32) ?? null;

  return {
    timezone: cap(c.timezone, 64),
    browser: uaParsed.browser || ch.browser || cap(c.browser, 64),
    browser_version: uaParsed.browser_version || ch.browser_version || cap(c.browser_version, 32),
    os: chOs || uaParsed.os || cap(c.os, 32),
    device_fp: cap(c.device_fp, 128),
  };
}

function parseAsnOrg(org) {
  if (!org) return { asn: null, asn_org: null };
  const m = org.match(/^AS(\d+)\s+(.*)$/i);
  if (m) return { asn: Number(m[1]), asn_org: m[2].trim() };
  return { asn: null, asn_org: org };
}

function inferFlags(asnOrg, privacy) {
  const is_vpn =
    privacy?.vpn || privacy?.proxy || privacy?.tor
      ? true
      : asnOrg
        ? VPN_ORG_RE.test(asnOrg)
        : null;
  const is_hosting = privacy?.hosting ? true : asnOrg ? HOSTING_ORG_RE.test(asnOrg) : null;
  return { is_vpn, is_hosting };
}

async function lookupIpIntel(ip, countryHint) {
  const hint = asText(countryHint);
  const country = hint && /^[A-Z]{2}$/.test(hint) && hint !== 'XX' && hint !== 'T1' ? hint : null;
  const empty = { asn: null, asn_org: null, country, city: null, is_vpn: null, is_hosting: null };
  if (!ip) return empty;

  const token = process.env.IPINFO_TOKEN;
  const url = token
    ? `https://ipinfo.io/${encodeURIComponent(ip)}?token=${encodeURIComponent(token)}`
    : `https://ipinfo.io/${encodeURIComponent(ip)}/json`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(1500),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return empty;
    const json = await res.json();

    let asn = null;
    let asn_org = null;
    if (json.asn?.asn) {
      asn = Number(String(json.asn.asn).replace(/^AS/i, '')) || null;
      asn_org = json.asn.name ?? null;
    } else {
      const parsed = parseAsnOrg(json.org ?? null);
      asn = parsed.asn;
      asn_org = parsed.asn_org;
    }

    const flags = inferFlags(
      asn_org,
      json.privacy ?? (json.asn?.type === 'hosting' ? { hosting: true } : undefined)
    );

    return {
      asn,
      asn_org,
      country: json.country || country,
      city: json.city || null,
      is_vpn: flags.is_vpn,
      is_hosting: flags.is_hosting,
    };
  } catch (err) {
    // Never log the URL: it contains the IPinfo token.
    console.error('[DEVICE] IP intel lookup failed:', err?.name || 'error');
    return empty;
  }
}

async function recordAccountDevice(supabase, { userId, event, deviceId, ip, client, intel }) {
  const fields = client || {};

  const { error } = await supabase.from('account_devices').insert({
    user_id: userId,
    event,
    device_id: deviceId,
    device_fp: fields.device_fp ?? null,
    timezone: fields.timezone ?? null,
    browser: fields.browser ?? null,
    browser_version: fields.browser_version ?? null,
    os: fields.os ?? null,
    ip,
    asn: intel.asn,
    asn_org: intel.asn_org,
    country: intel.country,
    city: intel.city,
    is_vpn: intel.is_vpn,
    is_hosting: intel.is_hosting,
  });

  if (error) {
    console.error('[DEVICE] account_devices insert failed:', error.message);
    return { ok: false, error: error.message };
  }

  const { error: snapshotError } = await supabase
    .from('profiles')
    .update({
      last_device_id: deviceId,
      last_ip: ip,
      last_seen_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (snapshotError) {
    // last_* columns are optional; don't fail the device row over them
    console.error('[DEVICE] profiles last_* snapshot failed:', snapshotError.message);
  }

  return { ok: true, error: null };
}

module.exports = {
  DEVICE_COOKIE,
  readOrMintDeviceId,
  setDeviceCookie,
  mergeDeviceFields,
  lookupIpIntel,
  recordAccountDevice,
};
```

### `routes/_shared/cookies.js`

```js
// routes/_shared/cookies.js
//
// Minimal Cookie header parser (no cookie-parser dependency). Ignores
// malformed pairs and caps sizes so a huge header can't cost much.

'use strict';

const MAX_COOKIE_HEADER = 8192;

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = Object.create(null);
  if (typeof header !== 'string' || header.length > MAX_COOKIE_HEADER) return out;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (!name || name in out) continue;
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      // Malformed encoding: skip this cookie.
    }
  }
  return out;
}

module.exports = { parseCookies };
```

---

## Appendix F – Web app files

| File | What it does | Status |
|---|---|---|
| `components/google-auth-button.tsx` | Calls `/api/oauth/start`, resets Turnstile, then `signInWithOAuth('google', { redirectTo: <origin>/auth/callback, prompt: select_account })`. Logo from `public/images/google-g.svg` (official mark, hidden if missing) | ✅ Live (**pre-switch** version) |
| `components/google-auth-button.tsx` (switch version) | Same, plus it only renders when `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true'` or `?google_test=1`; the "or" divider moved inside | ⏳ Not deployed |
| `app/auth/callback/page.tsx` | Session → clear URL → collect device → `/complete`; stages `working` / `consent` / `error` / `restart` | ✅ Live |
| `app/signup/page.tsx` | Button under the form, shares consent + Turnstile | ✅ Live |
| `app/signin/page.tsx` | Button under the form, shares Turnstile | ✅ Live |
| `public/images/google-g.svg` | Official Google "G" (from Google's branding guidelines) | ⚠️ Assumed present |

The callback page's JSON body to `/complete`: `{ acceptedTerms, timezone, browser, browser_version, os, device_fp }` (from `collectDeviceClient()`), with header `Authorization: Bearer <access_token>`.

---

## Appendix G – Verification and troubleshooting commands

**Route reachable, three layers:**
```bash
# 1. Node directly (test 3001 / prod 3000)
curl -s -i -X POST http://127.0.0.1:3001/api/oauth/start -H 'Content-Type: application/json' -d '{}'
# 2. Through Cloudflare + nginx (API host)
curl -s -i -X POST https://test.mediacrater.com/api/oauth/start -H 'Content-Type: application/json' -d '{}'
# 3. Through the Worker (site domain)
curl -s -X POST https://mediacrater.com/api/oauth/start -H 'Content-Type: application/json' -d '{}'; echo
```
Expected for all three: `400` / `{"error":"Invalid request."}`.

**nginx:**
```bash
sudo grep "/api/oauth" /var/log/nginx/access.log | tail -n 10      # 444 = origin-auth / server_name rejection
sudo tail -n 30 /var/log/nginx/error.log
sudo nginx -T 2>/dev/null | grep -nE "server_name|listen|return 444|location|proxy_pass|default_server"
sudo nginx -T 2>/dev/null | sed -n '325,410p'                      # redact secrets before sharing
sudo grep x_origin_auth /etc/nginx/snippets/cloudflare-origin-auth.conf
```

**App logs:**
```bash
pm2 logs mediacrater-api-test --lines 40 --nostream | grep -E "TURNSTILE|OAUTH|RATE LIMIT"
pm2 logs mediacrater-api --lines 30 --nostream | grep -E "OAUTH|Error|running on port"
pm2 list
```

**Turnstile secret check** (doesn't print the secret):
```bash
curl -s -X POST https://challenges.cloudflare.com/turnstile/v0/siteverify \
  --data-urlencode "secret=$(grep '^TURNSTILE_SECRET_KEY=' .env | cut -d= -f2-)" \
  --data-urlencode "response=test"; echo
```
| Output | Meaning |
|---|---|
| `invalid-input-response` | Secret OK ✅ |
| `invalid-input-secret` | Wrong key (test VPS had this) |
| `missing-input-secret` | Not in `.env` (prod had this) |

**Status code guide (Google button → `/api/oauth/start`):**
| Response | Source | Meaning |
|---|---|---|
| 404 (Vercel page) | Vercel | Worker route not matching, or DNS not proxied |
| 500 / Subrequests 0 | Worker | Crash (v1); v2+ returns 503 instead |
| 503 `Sign-in is temporarily unavailable.` | Worker | A Worker variable is missing; see Observability → Logs `[oauth-proxy] misconfigured:` |
| 502 | Worker | VPS unreachable |
| 520 | Cloudflare | nginx closed the connection (444): Host or `X-Origin-Auth` |
| 400 / 429 / 500 JSON | VPS | Route answered (validation, rate limit, Turnstile) |

**Google errors:**
| Error | Fix |
|---|---|
| "Access blocked: This app's request is invalid" (`redirect_uri_mismatch`) | Add the project's `https://<project-ref>.supabase.co/auth/v1/callback` to the OAuth client |
| "Database error saving new user" | Postgres logs (Logs → Postgres, search `ERROR`) |

**Google signups before `04` (prod):**
```sql
select u.id, u.email, u.created_at, p.account_status,
       p.accept_tos_privacy_refund_emailconsent_age18plus as consent
from auth.users u
join public.profiles p on p.id = u.id
where u.raw_app_meta_data->>'provider' = 'google'
  and u.created_at > now() - interval '2 days'
order by u.created_at desc;
```
Expected: only your own accounts.

**Device rows look right:**
```sql
select event, ip, country, created_at from public.account_devices
order by created_at desc limit 10;
```
Expected: your real IP (not `2a06:98c0:…`), events `signup` / `login`.

---

## Appendix H – Rollback and kill switch

| Action | How | Effect |
|---|---|---|
| **Stop Google sign-in now** | Supabase → Authentication → Sign In / Providers → Google → off | Instant. Email login unaffected. Button stays visible and shows an error |
| Hide the button | Deploy the switch version with `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false`, then redeploy | Needs the switch version first |
| Remove the VPS routes | `cp server.js.bak-google server.js && pm2 restart mediacrater-api` | `/api/oauth/*` gone |
| Remove the Worker route | Worker → Domains & Routes → delete `…/api/oauth/*` | Requests go to Vercel (404) |
| Revert the pending model | `ROLLBACK_server_verified_accounts.sql` (see `server-verified-accounts-12oct26.md`) | Restores the old function + `02` trigger |

---

## Appendix I – Questions answered along the way

**Existing email/password users with a Gmail address:** Supabase links Google to the same account automatically when the existing email is **confirmed** (verified on test and live). For unconfirmed accounts, Supabase doesn't link; untested. A "Connect Google account" setting (`linkIdentity`, Manual linking on) is only needed when the Google email differs from the login email.

**Does `profiles` still get the email?** Yes: `handle_new_user()` copies `new.email`, and Google always provides a verified email.

**First-name column?** Only if you'll use it (data minimisation). It's already in `auth.users.raw_user_meta_data` (`given_name`, `full_name`, `avatar_url`), and would be empty for email signups.

**Account chooser showing `supabase.co`:** fixed by brand verification. Alternatives, if it ever returns: a Supabase custom domain (`auth.mediacrater.com`, paid add-on), or Google Identity Services + `signInWithIdToken`.

**Costs:** Google sign-in free, no user cap with basic scopes. Supabase MAU (Free 50k; Pro $25/mo with 100k included, then $0.00325/MAU; Free projects pause after 7 days of inactivity). Cloudflare Workers Free: 100k requests/day across all Workers, about 2 per Google sign-in. Turnstile, Vercel and the VPS are unchanged.

**Privacy policy section added for Google** (as given):
> Google shares your email address, name and profile picture, and a Google account identifier, only after you approve it. Basic sign-in permissions only (openid, email, profile). Used only to create your account and sign you in; never sold, never used for advertising, never sent to AI model providers or used to train AI. Shared only with Supabase. Adheres to the Google API Services User Data Policy, including Limited Use. Revoke access in your Google Account → Security → Your connections to third-party apps & services.

**Note to the review team (used on resubmission):** Mediacrater analyzes advertisers' own ad creatives for advertising-policy compliance. It doesn't generate, edit or synthesize images or video of people. Google APIs are used only for "Sign in with Google" with basic scopes; no Google user data is sent to AI providers.

---

*End of index.  
Conversation: `<add this conversation's URL>`*
