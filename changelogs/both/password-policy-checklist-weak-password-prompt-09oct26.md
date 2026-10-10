# Password Policy: 10+ Characters, Live Checklist, Supabase Enforcement & Weak-Password Prompt

| | |
|---|---|
| **Date** | 9 October 2026 (`09oct26`) |
| **Destination** | changelogs/both |
| **Conversation** | https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d |
| **Related prior work** | `security-review-phase1-vps-lockdown-07oct26.md` (Phases 6 and 8 in its plan)<br>`email-typo-prevention-popup-domain-check-09oct26.md` (same day; this file's sign-up page builds on it) |
| **Stack** | Next.js web app on Vercel (`lib/password-policy.ts`, `components/password-checklist.tsx`, sign-up, sign-in, reset dialog, `/api/signup`, `/api/signin`), Supabase Auth (**separate TEST and LIVE projects**) |
| **Starting trigger** | You wanted the password minimum raised from 6 to 10, enforced on the server, with a checklist that turns green as the user types, without locking out existing users |

> **Redaction note:** no secrets, keys, IP addresses, user IDs, passwords or email addresses are included.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied (expected output is given). ⏳ = open.

> **This replaces Phases 6 and 8 of the security review plan.** You clarified that "password-reset link" meant enforcing the password rules on the server, which this covers together with Phase 8 (where to set the minimum in Supabase).

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
9. [Appendix A – `lib/password-policy.ts`](#appendix-a--libpassword-policyts)
10. [Appendix B – `components/password-checklist.tsx`](#appendix-b--componentspassword-checklisttsx)
11. [Appendix C – Changes to existing files](#appendix-c--changes-to-existing-files)
12. [Appendix D – Supabase settings](#appendix-d--supabase-settings)

---

## 1. Summary

**Option B** was chosen: Supabase itself enforces every rule on every path (sign-up, password reset, password change), and the page shows the same rules as a live checklist.

**The rules:**
- at least 10 characters
- a lowercase letter, an uppercase letter, a number and a special character (counted exactly as Supabase counts them)
- spaces allowed, but not at the start or end
- at most 72 bytes (bcrypt's limit)

**Main outcomes**

- **Checklist** under the password field on sign-up and on the password-reset dialog. Each item turns green with a ✓ as it's met; "Passwords match" is the last row; the leading/trailing-space and too-long rules only appear, in red, when broken. The submit buttons stay disabled until everything passes.
- **`/api/signup` refuses a password that fails the rules**, so skipping the page doesn't help.
- **Existing users still sign in with their old passwords.** Supabase only checks rules when a password is *set*. `/api/signin` now also returns `weakPassword: true` for those accounts, and the sign-in page then shows **"Time to update your password"** with new-password fields, the checklist, **Update password** and **Not now, continue to dashboard**. It reappears at every sign-in until the password is updated.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| New files + changed pages and routes on TEST | ✅ "It works" | |
| Supabase TEST settings (min 10 + lower/upper/digits/symbols) | ⚠️ Not explicitly confirmed | Expected: Authentication → Sign In / Providers → Email shows min length 10 and "Lowercase, uppercase letters, digits and symbols" |
| Leaked-password protection | ⚠️ Plan-dependent | Expected: on, if your Supabase plan offers it |
| Weak-password prompt (old 6-character account) | ✅ Part of "it works" | Expected each sign-in until updated |
| LIVE (code, then Supabase settings) | ⚠️ Not confirmed | Same order as TEST |

---

## 3. Starting point

- Sign-up and the reset dialog checked `password.length < 6` in the browser only; Supabase's minimum was 6.
- Password resets go **straight from the browser to Supabase** (`VerificationDialog` → `PUT /auth/v1/user`), not through your API. Only Supabase's own settings apply to that path.
- Settings has no password-change form.
- Sign-in goes through `/api/signin`, which returns the session; the page then calls `supabase.auth.setSession()`.

---

## 4. Timeline: what we did, in order

### Step 1 – Your requirements and my pushback

You asked for: 10 characters, no spaces, at least one special character "excluding ones that mess up the encrypted password varchar string", at least one number, green-as-you-type checklist items, and a plan for existing users.

My pushback:
1. **No special characters need excluding.** Supabase stores a bcrypt hash, never the text. The real limit is **72 bytes**.
2. **Spaces:** current guidance (NIST) recommends allowing them (passphrases), and advises against forced character rules (they push people toward `Password1!`).
3. **"Number + symbol" isn't one of Supabase's presets**, and resets bypass your API. So either (A) Supabase enforces letters and digits, and only sign-up adds the symbol rule, or (B) Supabase enforces lower, upper, digits and symbols everywhere.
4. **Existing users:** Supabase never checks rules at sign-in, so nobody is locked out.

### Step 2 – Your decisions

- **B**
- **Spaces allowed** (except leading or trailing)
- **A gentle prompt at every sign-in** for weak passwords

### Step 3 – Implementation and tests

| File | Change |
|---|---|
| `lib/password-policy.ts` (new) | The rules; `checkPassword()`, `isPasswordValid()` |
| `components/password-checklist.tsx` (new) | The live list (`aria-live`, screen-reader "done/not yet") |
| `app/signup/page.tsx` | Checklist under the password field; `isPasswordValid` replaces `length < 6`; submit disabled until valid and matching; `autoComplete="new-password"` |
| `components/verification-dialog.tsx` | Same checklist and rule on the reset form |
| `app/api/signup/route.ts` | Server-side `isPasswordValid` check before the rate limit |
| `app/api/signin/route.ts` | Returns `weakPassword: supabaseFlaggedWeak \|\| !isPasswordValid(password)` |
| `app/signin/page.tsx` | "Time to update your password" dialog with inline update (`supabase.auth.updateUser`) |

Sandbox results:
- **Rules:** 11 sample passwords classified correctly (passphrase with spaces, leading/trailing spaces, quotes and backslashes, non-English letters, the 72-byte limit).
- **`/api/signup`:** `secret`, `abcdefghij1!` and a leading space were refused; `Abcdefghij1!` was accepted.
- **`/api/signin`:** `secret` → `weakPassword: true`; `Abcdefghij1!` → `false`.
- **Type checker:** caught one error in the checklist component (an item type), fixed. Your build skips type errors (`ignoreBuildErrors`), so it was run separately.

### Step 4 – Deployment

Order: code first, then Supabase settings, so new users never see Supabase's error under an old "at least 6 characters" page. You confirmed it works on TEST.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Worry about characters breaking the stored password | Passwords are hashed, never stored as text | No exclusions; 72-byte limit instead |
| 2 | Your exact rule set isn't a Supabase preset | Supabase offers fixed presets | Option B (adds upper and lowercase) |
| 3 | Resets bypass your API | The reset dialog talks to Supabase directly | Supabase settings enforce the rules there |
| 4 | Type error in `password-checklist.tsx` | The "Passwords match" row isn't a rule ID | Explicit item type |

---

## 6. Corrections / important decisions

1. **Option B,** so the server enforces exactly what the checklist shows, everywhere.
2. **The checklist counts letters and symbols exactly as Supabase does** (plain a–z/A–Z and Supabase's symbol set), so a password that passes the checklist also passes Supabase.
3. **The weak-password prompt updates the password inline**, because Settings has no password form and the user has just signed in (no re-authentication needed).
4. **Supabase's length check counts bytes; the checklist counts characters.** Characters ≤ bytes, so passing the checklist always passes Supabase.

**Known limit:** the old Host-header-based reset link (`/api/auth/reset-password` building `redirectTo` from the request) is effectively neutralised by your Supabase Redirect URL allow list (only `/verified` and `/db`), but still uses the request's host. Low priority.

---

## 7. Open items checklist

- [ ] Confirm the TEST Supabase settings (Appendix D)
- [ ] Turn on leaked-password protection if your plan offers it
- [ ] LIVE: add the two new files, replace the five changed files, wait for **Ready**, then change LIVE Supabase's settings
- [ ] LIVE tests: sign-up checklist, reset with checklist, old account → prompt → **Not now** → prompt again next sign-in → update → no prompt
- [ ] Later: a password-change form in Settings

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Minimum | 10 characters (`PASSWORD_MIN_LENGTH`) |
| Maximum | 72 bytes (`PASSWORD_MAX_BYTES`) |
| Required | lowercase a–z, uppercase A–Z, digit 0–9, a symbol from ``!@#$%^&*()_+-=[]{};'\:"\|<>?,./`~`` |
| Spaces | Allowed; not at the start or end |
| Weak-password signal | `/api/signin` → `weakPassword` (your rules or Supabase's own flag) |
| Final files | `lib/password-policy.ts`, `components/password-checklist.tsx`, `app/signup/page.tsx`, `components/verification-dialog.tsx`, `app/signin/page.tsx`, `app/api/signup/route.ts`, `app/api/signin/route.ts` |

---

## Appendix A – `lib/password-policy.ts`

```ts
// lib/password-policy.ts
//
// The password rules, shared by the sign-up page, the password-reset dialog
// (both show them as a live checklist) and the server (/api/signup,
// /api/signin). Keep this file and the Supabase setting in sync:
//
//   Supabase → Authentication → (Sign In / Providers →) Email:
//     Minimum password length: 10
//     Password requirements: "Lowercase, uppercase letters, digits and symbols"
//
// Supabase enforces those on EVERY path (sign-up, reset, password change),
// so the checklist only has to make the rules visible.
//
// Notes:
// - Any character is safe. Supabase stores a bcrypt hash, never the text.
// - bcrypt only uses the first 72 BYTES, so longer passwords are refused.
//   Accented letters and emoji take 2–4 bytes each.
// - Spaces are allowed (passphrases), but not at the start or end, where they
//   are invisible and cause "wrong password" confusion at sign-in.
// - Letters and symbols are counted exactly like Supabase counts them: plain
//   a–z / A–Z, and this symbol set. Accented letters or "€" don't count.

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 72;

// Supabase Auth's symbol set for the "...and symbols" requirement.
const SYMBOLS = `!@#$%^&*()_+-=[]{};'\\:"|<>?,./\`~`;

export type PasswordRuleId =
  | 'length'
  | 'lowercase'
  | 'uppercase'
  | 'number'
  | 'symbol'
  | 'edges'
  | 'maxBytes';

export type PasswordRule = {
  id: PasswordRuleId;
  label: string;
  /** Rules that only matter when broken are hidden until they fail. */
  showOnlyWhenFailing?: boolean;
  test: (password: string) => boolean;
};

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (p) => Array.from(p).length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'lowercase',
    label: 'At least one lowercase letter (a–z)',
    test: (p) => /[a-z]/.test(p),
  },
  {
    id: 'uppercase',
    label: 'At least one uppercase letter (A–Z)',
    test: (p) => /[A-Z]/.test(p),
  },
  {
    id: 'number',
    label: 'At least one number',
    test: (p) => /[0-9]/.test(p),
  },
  {
    id: 'symbol',
    label: 'At least one special character (e.g. ! @ # $ %)',
    test: (p) => Array.from(p).some((c) => SYMBOLS.includes(c)),
  },
  {
    id: 'edges',
    label: 'No space at the start or end',
    showOnlyWhenFailing: true,
    test: (p) => p === p.trim(),
  },
  {
    id: 'maxBytes',
    label: 'Too long (maximum 72 characters, fewer with accents or emoji)',
    showOnlyWhenFailing: true,
    test: (p) => utf8Length(p) <= PASSWORD_MAX_BYTES,
  },
];

export function checkPassword(password: string) {
  const results = PASSWORD_RULES.map((rule) => ({
    ...rule,
    passed: rule.test(password),
  }));
  return {
    results,
    valid: results.every((r) => r.passed),
  };
}

export function isPasswordValid(password: unknown): password is string {
  return typeof password === 'string' && checkPassword(password).valid;
}
```

---

## Appendix B – `components/password-checklist.tsx`

```tsx
// components/password-checklist.tsx
//
// Live password requirements list: each item turns green as it's met.
// Rules come from lib/password-policy.ts, the same rules the server uses.

'use client';

import { checkPassword } from '@/lib/password-policy';

type Props = {
  password: string;
  /** Optional: also show whether the confirmation field matches. */
  confirmPassword?: string;
  id?: string;
};

export function PasswordChecklist({ password, confirmPassword, id }: Props) {
  const { results } = checkPassword(password);

  type Item = { key: string; label: string; passed: boolean; alwaysRed: boolean };

  const items: Item[] = results
    .filter((r) => !r.showOnlyWhenFailing || (password.length > 0 && !r.passed))
    .map((r) => ({ key: r.id, label: r.label, passed: r.passed, alwaysRed: !!r.showOnlyWhenFailing }));

  if (confirmPassword !== undefined) {
    items.push({
      key: 'match',
      label: 'Passwords match',
      passed: password.length > 0 && password === confirmPassword,
      alwaysRed: false,
    });
  }

  return (
    <ul id={id} aria-live="polite" className="mt-2 space-y-1 text-xs">
      {items.map((item) => (
        <li
          key={item.key}
          className={`flex items-start gap-1.5 transition-colors ${
            item.passed
              ? 'text-green-600 dark:text-green-400'
              : item.alwaysRed
              ? 'text-red-600 dark:text-red-400'
              : 'text-muted-foreground'
          }`}
        >
          <span aria-hidden="true" className="w-3 shrink-0 text-center">
            {item.passed ? '✓' : item.alwaysRed ? '✕' : '○'}
          </span>
          <span>
            {item.label}
            <span className="sr-only">{item.passed ? ' (done)' : ' (not yet)'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
```

---

## Appendix C – Changes to existing files

**`app/api/signup/route.ts`** (before the rate limit):
```ts
import { isPasswordValid } from '@/lib/password-policy';
// …
  if (!isPasswordValid(password)) {
    return jsonWithDevice(
      {
        error:
          'Password must be at least 10 characters and include a lowercase letter, an uppercase letter, a number and a special character, with no space at the start or end.',
      },
      400,
      deviceId
    );
  }
```

**`app/api/signin/route.ts`** (success response):
```ts
  const supabaseFlaggedWeak = Boolean((data as { weakPassword?: unknown }).weakPassword)

  return NextResponse.json(
    {
      success: true,
      session: data.session,
      weakPassword: supabaseFlaggedWeak || !isPasswordValid(password),
    },
    { headers: rateLimitHeaders }
  )
```

**`app/signin/page.tsx`:** after `setSession`, `if (json.weakPassword) { setShowWeakPasswordPrompt(true); return; }`. The dialog (`showCloseButton={false}`; closing it equals "Not now") contains the new-password and confirm fields with `<PasswordChecklist>`, an error box, **Update password** (disabled until valid and matching; calls `supabase.auth.updateUser({ password })`, then goes to `/dashboard`), and **Not now, continue to dashboard**.

**`app/signup/page.tsx`** and **`components/verification-dialog.tsx`:** `isPasswordValid(password)` replaces `password.length < 6`; `<PasswordChecklist password={…} confirmPassword={…} />` under the password field; `minLength={6}` removed; submit disabled with `!isPasswordValid(password) || password !== confirmPassword`.

---

## Appendix D – Supabase settings

In each project (**TEST, then LIVE**), after the code is deployed:

**Authentication → Sign In / Providers → Email** (the location may vary slightly):
- **Minimum password length:** `10`
- **Password requirements:** "Lowercase, uppercase letters, digits and symbols"
- **Prevent use of leaked passwords:** on, if available on your plan
- **Save**

Rollback: set the minimum back to 6 and requirements to none, and revert the web commits.

---

*End of index.  
Conversation: https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d*
