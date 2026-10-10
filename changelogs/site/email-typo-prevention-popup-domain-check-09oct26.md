# Email Typo Prevention: Double-Check Popup, "Did You Mean" Suggestions & Mail-Domain Check

| | |
|---|---|
| **Date** | 9 October 2026 (`09oct26`) |
| **Destination** | changelogs/site |
| **Conversation** | https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d |
| **Related prior work** | `email-verification-resend-fixes-already-confirmed-09oct26.md` (same day: found that typos caused the repeated resends)<br>Followed by `password-policy-checklist-weak-password-prompt-09oct26.md` (same day) |
| **Stack** | Next.js web app on Vercel (`app/signup/page.tsx`, `app/api/signup/route.ts`, `lib/email-typo.ts`, `lib/email-domain.ts`), shadcn `Dialog` |
| **Starting trigger** | Resend logs showed bounces from mistyped addresses (e.g. `@gmail.copm`), followed by `Suppressed` resends. Bounces also hurt your sender reputation |

> **Redaction note:** no secrets, keys, IP addresses, user IDs or email addresses are included. Example addresses are made up.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied (expected output is given). ⏳ = open.

> **`app/signup/page.tsx` changed again the same day** (password checklist). The final file is in the password-policy index and includes everything below.

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
9. [Appendix A – `lib/email-typo.ts`](#appendix-a--libemail-typots)
10. [Appendix B – `lib/email-domain.ts`](#appendix-b--libemail-domaints)
11. [Appendix C – Sign-up route and page changes](#appendix-c--sign-up-route-and-page-changes)
12. [Appendix D – Growing the domain list later](#appendix-d--growing-the-domain-list-later)

---

## 1. Summary

Three layers now stop typos before a confirmation email is sent:

| Typo | Example | Caught by |
|---|---|---|
| Name part (before `@`) | `jhon@gmail.com` | **The popup:** "Double check if we got your email right" |
| Misspelled provider | `hotmial.com`, `gmail.copm` | **"Did you mean …?"** inside the popup (one click fixes it) |
| Domain that can't receive mail | `gmail.copm`, `outlok.con` | **Server check** in `/api/signup`: sign-up is refused |

Your real `gmail.copm` case is now caught twice. The popup was then restyled: no ✕ button, the dialog's default (wider) width, and the title on one line.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| `lib/email-typo.ts`, `lib/email-domain.ts` | ✅ TEST | |
| Popup + suggestion (`app/signup/page.tsx`) | ✅ TEST | Your screenshot showed it working with a `…@gmail.copm` test address and the `gmail.com` suggestion |
| Popup restyle (no ✕, wider, one-line title) | ✅ TEST | "That's fine for now" |
| Mail-domain check (`app/api/signup/route.ts`) | ⚠️ Not explicitly tested by you | Expected: `test@outlok.con` + "That is my email" → red "That email address can't receive mail. Please check it for typos." and nothing in Resend's log |
| "You got this wrong, change email" | ⚠️ Not explicitly confirmed | Expected: popup closes, cursor in the email field with the text selected |
| LIVE | ⚠️ Not confirmed | Expected: same behaviour |
| Popup sits left of centre in your screenshot | ⏳ Unanswered | Only if it really looks like that |

---

## 3. Starting point

- Sign-up posted straight to `/api/signup` on **Create Account**.
- The "Check your email" screen showed the address, but there was no easy way to correct it.
- Resend's log: `delivered` for most, `bounced` for typos, 2 `Suppressed` (blocked after a hard bounce).

---

## 4. Timeline: what we did, in order

### Step 1 – The plan

I proposed a domain suggestion and a "Wrong email? Start over" link. You pointed out that suggestions can't catch mistakes before the `@`, and designed a popup instead:
- title "Double check if we got your email right", with the address under it
- an underlined text button "You got this wrong, change email"
- a coloured "That is my email" button that sends the verification email

You also asked for the optional server check for domains that can't receive mail.

### Step 2 – Implementation and tests

| File | What it does |
|---|---|
| `lib/email-typo.ts` (new) | Damerau–Levenshtein distance against ~50 known providers (max distance 2 for domains of 8+ characters, else 1). Legitimate look-alikes (`mail.com`, `gmx.com`, `ymail.com`, `me.com`, `yahoo.fr`…) are listed so they're never "corrected" |
| `lib/email-domain.ts` (new) | MX lookup (2 s timeout); rejects RFC 7505 "null MX" (`example.com`); without MX, falls back to A/AAAA; DNS errors **allow** the sign-up; results cached 1 hour |
| `app/api/signup/route.ts` | After the rate limit: `checkEmailDomain(email) === 'no_mail'` → `400 "That email address can't receive mail. Please check it for typos."` |
| `app/signup/page.tsx` | Submit opens the popup; `createAccount()` runs only from "That is my email" |

Sandbox results:
- **Suggestions:** 9 typos got the right one (`gmail.copm`, `gmial.com`, `hotmial.com`, `outlok.con`, `yaho.com`, `gmai.com`, `icloud.co`, `hotmail.co`, `gmail.con`); 11 valid addresses got none.
- **Domain check:** `gmail.copm`, `outlok.con` and `example.com` were rejected before reaching Supabase; `gmail.com` signed up normally.

### Step 3 – Popup styling

From your screenshot: the ✕ shouldn't be there, and the title wrapped onto two lines.
- `showCloseButton={false}` (Escape and clicking outside still close it)
- my `sm:max-w-sm` override removed → the dialog's default `sm:max-w-lg` (512 px)
- `sm:whitespace-nowrap` on the title (it can still wrap on phones narrower than 640 px)

### Step 4 – Growing the domain list (discussed, deferred)

You suggested building a larger database of provider domains later. See [Appendix D](#appendix-d--growing-the-domain-list-later).

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Suggestions can't fix the name part | Nothing can verify a mailbox name except sending to it | Your popup makes the user re-read the address |
| 2 | ✕ button and two-line title | My first popup version | Restyled |
| 3 | Popup appears left of centre in the screenshot | Unknown (may be the screenshot) | Open question |

---

## 6. Corrections / important decisions

1. **The popup is the main defence**; suggestions and the server check are extra layers.
2. **The server check fails open:** a DNS problem never blocks a real sign-up.
3. **The check runs after the rate limit**, so it can't be used to make your server do unlimited DNS lookups (a typo uses one of the 10 sign-up attempts per IP per day).
4. **The suggestion list stays small for now** (see Appendix D).

**Known limits:**
- The Turnstile token expires after ~5 minutes; a user who leaves the popup open that long gets "Verification failed" and must redo the check.
- A typo that lands on a real, mail-receiving domain (e.g. a squatted misspelling) passes the server check; only the suggestion or the user's re-read catches it.

---

## 7. Open items checklist

- [ ] Test the domain check and "change email" on TEST (expected results in §2)
- [ ] Roll out to LIVE (`lib/email-typo.ts`, `lib/email-domain.ts`, `app/api/signup/route.ts`, final `app/signup/page.tsx`)
- [ ] Tell me if the popup really appears off-centre
- [ ] Later: grow the domain list from your own users' data (Appendix D)
- [ ] Later (separate goal): block disposable email domains to limit free-scan abuse

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Suggestion distance | ≤ 2 edits for domains of 8+ characters, else ≤ 1 |
| MX lookup | `Resolver({ timeout: 2000, tries: 1 })`, cache 1 hour (2,000 domains max), `unknown` never cached |
| Rejection message | "That email address can't receive mail. Please check it for typos." |
| Popup | Title "Double check if we got your email right"; buttons "You got this wrong, change email" and "That is my email"; `showCloseButton={false}`; default width `sm:max-w-lg` |

---

## Appendix A – `lib/email-typo.ts`

```ts
// lib/email-typo.ts
//
// Suggests a correction when an email's domain looks like a misspelling of a
// common provider ("gmial.com", "gmail.copm", "hotmial.com"). Runs in the
// browser only and never blocks sign-up: it just offers "Did you mean …?".
//
// It can't catch mistakes in the part before the @, which is why sign-up also
// shows the "Double check your email" popup and the server checks that the
// domain can receive mail.

// Domains that are correct as typed. Legitimate look-alikes (mail.com, gmx.com,
// ymail.com, me.com, mac.com) are listed so they are never "corrected".
const KNOWN_DOMAINS = [
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.ca', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.ca', 'hotmail.co.uk', 'hotmail.fr',
  'outlook.com', 'live.com', 'live.ca', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me', 'pm.me',
  'gmx.com', 'gmx.de', 'mail.com', 'zoho.com', 'yandex.com',
  'yahoo.fr', 'yahoo.de', 'hotmail.de', 'outlook.fr', 'web.de', 'orange.fr', 'free.fr', 'laposte.net',
  'videotron.ca', 'sympatico.ca', 'bell.net', 'rogers.com', 'shaw.ca',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
];

const KNOWN_SET = new Set(KNOWN_DOMAINS);

// Damerau–Levenshtein distance (insert, delete, substitute, swap neighbours).
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * Returns a corrected email ("name@gmail.com") when the domain is a likely
 * misspelling of a known provider, otherwise null.
 */
export function suggestEmailCorrection(input: string): string | null {
  const email = input.trim();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (KNOWN_SET.has(domain)) return null;

  // Short domains need a closer match, to avoid "correcting" real ones.
  const maxDistance = domain.length >= 8 ? 2 : 1;

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of KNOWN_DOMAINS) {
    if (Math.abs(candidate.length - domain.length) > maxDistance) continue;
    const distance = editDistance(domain, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (best && bestDistance > 0 && bestDistance <= maxDistance) {
    return `${local}@${best}`;
  }
  return null;
}
```

---

## Appendix B – `lib/email-domain.ts`

```ts
// lib/email-domain.ts
//
// Server-only. Checks that an email's domain can receive mail at all, so
// sign-ups with typos like "gmail.copm" or "outlok.con" are rejected before a
// confirmation email bounces (bounces hurt the domain's sending reputation,
// and Resend then suppresses the address).
//
// Fails OPEN: if DNS is slow or broken, the sign-up is allowed. Only a clear
// "this domain doesn't exist / can't receive mail" answer blocks it.

import { Resolver } from 'node:dns/promises';

export type EmailDomainResult = 'ok' | 'no_mail' | 'unknown';

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 2_000;
const cache = new Map<string, { result: EmailDomainResult; expires: number }>();

// No such domain, or the domain exists but has no records of this type.
const NOT_FOUND_CODES = new Set(['ENOTFOUND', 'ENODATA']);

function newResolver(): Resolver {
  return new Resolver({ timeout: 2_000, tries: 1 });
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const raw = email.slice(at + 1).trim().toLowerCase();
  if (!raw || raw.length > 253) return null;
  try {
    // Converts international domain names to their ASCII (punycode) form.
    const hostname = new URL(`http://${raw}`).hostname;
    return hostname.includes('.') ? hostname : null;
  } catch {
    return null;
  }
}

async function lookup(domain: string): Promise<EmailDomainResult> {
  const resolver = newResolver();
  try {
    const records = await resolver.resolveMx(domain);
    // RFC 7505 "null MX" (exchange "." or empty) means: accepts no mail.
    const usable = records.filter((r) => r.exchange && r.exchange !== '.');
    return usable.length > 0 ? 'ok' : 'no_mail';
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (!NOT_FOUND_CODES.has(code)) return 'unknown';
  }

  // No MX record: mail servers fall back to the domain's own address
  // (A/AAAA), so only reject if there's no address either.
  for (const type of ['A', 'AAAA'] as const) {
    try {
      const addresses = type === 'A' ? await resolver.resolve4(domain) : await resolver.resolve6(domain);
      if (addresses.length > 0) return 'ok';
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      if (!NOT_FOUND_CODES.has(code)) return 'unknown';
    }
  }
  return 'no_mail';
}

export async function checkEmailDomain(email: string): Promise<EmailDomainResult> {
  const domain = domainOf(email);
  if (!domain) return 'no_mail';

  const cached = cache.get(domain);
  if (cached && cached.expires > Date.now()) return cached.result;

  const result = await lookup(domain);

  // Don't cache "unknown" (a temporary DNS problem).
  if (result !== 'unknown') {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(domain, { result, expires: Date.now() + CACHE_TTL_MS });
  }
  return result;
}
```

---

## Appendix C – Sign-up route and page changes

**`app/api/signup/route.ts`** (after the rate-limit check):

```ts
import { checkEmailDomain } from '@/lib/email-domain';
// …
  if (typeof email !== 'string' || (await checkEmailDomain(email)) === 'no_mail') {
    return jsonWithDevice(
      { error: "That email address can't receive mail. Please check it for typos." },
      400,
      deviceId
    );
  }
```

**`app/signup/page.tsx`:**
- imports `suggestEmailCorrection` and the `Dialog` components
- state: `showEmailConfirm`, `emailInputRef`, `focusEmailOnClose`
- `handleSubmit` validates, then `setShowEmailConfirm(true)` instead of posting
- `handleChangeEmail` closes the popup and focuses the email field (via `onCloseAutoFocus`)
- `handleConfirmEmail` closes it and calls `createAccount()` (the old submit body)
- `ref={emailInputRef}` on the email input

Popup markup (final):

```tsx
<Dialog open={showEmailConfirm} onOpenChange={setShowEmailConfirm}>
  <DialogContent
    showCloseButton={false}
    onCloseAutoFocus={(event) => {
      if (focusEmailOnClose.current) {
        event.preventDefault();
        focusEmailOnClose.current = false;
        emailInputRef.current?.focus();
        emailInputRef.current?.select();
      }
    }}
  >
    <DialogHeader>
      {/* One line on tablet/desktop; may wrap on narrow phones. */}
      <DialogTitle className="sm:whitespace-nowrap">
        Double check if we got your email right
      </DialogTitle>
      <DialogDescription className="break-all pt-2 text-center text-base font-semibold text-foreground">
        {email.trim()}
      </DialogDescription>
    </DialogHeader>
    {/* "Did you mean …?" (only when suggestEmailCorrection(email) returns something) */}
    {/* "You got this wrong, change email" (underlined) and "That is my email" (primary) */}
  </DialogContent>
</Dialog>
```

---

## Appendix D – Growing the domain list later

- **What a bigger list adds:** the server check already rejects any domain that can't receive mail. The list matters for typos that land on a **real** domain (some misspellings are registered by squatters with working mail servers).
- **Build it from your own data:**
  ```sql
  select split_part(lower(email), '@', 2) as domain, count(*) as users
  from public.profiles
  group by 1
  order by 2 desc
  limit 50;
  ```
  This shows which providers your users use, and surfaces typo domains already in your database.
- **Bigger isn't automatically better:** every added domain is another possible wrong match. A few dozen providers your users actually use beats a thousand-entry list.
- **Disposable addresses** (`mailinator.com`, `10minutemail.com`…) are a separate goal (abuse of free scans) and need a maintained source.

---

*End of index.  
Conversation: https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d*
