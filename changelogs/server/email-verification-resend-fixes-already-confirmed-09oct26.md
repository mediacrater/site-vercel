# Email Verification: Resend Fixes, "Already Confirmed" State & Delivery Diagnosis

| | |
|---|---|
| **Date** | 9 October 2026 (`09oct26`) |
| **Destination** | changelogs/server |
| **Conversation** | https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d |
| **Related prior work** | `security-review-phase2-headers-csp-08oct26.md` (8 Oct 2026)<br>Followed by `email-typo-prevention-popup-domain-check-09oct26.md` and `password-policy-checklist-weak-password-prompt-09oct26.md` (same day) |
| **Stack** | Next.js web app on Vercel (`app/signup/page.tsx`, `app/api/resend-verification/route.ts`), Supabase Auth (**separate TEST and LIVE projects**), Resend (custom SMTP) |
| **Starting trigger** | Verification emails seemed "spotty": some users requested a resend 2–3 times, while you always received yours. You also wanted the resend button replaced by a warning once the email is confirmed |

> **Redaction note:** no secrets, keys, IP addresses, user IDs or email addresses are included. `<test web host>` stands in for the TEST website's hostname.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied (expected output is given). ⏳ = open.

> **`app/signup/page.tsx` changed twice more the same day.** The final sign-up page is the one in the password-policy index; it includes everything below.

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
9. [Appendix A – `app/api/resend-verification/route.ts` (final)](#appendix-a--appapiresend-verificationroutets-final)
10. [Appendix B – Sign-up page changes](#appendix-b--sign-up-page-changes)
11. [Appendix C – Diagnosis queries and commands](#appendix-c--diagnosis-queries-and-commands)

---

## 1. Summary

Emails were being sent and delivered. The "spotty" behaviour came from a UI bug that hid failed resends and, mostly, from **typos in email addresses** (handled in the typo-prevention index).

**Main outcomes**

- **Hidden-error bug fixed.** The sign-up page only showed a resend error during a countdown (`{resendError && resendCooldown > 0 && …}`), so when Supabase refused to send, the button simply came back and users clicked again. Errors now stay visible; only countdown errors disappear when the countdown ends.
- **Supabase refusals get clear messages.** The hourly email cap shows "We are sending a lot of emails right now…" with a 300 s countdown; the per-user wait shows Supabase's own number of seconds. Each refusal is logged as `<env> [RESEND] Supabase refused: …`.
- **Resent links point to the home page explicitly** (`${NEXT_PUBLIC_APP_URL}/`), where `VerificationDialog` handles the confirmation.
- **"Already confirmed" warning** replaces the resend button and Turnstile widget once the email is confirmed:
  - same browser: detected from the Supabase session shared across tabs, plus a re-check when the tab regains focus
  - another browser or device: the resend API answers `{ alreadyConfirmed: true }`, but **only** for the browser that created the account (its `mc_device_id` cookie must be linked to the account in `account_devices`), so nobody can use it to check whether someone else's email is registered
- **Delivery checked and healthy:** Resend logs show mostly `delivered`; bounces are typos; SPF, DKIM and the bounce MX are correct.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| New `route.ts` + sign-up page on TEST | ✅ | |
| Test: confirm in another browser, then Resend | ✅ | Amber warning shown |
| Test: Resend for an unconfirmed account | ✅ | Email arrives |
| Test: same-browser, second tab | ⚠️ Not confirmed | Expected: the warning appears when you return to the first tab, without clicking |
| LIVE | ⚠️ Not confirmed | You reported the files "Done"; expected: the same three tests pass on LIVE |
| Supabase email rate limit | ✅ 120/hour | But Resend's free plan caps at 100/day (see §6) |
| SPF / DKIM / bounce MX | ✅ Correct | |
| DMARC reporting address | ⏳ Optional | Currently `p=none` with no `rua` |
| Root cause (typos) | ➡️ | Handled in the typo-prevention index |

---

## 3. Starting point

- **Sign-up email:** `/api/signup` doesn't pass `emailRedirectTo`, so the confirmation link uses the Site URL (home page), where `VerificationDialog` handles it.
- **Resend:** `/api/resend-verification` passed `emailRedirectTo: ${NEXT_PUBLIC_APP_URL}/auth/callback`, a page that doesn't exist. It returned raw error messages, and allowed 1 resend per 100 s per IP.
- **Supabase URL configuration:**
  - TEST: Site URL `https://<test web host>/`; Redirect URLs `…/verified` and `…/db`
  - LIVE: Site URL `https://mediacrater.com/`; Redirect URLs `https://mediacrater.com/verified` and `https://mediacrater.com/db`
- **Email provider:** Resend (custom SMTP), **free plan: 100 emails/day, 3,000/month**.
- **Supabase "Rate limit for sending emails":** 30/hour.
- **Supabase auth audit logs aren't written to the database** (the per-account query returned 0 everywhere).

---

## 4. Timeline: what we did, in order

### Step 1 – Code review

Found three issues in the sign-up and resend code:
1. the hidden resend error (above)
2. the `/auth/callback` redirect target
3. raw Supabase errors (`error.message`) returned to users

### Step 2 – Implementation and sandbox tests

`route.ts` and `page.tsx` rewritten ([Appendix A](#appendix-a--appapiresend-verificationroutets-final), [Appendix B](#appendix-b--sign-up-page-changes)). Tested against a fake Supabase (8 cases):
- with no cookie, or another browser's cookie, a confirmed account gets the normal resend (no leak)
- the creating browser gets `alreadyConfirmed`, and nothing is sent (also with different capitalisation)
- an unconfirmed account gets its email
- the hourly cap → `429` with 300 s; the per-user wait → `429` with Supabase's 42 s
- a bad email or bad JSON → `400`
- resent links point to `https://<app>/`

### Step 3 – Your diagnosis results

| Check | Result |
|---|---|
| Redirect URLs | Only `/verified` and `/db` allowed → `/auth/callback` was never accepted; Supabase fell back to the Site URL |
| Per-account audit query | 0 everywhere: audit logs aren't stored in the database |
| Supabase Auth logs (`resend`) | `POST 200 …/auth/v1/resend?redirect_to=…/auth/callback` |
| SMTP | Resend |
| Supabase email rate limit | 30/hour |
| `dig` root SPF | Empty (expected: Resend uses `send.`) |
| `dig _dmarc` | `"v=DMARC1; p=none;"` |

### Step 4 – Correction: the redirect wasn't the cause

Because `/auth/callback` wasn't on the allow list, users always landed on the home page. The explicit `${APP_URL}/` target is kept for clarity, but bug 1 (hidden errors) remained the real code problem.

### Step 5 – Resend data

| Check | Result |
|---|---|
| Resend plan | Free: 100/day, 3,000/month |
| Resend email log | Mostly `delivered`; bounces were typos; 2 `Suppressed` ("recent history of producing hard bounces") |
| `dig TXT send.mediacrater.com` | `"v=spf1 include:amazonses.com ~all"` |
| `dig TXT resend._domainkey.mediacrater.com` | DKIM key present |
| `dig MX send.mediacrater.com` | `10 feedback-smtp.us-east-1.amazonses.com.` |
| Supabase email rate limit | You raised it to 120/hour |

**Conclusion:** after a hard bounce, Resend suppresses the address, so every resend to a mistyped address is never even attempted. That explains the repeated resends. Bounces also hurt sender reputation. → typo prevention.

### Step 6 – Deployment and tests

Files applied. You confirmed in a **different browser** (logged in there instantly), clicked Resend in the first browser, and got the amber warning. Resend for an unconfirmed account worked.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Users clicked Resend 2–3 times | Errors only rendered during a countdown | Errors stay visible |
| 2 | Resent links targeted `/auth/callback` (doesn't exist) | Old code | Not harmful (not on the allow list → Site URL); now explicit `/` |
| 3 | Audit query returned 0 for every account | Supabase doesn't store auth audit logs in your database | Used Resend's logs instead |
| 4 | Root SPF lookup empty | Resend's SPF lives on `send.mediacrater.com` | Checked the right records |
| 5 | `Suppressed` emails | Resend blocks addresses after a hard bounce | Typo prevention |
| 6 | 120/hour set in Supabase | Resend's free plan allows 100/day | Watch daily usage (§6) |

---

## 6. Corrections / important decisions

1. **My first guess (the 404 redirect) was wrong**; your allow-list check disproved it.
2. **Device-bound "already confirmed" check**, so the feature can't be used to probe whether an email has an account.
3. **One sentence added to your warning text:** "If you confirmed it on another device, sign in instead." Refreshing only works when the confirmation happened in the same browser.
4. **Hourly vs daily limits:** Supabase only offers an hourly setting, but your real limit is Resend's 100/day. One busy hour can use the whole day, after which all auth emails (including password resets) fail until the next day. Upgrade Resend once daily usage regularly approaches ~70% of the cap.

---

## 7. Open items checklist

- [ ] Same-browser test: confirm in a second tab, return to the first. Expected: warning appears
- [ ] LIVE: the three tests (same browser, other browser, unconfirmed resend)
- [ ] Watch Resend's daily usage; upgrade before the 100/day cap is regularly approached
- [ ] Optional: DMARC reports, e.g. `v=DMARC1; p=none; rua=mailto:dmarc@mediacrater.com` (needs a mailbox or a report service); later `p=quarantine`
- [ ] Optional: forward `[RESEND]` refusals to Slack (Vercel keeps logs ~1 hour)

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Resend cooldown (per IP) | 1 per 100 s (`RESEND_MAX_ATTEMPTS = 1`, `RESEND_WINDOW_SECONDS = 100`) |
| Supabase hourly cap fallback countdown | 300 s (`EMAIL_CAP_RETRY_SECONDS`) |
| Resend link target | `${NEXT_PUBLIC_APP_URL}/` (Site URL if unset) |
| "Already confirmed" check | `profiles.email` (typed and lowercased) → `account_devices` (user + this browser's `mc_device_id`) → `auth.admin.getUserById` → `email_confirmed_at` |
| Log prefix | `${NEXT_PUBLIC_STATE} [RESEND]` |
| Supabase email rate limit | 120/hour |
| Resend plan | Free: 100/day, 3,000/month |
| Email DNS | SPF + MX on `send.mediacrater.com`; DKIM `resend._domainkey`; DMARC `p=none` |

---

## Appendix A – `app/api/resend-verification/route.ts` (final)

```ts
// app/api/resend-verification/route.ts
//
// CHANGES (email verification fixes):
// 1. Already-confirmed detection. If the email's account is already
//    confirmed AND this browser is the one that created it (its HttpOnly
//    mc_device_id cookie is linked to that account in account_devices), the
//    route answers { alreadyConfirmed: true } and sends nothing. Any other
//    caller gets the normal behaviour, so this can't be used to find out
//    whether someone else's email is registered or confirmed.
// 2. Confirmation link target. Resent links used to point at /auth/callback,
//    a page that doesn't exist, so a user could confirm successfully and
//    land on a 404. They now point at the home page, which handles the
//    confirmation (VerificationDialog), the same place the original signup
//    email lands.
// 3. Supabase email limits. When Supabase refuses to send (hourly email cap,
//    or the per-user wait between emails), the user now gets a clear message
//    and a countdown instead of a raw error, and the failure is logged with
//    a [RESEND] prefix.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkAndLogRateLimit, clientIpFrom } from '@/lib/rate-limit';
import { DEVICE_COOKIE, createAdminClient } from '@/lib/account-device';

const RESEND_MAX_ATTEMPTS = 1;
const RESEND_WINDOW_SECONDS = 100;

// Used when Supabase's hourly email cap is hit and gives no wait time.
const EMAIL_CAP_RETRY_SECONDS = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LOG_PREFIX = `${process.env.NEXT_PUBLIC_STATE ?? 'UNKNOWN_ENV'} [RESEND]`;

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 320 || !EMAIL_RE.test(email)) return null;
  return email;
}

/**
 * True only if the account for this email is confirmed AND was created
 * (or signed into) from this browser. Any error or mismatch returns false,
 * which falls back to a normal resend.
 */
async function isConfirmedForThisDevice(
  req: NextRequest,
  email: string,
  typedEmail: string
): Promise<boolean> {
  const deviceId = req.cookies.get(DEVICE_COOKIE)?.value;
  if (!deviceId || !UUID_RE.test(deviceId)) return false;

  try {
    const admin = createAdminClient();

    // profiles.email is stored as typed at signup (Supabase Auth itself stores
    // it lowercased), so match both forms exactly.
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id')
      .in('email', Array.from(new Set([email, typedEmail])))
      .limit(1)
      .maybeSingle();
    if (profileError || !profile?.id) return false;

    const { data: devices, error: deviceError } = await admin
      .from('account_devices')
      .select('user_id')
      .eq('user_id', profile.id)
      .eq('device_id', deviceId)
      .limit(1);
    if (deviceError || !devices?.length) return false;

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
    if (userError) return false;

    return Boolean(userData.user?.email_confirmed_at);
  } catch (err) {
    console.error(`${LOG_PREFIX} confirmation check failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    let body: { email?: unknown; turnstileToken?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }

    const email = normalizeEmail(body.email);
    const typedEmail = typeof body.email === 'string' ? body.email.trim() : '';
    const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Supabase verifies the token itself (single-use)
    if (!turnstileToken) {
      return NextResponse.json(
        { error: 'Verification failed. Please try again.' },
        { status: 400 }
      );
    }

    const ip = clientIpFrom(req);

    const rateLimit = await checkAndLogRateLimit(
      'resend_verification',
      ip,
      RESEND_MAX_ATTEMPTS,
      RESEND_WINDOW_SECONDS
    );

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Please wait before requesting another email.',
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    if (await isConfirmedForThisDevice(req, email, typedEmail)) {
      return NextResponse.json({ alreadyConfirmed: true });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '');

    const { error } = await supabaseAnon.auth.resend({
      type: 'signup',
      email,
      options: {
        captchaToken: turnstileToken,
        // Without NEXT_PUBLIC_APP_URL, Supabase falls back to the project's Site URL.
        ...(appUrl ? { emailRedirectTo: `${appUrl}/` } : {}),
      },
    });

    if (error) {
      const status = (error as { status?: number }).status;
      const code = (error as { code?: string }).code;
      console.error(`${LOG_PREFIX} Supabase refused:`, status, code, error.message);

      if (/captcha/i.test(error.message)) {
        return NextResponse.json(
          { error: 'Verification failed. Please try again.' },
          { status: 400 }
        );
      }

      if (status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
        // Supabase's per-user wait: "...you can only request this after 42 seconds."
        const waitMatch = /after (\d+) seconds?/i.exec(error.message);
        const retryAfterSeconds = waitMatch
          ? Math.min(Math.max(Number(waitMatch[1]), 1), 3600)
          : EMAIL_CAP_RETRY_SECONDS;

        return NextResponse.json(
          {
            error: waitMatch
              ? 'Please wait a moment before requesting another email.'
              : 'We are sending a lot of emails right now. Please try again in a few minutes.',
            retryAfterSeconds,
          },
          {
            status: 429,
            headers: { 'Retry-After': String(retryAfterSeconds) },
          }
        );
      }

      return NextResponse.json(
        { error: "We couldn't send the email right now. Please try again shortly." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      retryAfterSeconds: RESEND_WINDOW_SECONDS,
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} unexpected error:`, err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Failed to resend verification email' },
      { status: 500 }
    );
  }
}
```

---

## Appendix B – Sign-up page changes

These are in the final `app/signup/page.tsx` (password-policy version):

1. **New state:** `resendErrorTiedToCooldown`, `alreadyConfirmed`.
2. **New effect** while the "Check your email" screen is open:
   ```tsx
   useEffect(() => {
     if (!checkEmail) return;

     const { data } = supabase.auth.onAuthStateChange((_event, session) => {
       if (session) setAlreadyConfirmed(true);
     });

     const checkSession = () => {
       supabase.auth.getSession().then(({ data: { session } }) => {
         if (session) setAlreadyConfirmed(true);
       });
     };
     window.addEventListener('focus', checkSession);

     return () => {
       data.subscription.unsubscribe();
       window.removeEventListener('focus', checkSession);
     };
   }, [checkEmail]);
   ```
3. **`handleResendVerification`:** on `response.ok && data.alreadyConfirmed`, set `alreadyConfirmed` and stop; on a `429` with `retryAfterSeconds`, mark the error as tied to the countdown.
4. **Render:** the Turnstile container stays mounted but hidden when `alreadyConfirmed`; the amber `role="status"` box replaces the button; errors render with `{resendError && (!resendErrorTiedToCooldown || resendCooldown > 0) && …}`.

Warning text:
> Your email has already been confirmed. Please refresh the page to access the dashboard. If you confirmed it on another device, **sign in** instead. If you're encountering issues, please contact support for assistance.

---

## Appendix C – Diagnosis queries and commands

```sql
-- Per account (last 30 days): confirmation emails requested and confirmation time.
-- Returned 0 for you: audit logs aren't stored in the database.
select u.id, u.created_at, u.email_confirmed_at,
  count(a.*) filter (where a.payload->>'action' = 'user_confirmation_requested') as confirmation_emails,
  max(a.created_at) filter (where a.payload->>'action' = 'user_confirmation_requested') as last_request
from auth.users u
left join auth.audit_log_entries a on a.payload->>'actor_id' = u.id::text
where u.created_at > now() - interval '30 days'
group by u.id
order by confirmation_emails desc
limit 30;
```

```bash
dig +short TXT send.mediacrater.com              # "v=spf1 include:amazonses.com ~all"
dig +short TXT resend._domainkey.mediacrater.com # DKIM key "p=…"
dig +short MX send.mediacrater.com               # 10 feedback-smtp.us-east-1.amazonses.com.
dig +short TXT _dmarc.mediacrater.com            # "v=DMARC1; p=none;"
```

Supabase dashboard: **Logs → Auth**, search `resend` and `rate limit`. Resend dashboard: **Emails** for per-email status (`delivered`, `bounced`, `suppressed`, `delivery_delayed`, `complained`).

---

*End of index.  
Conversation: https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d*
