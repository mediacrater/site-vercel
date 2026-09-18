// app/api/auth/reset-password/route.ts
//
// Two changes from the previous version:
//   1. Turnstile verification added — this route previously had none.
//   2. Rate limiting migrated from the dedicated password_reset_rate_limits
//      table (single row per IP, attempt_count + last_attempt_at) onto the
//      shared rate_limits table via check_and_log_rate_limit(), matching
//      the pattern used by signup, signin, and the custom-solutions form.
//      Limit changed from 3/60min to 10/24hr per the new settled numbers.
//
// Everything else — the resetPasswordForEmail call, the redirect URL, the
// Supabase-level 429 passthrough — is unchanged.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkAndLogRateLimit, clientIpFrom, verifyTurnstileToken } from '@/lib/rate-limit';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RESET_MAX_ATTEMPTS = 8;
const RESET_WINDOW_SECONDS = 24 * 60 * 60; // 24 hours

export async function POST(req: NextRequest) {
  const { email, turnstileToken } = await req.json();

  if (!email) {
    return NextResponse.json({ error: 'Email address is required' }, { status: 400 });
  }

  const ip = clientIpFrom(req);

  // Verify Turnstile before touching the rate limiter.
  const isHuman = await verifyTurnstileToken(turnstileToken, ip);
  if (!isHuman) {
    return NextResponse.json(
      { error: 'Verification failed. Please try again.' },
      { status: 400 }
    );
  }

  // ── Per-IP password reset rate limit (shared rate_limits table) ──
  const rateLimit = await checkAndLogRateLimit(
    'reset_password',
    ip,
    RESET_MAX_ATTEMPTS,
    RESET_WINDOW_SECONDS
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many password reset requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  // Use the admin client (or a standard client) to trigger the password reset email.
  // Note: Standard Supabase auth uses the default redirect url unless configured otherwise.
  const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
    redirectTo: `${new URL(req.url).origin}/auth/update-password`,
  });

  if (resetError) {
    // If the error is a Supabase level rate limit, forward a clean message
    if (resetError.status === 429) {
      return NextResponse.json(
        { error: 'Email limit exceeded. Please try again later.' },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: resetError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
