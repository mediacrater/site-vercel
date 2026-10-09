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
