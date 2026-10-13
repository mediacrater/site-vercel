# Test Site Protection: Noindex Header, HTTP Basic Auth Password, and the Cached-Homepage Scare

| | |
|---|---|
| **Date** | 13 October 2026 (`13oct26`) |
| **Destination** | changelogs/site |
| **Conversation** | _(add this chat's link)_ |
| **Related prior work** | `free-seo-tools-roas-rejection-metadata-13oct26.md` (same day, companion file: the free tools and site SEO fixes) |
| **Stack** | Next.js 16 `middleware.ts` on Vercel (shown in the build output as `ƒ Proxy (Middleware)`), `next.config.mjs` security headers. Test repo `mediacrater/test-site-vercel`. A drift monitor copies files between live and test |
| **Starting trigger** | The public test site could be indexed by Google as a duplicate of mediacrater.com. You then asked for a browser password on the whole test site |

> **Redaction note:** No usernames, passwords or test-site domains are included. `<your-test-domain>` stands in for the test site's address.

**How to read the status marks in this file:** ✅ = done and you reported or verified it, or I saw it in the test repo. ⚠️ = advised, but I can't confirm it was applied. ⏳ = open. Where something wasn't confirmed, the **expected output** is given.

---

## Contents

1. [Summary](#1-summary)
2. [Status at a glance](#2-status-at-a-glance)
3. [Starting point](#3-starting-point)
4. [Timeline: what we did, in order](#4-timeline-what-we-did-in-order)
5. [Errors and surprises](#5-errors-and-surprises)
6. [Corrections / important decisions](#6-corrections--important-decisions)
7. [Open items checklist](#7-open-items-checklist)
8. [LIVE: what to port and what never to set](#8-live-what-to-port-and-what-never-to-set)
9. [Reference: key settings](#9-reference-key-settings)
10. [Appendix A – middleware.ts (final)](#appendix-a--middlewarets-final)
11. [Appendix B – NOINDEX header in next.config.mjs](#appendix-b--noindex-header-in-nextconfigmjs)
12. [Appendix C – Verification and troubleshooting commands](#appendix-c--verification-and-troubleshooting-commands)
13. [Appendix D – Rollback and maintenance](#appendix-d--rollback-and-maintenance)

---

## 1. Summary

The test site now asks for a username and password before it serves anything. A request without the right login gets a real **401** from the server, so crawlers can't read or index it. A `noindex` header is also in place as a second layer.

**Main outcomes**

- **Password protection lives in `middleware.ts`** (HTTP Basic Auth). It switches on **only when both `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` are set**, so the same file is harmless on live.
- **Credentials are compared in constant time** (no timing leak). The 401 response also sends `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`.
- **`/api/csp-report` is exempt** (browsers send CSP reports without the login). It's still protected by the existing proxy-secret check.
- **Existing middleware behaviour is unchanged:** the `/api/` proxy-secret check and the device cookie.
- **`next.config.mjs` adds `X-Robots-Tag: noindex, nofollow`** to every response **only when `NOINDEX=true`**. Default is indexable, so forgetting the variable can never deindex live.
- **I tested the middleware in my sandbox:** no login, an empty login and a wrong password all returned 401; the right login returned 200.
- **The scare:** right after enabling, an empty "Sign in" seemed to let you through. The server code was correct; a cached copy of the homepage was most likely being served. It resolved itself within a short while.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| `middleware.ts` with Basic Auth (Appendix A) | ✅ Done | Seen in repo, commit `aabd940` |
| `vendor` excluded from the matcher | ✅ Done | Commit `93d3201` (needed by the metadata tool's engine file) |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` on the **test** Vercel project | ✅ Working | You reported the prompt appears and the login works |
| Strong password saved in a password manager | ⚠️ Advised | 20+ random characters |
| Variables **absent** on the **live** project | ⚠️ Can't confirm | Check in Vercel → live project → Settings → Environment Variables |
| `curl -sI https://<your-test-domain>/` returns 401 | ⚠️ Not reported | **Expected:** first line `HTTP/2 401`, with `www-authenticate: Basic realm="Mediacrater test", charset="UTF-8"` |
| NOINDEX code in `next.config.mjs` (Appendix B) | ✅ Done | Seen in repo, placed after the `securityHeaders` array (the build passes) |
| `NOINDEX=true` on the **test** project | ⚠️ Can't confirm | **Expected:** once logged in, response headers include `x-robots-tag: noindex, nofollow` |
| Cached-homepage issue | ✅ Resolved | It cleared itself. The cause (Cloudflare or browser cache) wasn't confirmed |
| Cloudflare "Bypass cache" rule for the test hostname | ⏳ Optional | Only if the issue comes back and `cf-cache-status: HIT` shows on the page itself |
| Search Console removal of already-indexed test URLs | ⏳ Optional | Only if the test site was indexed before; the 401 drops pages over time anyway |

---

## 3. Starting point

- The test site is a separate Vercel project from the GitHub repo `mediacrater/test-site-vercel`. It was publicly reachable, so Google could index it as a duplicate of mediacrater.com.
- `middleware.ts` already ran on almost every request. It returned 403 for `/api/` calls without the Cloudflare proxy secret, and set a device cookie.
- Your CSP references Cloudflare (Turnstile, Insights), and live API traffic goes through a Cloudflare proxy. Whether the **test** domain is also behind Cloudflare wasn't confirmed.
- The pasted Basic Auth instructions (from another assistant) were for **Apache (`.htaccess`) and Nginx**. Neither applies to Vercel.

---

## 4. Timeline: what we did, in order

### Phase 1 – Noindex header for the test site

- **The idea:** the test site, while public, could be indexed as a duplicate of live. I proposed an `X-Robots-Tag: noindex, nofollow` header, switched on by a `NOINDEX=true` variable set **only on the test project**.
- **Design choice:** the default is *indexable*, so if someone forgets the variable on live, nothing breaks. The opposite design (noindex unless `SITE_ENV=production`) was rejected, because forgetting the variable there would deindex live.
- Code: [Appendix B](#appendix-b--noindex-header-in-nextconfigmjs).

### Phase 2 – `SyntaxError: Unexpected token 'if'`

- **The error:**
  ```
  > Build error occurred
  SyntaxError: Unexpected token 'if'
  Error: Command "next build" exited with 1
  ```
- **Cause:** the `if (process.env.NOINDEX === 'true') { … }` block was pasted **inside** the `securityHeaders = [ … ]` array, before its closing `];`. An array can only hold values, not statements.
- **Fix:** move the block below the array's `];`, above the existing `if (isProductionBuild && cspMode !== 'off')` block. It's now in the right place (seen in repo).

### Phase 3 – Choosing Basic Auth on Vercel

You asked for a browser password. The Apache and Nginx snippets don't apply to Vercel, which left two options:

| Option | Cost | How it works |
|---|---|---|
| Vercel Deployment Protection → Vercel Authentication | Free | Visitors log in with a **Vercel account**, not a shared password |
| Vercel Password Protection | Paid add-on | Shared password, managed by Vercel |
| **Basic Auth in `middleware.ts` (chosen)** | Free | Any username and password you set; a real 401 for everyone else |

### Phase 4 – The middleware

- Full file: [Appendix A](#appendix-a--middlewarets-final).
- **What it does:**
  - **Switch:** it's active only when both variables are set.
  - **Login check:** it decodes the `Authorization: Basic …` header and compares username and password in constant time. It always checks both, so timing doesn't reveal which one was wrong.
  - **Rejection:** otherwise it returns 401 with `WWW-Authenticate`, `X-Robots-Tag` and `Cache-Control: no-store`.
- **Kept from before:** the proxy-secret check and device cookie, unchanged.
- **Exempt:** `/api/csp-report`.
- **Not covered by the middleware:** `/_next/static`, `/_next/image`, `favicon.ico`, `/images` and `/vendor` skip it, so they stay public. They hold no page content.
- **Setup you did:**
  1. Replaced `middleware.ts`.
  2. Generated a password.
  3. Added `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` to the test project for all environments.
  4. Pushed, so a new deployment picked the variables up.

### Phase 5 – "Empty sign-in takes me to the homepage"

- **What you saw:** the browser's login box appeared, but clicking **Sign in** with empty fields loaded the homepage.
- **I confirmed the code was in your repo unchanged,** then built your site in my sandbox with the password on and tested it with curl:

  | Login sent | Result |
  |---|---|
  | none | 401 |
  | empty (`:`) | 401 |
  | right user, wrong password | 401 |
  | right user and password | 200 |
  | `/tools/break-even-roas-calculator` with no login | 401 |

- **Conclusion:** the page was reaching you without your server being asked. The likely cause was a cached copy of the homepage, in Cloudflare (if the test domain is proxied and caches HTML) or in the browser. A background request then hit the server, got the 401, and triggered the prompt over a page that had already loaded.
- **Diagnosis steps given:** DevTools → Network with Preserve log, check the first row's status and its `cf-cache-status` / `x-vercel-cache` / `age` headers, and find the 401 row. Alternatively, `curl -sI https://<your-test-domain>/`.

### Phase 6 – Resolved, and "refresh doesn't prompt"

- **It fixed itself after a short wait,** consistent with a cached copy expiring. The exact cache wasn't identified.
- **No prompt on refresh is normal Basic Auth behaviour.** After one successful login the browser resends the credentials automatically until the browser is fully closed. There's no logout.
- **To see the prompt again:** open a new private window, or fully quit and reopen the browser. To check from outside the browser, use `curl -sI`.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | `SyntaxError: Unexpected token 'if'` in `next build` | NOINDEX `if` block pasted inside the `securityHeaders` array | Moved below the array's `];` |
| 2 | Pasted instructions used `.htaccess` / Nginx | Written for traditional servers | Basic Auth in `middleware.ts` instead |
| 3 | Empty "Sign in" loaded the homepage | Most likely a cached homepage (Cloudflare or browser); the server code was verified correct | Cleared itself; diagnosis steps and a Cloudflare bypass rule documented |
| 4 | Refresh doesn't ask for the password again | Browsers remember Basic Auth credentials until fully closed | Expected; test with a new private window |

---

## 6. Corrections / important decisions

### Decisions

1. **Basic Auth in middleware**, not Vercel's paid password feature.
2. **Both protections are switched on by environment variables**, so identical code can live in both repos (the drift monitor copies files):
   - `BASIC_AUTH_USER` + `BASIC_AUTH_PASSWORD`: password on
   - `NOINDEX=true`: noindex header on
3. **The default is open and indexable.** A missing variable can never lock out or deindex live.
4. **`/api/csp-report` is exempt** from the password; it keeps the proxy-secret check.
5. **Keep `NOINDEX=true` together with the password** on test. It protects you if the password variables are ever removed.

### Notes on my advice

- I suggested `X-Robots-Tag` before the password existed. With a 401 in place, crawlers never see that header, so it's now the backup layer, not the main one.
- I didn't know whether the test domain is behind Cloudflare. The Cloudflare fix is given as conditional.

---

## 7. Open items checklist

- [ ] **Check the live project's variables.** In Vercel, open the **live** project → Settings → Environment Variables. `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` and `NOINDEX` must **not** exist.
- [ ] **Check the test project's `NOINDEX`.** It should be `true`. **Expected** (logged in, DevTools → page request → Response Headers): `x-robots-tag: noindex, nofollow`.
- [ ] **Run the curl matrix** in [Appendix C](#appendix-c--verification-and-troubleshooting-commands) against the real test domain.
- [ ] **Save the password** in a password manager.
- [ ] **Webhook routes.** If you ever add one (e.g. Stripe) to the test site, add its path to the exemption next to `/api/csp-report`, or it gets a 401.
- [ ] **Only if the cached-homepage issue returns:** add the Cloudflare bypass rule (Appendix C).
- [ ] **Only if test pages were already indexed:** Search Console → Removals for the test domain's property.

---

## 8. LIVE: what to port and what never to set

**Safe to have on live (inert without the variables):**
- The `middleware.ts` in [Appendix A](#appendix-a--middlewarets-final). Without `BASIC_AUTH_*` set, it behaves exactly like the old middleware. The `vendor` matcher exclusion is needed on live anyway for the metadata tool.
- The NOINDEX block in `next.config.mjs` ([Appendix B](#appendix-b--noindex-header-in-nextconfigmjs)). It does nothing unless `NOINDEX=true`.

**Never set on live:**

| Variable | What happens if it's set on live |
|---|---|
| `BASIC_AUTH_USER` + `BASIC_AUTH_PASSWORD` | Every visitor and Google get a password prompt. The site drops out of search and nobody can sign up |
| `NOINDEX=true` | Google drops every page from search |

**Steps when porting:**
1. Copy `middleware.ts` and the NOINDEX block to live, or confirm the drift monitor already did.
2. Open the live Vercel project → Settings → Environment Variables and confirm none of the three variables exist.
3. Deploy, then run `curl -sI https://mediacrater.com/`. **Expected:** `HTTP/2 200` and **no** `x-robots-tag` header.

---

## 9. Reference: key settings

| Setting | Test project | Live project |
|---|---|---|
| `BASIC_AUTH_USER` | Your chosen username | **Not set** |
| `BASIC_AUTH_PASSWORD` | 20+ random characters | **Not set** |
| `NOINDEX` | `true` | **Not set** |
| Realm shown in the prompt | `Mediacrater test` | n/a |
| Paths outside the middleware | `/_next/static`, `/_next/image`, `favicon.ico`, `/images`, `/vendor` | Same |
| Password-exempt path | `/api/csp-report` | n/a |

Environment-variable changes only apply to **new** deployments. Redeploy after changing them.

---

## Appendix A – middleware.ts (final)

Exactly as in the test repo at `eb36cba`.

```ts
//middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { attachDeviceCookie, readOrMintDeviceId } from '@/lib/account-device';

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images|vendor).*)',
  ],
};

// ---------------------------------------------------------------------------
// Password protection (HTTP Basic Auth) for the TEST site only.
// Active ONLY when both BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are set.
// Never set these on the live project, or visitors and Google get locked out.
// ---------------------------------------------------------------------------

/** Compares two strings in constant time, so response timing can't leak the password. */
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function hasValidCredentials(req: NextRequest, user: string, password: string): boolean {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Basic ')) return false;
  try {
    const decoded = atob(header.slice(6));
    const split = decoded.indexOf(':');
    if (split < 0) return false;
    // Check both, always, so timing doesn't reveal which one was wrong.
    const userOk = safeEqual(decoded.slice(0, split), user);
    const passwordOk = safeEqual(decoded.slice(split + 1), password);
    return userOk && passwordOk;
  } catch {
    return false; // malformed header
  }
}

export function middleware(req: NextRequest) {
  const authUser = process.env.BASIC_AUTH_USER;
  const authPassword = process.env.BASIC_AUTH_PASSWORD;
  const { pathname } = req.nextUrl;

  // Browsers send CSP violation reports without the login, so that one endpoint
  // stays open. It's still protected by the proxy-secret check below.
  if (authUser && authPassword && pathname !== '/api/csp-report') {
    if (!hasValidCredentials(req, authUser, authPassword)) {
      return new NextResponse('Authentication required', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Basic realm="Mediacrater test", charset="UTF-8"',
          'X-Robots-Tag': 'noindex, nofollow',
          'Cache-Control': 'no-store',
        },
      });
    }
  }

  const secret = process.env.CLOUDFLARE_PROXY_SECRET;

  if (pathname.startsWith('/api/')) {
    const misconfigured = !secret && process.env.VERCEL_ENV === 'production';
    if (misconfigured || (secret && req.headers.get('x-mediacrater-proxy-secret') !== secret)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const { deviceId, minted } = readOrMintDeviceId(req);
  const res = NextResponse.next();
  if (minted) attachDeviceCookie(res, deviceId);
  return res;
}
```

---

## Appendix B – NOINDEX header in next.config.mjs

The block sits **after** the closing `];` of `securityHeaders` and **before** the CSP block:

```js
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

// Set NOINDEX=true ONLY on the test/staging Vercel project.
// Default is indexable, so forgetting the variable can never deindex production.
if (process.env.NOINDEX === 'true') {
  securityHeaders.push({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
}

if (isProductionBuild && cspMode !== 'off') {
  securityHeaders.push({
    key: cspMode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    value: buildCsp(),
  });
}
```

---

## Appendix C – Verification and troubleshooting commands

### Curl matrix (run against the test site)

```
curl -s -o /dev/null -w "%{http_code}\n" https://<your-test-domain>/
curl -s -o /dev/null -w "%{http_code}\n" -u ":" https://<your-test-domain>/
curl -s -o /dev/null -w "%{http_code}\n" -u "<user>:wrong" https://<your-test-domain>/
curl -s -o /dev/null -w "%{http_code}\n" -u "<user>:<password>" https://<your-test-domain>/
curl -sI https://<your-test-domain>/
```
**Expected:** `401`, `401`, `401`, `200`. The last command's first line is `HTTP/2 401`, with `www-authenticate: Basic realm="Mediacrater test", charset="UTF-8"` and `x-robots-tag: noindex, nofollow`.

Your shell history may keep the real password from the fourth command. Clear it afterwards, or test the right login in a private browser window instead.

### Browser checks

- **New private window → test site:** the login prompt appears.
- **Cancel:** the page shows "Authentication required".
- **Right login:** the site works normally, including signup, sign-in, tools and scans.

### If an empty login seems to let you in again

1. In a private window, open DevTools → **Network** and tick **Preserve log**, then visit the site.
2. Click the **first row** (the page itself):
   - status `200` means it came from a cache
   - check `cf-cache-status`, `x-vercel-cache` and `age`
3. Find the `401` row. That's the request that raised the prompt.
4. **If `cf-cache-status: HIT`:**
   - Cloudflare → test domain → **Caching** → **Cache Rules** → **Create rule**. Condition: **Hostname** equals your test hostname. Action: **Bypass cache**.
   - Then **Purge Everything**. If live and test share a zone, use **Custom Purge** with the test hostname instead.
5. **If `x-vercel-cache: HIT`** on a page that should be a 401: investigate separately. The middleware runs before Vercel's cache, so this shouldn't happen.

### What I ran in my sandbox (not on your machines)

```
npx next build      # test repo with next/font stubbed and dummy env vars
BASIC_AUTH_USER=admin BASIC_AUTH_PASSWORD=s3cretpass npx next start -p 3123
curl -s -o /dev/null -w "%{http_code}" http://localhost:3123/                       # 401
curl -s -o /dev/null -w "%{http_code}" -u ":" http://localhost:3123/                 # 401
curl -s -o /dev/null -w "%{http_code}" -u "admin:wrong" http://localhost:3123/       # 401
curl -s -o /dev/null -w "%{http_code}" -u "admin:s3cretpass" http://localhost:3123/  # 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3123/tools/break-even-roas-calculator  # 401
```
(The `admin` / `s3cretpass` values were throwaway sandbox values, not yours.)

---

## Appendix D – Rollback and maintenance

### Turn the password off temporarily

1. Delete `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` from the test project.
2. Redeploy.

The site is public again. Keep `NOINDEX=true` so it still isn't indexed.

### Change the password

1. Update `BASIC_AUTH_PASSWORD` in the test project.
2. Redeploy.
3. Fully close the browser so it forgets the old credentials.

### Remove the feature completely

Restore the previous `middleware.ts` (the version without the Basic Auth section; keep the `vendor` matcher exclusion), then delete the two variables.

### Routine

- Whenever you add API routes that outside services call, add them to the exemption.
- Every time you create or reconfigure a Vercel project, confirm that live has none of the three variables.

---

*End of index.  
Conversation: (add this chat's link)*
