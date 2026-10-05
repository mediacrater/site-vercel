// app/api/auth/reset-password/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkAndLogRateLimit, clientIpFrom } from '@/lib/rate-limit';

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const RESET_MAX_ATTEMPTS = 8;
const RESET_WINDOW_SECONDS = 24 * 60 * 60; // 24 hours

export async function POST(req: NextRequest) {
  const { email, turnstileToken } = await req.json();

  if (!email) {
    return NextResponse.json({ error: 'Email address is required' }, { status: 400 });
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

  const { error: resetError } = await supabaseAnon.auth.resetPasswordForEmail(email, {
    captchaToken: turnstileToken,
    redirectTo: `${new URL(req.url).origin}/auth/update-password`,
  });

  if (resetError) {
    if (/captcha/i.test(resetError.message)) {
      return NextResponse.json(
        { error: 'Verification failed. Please try again.' },
        { status: 400 }
      );
    }
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
