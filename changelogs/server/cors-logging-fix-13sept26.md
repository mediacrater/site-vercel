# Deployment Record: CORS Rejection Logging Fix

**Date:** 2026-09-13
**Environment:** mediacrater-api-test (VPS, test environment)
**File changed:** `server.js`
**Type:** Logging/observability fix — no functional/security behavior change

---

## Problem

`server.js` was logging every rejected CORS request as a full-stack-trace
`[UNHANDLED]` error via the global catch-all error handler at the bottom
of the file. This made routine, expected traffic look like application
crashes in the logs.

**Root cause:** the `cors()` middleware's `origin` callback throws a real
`Error('Not allowed by CORS')` for any disallowed origin. That error had
nowhere to go except the generic bottom-of-file handler, which logs
everything it catches as `[UNHANDLED]` with a full stack trace.

## Diagnosis

- Traffic causing the rejections carries an `Origin` header set to values
  not in `allowedOrigins` — consistent with automated CORS-misconfiguration
  scanners (a common, non-targeted background-noise pattern on any public
  API), not a targeted attack.
- Confirmed no real signed-in user was ever affected: `logCorsRejectionIfRealUser`
  (existing code, unchanged) verifies the request's JWT against Supabase
  before logging `[CORS-BLOCKED-REAL-USER]`, and no such log line appeared
  near the incident timestamps.
- CORS is a browser-enforced mechanism only — it does not block
  non-browser bots/scripts from reaching the API. Real protection for
  authenticated routes comes from the existing `authenticateUser` JWT
  check, which was already in place and unaffected by this issue.

## Change made

Added one new middleware in `server.js`, placed immediately after the
existing `app.use(cors(...))` block and before `logRequestOrigin`:

```js
app.use((err, req, res, next) => {
  if (err && err.message === 'Not allowed by CORS') {
    console.warn(
      `[CORS-BLOCKED] origin:${req.headers.origin || 'none'} | ip:${getClientIp(req)} | path:${req.path} | ua:${req.headers['user-agent'] || 'none'}`
    );
    return res.status(403).json({ error: 'Not allowed by CORS' });
  }
  next(err);
});
```

**Why this placement:** Express only routes an error to a 4-arg handler
registered *after* the middleware that threw it. Placing this directly
after `cors()` intercepts CORS errors specifically, before they can reach
the bottom-of-file global `[UNHANDLED]` handler, which continues to catch
genuine application errors unchanged.

**Reused existing code:** `getClientIp(req)` (already defined near the
top of `server.js`, checks `cf-connecting-ip` → `true-client-ip` →
`x-forwarded-for` → socket address) — no new IP-extraction logic added.

## Explicitly ruled out / not needed

Considered and deliberately **not** implemented, with reasoning:

- **ASN/hosting-provider lookup on blocked IPs (MaxMind GeoLite2)** —
  useful capability, but shelved for now as unnecessary for this fix's
  scope. Can be revisited later if needed.
- **Shared-secret gate on no-`Origin` requests** — investigated because
  `cors()` allows any request with no `Origin` header through
  (server-to-server calls send none). Traced all real no-origin callers:
  - Stripe: never calls into `server.js` directly (webhook lives on a
    Supabase Edge Function).
  - Supabase: this server only calls *out* to Supabase; nothing calls
    *into* `server.js` from Supabase.
  - Internal monitoring tool: runs on the same VPS and is already gated
    by its own HTTP Basic Auth (`auth()` function, separate index file)
    before it can trigger any call.

  Since no anonymous/external path relies on the `!origin` allowance,
  and a fake `Origin` header is trivial for a real attacker to set
  anyway, no additional gate was added. `allowedOrigins` and
  `authenticateUser` remain the actual security boundaries, unchanged.

## Result

- CORS rejections now log as a single `[CORS-BLOCKED]` warning line
  instead of a full stack trace under `[UNHANDLED]`.
- No change to what is allowed/blocked, no change to authentication,
  no change to `allowedOrigins`, `logCorsRejectionIfRealUser`, or the
  bottom-of-file global error handler.
