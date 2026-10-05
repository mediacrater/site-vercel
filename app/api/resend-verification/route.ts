// app/api/resend-verification/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkAndLogRateLimit, clientIpFrom } from '@/lib/rate-limit';

const RESEND_MAX_ATTEMPTS = 1;
const RESEND_WINDOW_SECONDS = 100;

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { email, turnstileToken } = await req.json();

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

    const { error } = await supabaseAnon.auth.resend({
      type: 'signup',
      email,
      options: {
        captchaToken: turnstileToken,
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    });

    if (error) {
      if (/captcha/i.test(error.message)) {
        return NextResponse.json(
          { error: 'Verification failed. Please try again.' },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      retryAfterSeconds: RESEND_WINDOW_SECONDS,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to resend verification email' },
      { status: 500 }
    );
  }
}
