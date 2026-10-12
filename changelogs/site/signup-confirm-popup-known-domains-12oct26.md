# Sign-Up: "Double Check Your Email" Popup Only for Unrecognised Email Domains

| | |
|---|---|
| **Date** | 12 October 2026 (`12oct26`) |
| **Conversation** | https://claude.ai/chat/d4b23f41-e563-40d3-a5ba-165fd98c9a36 |
| **Related work (same conversation)** | `signup-existing-account-alert-12oct26.md`, `google-oauth-signin-12oct26.md` |
| **Stack** | Next.js on Vercel: `lib/email-typo.ts`, `app/signup/page.tsx` |
| **Starting trigger** | You wanted the "Did we get this email right?" popup to appear only when the email does **not** end in a known provider domain (e.g. `@gmail.copm` → popup, `@gmail.com` → none), using a research document listing global email providers and their domains |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included. Example addresses use `a@…`.

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
9. [Appendix A – lib/email-typo.ts (final)](#appendix-a--libemail-typots-final)
10. [Appendix B – Sign-up page change and tests](#appendix-b--sign-up-page-change-and-tests)

---

## 1. Summary

The popup used to appear on **every** signup: `handleSubmit` always called `setShowEmailConfirm(true)`, and `email-typo.ts` only added the "Did you mean…?" line. Now, emails on a recognised public provider domain go straight to account creation, while anything else (typo domains, company domains) still gets the popup.

**Main outcomes**

- `PROVIDER_DOMAINS`: an exact-match list of roughly 250 domains. That's the old list plus the research document's providers (Google, Microsoft, Yahoo, AOL, Apple, Proton, Tuta, Zoho, the Fastmail, mail.com and GMX families, US ISPs, Tencent, Yandex, Mail.ru, Seznam, T-Online, Libero).
- `SUGGESTION_TARGETS` (the old popular list, unchanged) remains the **only** source of "Did you mean…?" suggestions. Suggesting from all 250 would "correct" real custom domains into obscure Fastmail domains.
- New export `isKnownProviderDomain(email)`. Comparison is lowercased and trimmed, and a trailing dot is removed.
- The page calls it in `handleSubmit`: a known domain creates the account immediately, anything else opens the popup.
- **Verified in your GitHub repo:** `lib/email-typo.ts` contains `PROVIDER_DOMAINS` / `isKnownProviderDomain`, and `app/signup/page.tsx` calls it.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| `lib/email-typo.ts` with `PROVIDER_DOMAINS` | ✅ Applied | Seen in the repo |
| `app/signup/page.tsx` skips the popup for known domains | ✅ Applied | Seen in the repo |
| Existing false suggestion `a@acme.com` → "Did you mean a@me.com?" | ⏳ Open | Already present before this change |
| "Wrong email? Change it" on the check-email screen | ⏳ Not built | Recommended mitigation (Decision 2) |

---

## 3. Starting point

- `suggestEmailCorrection()` compared the domain against about 45 popular domains with Damerau–Levenshtein distance (1 for short domains, 2 for domains of 8+ characters).
- The page **always** showed the confirmation popup on submit.

---

## 4. Timeline: what we did, in order

### Phase 1 – Correction and pushback

- Your belief that `email-typo.ts` forced the popup wasn't quite right: the page showed it unconditionally.
- **Trade-off I raised:** skipping the popup for known domains loses the check on the part before the @ (`jonh@gmail.com`). A typo there sends the confirmation email to a stranger, or it bounces, and the user is stuck on "Check your email". Most large sites have no popup, but they offer a "Wrong email? Change it" link.
- **Separate lists:** the big list is only ever used for exact matches; suggestions still come from the popular list.
- **Outdated entries** in the research text (`kimo.com`, `passport.com`, `windowslive.com`, `narod.ru`, `qmail.com`, `currently.com`) are kept. Low risk: the server's mail-server check still rejects domains that can't receive mail.

### Phase 2 – Build and tests

I tested it by bundling with esbuild and running it in Node:

| Typed | Popup? | Suggestion |
|---|---|---|
| `a@gmail.com`, `a@GMAIL.COM ` (trailing space), `a@gmail.com.` | No | – |
| `a@eml.cc`, `a@tampabay.rr.com` | No | – |
| `a@gmail.copm` | Yes | `a@gmail.com` |
| `a@hotmial.com` | Yes | `a@hotmail.com` |
| `a@mymail.com` | Yes | `a@ymail.com` |
| `a@acme.com` | Yes | `a@me.com` ⚠️ existing bug |
| `@gmail.com`, `a@` | Not a known domain | – |

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | You thought `email-typo.ts` forced the popup | The page showed it unconditionally | Explained; the page now decides |
| 2 | `a@acme.com` suggests `a@me.com` | Two deletions are allowed on 8+ character domains (pre-existing) | ⏳ Fix proposed: only suggest when the ending matches and the distance is 1 |
| 3 | First test command failed with `/bin/sh: Syntax error: "(" unexpected` | I used bash process substitution in `sh` | Re-ran it; the files were fine |

---

## 6. Corrections / important decisions

### Decisions

1. **Exact-match list for skipping; popular list for suggestions.**
2. **Known-domain users lose the local-part double check.** Recommended mitigation: a "Wrong email? Change it" link on the check-email screen (not built).
3. **Company and custom domains still get the popup.** Harmless, and arguably useful for B2B signups.

---

## 7. Open items checklist

- [x] Popup only for unknown domains
- [ ] Fix the `acme.com` → `me.com` false suggestion
- [ ] Optional: a "Wrong email? Change it" link on the check-email screen

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Exact-match export | `isKnownProviderDomain(email): boolean` |
| Suggestion export | `suggestEmailCorrection(email): string \| null` (never "corrects" a recognised domain) |
| Distance rule | ≤ 1 for domains under 8 characters, ≤ 2 for 8+ |
| Normalisation | trim, lowercase, remove a trailing `.` |

---

## Appendix A – lib/email-typo.ts (final)

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
//
// CHANGES (popup only for unknown domains):
// - PROVIDER_DOMAINS: every public mailbox domain we recognise (major webmail,
//   privacy providers, Fastmail / mail.com / GMX families, ISPs, regional
//   providers). isKnownProviderDomain() uses it, and sign-up skips the
//   "Double check your email" popup when it returns true.
// - SUGGESTION_TARGETS (the old KNOWN_DOMAINS list, unchanged) is still the only
//   list "Did you mean …?" suggests from. Suggesting from all ~250 domains would
//   "correct" real custom domains into obscure ones (e.g. Fastmail's eml.cc,
//   imap.cc, mailc.net), so the big list is only ever used for exact matches.
// - Domains are compared lowercased, trimmed, with a trailing dot removed.

// Popular providers that "Did you mean …?" may suggest. Legitimate look-alikes
// (mail.com, gmx.com, ymail.com, me.com, mac.com) are listed so they are never
// "corrected".
const SUGGESTION_TARGETS = [
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

// Exact-match list: an email on any of these skips the confirmation popup.
// Includes everything in SUGGESTION_TARGETS.
const PROVIDER_DOMAINS = [
  ...SUGGESTION_TARGETS,

  // Google
  // (gmail.com, googlemail.com above)

  // Microsoft
  'passport.com', 'windowslive.com', 'live.co.uk',

  // Yahoo
  'y7mail.com', 'kimo.com', 'yahoo.co.jp', 'yahoo.com.ar', 'yahoo.com.au',
  'yahoo.com.br', 'yahoo.co.in', 'yahoo.co.id',

  // Proton
  'protonmail.ch',

  // Tuta
  'tuta.com', 'tutanota.com', 'tutanota.de', 'tutamail.com', 'tuta.io', 'keemail.me',

  // Zoho
  'zohomail.com',

  // Fastmail
  'fastmail.com', 'sent.com', 'fastmail.fm', '123mail.org', '150mail.com', '150ml.com',
  '16mail.com', '2-mail.com', '4email.net', '50mail.com', 'airpost.net', 'eml.cc',
  'f-m.fm', 'fast-email.com', 'fast-mail.org', 'fastem.com', 'fastemailer.com',
  'fastest.cc', 'fastmail.ca', 'fastmail.cn', 'fastmail.co.uk', 'fastmail.de',
  'fastmail.es', 'fastmail.fr', 'fastmail.nl', 'fastmail.se', 'fastmail.uk',
  'fastmail.us', 'fmail.co.uk', 'h-mail.us', 'bestmail.us', 'fastemail.us', 'ftml.net',
  'hailmail.net', 'imap-mail.com', 'imap.cc', 'imapmail.org', 'immerbox.com',
  'immermail.com', 'inoutbox.com', 'internet-e-mail.com', 'internet-mail.org',
  'internetemails.net', 'internetmailing.net', 'jetemail.net', 'justemail.net',
  'letterboxes.org', 'lifetimeaddress.com', 'mail-central.com', 'mail-page.com',
  'mailas.com', 'mailbolt.com', 'mailc.net', 'siempremail.com', 'speedpost.net',
  'speedymail.org', 'ssl-mail.com', 'swift-mail.com', 'the-fastest.net',
  'the-quickest.com', 'theinternetemail.com', 'veribox.net', 'veryfast.biz',
  'warpmail.net', 'xsmail.com', 'yepmail.net', 'your-mail.com',

  // mail.com
  'email.com', 'usa.com', 'consultant.com', 'iname.com', 'myself.com', 'post.com',
  'writeme.com', 'dr.com', 'engineer.com', 'cheerful.com', 'techie.com', 'doctor.com',
  'workmail.com', 'europe.com', 'mail.org', 'homemail.com', 'mindless.com',
  'lawyer.com', 'realtyagent.com', 'execs.com', 'earthling.net', 'bikerider.com',
  'contractor.net', 'rescueteam.com',

  // GMX / Web.de
  'gmx.net', 'gmx.at', 'gmx.ch', 'gmx.fr', 'gmx.co.uk', 'gmx.us', 'gmx.es',
  'gmx-topmail.de', 'gmx.eu', 'gmx.li', 'email.de',

  // AT&T
  'bellsouth.net', 'pacbell.net', 'prodigy.net', 'swbell.net', 'ameritech.net',
  'snet.net', 'flash.net', 'currently.com',

  // Charter Spectrum / RoadRunner
  'charter.net', 'roadrunner.com', 'twc.com', 'tampabay.rr.com', 'cfl.rr.com', 'nc.rr.com',

  // CenturyLink
  'centurylink.net', 'q.com', 'embarqmail.com', 'centurytel.net',

  // Earthlink
  'earthlink.net', 'mindspring.com', 'peoplepc.com',

  // Optimum
  'optonline.net', 'optimum.net',

  // Tencent
  'qq.com', 'foxmail.com', 'vip.qq.com', 'qmail.com',

  // Yandex
  'yandex.ru', 'yandex.com.tr', 'ya.ru', 'narod.ru', 'yandex.by', 'yandex.kz',

  // Mail.ru
  'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'icqmail.com',

  // Seznam
  'seznam.cz', 'email.cz', 'post.cz',

  // Others
  't-online.de', 'libero.it',
];

const PROVIDER_SET = new Set(PROVIDER_DOMAINS);

// Lowercased domain of an email, or null if there isn't a usable one.
function domainOf(input: string): string | null {
  const email = input.trim();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase().replace(/\.$/, '');
}

/**
 * True when the email ends in a recognised public provider domain
 * (exact match, e.g. "gmail.com" yes, "gmail.copm" no). Sign-up skips the
 * confirmation popup for these.
 */
export function isKnownProviderDomain(input: string): boolean {
  const domain = domainOf(input);
  return domain !== null && PROVIDER_SET.has(domain);
}

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
 * misspelling of a popular provider, otherwise null.
 */
export function suggestEmailCorrection(input: string): string | null {
  const email = input.trim();
  const domain = domainOf(email);
  if (domain === null) return null;

  // Any recognised provider domain is correct as typed, never "corrected".
  if (PROVIDER_SET.has(domain)) return null;

  const local = email.slice(0, email.lastIndexOf('@'));

  // Short domains need a closer match, to avoid "correcting" real ones.
  const maxDistance = domain.length >= 8 ? 2 : 1;

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of SUGGESTION_TARGETS) {
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

## Appendix B – Sign-up page change and tests

```diff
-import { suggestEmailCorrection } from '@/lib/email-typo';
+import { isKnownProviderDomain, suggestEmailCorrection } from '@/lib/email-typo';
```

In `handleSubmit`:

```diff
-    // Ask the user to double-check the address before anything is sent.
-    setShowEmailConfirm(true);
+    // Recognised provider (gmail.com, outlook.com, …): no popup.
+    if (isKnownProviderDomain(email)) {
+      void createAccount();
+      return;
+    }
+    // Unknown or misspelled domain: ask the user to double-check first.
+    setShowEmailConfirm(true);
```

**Test on `/signup`:**
1. `@gmail.com`. Expected: no popup, straight to "Check your email".
2. `@gmail.copm`. Expected: the popup with "Did you mean …@gmail.com?".
3. `@yourcompany.com`. Expected: the popup, with no suggestion.

---

*End of index.  
Conversation: `<add this conversation's URL>`*
