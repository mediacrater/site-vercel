import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SIGNUP_RATE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS_PER_WINDOW = 4;

export async function POST(req: NextRequest) {
  const { email, password, acceptedTerms } = await req.json(); // acceptedTerms added

  // Server-side guard — can't be bypassed by calling the API directly
  if (!acceptedTerms) {
    return NextResponse.json({ error: 'Terms of service must be accepted' }, { status: 400 });
  }

  const ip = (
    req.headers.get('x-forwarded-for') ||
    req.headers.get('x-real-ip') ||
    ''
  ).split(',')[0].trim();

  // ── Per-IP signup rate limit ──────────────────────────────
  // Checked before any Supabase auth call, using a small table
  // since Vercel functions are stateless across invocations —
  // an in-memory limiter would not persist between requests.
  if (ip) {
    const { data: existingLimit } = await supabaseAdmin
      .from('signup_rate_limits')
      .select('last_attempt_at, attempt_count')
      .eq('ip', ip)
      .maybeSingle();

    const now = new Date();
    let newCount = 1;
    let windowStart = now.toISOString();

    if (existingLimit) {
      const elapsedMs = now.getTime() - new Date(existingLimit.last_attempt_at).getTime();

      if (elapsedMs < SIGNUP_RATE_LIMIT_MS) {
        if (existingLimit.attempt_count >= MAX_ATTEMPTS_PER_WINDOW) {
          const retryAfterSeconds = Math.ceil((SIGNUP_RATE_LIMIT_MS - elapsedMs) / 1000);
          return NextResponse.json(
            { error: 'Too many signup attempts. Please try again later.' },
            { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
          );
        }
        
        // Still within the 15-minute window, so increment count and keep the original start time
        newCount = (existingLimit.attempt_count || 0) + 1;
        windowStart = existingLimit.last_attempt_at;
      }
      // If elapsedMs >= 15 minutes, the flow naturally uses the default values 
      // (newCount = 1, windowStart = now), effectively resetting the window.
    }

    // Record this attempt immediately, before calling Supabase auth,
    // to close the race window between near-simultaneous requests
    // from the same IP.
    const { error: rateLimitError } = await supabaseAdmin
      .from('signup_rate_limits')
      .upsert(
        { ip, last_attempt_at: windowStart, attempt_count: newCount },
        { onConflict: 'ip' }
      );

    if (rateLimitError) {
      console.error('[SIGNUP] Failed to record rate limit attempt:', rateLimitError.message);
      // Non-fatal — don't block signup over a logging failure
    }
  }

  const { data, error } = await supabaseAnon.auth.signUp({
    email,
    password,
    options: {
      data: {
        browser_id: null,
        signup_source: 'website'
      }
    }
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const userId = data.user?.id;
  if (userId) {
    const { error: upsertError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        email: email, // add this
        ip_at_creation: ip || null,
        accept_tos_privacy_refund_emailconsent: new Date().toISOString()
      }, {
        onConflict: 'id',
        ignoreDuplicates: false
      });

    if (upsertError) {
      console.error('[SIGNUP] Failed to write profile data:', upsertError.message);
    }
  }

  return NextResponse.json({ success: true });
}
