// app/api/signup/route.ts
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
const SIGNUP_RATE_LIMIT_MS = 60 * 60 * 1000; // 60 minutes
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
  // Supabase's own dashboard-configurable auth rate limit is
  // currently unreliable (confirmed open bug), so this is the
  // actual enforcement layer.
  if (ip) {
    const { data: existingLimit } = await supabaseAdmin
      .from('signup_rate_limits')
      .select('last_attempt_at')
      .eq('ip', ip)
      .maybeSingle();
    if (existingLimit) {
      const elapsedMs = Date.now() - new Date(existingLimit.last_attempt_at).getTime();
      if (elapsedMs < SIGNUP_RATE_LIMIT_MS) {
        const retryAfterSeconds = Math.ceil((SIGNUP_RATE_LIMIT_MS - elapsedMs) / 1000);
        return NextResponse.json(
          { error: 'Too many signup attempts. Please try again later.' },
          { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
        );
      }
    }
    // Record this attempt immediately, before calling Supabase auth,
    // to close the race window between near-simultaneous requests
    // from the same IP.
    const { error: rateLimitError } = await supabaseAdmin
      .from('signup_rate_limits')
      .upsert(
        { ip, last_attempt_at: new Date().toISOString() },
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
        accept_tos_privacy_refund_emailconsent_age18plus: new Date().toISOString()
      }, {
        onConflict: 'id',
        ignoreDuplicates: false
      });
    if (upsertError) {
      console.error('[SIGNUP] Failed to write profile data:', upsertError.message);
    }
  }
  // KEPT DELIBERATELY — not part of what you pasted, flagging rather
  // than silently reintroducing. Your live signup page's success handler
  // does `setSuccess(true)` unconditionally, same gap I found and fixed
  // in this project's version: if your Supabase project ever has email
  // confirmation OFF, that always shows "check your email" even when a
  // real session was already returned and the user could go straight to
  // /dashboard. hasSession costs nothing to include and lets the client
  // branch correctly instead of assuming. Remove this line if you'd
  // rather this route match your live version byte-for-byte.
  return NextResponse.json({ success: true, hasSession: Boolean(data.session) });
}
