// app/api/signup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  attachDeviceCookie,
  clientIpFrom,
  lookupIpIntel,
  mergeDeviceFields,
  readOrMintDeviceId,
  recordAccountDevice,
} from '@/lib/account-device';

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SIGNUP_RATE_LIMIT_MS = 1 * 60 * 1000; // 60 minutes

function jsonWithDevice(body: unknown, status: number, deviceId: string, extraHeaders?: HeadersInit) {
  const res = NextResponse.json(body, { status, headers: extraHeaders });
  return attachDeviceCookie(res, deviceId);
}

export async function POST(req: NextRequest) {
  const { deviceId } = readOrMintDeviceId(req);

  const {
    email,
    password,
    acceptedTerms,
    timezone,
    browser,
    browser_version,
    os,
    device_fp,
  } = await req.json();

  // Server-side guard — can't be bypassed by calling the API directly
  if (!acceptedTerms) {
    return jsonWithDevice({ error: 'Terms of service must be accepted' }, 400, deviceId);
  }

  const ip = clientIpFrom(req);

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
        return jsonWithDevice(
          { error: 'Too many signup attempts. Please try again later.' },
          429,
          deviceId,
          { 'Retry-After': String(retryAfterSeconds) }
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

  const clientFields = mergeDeviceFields(req, {
    timezone,
    browser,
    browser_version,
    os,
    device_fp,
  });

  const { data, error } = await supabaseAnon.auth.signUp({
    email,
    password,
    options: {
      data: {
        browser_id: deviceId,
        signup_source: 'website',
      },
    },
  });

  if (error) {
    return jsonWithDevice({ error: error.message }, 400, deviceId);
  }

  const userId = data.user?.id;
  // Do NOT gate on data.user.identities. With email confirmation on, signUp
  // often returns a user with identities missing/empty even for a real new
  // account. That skip is why profiles.browser_id filled (handle_new_user
  // trigger reads user_metadata) while account_devices stayed empty (this
  // block never ran). Duplicate-email fake users come back with no user id.
  let deviceRecorded = false;
  let deviceError: string | null = null;

  if (userId) {
    const { error: upsertError } = await supabaseAdmin
      .from('profiles')
      .upsert(
        {
          id: userId,
          email: email,
          ip_at_creation: ip || null,
          browser_id: deviceId,
          accept_tos_privacy_refund_emailconsent_age18plus: new Date().toISOString(),
        },
        {
          onConflict: 'id',
          ignoreDuplicates: false,
        }
      );
    if (upsertError) {
      console.error('[SIGNUP] Failed to write profile data:', upsertError.message);
    }

    const intel = await lookupIpIntel(req, ip);
    const recorded = await recordAccountDevice(supabaseAdmin, {
      userId,
      event: 'signup',
      deviceId,
      ip: ip || null,
      client: clientFields,
      intel,
    });
    deviceRecorded = recorded.ok;
    deviceError = recorded.error;
  }

  return jsonWithDevice(
    {
      success: true,
      hasSession: Boolean(data.session),
      deviceRecorded,
      deviceError,
    },
    200,
    deviceId
  );
}
