import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RESET_RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour
const MAX_ATTEMPTS_PER_WINDOW = 3;

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ error: 'Email address is required' }, { status: 400 });
  }

  const ip = (
    req.headers.get('x-forwarded-for') ||
    req.headers.get('x-real-ip') ||
    ''
  ).split(',')[0].trim();

  // ── Per-IP Password Reset Rate Limit ──────────────────────────
  if (ip) {
    const { data: existingLimit } = await supabaseAdmin
      .from('password_reset_rate_limits')
      .select('last_attempt_at, attempt_count')
      .eq('ip', ip)
      .maybeSingle();

    const now = new Date();
    let newCount = 1;
    let windowStart = now.toISOString();

    if (existingLimit) {
      const elapsedMs = now.getTime() - new Date(existingLimit.last_attempt_at).getTime();

      if (elapsedMs < RESET_RATE_LIMIT_MS) {
        if (existingLimit.attempt_count >= MAX_ATTEMPTS_PER_WINDOW) {
          const retryAfterSeconds = Math.ceil((RESET_RATE_LIMIT_MS - elapsedMs) / 1000);
          return NextResponse.json(
            { error: 'Too many password reset requests. Please try again in an hour.' },
            { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
          );
        }

        // Within the 1-hour window: increment attempts and preserve the start time
        newCount = (existingLimit.attempt_count || 0) + 1;
        windowStart = existingLimit.last_attempt_at;
      }
    }

    // Record the attempt immediately to mitigate simultaneous race condition attacks
    const { error: rateLimitError } = await supabaseAdmin
      .from('password_reset_rate_limits')
      .upsert(
        { ip, last_attempt_at: windowStart, attempt_count: newCount },
        { onConflict: 'ip' }
      );

    if (rateLimitError) {
      console.error('[RESET] Failed to record rate limit attempt:', rateLimitError.message);
    }
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
