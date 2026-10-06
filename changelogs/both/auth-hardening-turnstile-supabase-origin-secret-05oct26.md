# Auth Hardening & Free-Tier Abuse Controls: Turnstile + Supabase CAPTCHA, Origin-Secret Middleware, IP-Source Fixes & Shared-Quota Design

| | |
|---|---|
| **Date** | 5 October 2026 (`05oct26`) |
| **Conversations** | **Claude (abuse investigation, reviews, fixes):** https://claude.ai/chat/344c1200-b593-4d05-bab9-cd0f70039e9c<br>**Grok (route implementation session):** https://grok.com/c/5ce1a967-c6ed-4894-bed4-17a43b35823e?rid=95a9ca06-b240-4f43-89d0-86b7b7e3f600 |
| **Related prior work** | `vps-hardening-cloudflare-lockdown-ssrf-fix-02oct26.md` (2 Oct 2026) |
| **Stack** | Next.js on Vercel (proxied through Cloudflare), Supabase Auth + Postgres, Cloudflare Turnstile, Cloudflare Transform Rules, Node API on the VPS (`rateLimiter.js`, `abuseDetection.js`) |
| **Starting trigger** | Free-tier abuse: the timed IP-lock sweep sometimes failed to lock a third account. Investigating it exposed a public Supabase signup endpoint that skipped every protection in the signup route. Fixing that led to CAPTCHA enforcement, the origin-secret middleware, and IP-source cleanup |

> **Redaction note:** No secrets, API keys, full hostnames, user emails or personal data are included. `YOUR_PROJECT`, `your-real-domain.com` and similar placeholders stand in for them.

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
9. [Appendix A – Final middleware.ts](#appendix-a--final-middlewarets)
10. [Appendix B – Final auth route patterns](#appendix-b--final-auth-route-patterns)
11. [Appendix C – IP-source and device-field fixes](#appendix-c--ip-source-and-device-field-fixes)
12. [Appendix D – Third-account bug: diagnosis and stopgap](#appendix-d--third-account-bug-diagnosis-and-stopgap)
13. [Appendix E – Shared-pool SQL](#appendix-e--shared-pool-sql)
14. [Appendix F – rateLimiter.js pool integration](#appendix-f--ratelimiterjs-pool-integration)
15. [Appendix G – Checks and verification commands](#appendix-g--checks-and-verification-commands)

---

## 1. Summary

The session started as a free-tier abuse problem and turned into an auth hardening project.

**Abuse side (designed, not deployed yet)**

- Found why the third account escapes the IP lock: `detect_duplicate_free_ips()` only counts `active` accounts. Once two accounts are locked, a new account at the same IP counts as 1 and never reaches the `>= 2` threshold. A stopgap SQL patch is in [Appendix D](#appendix-d--third-account-bug-diagnosis-and-stopgap).
- Designed a **shared free-tier quota pool** built on strong signals (`device_id`, `device_fp`) from `account_devices`, with remaining quota computed from the `scans` table. It runs in **shadow mode** first.
- Reviewed another LLM's shared-quota plan. The structure was right, but its pool key, decrement logic and timing would not have worked as written.
- Gave a position on a $1 paywall (use a $0 card setup instead, later) and on partial-IP matching (`/24` is a weak signal, alert-only).

**Auth side (implemented)**

- Confirmed a **real bypass**: a direct call to Supabase's public `/auth/v1/signup` created an account with no Turnstile check, no rate limit and no `account_devices` row.
- Enabled **Supabase CAPTCHA (Turnstile)** and changed all four auth routes to pass `captchaToken` to Supabase instead of verifying the token themselves (tokens are single-use). Resend and reset moved from the service-role client to the anon client.
- Added **origin-secret middleware** so direct `*.vercel.app` API calls get a 403. Uses `x-mediacrater-proxy-secret` / `CLOUDFLARE_PROXY_SECRET`.
- Fixed the **IP source**: both `clientIpFrom` functions now read only `cf-connecting-ip`. Before, the auth rate limits likely keyed on Cloudflare edge IPs (to confirm with a query).
- Handled two incidents: a JSON parse error from a plain-text 403, and a later `/api/*` 403 outage after the middleware swap.
- Hardened device fields (`mergeDeviceFields`, `vercelGeo`, `HOSTING_ORG_RE`).

This work sits on top of the VPS hardening completed on 2 October 2026.

---

## 2. Status at a glance

### Auth hardening

| Area | Status | Notes |
|---|---|---|
| Supabase CAPTCHA provider = Turnstile | ✅ Done | Secret key from the Turnstile widget; the direct signup curl now fails |
| Public `/auth/v1/signup` bypass closed | ✅ Done | Confirmed open before (0 device rows), closed after CAPTCHA was enforced |
| Signup route passes `captchaToken` | ✅ Done | Also guards against the obfuscated already-registered user |
| Signin route passes `captchaToken` | ✅ Done | |
| Resend-verification route | ✅ Done | Anon client + `captchaToken` |
| Reset-password route | ✅ Done | Anon client + `captchaToken` |
| Self-verification removed from auth routes | ✅ Done | Tokens are single-use; only Supabase may consume them |
| Origin-secret middleware (`/api/*`) | ✅ Done | JSON 403 bodies observed, so a JSON version is deployed. Confirm it is the fail-closed one in [Appendix A](#appendix-a--final-middlewarets) |
| Cloudflare **Request** Header Transform Rule | ✅ Done | Real domain returns 400 on an empty POST (middleware passes) |
| Direct `*.vercel.app` blocked | ✅ Verified | POST to the `.vercel.app` URL returns 403 |
| `/api/*` 403 outage on the real domain | ✅ Resolved | Real domain now returns 400 on an empty POST. The exact cause was not captured (see [section 5](#5-errors-and-surprises)) |
| `CLOUDFLARE_PROXY_SECRET` set in **Production only** | ⚠️ Confirm | The earlier doc and the other LLM said "Production and Preview". That was wrong |
| `clientIpFrom` in `lib/rate-limit.ts` → `cf-connecting-ip` only | ⚠️ Confirm | One pasted file has it, the other does not. Check test and live |
| `clientIpFrom` in `lib/account-device.ts` → `cf-connecting-ip` only | ⚠️ Confirm | The 294-line file is correct, the 305-line file is old |
| Device-field patches (`mergeDeviceFields`, `vercelGeo`, `HOSTING_ORG_RE`) | ⚠️ Confirm | Advised, replacements in [Appendix C](#appendix-c--ip-source-and-device-field-fixes) |
| Bypass test user deleted | ⚠️ Confirm | Created by the curl test, delete it in Authentication → Users |
| Stripe webhook / Vercel cron callers | ⏳ Open | Anything skipping Cloudflare now gets 403 |
| Frontend resets the Turnstile widget after each attempt | ⚠️ Confirm | Required, because tokens are single-use |

### Free-tier abuse controls

| Area | Status | Notes |
|---|---|---|
| Root cause of the third-account bug | ✅ Identified | RPC counts only `active` accounts |
| RPC stopgap patch | ⏳ Open | Test as a plain `SELECT` first ([Appendix D](#appendix-d--third-account-bug-diagnosis-and-stopgap)) |
| `account_devices` RLS | ✅ Verified | RLS on with no policies: the browser can't read or write it |
| `profiles` / `scans` policies | ⏳ Open | Policy names were shared, but not their `roles`. A broad "service role…" policy would be dangerous |
| Shared pool SQL (`scan_pools`, `assign_pool`, `pool_remaining`) | ⏳ Not started | [Appendix E](#appendix-e--shared-pool-sql) |
| `rateLimiter.js` pool integration | ⏳ Not started | Deploy in shadow mode first ([Appendix F](#appendix-f--ratelimiterjs-pool-integration)) |
| Stop creating IP locks (keep the resolve sweep) | ⏳ After enforcement | |
| Weak-link detection as Slack alerts | ⏳ Later | `/24` and IP clusters alert only |
| $0 card setup (Stripe SetupIntent) | ⏳ Decision later | Only if abuse continues |

---

## 3. Starting point

### Abuse side

- Free plan: 3 scans per month. Accounts are locked when 2 or more free accounts share an IP at creation.
- `abuseDetection.js` runs a sweep every **5 minutes**, calling the `detect_duplicate_free_ips` RPC, locking accounts, and emailing them. A second sweep auto-unlocks accounts when no free peers remain.
- A new `account_devices` table (signup/login events, `device_id`, `device_fp`, IP, ASN, VPN/hosting flags) exists, written by the website's signup route.
- Symptom: the third account created after the first two were locked is not always locked.
- Idea on the table: one shared scan pool per cluster of accounts, so extra accounts add no scans.

### Auth side

- Supabase CAPTCHA protection had been turned on.
- The four auth routes still called `verifyTurnstileToken` themselves and then called Supabase **without** passing `captchaToken`.
- Because tokens are single-use, Supabase always rejected the (already consumed) token, so users were locked out of signup and signin.
- Direct calls to Supabase's public `/auth/v1/signup` endpoint still succeeded (bypass confirmed with curl).
- Middleware only handled the device-cookie logic and did not enforce the origin secret.
- An origin secret already existed under the names `x-mediacrater-proxy-secret` / `CLOUDFLARE_PROXY_SECRET`, but the middleware did not use them.
- The site is served on Vercel behind Cloudflare, and also reachable at `*.vercel.app`, which skips Cloudflare.

---

## 4. Timeline: what we did, in order

Phases 1 to 4 are the abuse investigation. Phases 5 to 16 are the auth hardening (phases 7 to 10 were carried out in the Grok session using the replacements from the Claude plan).

### Part A: Free-tier abuse investigation

#### Phase 1 – Why the third account escapes

- I first guessed the cause was the timed-job gap, late `ip_at_creation` capture, spoofable IPs and IPv6 rotation. After seeing `abuseDetection.js` and the RPC, that guess was **partly wrong**.
- **Real cause:** the RPC has `WHERE p.account_status = 'active'`.
  1. Accounts A and B share an IP. The RPC returns a count of 2, so both get locked.
  2. Account C signs up from the same IP. The RPC counts only active accounts, so the IP has 1, and `HAVING COUNT(*) >= 2` fails.
  3. `lockAndNotifyCluster` only runs for clusters the RPC returns, so C is never locked.
- Also corrected: the sweep runs every **5 minutes**, not 45. The comment in `server.js` is stale.
- **Stopgap fix:** a patched RPC that counts all matching accounts and flags a cluster when at least one is still active. Test it as a `SELECT` first ([Appendix D](#appendix-d--third-account-bug-diagnosis-and-stopgap)).

#### Phase 2 – Review of the other LLM's shared-quota plan

Verdict: right skeleton (pool table plus a `shared_pool_id` column), not usable as written.

| # | Problem | Why it matters |
|---|---|---|
| 1 | Pool key is one hash of IP + `device_id` + `device_fp` + ASN | Changing any one value gives a new hash and a fresh pool of 3, which is the exact bypass |
| 2 | Scan is consumed before it runs | Failed scans are charged, and the queue re-call after a `202` charges twice |
| 3 | Decrement is read-then-write | Two simultaneous requests both read 3 and both write 2. Needs one atomic SQL statement |
| 4 | Signals come from the current request | A different network means a different pool. Use signup-time `account_devices` rows |
| 5 | `shared_pool_id` is never read | The check recomputes the hash each time, so the column does nothing |
| 6 | Side effects | Every existing free user gets a fresh 3 scans, and anything reading `profiles.scans_remaining` goes stale |
| 7 | Gaps | RLS off on new tables by default, no IPv6 handling, keeping the lock sweep punishes shared-IP users twice, no concurrency or incognito tests |

**What I salvaged:** stable membership assigned at signup, a two-phase flow (read-only check, then deduct after success), and shadow mode before enforcement.

#### Phase 3 – Recommended design and answers to your three ideas

**Recommendation:** pool free-plan quota across accounts that share a **strong** signal, and use weak signals only to alert. Don't charge a card yet.

1. Pool membership comes from `device_id` and `device_fp` in **signup** events of `account_devices`. It does not come from IP or IP prefix.
2. Remaining pool quota is computed from the `scans` table (a ledger), not a separate counter. That removes reset logic, the queue double-charge and the non-atomic decrement.
3. Run in **shadow mode** for about a week (`POOL_ENFORCE` unset), then enforce.
4. Stop creating new IP locks once enforcement is on. Use `/24` and IP clusters for Slack alerts only.
5. If abuse continues, add a **$0 card setup** and merge pools on `card.fingerprint`.

**Withdrawn from my earlier advice**

- A generous 2× pool for IP-only links. A school or library with many users on one `/24` would still be throttled, so weak links should not share quota at all.
- The `pool_usage` function. It was `SECURITY DEFINER`, and Supabase lets `anon` call functions by default. The final functions revoke that.

**Your ideas**

| Idea | Position |
|---|---|
| **$1 paywall for the card fingerprint** | Stripe's `card.fingerprint` is a much stronger signal than IP or browser, but you don't need to charge: a SetupIntent (Checkout in setup mode) saves the card for $0 and still returns the fingerprint. A $1 charge loses roughly a third to fees and invites card testing. Virtual cards defeat it, and requiring it for everyone hurts the SEO-to-signup funnel. Middle path: 1 scan with no card, the rest of the free scans after a no-charge card add |
| **Use `account_devices` for detection** | Yes. Treat a shared `device_id` or `device_fp` as a strong link. Require corroboration for weak ones |
| **Partial IPs (e.g. `123.12.123.x`)** | The `/24` pattern is real, but weak: carriers (CGNAT) and campuses put thousands of unrelated users in one `/24`. Never flag on it alone. Pair it with the same ASN, OS, browser and timezone. For IPv6 use `/64`. Alert-only |

Other layers I listed for later: block at signup (Supabase CAPTCHA, email confirmation, disposable-domain rejection, Gmail normalisation with a unique index on the normalised address), a Supabase "before user created" hook (check the current docs), and cutting the incentive (lifetime free allowance, phone or card verification).

**Rollout order (abuse controls)**

1. Run the security checks first (Phase 4).
2. Apply the RPC stopgap and run the read-only diagnostic queries ([Appendix D](#appendix-d--third-account-bug-diagnosis-and-stopgap)).
3. Run the pool SQL ([Appendix E](#appendix-e--shared-pool-sql)) and deploy the `rateLimiter.js` changes **without** `POOL_ENFORCE` ([Appendix F](#appendix-f--ratelimiterjs-pool-integration)).
4. Watch for `[POOL-SHADOW]` log lines for a week, and check pool sizes against accounts you know are abusive.
5. Set `POOL_ENFORCE=true` and restart PM2 with `--update-env`.
6. Comment out the `lockAndNotifyCluster` call in `abuseDetection.js`. Keep the resolve sweep so existing locks clear.
7. In the Stripe webhook, set `pool_id = null` on upgrade.

#### Phase 4 – Prerequisite security checks

- `select … from pg_policies where tablename = 'account_devices'` returned **no rows**. That is ambiguous: it fits both "RLS on, no policies" (safe) and "RLS off" (dangerous).
- `pg_class.relrowsecurity` check: **RLS is on, with no policies.** The browser can't touch `account_devices`, so only the server (service role) writes it.
- `profiles` has "service role can do everything" and "users can read own profile". `scans` has "service role can insert scans" and "users can view own scans". The **names don't show the role**. If a "service role" policy has no `TO service_role` clause and a `true` condition, anyone with the public anon key could read or edit every profile or insert fake `scans` rows. The service role bypasses RLS, so those policies are unnecessary. The `roles` column of `pg_policies` decides this. **Not yet checked.**
- `account_devices` is written by the website's signup route on Vercel. The IP comes from a header (good), but `device_fp`, `timezone`, `browser` and `os` came from the request body (client-controlled).

### Part B: Auth hardening

#### Phase 5 – The public Supabase signup bypass

- The signup route calls `supabaseAnon.auth.signUp`. Supabase's own `/auth/v1/signup` endpoint is public, and the anon key sits in the site's JavaScript. Unless CAPTCHA protection is on in Supabase itself, a script can skip the route entirely.
- **Test:** a direct curl to `/auth/v1/signup` with a throwaway address ([Appendix G](#appendix-g--checks-and-verification-commands)).
- **Result:** a user was created (no session, so email confirmation is on). `device_rows` was **0**, which proves the route's Turnstile check, rate limit, IP capture and device record were all skipped. A query as `anon` against `auth.users` returned an error, which is the good outcome.
- **Fix:** enable CAPTCHA protection in Supabase and pass `captchaToken` from the routes.
- **Second finding:** the site is also served at `*.vercel.app`, where `CF-Connecting-IP` and `True-Client-IP` can be forged. That poisons `ip_at_creation`, `account_devices.ip` and the rate limits. Fix: origin-secret middleware.

#### Phase 6 – Lockout after enabling CAPTCHA, and the recovery plan

- After CAPTCHA was enabled, signin and signup stopped working, because the routes verified the token themselves and then passed nothing to Supabase.
- **Phase 0 option:** turn CAPTCHA off temporarily to restore access (the bypass was already open, so this was no worse).
- I gave a five-phase plan: (1) fix the four auth routes, (2) origin-secret middleware, (3) one IP function everywhere, (4) smaller device-field patches, (5) abuse controls last.
- The route changes were then carried out in the Grok session (phases 7 to 10).

#### Phase 7 – Confirm Turnstile configuration (Grok session)

1. Cloudflare Turnstile widget: copy the Site Key (frontend) and Secret Key.
2. Supabase Dashboard → Authentication → Attack Protection → Enable CAPTCHA → Provider = **Turnstile** → paste the Secret Key.
3. The frontend already sent `turnstileToken` in the request body.

Common failure modes: Site Key and Secret Key from different widgets, token reused (no widget reset), a route that still calls `verifyTurnstileToken`, or the provider still set to hCaptcha.

#### Phase 8 – Fix the four auth routes (Grok session)

**Signup and signin:** full replacements that remove every `verifyTurnstileToken` call, check only that `turnstileToken` exists, pass it to Supabase as `captchaToken`, and keep the rate-limiting and device-recording logic. Signup also skips writes for the obfuscated already-registered user ([Appendix B](#appendix-b--final-auth-route-patterns)).

**Resend-verification and reset-password.** Original problems:
- Both used the **service-role** client, so Supabase CAPTCHA was bypassed.
- Both still called `verifyTurnstileToken`.

Changes applied: switched to the **anon client**, removed `verifyTurnstileToken`, added the early "token must exist" guard, and passed `captchaToken` into `auth.resend` and `auth.resetPasswordForEmail`.

#### Phase 9 – Origin-secret middleware (Grok session)

The existing names were used: header `x-mediacrater-proxy-secret`, env var `CLOUDFLARE_PROXY_SECRET`. The middleware enforces the secret on `/api/*` and then continues the device-cookie logic. A later review changed it to fail closed ([Appendix A](#appendix-a--final-middlewarets)).

#### Phase 10 – "Forbidden" JSON parse error (Grok session)

- **Symptom:** signup returned `Unexpected token 'F', "Forbidden" is not valid JSON`.
- **Cause:** the middleware returned plain-text `Forbidden` (403) because the secret header was missing, and the frontend tried to parse it as JSON.
- **Root cause:** the Cloudflare Transform Rule had been created as a **Response** Header rule. Response rules only change what Cloudflare sends to the browser, never the request that reaches Vercel.
- **Fix:** deleted it and created a **Request** Header Transform Rule setting `x-mediacrater-proxy-secret` on the production hostname.

#### Phase 11 – Reviews of the implemented auth changes

**Review 1 (of the first version of this index file):** routes and CAPTCHA wiring were right, but:
- "Production **and Preview**" for the secret was wrong. Preview deployments are not served through Cloudflare and never get the header, so every preview API call would 403. Set it for **Production only**. The middleware skips the check when the variable is unset, and Vercel Deployment Protection should stay on for previews.
- The middleware **failed open**: if the variable was deleted or mistyped in production, the protection silently disappeared. Its plain-text 403 caused the earlier JSON parse error.
- "Direct `*.vercel.app` blocked: verified" was not verified. The 403 seen was on the real domain.
- Callers that skip Cloudflare now get 403: the Stripe webhook (must use the real domain) and any Vercel cron jobs.
- `reset-password` built `redirectTo` from `req.url`. Use `NEXT_PUBLIC_APP_URL`, and keep Supabase's Redirect URLs list to exact URLs.
- The routes return raw `error.message`, and reset must answer the same whether or not the email exists.

**Review 2 (of the Grok transcript):** the four routes matched the plan. Findings:
- The middleware paste was an older version (`CF_ORIGIN_SECRET`, `x-origin-secret`, Production + Preview, fail-open). Use the existing `mediacrater` names, Production only, fail-closed.
- `lib/rate-limit.ts` read `x-forwarded-for` first, so signin, reset and resend were probably keyed on **Cloudflare edge IPs** while signup (in `account-device.ts`) used `cf-connecting-ip`. Unrelated users would share rate-limit buckets.
- `curl -I` sends HEAD and proves nothing about POST handlers. Verify with POST requests.
- The old matcher excluded `api/resend-verification` on purpose and the new one drops that exclusion, so test a full resend flow.
- Other entry points to check in Supabase: **anonymous sign-ins** (should be off) and **unused OAuth providers** (off; used ones need a server-side callback that records a device row).

#### Phase 12 – IP-source cleanup

- Both `clientIpFrom` functions should read only `cf-connecting-ip`, validated with a regex. This is safe because the origin secret now blocks direct access.
- The fallbacks differ on purpose: `lib/rate-limit.ts` returns `'unknown'` (rate limiting needs a string), and `lib/account-device.ts` returns `''` (its callers do `ip || null`).
- Check afterwards that real visitor IPs, not Cloudflare ranges (`104.x`, `172.64–71.x`, `162.158.x`), appear in `rate_limits`. A growing `unknown` row means requests arrive without `cf-connecting-ip`.

#### Phase 13 – The `/api/*` 403 outage

- **Test:** `curl -X POST` to the real domain and the `.vercel.app` URL both returned 403. A bare POST sends no body, and the signin route calls `await req.json()` without a catch, so my "expect 400" was wrong.
- **Diagnosis:** `{"error":"Forbidden"}` JSON plus an `x-vercel-id` header showed the request reached Vercel and the middleware rejected it. A browser sign-in also failed with 403, so **real users were locked out**.
- **Recovery plan:** roll back via Vercel → Deployments → previous deployment → Promote to Production, then add a version of the middleware that logs *why* it rejects (without logging the secret).

| Log line | Meaning | Fix |
|---|---|---|
| `not set in this deployment` | Env var missing in Production, misnamed, or added after the last deploy | Check the exact name `CLOUDFLARE_PROXY_SECRET`, tick Production, **Redeploy** |
| `rejected`, `headerPresent: false` | Cloudflare isn't injecting the header | Rule must be **Request** Header, enabled, header name exact, hostname expression matching the visitor hostname (apex vs `www`) |
| `rejected`, `headerPresent: true` | Values differ | Re-paste the same value into both. Watch for trailing whitespace, then redeploy |

- **Result:** a later test showed `HTTP/2 400` from the real domain (Cloudflare adds the header and the route complains about missing credentials), so access was restored. The exact cause was not captured. My guess was a secret-name mismatch between the earlier `CF_ORIGIN_SECRET` / `x-origin-secret` instructions and the `mediacrater` names.
- A manual secret test on the `.vercel.app` URL returned 403. The command was `read -rsp …`, which waits silently for the secret. It looked frozen, and pressing Enter without typing sends an empty header, so 403 was the correct answer. It was optional.

#### Phase 14 – Which file version is correct

- **`lib/rate-limit.ts`:** of the two pasted files (test and live), the one with the `cf-connecting-ip` `clientIpFrom` is correct. Check with `grep -n "cf-connecting-ip" lib/rate-limit.ts` in each environment.
- **`lib/account-device.ts`:** the **294-line** file is correct. The 305-line file still has the `true-client-ip` / `x-forwarded-for` fallbacks.
- **Test-environment caveat:** if the test site isn't served through Cloudflare, every visitor lands in one `'unknown'` rate-limit bucket. Harmless for a single tester. If test is behind Cloudflare, it also needs the origin-secret rule and `CLOUDFLARE_PROXY_SECRET`, or the fail-closed middleware will 403 its API routes.

#### Phase 15 – Device-field hardening patches

Three replacements for the 294-line `lib/account-device.ts` ([Appendix C](#appendix-c--ip-source-and-device-field-fixes)):

1. **`mergeDeviceFields`:** header-derived browser, version and OS win over the request body, and lengths are capped. `timezone` and `device_fp` remain client-supplied.
2. **`vercelGeo`:** prefer `cf-ipcountry` (Vercel's header likely describes the edge location behind Cloudflare), ignore `XX` and `T1`, and take the city from ipinfo only.
3. **`HOSTING_ORG_RE`:** drop `cloudflare` so WARP users aren't flagged as hosting.

Old `account_devices` rows keep the old client-supplied values, so don't rely on exact browser equality across old and new rows.

#### Phase 16 – Limits that remain

- `device_fp`, `timezone` and the `device_id` cookie are client-controlled. A script can send a fresh UUID cookie and random fingerprint per signup for the cost of one CAPTCHA solve. Pooling stops casual abuse, and only a card fingerprint is a hard link.
- Clearing storage resets `device_id`, and a new browser profile changes `device_fp`.
- Deleting an account may refund pool quota if `scans.user_id` cascades on delete.
- Concurrent sibling scans can slightly overshoot the pool, because the ledger updates after a scan completes.
- The pool lookup fails open (logged), favouring availability over catching every abuser.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Third account never locked | RPC counts only `active` accounts, so the IP drops below the threshold after the first lock | Stopgap RPC patch ([Appendix D](#appendix-d--third-account-bug-diagnosis-and-stopgap)), then the shared pool |
| 2 | Users locked out of signup / signin after enabling CAPTCHA | Routes self-verified the Turnstile token and passed nothing to Supabase | Removed self-verification and passed `captchaToken` |
| 3 | Resend and reset ignored CAPTCHA | Service-role (admin) client bypasses Supabase CAPTCHA | Switched to the anon client |
| 4 | Account created through Supabase's public endpoint with 0 device rows | The route's protections only apply when the route is used | Supabase CAPTCHA enforcement |
| 5 | `Unexpected token 'F', "Forbidden" is not valid JSON` | Middleware returned a plain-text 403; frontend expected JSON | Fixed the Cloudflare rule type, then switched the middleware to a JSON 403 |
| 6 | Origin secret not arriving at Vercel | Created a **Response** Header rule instead of a **Request** Header rule | Re-created as a Request Header Transform Rule |
| 7 | Confusion about the secret's name | Instructions used `CF_ORIGIN_SECRET` / `x-origin-secret`; the project used `CLOUDFLARE_PROXY_SECRET` / `x-mediacrater-proxy-secret` | Standardised on the existing names |
| 8 | Real-domain `/api/*` returned 403 after the middleware swap, browser sign-in failed | Secret mismatch or missing env var in the fail-closed version (exact cause not captured) | Rollback option, logging middleware, later 400 on the real domain |
| 9 | `read -rsp` secret test looked frozen, then returned 403 | The prompt waits silently; an empty header is correctly rejected | Optional test, not needed |
| 10 | Bare `curl -X POST` returned 403 on both URLs | No body and no header; the real-domain 403 was the outage above | Browser test plus `-d '{}'` with a JSON content type |
| 11 | `curl -I` used to verify | HEAD requests don't exercise POST handlers | Use `curl -X POST` |
| 12 | `pg_policies` query returned no rows | Ambiguous: RLS on with no policies, or RLS off | `relrowsecurity` check: RLS is on |
| 13 | Two different copies of `rate-limit.ts` and `account-device.ts` (test vs live) | Code drift between environments | Use the `cf-connecting-ip` / 294-line versions in both |
| 14 | Auth rate limits probably keyed on Cloudflare edge IPs | `x-forwarded-for` read first in `lib/rate-limit.ts` | `cf-connecting-ip` only (confirm with the `rate_limits` query) |
| 15 | `assign_pool` could merge unrelated accounts | My first version matched every `account_devices` row, including `login` events from shared computers | Corrected version matches **signup** events only ([Appendix E](#appendix-e--shared-pool-sql)) |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. **Third-account cause:** my first guesses (timed-job gap, late IP capture, IPv6 rotation) were not the real cause. The RPC's `active` filter was.
2. **Sweep interval:** I said 45 minutes. It is 5 minutes.
3. **2× IP-only pool:** withdrawn. Weak links should not share quota.
4. **`pool_usage`:** withdrawn. It was `SECURITY DEFINER` and callable by `anon`.
5. **`assign_pool` v1:** matched `login` events and could merge unrelated accounts. Replaced.
6. **"Expect 400" on a bare POST:** wrong. An empty POST reaches `req.json()` without a catch.
7. **Fail-closed middleware:** I should have told you to confirm the env var and redeploy first. A mismatch becomes a full outage.
8. **`read -rsp` test:** gave no visible prompt and was confusing.
9. **"Production + Preview":** wrong in the other LLM's instructions and in the first version of this file.
10. **"Direct vercel.app blocked: verified":** wrongly marked verified in the first version of this file.

### Decisions

1. **Tokens are single-use:** never call `verifyTurnstileToken` and then hand the same token to Supabase.
2. **Service role bypasses CAPTCHA:** any user-facing auth action that must be protected by CAPTCHA must use the anon client.
3. **The origin secret must be a Request Header rule.** Response Header rules do nothing for this.
4. **Reuse existing names** (`x-mediacrater-proxy-secret`, `CLOUDFLARE_PROXY_SECRET`) to avoid drift.
5. **Middleware order:** secret check first, then device-cookie logic.
6. **Production-only secret, fail-closed in production, JSON 403 body.**
7. **One IP source:** `cf-connecting-ip` only, in both `clientIpFrom` functions.
8. **Pool on strong signals only.** Weak signals (IP, `/24`) alert and never share quota.
9. **Ledger, not counter:** remaining pool quota comes from `scans`, so there is no reset logic or double-charge.
10. **Shadow mode first,** then enforce. The pool lookup fails open.
11. **Don't paywall yet.** If needed later, use a $0 card setup, not a $1 charge.

---

## 7. Open items checklist

### Confirm immediately (auth)

- [ ] All four auth routes and the middleware are deployed to production
- [ ] Middleware is the **fail-closed JSON** version ([Appendix A](#appendix-a--final-middlewarets))
- [ ] `CLOUDFLARE_PROXY_SECRET` is set for **Production only** in Vercel, and matches the Cloudflare Request Header rule exactly
- [ ] Supabase CAPTCHA is still set to **Turnstile**, and the direct `/auth/v1/signup` curl still fails
- [ ] Frontend resets the Turnstile widget after every attempt
- [ ] Sign in, sign up (real inbox), reset password and resend verification all work in a browser. Test resend specifically, because the old matcher excluded it
- [ ] The bypass test user is deleted (Authentication → Users)
- [ ] **Stripe webhook** URL uses the real domain, with no 403s in Stripe's recent deliveries
- [ ] Any **Vercel cron** paths are exempted in the middleware
- [ ] Supabase: **anonymous sign-ins off**, unused OAuth providers off, Redirect URLs are exact (no wildcards)

### IP source and device fields

- [ ] `lib/rate-limit.ts` has the `cf-connecting-ip` `clientIpFrom` in **both** test and live
- [ ] `lib/account-device.ts` is the 294-line version in **both** test and live
- [ ] Apply the three device-field patches ([Appendix C](#appendix-c--ip-source-and-device-field-fixes)), then run the post-deploy check
- [ ] Run the `rate_limits` query and confirm real visitor IPs (no Cloudflare ranges, no growing `unknown` row)
- [ ] If test isn't served through Cloudflare, accept that its auth rate limits share one `unknown` bucket. If it is, give it the origin-secret rule and env var too

### Small route fixes

- [ ] Add `.catch(() => null)` to `req.json()` in `signin` and `reset-password` (signup already has it)
- [ ] Use `NEXT_PUBLIC_APP_URL` for `redirectTo` in `reset-password`
- [ ] Return generic error messages instead of raw `error.message`, and make reset answer identically whether or not the email exists

### Abuse controls (after the auth items above are stable)

- [ ] Run the `pg_policies` query with `roles` for `profiles` and `scans`. Drop any "service role…" policy that applies to `public` or `authenticated`
- [ ] Check the `scans.user_id` foreign key delete behaviour (cascade would refund pool quota on account deletion)
- [ ] Apply the RPC stopgap and run the read-only diagnostic queries ([Appendix D](#appendix-d--third-account-bug-diagnosis-and-stopgap))
- [ ] Run the pool SQL ([Appendix E](#appendix-e--shared-pool-sql)) with the **corrected `assign_pool`**
- [ ] Add the pool code to `rateLimiter.js` ([Appendix F](#appendix-f--ratelimiterjs-pool-integration)) and deploy **without** `POOL_ENFORCE`
- [ ] Watch `[POOL-SHADOW]` log lines for about a week, then check pool sizes against known abusers
- [ ] Set `POOL_ENFORCE=true` and restart PM2 with `--update-env`
- [ ] Comment out the `lockAndNotifyCluster` call in `abuseDetection.js`, keep the resolve sweep
- [ ] Stripe webhook: set `pool_id = null` on upgrade
- [ ] Daily weak-link pair query posted to Slack for review

### Optional later

- [ ] Gmail address normalisation with a unique index, and disposable-email blocking
- [ ] Supabase "before user created" hook (check the current docs and what the payload contains)
- [ ] $0 card setup (Stripe SetupIntent) and a pool merge on `card.fingerprint`, only if abuse continues
- [ ] Treat `is_hosting` signups with extra friction (CAPTCHA or phone check), not a block
- [ ] Fix the stale 45-minute comment in `server.js`

### Still open from the VPS index (2 Oct)

- [ ] `sudo pm2 list` → delete any stale root daemon, then `pm2 save` for the real user
- [ ] Bind tools app (`:3876`) to `127.0.0.1`
- [ ] Revoke the old Resend API key that lived in n8n
- [ ] `apt upgrade` + reboot (kernel update)
- [ ] `certbot renew --dry-run`
- [ ] Set nginx `error_log` back to `warn`
- [ ] Confirm `/scan-image` route, new `getClientIp`, etc. are present in both live and test

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Turnstile Site Key | Used on the frontend (public) |
| Turnstile Secret Key | Stored only in Supabase CAPTCHA settings |
| Supabase CAPTCHA provider | Turnstile |
| Origin-secret header | `x-mediacrater-proxy-secret` |
| Origin-secret env var | `CLOUDFLARE_PROXY_SECRET` (**Production only**) |
| Cloudflare rule type | **Request** Header Transform Rule (not Response) |
| Auth routes | `/api/signup`, `/api/signin`, `/api/resend-verification`, `/api/auth/reset-password` |
| Middleware file | `middleware.ts` (project root or `src/`) |
| IP source (website) | `cf-connecting-ip` only, validated by regex |
| Rate-limit tables / RPC | `rate_limits`, `check_and_log_rate_limit` |
| Device table | `account_devices` (RLS on, no policies, service-role writes only) |
| Strong pool signals | `device_id`, `device_fp` from **signup** events. Fingerprints shared by more than 10 accounts are ignored (a guess, tune it from your data) |
| Weak signals (alert only) | IPv4 `/24`, IPv6 `/64`, same ASN, OS, browser, timezone |
| Pool tables / functions | `scan_pools`, `profiles.pool_id`, `assign_pool(uuid)`, `pool_remaining(bigint, timestamptz, int)` (service role only) |
| Pool switch | `POOL_ENFORCE=true` (unset = shadow mode, logs `[POOL-SHADOW]`) |
| Abuse sweep | `abuseDetection.js`, every 5 minutes |
| Free plan | 3 scans per month (`PLAN_CONFIG.free.maxScans`) |

---

## Appendix A – Final middleware.ts

Fail-closed in production, JSON 403, Production-only secret. JSON 403 bodies have been observed, so a JSON version is deployed, but confirm it is this one.

```ts
// middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { attachDeviceCookie, readOrMintDeviceId } from '@/lib/account-device';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images).*)'],
};

export function middleware(req: NextRequest) {
  // 1. Origin-secret check on API routes (blocks direct *.vercel.app access).
  //    Fails closed in production if the secret is missing.
  if (req.nextUrl.pathname.startsWith('/api/')) {
    const secret = process.env.CLOUDFLARE_PROXY_SECRET;
    const got = req.headers.get('x-mediacrater-proxy-secret');

    if (!secret) {
      if (process.env.VERCEL_ENV === 'production') {
        console.error('[MW] CLOUDFLARE_PROXY_SECRET not set in this deployment');
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (got !== secret) {
      console.error('[MW] proxy secret rejected', { headerPresent: got !== null });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // 2. Device cookie
  const { deviceId, minted } = readOrMintDeviceId(req);
  const res = NextResponse.next();
  if (minted) attachDeviceCookie(res, deviceId);
  return res;
}
```

**Notes**

- Env changes only apply to new deployments, so redeploy after changing `CLOUDFLARE_PROXY_SECRET`.
- Keep Vercel Deployment Protection on for previews.
- The `[MW]` log lines never include the secret. Keep them or remove them once things are stable.
- If the secret was ever pasted into chat or a terminal history, rotate it: generate a new one, update Vercel (Production) and the Cloudflare rule, then redeploy.

---

## Appendix B – Final auth route patterns

All four routes follow the same pattern:

1. Parse the body (`.catch(() => null)`) → require `email` (and `password` / `turnstileToken` as appropriate).
2. Early exit if `!turnstileToken`.
3. Rate-limit by IP.
4. Call the Supabase **anon** client and pass `captchaToken: turnstileToken`.
5. Map any captcha-related error to a clean "Verification failed" message.
6. Never call `verifyTurnstileToken` yourself.

**Signup: guard against the obfuscated existing user.** With email confirmation on, an already-registered email comes back as an obfuscated user with an empty `identities` array. Don't write profile or device rows for it:

```ts
const { data, error } = await supabaseAnon.auth.signUp({
  email,
  password,
  options: {
    captchaToken: turnstileToken,
    data: { browser_id: deviceId, signup_source: 'website' },
  },
});

const userId = data.user?.id;
const isObfuscatedExisting =
  Array.isArray(data.user?.identities) && data.user!.identities!.length === 0;

if (userId && !isObfuscatedExisting) {
  // profiles upsert (ip_at_creation, browser_id, ...) and recordAccountDevice(...) go here
}
// Return only { success, hasSession, deviceRecorded }, never deviceError.
```

**Signin:**

```ts
await supabaseAnon.auth.signInWithPassword({
  email,
  password,
  options: { captchaToken: turnstileToken },
});
```

**Resend (final form):**

```ts
const { error } = await supabaseAnon.auth.resend({
  type: 'signup',
  email,
  options: {
    captchaToken: turnstileToken,
    emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
  },
});
```

**Reset-password (final form, with the redirect fix):**

```ts
const { error: resetError } = await supabaseAnon.auth.resetPasswordForEmail(email, {
  captchaToken: turnstileToken,
  redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/update-password`,
});
```

Previously this used `new URL(req.url).origin`. Use the fixed app URL instead, and keep Supabase's Redirect URLs list to exact URLs.

The full signup and signin replacements were provided in the Claude conversation (see the link at the top).

---

## Appendix C – IP-source and device-field fixes

### `clientIpFrom`: replace the whole function in both files

**`lib/rate-limit.ts`** (used by signin, reset, resend):

```ts
export function clientIpFrom(req: NextRequest): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim() ?? ''
  return /^[0-9a-fA-F:.]{3,45}$/.test(cf) ? cf : 'unknown'
}
```

**`lib/account-device.ts`** (used by signup, whose callers do `ip || null`):

```ts
export function clientIpFrom(req: NextRequest): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim() ?? '';
  return /^[0-9a-fA-F:.]{3,45}$/.test(cf) ? cf : '';
}
```

Delete the old bodies completely, including the `true-client-ip` and `x-forwarded-for` fallbacks.

### `mergeDeviceFields` (header-derived values win, lengths capped)

```ts
export function mergeDeviceFields(
  req: NextRequest,
  client: DeviceClientFields
): Required<DeviceClientFields> {
  const cap = (v: unknown, n: number) => asText(v)?.slice(0, n) ?? null;
  const uaParsed = parseUserAgent(req.headers.get('user-agent'));
  const ch = parseSecChUa(req.headers.get('sec-ch-ua'));
  const chOs = asText(req.headers.get('sec-ch-ua-platform'))?.replace(/"/g, '') ?? null;

  return {
    timezone: cap(client.timezone, 64),
    browser: uaParsed.browser || ch.browser || cap(client.browser, 64),
    browser_version: uaParsed.browser_version || ch.browser_version || cap(client.browser_version, 32),
    os: chOs || uaParsed.os || cap(client.os, 32),
    device_fp: cap(client.device_fp, 128),
  };
}
```

`timezone` and `device_fp` can't be derived from headers, so they stay client-supplied. The User-Agent header is also spoofable by a script, but it is one more thing a bot has to fake consistently.

### `vercelGeo` (Cloudflare's header wins)

```ts
function vercelGeo(req: NextRequest): Pick<IpIntel, 'country' | 'city'> {
  const country = asText(req.headers.get('cf-ipcountry') || req.headers.get('x-vercel-ip-country'));
  return {
    country: country && country !== 'XX' && country !== 'T1' ? country : null,
    city: null, // Vercel's city header describes the edge, so city comes from ipinfo only
  };
}
```

`XX` is Cloudflare's "unknown" and `T1` is Tor. The city is lost if the ipinfo call fails or times out (1.5 s), which is better than storing the wrong one.

### `HOSTING_ORG_RE` (`cloudflare` removed)

```ts
const HOSTING_ORG_RE =
  /\b(amazon|aws|google cloud|gcp|microsoft azure|azure|digitalocean|linode|akamai|ovh|hetzner|vultr|datacamp|m247|choopa|leaseweb|hivelocity|contabo|oracle cloud|alibaba)\b/i;
```

`VPN_ORG_RE` matches any organisation with "vpn" in the name. Both flags are signals, so don't block on them.

### Post-deploy check

Sign up with a test account on the real site, then:

```sql
select browser, browser_version, os, country, city, asn_org, is_hosting, ip
from account_devices order by created_at desc limit 1;
```

Browser, OS and country should match your real device, and `ip` should be your own, not a Cloudflare IP.

---

## Appendix D – Third-account bug: diagnosis and stopgap

### Stopgap: patched RPC

Counts all matching accounts, and flags a cluster only when it has 2 or more accounts and at least one is still `active`. Untested, so run its body as a plain `SELECT` first.

```sql
CREATE OR REPLACE FUNCTION public.detect_duplicate_free_ips()
 RETURNS TABLE(ip_at_creation text, account_count bigint)
 LANGUAGE sql
AS $function$
SELECT p.ip_at_creation, COUNT(*) AS account_count
FROM profiles p
WHERE p.ip_at_creation IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM purchases pu WHERE pu.user_id = p.id)
GROUP BY p.ip_at_creation
HAVING COUNT(*) >= 2
   AND COUNT(*) FILTER (WHERE p.account_status = 'active') >= 1;
$function$;
```

`lockAndNotifyCluster` then sees A, B and C, and `toLock` is `[C]`. It still matches only on IP and has a window of up to 5 minutes, so it is a stopgap.

### Read-only diagnostics (collision rates)

```sql
-- Fingerprints shared by several accounts (tune the "> 10" cap in assign_pool from this)
select device_fp, count(distinct user_id) n from account_devices
where event='signup' and device_fp is not null group by 1 having count(distinct user_id)>1 order by n desc limit 20;

-- IPs shared by several signups
select ip, count(distinct user_id) n from account_devices
where event='signup' group by 1 having count(distinct user_id)>1 order by n desc limit 20;
```

### Partial-IP helper and prefix crowding check

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

select public.ip_prefix(ip) pfx, count(distinct user_id) n
from account_devices where event='signup' group by 1 order by n desc limit 20;
```

### Weak-link pair query (alert-only, eyeball the results before acting)

Excludes `browser_version` on purpose, since it changes.

```sql
with s as (
  select d.user_id, d.device_id, d.device_fp, d.asn, d.os, d.browser, d.timezone,
         public.ip_prefix(d.ip) as pfx
  from account_devices d join profiles p on p.id = d.user_id
  where d.event = 'signup' and p.plan = 'free'
    and d.created_at > now() - interval '30 days'
)
select a.user_id as user_a, b.user_id as user_b,
  coalesce(a.device_id = b.device_id or (a.device_fp is not null and a.device_fp = b.device_fp), false) as strong_link,
  coalesce(a.pfx = b.pfx and a.asn = b.asn and a.os = b.os
           and a.browser = b.browser and a.timezone = b.timezone, false) as weak_link
from s a join s b on a.user_id < b.user_id
where (a.device_id = b.device_id or (a.device_fp is not null and a.device_fp = b.device_fp))
   or (a.pfx = b.pfx and a.asn = b.asn and a.os = b.os
       and a.browser = b.browser and a.timezone = b.timezone);
```

---

## Appendix E – Shared-pool SQL

Untested, so try it in a scratch project first. Pools are assigned the first time a free account hits `checkRateLimit`, so existing users need no migration.

```sql
create table public.scan_pools (
  id bigserial primary key,
  created_at timestamptz not null default now()
);
alter table public.scan_pools enable row level security;

alter table public.profiles
  add column if not exists pool_id bigint references public.scan_pools(id);
create index if not exists profiles_pool_id_idx on public.profiles (pool_id);

-- Useful for the fingerprint lookups in assign_pool (from the earlier pool_usage message)
create index if not exists account_devices_device_fp_idx
  on public.account_devices (device_fp) where device_fp is not null;

drop function if exists public.pool_usage(uuid, timestamptz);

-- Corrected version: links on SIGNUP events only
create or replace function public.assign_pool(p_user uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  linked bigint[];
  target bigint;
begin
  perform pg_advisory_xact_lock(727001);   -- serialize so siblings can't create separate pools

  select pool_id into target from profiles where id = p_user;
  if target is not null then return target; end if;

  select array_agg(distinct p.pool_id) into linked
  from account_devices d
  join profiles p on p.id = d.user_id
  where d.event = 'signup'
    and d.user_id <> p_user
    and p.pool_id is not null
    and (
      d.device_id in (select device_id from account_devices
                      where user_id = p_user and event = 'signup')
      or (
        d.device_fp is not null
        and d.device_fp in (select device_fp from account_devices
                            where user_id = p_user and event = 'signup' and device_fp is not null)
        -- ignore fingerprints shared by many accounts (identical lab machines, common phones)
        and d.device_fp not in (select device_fp from account_devices
                                where event = 'signup' and device_fp is not null
                                group by device_fp having count(distinct user_id) > 10)
      )
    );

  if linked is null or cardinality(linked) = 0 then
    insert into scan_pools default values returning id into target;
  else
    select min(x) into target from unnest(linked) x;
    update profiles set pool_id = target where pool_id = any(linked) and pool_id <> target;  -- merge pools
  end if;

  update profiles set pool_id = target where id = p_user;
  return target;
end $$;

create or replace function public.pool_remaining(p_pool bigint, p_since timestamptz, p_quota int)
returns int language sql stable security definer set search_path = public as $$
  select greatest(0, p_quota - coalesce(sum(s.tokens_deducted), 0))::int
  from scans s join profiles p on p.id = s.user_id
  where p.pool_id = p_pool and s.status = 'completed' and s.created_at >= p_since;
$$;

revoke execute on function public.assign_pool(uuid) from public, anon, authenticated;
revoke execute on function public.pool_remaining(bigint, timestamptz, int) from public, anon, authenticated;
grant execute on function public.assign_pool(uuid) to service_role;
grant execute on function public.pool_remaining(bigint, timestamptz, int) to service_role;
```

**Notes**

- Assumes `scans` has `user_id`, `tokens_deducted`, `status` and `created_at` (the columns `logScan` writes).
- If you replace `assign_pool` while still in shadow mode and want a clean slate: `update profiles set pool_id = null; delete from scan_pools;`. Don't do that once `POOL_ENFORCE` is on.
- To link accounts by hand: `update profiles set pool_id = <id> where id in (...)`.
- Check pool sizes: `select pool_id, count(*) members from profiles where pool_id is not null group by 1 having count(*) > 1 order by 2 desc;`

---

## Appendix F – rateLimiter.js pool integration

Add these helpers, replace `checkRateLimit` and `getRateLimitStatus`, and leave `commitScanDeduction` unchanged. The `scans` rows written by `logScan` are the ledger. Your four scan handlers don't change.

```js
const POOL_ENFORCE = process.env.POOL_ENFORCE === 'true';   // unset = shadow mode

function monthStartUtc() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString();
}

// Returns pool-wide remaining scans, or null if the lookup failed (fails open, logged).
async function getFreePoolRemaining(userId, profile, supabase, quota, { assign = true } = {}) {
  try {
    let poolId = profile.pool_id;
    if (!poolId) {
      if (!assign) return null;
      const { data, error } = await supabase.rpc('assign_pool', { p_user: userId });
      if (error) throw error;
      poolId = data;
    }
    const { data, error } = await supabase.rpc('pool_remaining', {
      p_pool: poolId, p_since: monthStartUtc(), p_quota: quota
    });
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[POOL] lookup failed, using per-account limit only:', err.message);
    return null;
  }
}

async function checkRateLimit(userId, profile, supabase, scanCost = 1) {
  const plan = profile.plan || 'free';
  const config = PLAN_CONFIG[plan] || PLAN_CONFIG.free;
  const isPaid = plan !== 'free';

  const accountRemaining = profile.scans_remaining ?? config.maxScans;
  let effectiveRemaining = accountRemaining;
  let poolLimited = false;

  if (!isPaid) {
    const poolRemaining = await getFreePoolRemaining(userId, profile, supabase, config.maxScans);
    if (poolRemaining !== null && poolRemaining < effectiveRemaining) {
      if (POOL_ENFORCE) {
        effectiveRemaining = poolRemaining;
        poolLimited = true;
      } else if (poolRemaining < scanCost) {
        console.warn(`[POOL-SHADOW] would block user:${userId} pool:${profile.pool_id ?? 'new'} poolRemaining:${poolRemaining}`);
      }
    }
  }

  if (effectiveRemaining < scanCost) {
    return {
      allowed: false,
      isPaid,
      plan,
      error: 'Scan limit reached',
      message: poolLimited
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

  // remaining stays the ACCOUNT balance so commitScanDeduction keeps writing the right number
  return { allowed: true, isPaid, plan, remaining: accountRemaining, maxScans: config.maxScans };
}

async function getRateLimitStatus(userId, profile, supabase) {
  const plan = profile.plan || 'free';
  const isPaid = plan !== 'free';
  let remaining = Math.max(0, profile.scans_remaining ?? 0);
  const maxScans = profile.scans_per_month ?? PLAN_CONFIG[plan]?.maxScans ?? 3;

  if (!isPaid && POOL_ENFORCE && profile.pool_id) {
    const poolRemaining = await getFreePoolRemaining(userId, profile, supabase, maxScans, { assign: false });
    if (poolRemaining !== null) remaining = Math.min(remaining, poolRemaining);
  }
  return { isPaid, plan, remaining, maxScans };
}
```

**Flaws and limits of this design**

- **Shadow mode first.** Log what the pool would have blocked for a week to see the false-positive rate.
- **Concurrency.** Usage is written when a scan completes (`logScan`), so simultaneous sibling scans can slightly overshoot. The queue allows one scan per user, so the overshoot is bounded by the number of siblings.
- **Reset timing differs.** The pool resets on the 1st (UTC), while the per-account counter resets however it does today. The effective limit is the lower of the two.
- **Post-scan counts.** The scan response still returns the account-level number. Only the status endpoint is pool-aware.
- **Fails open.** If the RPC errors, the scan is allowed and the error is logged.

---

## Appendix G – Checks and verification commands

### Public signup bypass test (should now fail with a captcha error)

```bash
curl -s -X POST 'https://<project-ref>.supabase.co/auth/v1/signup' \
  -H 'apikey: <anon key>' -H 'Content-Type: application/json' \
  -d '{"email":"bypass-test@yourdomain.com","password":"<a strong password>"}'
```

Before the fix, check what the bypass left behind (then delete the user):

```sql
select u.id, u.email_confirmed_at,
       (select count(*) from account_devices d where d.user_id = u.id) as device_rows
from auth.users u where u.email = 'bypass-test@yourdomain.com';
```

### Origin-secret checks (POST, not HEAD)

```bash
# .vercel.app URL: expect 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://YOUR_PROJECT.vercel.app/api/signin

# Real domain with an empty JSON body: expect 400 (middleware passes, route complains)
curl -si -X POST https://your-real-domain.com/api/signin -H 'Content-Type: application/json' -d '{}' | head -1
```

Optional manual secret test on the `.vercel.app` URL (the prompt is silent, type the secret and press Enter, expect 400). Don't paste the secret anywhere:

```bash
read -rsp 'Secret (typing is hidden, press Enter): ' S; echo
curl -s -w '\n%{http_code}\n' -X POST https://YOUR_PROJECT.vercel.app/api/signin \
  -H 'Content-Type: application/json' -H "x-mediacrater-proxy-secret: $S" -d '{}'
unset S
```

### Rate-limit IP check (real visitor IPs, no Cloudflare ranges, no growing `unknown`)

```sql
select ip, action, count(*) from rate_limits
where created_at > now() - interval '1 hour' group by 1,2 order by 3 desc limit 15;
```

### Signup device row check

```sql
select user_id, event, ip, device_id from account_devices order by created_at desc limit 3;
```

### Row-level security checks

```sql
-- Is RLS on?
select c.relname, c.relrowsecurity as rls_on
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('account_devices','profiles','scans','scan_pools');

-- Which roles do the policies apply to? (drop any broad "service role…" policy on public/authenticated)
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where tablename in ('profiles','scans');

-- Does deleting a user cascade to scans?
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid = 'public.scans'::regclass and contype = 'f';
```

To drop a broad policy (use the exact name from the output; the service role bypasses RLS, so it isn't needed):

```sql
drop policy "<exact name>" on public.profiles;   -- repeat for scans
```

Then test a signup, a login, a dashboard load and one scan.

### Rollback if auth breaks again

Vercel → Deployments → the last good deployment → ⋯ → **Promote to Production**. If it is a CAPTCHA problem and you can't deploy right away, Supabase → Authentication → Attack Protection can be turned off temporarily (this reopens the bypass, so turn it back on after deploying).

---

*End of index.  
Conversations: Claude https://claude.ai/chat/344c1200-b593-4d05-bab9-cd0f70039e9c · Grok https://grok.com/c/5ce1a967-c6ed-4894-bed4-17a43b35823e?rid=95a9ca06-b240-4f43-89d0-86b7b7e3f600*
