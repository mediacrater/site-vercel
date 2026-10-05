# Auth Hardening: Turnstile + Supabase CAPTCHA, Origin-Secret Middleware & Route Fixes

| | |
|---|---|
| **Date** | 5 October 2026 (`05oct26`) |
| **Conversation** | https://grok.com/c/5ce1a967-c6ed-4894-bed4-17a43b35823e?rid=95a9ca06-b240-4f43-89d0-86b7b7e3f600 |
| **Related prior work** | `vps-hardening-cloudflare-lockdown-ssrf-fix-02oct26.md` (2 Oct 2026) |
| **Stack** | Next.js on Vercel, Supabase Auth, Cloudflare Turnstile, Cloudflare Transform Rules |
| **Starting trigger** | Enabling CAPTCHA protection in Supabase while routes still self-verified Turnstile tokens; incomplete origin-secret middleware; “Forbidden” JSON parse error on signup |

> **Redaction note:** No secrets, API keys, full hostnames or personal data are included.

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

---

## 1. Summary

We closed the public Supabase auth bypass and correctly integrated Cloudflare Turnstile with Supabase’s built-in CAPTCHA protection.

**Main outcomes**

- All four auth routes (`signup`, `signin`, `resend-verification`, `reset-password`) now pass `captchaToken` to Supabase and no longer call `verifyTurnstileToken` themselves (Turnstile tokens are single-use).
- Service-role clients were replaced with the **anon client** on the resend and reset routes so Supabase CAPTCHA is actually enforced.
- Origin-secret middleware was updated to use the names already present in the project:
  - Header: `x-mediacrater-proxy-secret`
  - Env var: `CLOUDFLARE_PROXY_SECRET`
- The “Unexpected token 'F', "Forbidden" is not valid JSON” error was diagnosed and fixed (wrong Cloudflare rule type).
- Direct access to `*.vercel.app/api/*` is now blocked; only traffic that has passed through the real domain (and therefore carries the secret) reaches the API routes.

This work sits on top of the VPS hardening completed on 2 October 2026.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| Supabase CAPTCHA provider = Turnstile | ✅ Done | Secret key taken from the Cloudflare Turnstile widget |
| Signup route passes `captchaToken` | ✅ Done | Full replacement provided and applied |
| Signin route passes `captchaToken` | ✅ Done | Full replacement provided and applied |
| Resend-verification route | ✅ Done | Switched to anon client + `captchaToken` |
| Reset-password route | ✅ Done | Switched to anon client + `captchaToken` |
| Self-verification removed from auth routes | ✅ Done | Tokens are single-use; only Supabase may consume them |
| Origin-secret middleware | ✅ Done | Uses existing header / env names |
| Cloudflare Request Header Transform Rule | ✅ Done | Fixed after initially creating a Response Header rule |
| Direct `*.vercel.app` blocked | ✅ Done | Verified by the “Forbidden” response that was later fixed |
| Frontend Turnstile widget | ✅ Already present | Site key used; widget reset after every attempt required |

---

## 3. Starting point

- Supabase CAPTCHA protection had been turned on.
- The four auth routes still called `verifyTurnstileToken` themselves and then called Supabase **without** passing `captchaToken`.
- Because tokens are single-use, Supabase always rejected the (already consumed) token → users were locked out of signup / signin.
- Direct calls to Supabase’s public `/auth/v1/signup` endpoint still succeeded (bypass confirmed earlier with curl).
- Middleware only handled the device-cookie logic; it did not enforce the origin secret.
- An origin secret already existed under the names `x-mediacrater-proxy-secret` / `CLOUDFLARE_PROXY_SECRET`, but the middleware did not use them.

---

## 4. Timeline: what we did, in order

### Phase 1 – Confirm Turnstile configuration

- Confirmed the project was already using Cloudflare Turnstile (not hCaptcha).
- Required steps:
  1. Cloudflare Turnstile widget → copy Site Key (frontend) and Secret Key.
  2. Supabase Dashboard → Authentication → Attack Protection → Enable CAPTCHA → Provider = **Turnstile** → paste Secret Key.
  3. Frontend already sent `turnstileToken` in the request body.

### Phase 2 – Fix the four auth routes

**Signup and Signin**  
Full replacements were provided that:
- Remove every `verifyTurnstileToken` call.
- Only check that `turnstileToken` is present.
- Pass `options: { captchaToken: turnstileToken }` (or the equivalent for each method) to Supabase.
- Keep existing rate-limiting and device-recording logic.

**Resend-verification and Reset-password** (user pasted the original files)

Original problems:
- Both used the **service-role** client → Supabase CAPTCHA is bypassed.
- Both still called `verifyTurnstileToken`.

Changes applied:
- Switched both routes to the **anon client**.
- Removed `verifyTurnstileToken`.
- Added the early “token must exist” guard.
- Passed `captchaToken: turnstileToken` into `auth.resend` and `auth.resetPasswordForEmail`.

### Phase 3 – Origin-secret middleware

User already had:
- Header name: `x-mediacrater-proxy-secret`
- Env var: `CLOUDFLARE_PROXY_SECRET`

Middleware was rewritten to:
1. Enforce the origin secret on every `/api/*` path.
2. Continue the existing device-cookie logic (`readOrMintDeviceId` / `attachDeviceCookie`).

Final matcher covers everything except static assets.

### Phase 4 – “Forbidden” JSON parse error

**Symptom**  
Signup returned `Unexpected token 'F', "Forbidden" is not valid JSON`.

**Cause**  
Middleware returned plain-text `Forbidden` (403) because the secret header was missing. The frontend tried to parse it as JSON.

**Root cause**  
The Cloudflare Transform Rule had been created as a **Response Header** rule instead of a **Request Header** rule. Response rules only affect what Cloudflare sends back to the browser; they never inject the header into the request that reaches Vercel.

**Fix**  
Deleted the Response Header rule and created the correct **Request Header Transform Rule** that sets `x-mediacrater-proxy-secret` to the secret value on the production hostname.

After the correct rule was in place the header arrived, the middleware allowed the request, and signup succeeded.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Users locked out of signup / signin after enabling CAPTCHA | Routes self-verified the Turnstile token then passed nothing to Supabase | Removed self-verification and passed `captchaToken` |
| 2 | Service-role clients on resend / reset | Admin client bypasses Supabase CAPTCHA | Switched to anon client |
| 3 | `Unexpected token 'F', "Forbidden" is not valid JSON` | Middleware returned plain-text 403; frontend expected JSON | Fixed the Cloudflare rule type (see below) |
| 4 | Origin secret not arriving at Vercel | Created a **Response** Header Transform Rule instead of a **Request** Header rule | Re-created as Request Header Transform Rule |
| 5 | Confusion about secret name | Documentation used `CF_ORIGIN_SECRET` / `x-origin-secret` | Updated all code to the names already in the project |

---

## 6. Corrections / important decisions

1. **Tokens are single-use** – never call `verifyTurnstileToken` and then hand the same token to Supabase.
2. **Service-role bypasses CAPTCHA** – any user-facing auth action that must be protected by CAPTCHA must use the anon client.
3. **Origin secret must be a Request Header rule** – Response Header rules are useless for this purpose.
4. **Reuse existing names** – the project already had `x-mediacrater-proxy-secret` and `CLOUDFLARE_PROXY_SECRET`; inventing new names would have created drift.
5. **Middleware order** – secret check first, then device-cookie logic.

---

## 7. Open items checklist

### Confirm immediately

- [ ] All four routes are deployed to production.
- [ ] Supabase CAPTCHA is still set to **Turnstile** (not hCaptcha or disabled).
- [ ] Cloudflare Request Header Transform Rule is enabled and scoped to the exact production hostname.
- [ ] `CLOUDFLARE_PROXY_SECRET` exists in Vercel for both Production and Preview environments.
- [ ] Frontend resets the Turnstile widget after every failed / successful attempt.

### Quick verification commands

```bash
# Must return 403
curl -sI https://YOUR_PROJECT.vercel.app/api/signin

# Must succeed (or return a normal auth error, not 403)
curl -sI https://your-real-domain.com/api/signin
```

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
| Origin-secret header | `x-mediacrater-proxy-secret` |
| Origin-secret env var | `CLOUDFLARE_PROXY_SECRET` |
| Cloudflare rule type | **Request** Header Transform Rule (not Response) |
| Supabase CAPTCHA provider | Turnstile |
| Auth routes | `/api/signup`, `/api/signin`, `/api/resend-verification`, `/api/auth/reset-password` |
| Middleware file | `middleware.ts` (project root or `src/`) |

---

## Appendix A – Final middleware.ts

```ts
// middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { attachDeviceCookie, readOrMintDeviceId } from '@/lib/account-device';

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images).*)',
  ],
};

export function middleware(req: NextRequest) {
  // 1. Origin-secret check (blocks direct *.vercel.app access)
  const secret = process.env.CLOUDFLARE_PROXY_SECRET;
  if (secret && req.headers.get('x-mediacrater-proxy-secret') !== secret) {
    if (req.nextUrl.pathname.startsWith('/api/')) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  // 2. Device cookie (existing logic)
  const { deviceId, minted } = readOrMintDeviceId(req);
  const res = NextResponse.next();
  if (minted) {
    attachDeviceCookie(res, deviceId);
  }
  return res;
}
```

---

## Appendix B – Final auth route patterns

All four routes now follow the same pattern:

1. Parse body → require `email` (and `password` / `turnstileToken` as appropriate).
2. Early exit if `!turnstileToken`.
3. Rate-limit by IP.
4. Call Supabase **anon** client and pass `captchaToken: turnstileToken`.
5. Map any captcha-related error to a clean “Verification failed” message.
6. Never call `verifyTurnstileToken` yourself.

**Resend example (final form):**

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

**Reset-password example (final form):**

```ts
const { error: resetError } = await supabaseAnon.auth.resetPasswordForEmail(email, {
  captchaToken: turnstileToken,
  redirectTo: `${new URL(req.url).origin}/auth/update-password`,
});
```

(The full signup and signin replacements were provided earlier in the conversation and follow the identical pattern.)

---

*End of index.  
Conversation: https://grok.com/c/5ce1a967-c6ed-4894-bed4-17a43b35823e?rid=95a9ca06-b240-4f43-89d0-86b7b7e3f600*
