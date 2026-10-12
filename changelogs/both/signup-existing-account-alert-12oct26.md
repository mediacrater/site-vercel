# Sign-Up: "An Account With This Email Already Exists" Alert

| | |
|---|---|
| **Date** | 12 October 2026 (`12oct26`) |
| **Conversation** | https://claude.ai/chat/d4b23f41-e563-40d3-a5ba-165fd98c9a36 |
| **Related prior work** | `auth-hardening-turnstile-supabase-origin-secret-05oct26.md` (5 Oct 2026, Turnstile and the signup rate limit this relies on) |
| **Related work (same conversation)** | `server-verified-accounts-12oct26.md` (later edits to the same `/api/signup` route) |
| **Stack** | Next.js on Vercel: `app/api/signup/route.ts`, `app/signup/page.tsx`. Supabase Auth |
| **Starting trigger** | New users signing up with an email that already had an account got the normal "check your email" flow, with no hint that they should log in instead |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included.

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
9. [Appendix A – Route change](#appendix-a--route-change)
10. [Appendix B – Page change](#appendix-b--page-change)
11. [Appendix C – Test steps](#appendix-c--test-steps)

---

## 1. Summary

`/api/signup` now answers **409 `ACCOUNT_EXISTS`** when the email belongs to a confirmed account. The signup page shows an amber alert, "An account with this email already exists. Please log in to continue.", with links to **Sign in** and **Reset password**.

**Main outcomes**

- No extra database lookup. The route reuses the signal Supabase already returns for existing confirmed users (`isObfuscatedExisting`: a user object with no identities). When email confirmation is off, it also catches Supabase's `user_already_exists` error.
- The check happens **after** Turnstile (verified by Supabase inside `signUp`) and the per-IP rate limit (10 per 24 h), so testing many emails costs a captcha and a rate-limit slot each.
- The existing user's rows are never touched, and nothing else about the account is revealed.
- The alert clears as soon as the email field is edited. The Turnstile widget resets, because its token was used.
- The email is **not** put in the sign-in link, which keeps it out of browser history and server logs.
- You confirmed: **"Fix #3 looks to be working."**

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| `/api/signup` returns 409 `ACCOUNT_EXISTS` | ✅ Done | |
| Amber alert with Sign in / Reset password links | ✅ Verified | Your report |
| Alert clears when the email is edited | ⚠️ Not reported | Expected behaviour, built in |
| Behaviour for an existing **unconfirmed** account | ⚠️ Untested | To my understanding, Supabase re-sends the confirmation and shows the normal "check your email" screen |
| Production | ✅ Live | Production now runs the later version of this route (see `server-verified-accounts-12oct26.md`), which keeps this change |

---

## 3. Starting point

- `/api/signup` already computed `isObfuscatedExisting`. Supabase intentionally returns a fake-looking user for existing confirmed emails, to prevent enumeration.
- In that case the route returned success **without** touching the existing user's rows, so the page showed "check your email".

---

## 4. Timeline: what we did, in order

### Phase 1 – The security trade-off

Saying "this email has an account" lets anyone test whether an email is registered (account enumeration). OWASP's recommendation is a generic message plus an email to the account owner. Many large sites do show the message, though. I built your version with the mitigations above, and noted the OWASP-style alternative.

### Phase 2 – Route change

Three edits ([Appendix A](#appendix-a--route-change)): a shared message constant, a 409 when Supabase reports `user_already_exists` / "already registered", and a 409 when `isObfuscatedExisting` is true, placed before any profile or device writes.

### Phase 3 – Page change

`accountExists` state; set on `409` + `code === 'ACCOUNT_EXISTS'`; cleared at the start of each attempt and whenever the email field changes. The Turnstile widget resets. An amber `role="alert"` box shows above the error box ([Appendix B](#appendix-b--page-change)).

### Phase 4 – Confirmation

You reported it working.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Existing users saw "check your email" | Supabase hides existing accounts on purpose | Use its own signal (`isObfuscatedExisting`) after Turnstile and the rate limit |

---

## 6. Corrections / important decisions

### Decisions

1. **Show the message** (your choice), accepting some enumeration risk, mitigated by Turnstile and the 10-per-day per-IP limit.
2. **No extra lookup.** Reuse Supabase's response, so the captcha is always spent first.
3. **HTTP 409** with `code: 'ACCOUNT_EXISTS'`, so the page can tell it apart from other errors.
4. **No email in the sign-in URL.**

---

## 7. Open items checklist

- [x] Alert works
- [ ] Optional test: sign up again with an **unconfirmed** existing email. Expected: no amber alert, the normal "check your email" screen, and a fresh confirmation email
- [ ] Optional (stronger privacy): the OWASP alternative, which shows the generic message and emails the existing owner "someone tried to sign up with your email"

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Response | `409 { error: "An account with this email already exists. Please log in to continue.", code: "ACCOUNT_EXISTS" }` |
| Triggers | `isObfuscatedExisting`, or the Supabase error `user_already_exists` / "already registered" |
| Runs after | Turnstile (inside Supabase `signUp`) and the per-IP signup limit (10 / 24 h) |
| Page links | `/signin`, `/forgot-password` |

---

## Appendix A – Route change

```ts
const ACCOUNT_EXISTS_MESSAGE =
  'An account with this email already exists. Please log in to continue.';
```

Inside the `signUp` error handling, after the captcha branch:

```ts
    // Returned instead of an obfuscated user when email confirmation is off.
    if (
      (error as { code?: string }).code === 'user_already_exists' ||
      /already registered/i.test(error.message)
    ) {
      return jsonWithDevice(
        { error: ACCOUNT_EXISTS_MESSAGE, code: 'ACCOUNT_EXISTS' },
        409,
        deviceId
      );
    }
```

Before `let deviceRecorded = false;`:

```ts
  if (isObfuscatedExisting) {
    return jsonWithDevice(
      { error: ACCOUNT_EXISTS_MESSAGE, code: 'ACCOUNT_EXISTS' },
      409,
      deviceId
    );
  }
```

---

## Appendix B – Page change

```tsx
const [accountExists, setAccountExists] = useState(false);

// in createAccount(): at the start
setAccountExists(false);

// after reading the JSON response
if (res.status === 409 && json.code === 'ACCOUNT_EXISTS') {
  setAccountExists(true);
  resetTurnstile(); // the token was used by this request
  return;
}

// email input
onChange={(e) => {
  setEmail(e.target.value);
  setAccountExists(false);
}}
```

```tsx
{accountExists && (
  <div
    role="alert"
    className="p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-800 dark:text-amber-400"
  >
    <p className="font-semibold">An account with this email already exists.</p>
    <p className="mt-0.5">
      Please <Link href="/signin" className="font-medium underline">log in</Link> to continue.
      Forgot your password? <Link href="/forgot-password" className="font-medium underline">Reset it</Link>.
    </p>
  </div>
)}
```

---

## Appendix C – Test steps

1. Sign up with an email that already has a **confirmed** account. Expected: the amber alert with both links, and no "check your email" screen.
2. Edit the email field. Expected: the alert disappears.
3. Sign up with a new email. Expected: the normal flow, unaffected.

---

*End of index.  
Conversation: `<add this conversation's URL>`*
