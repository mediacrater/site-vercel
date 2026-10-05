// app/api/signup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkAndLogRateLimit } from "@/lib/rate-limit";
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

const SIGNUP_RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SIGNUPS_PER_WINDOW = 10;

function jsonWithDevice(body: unknown, status: number, deviceId: string, extraHeaders?: HeadersInit) {
  const res = NextResponse.json(body, { status, headers: extraHeaders });
  return attachDeviceCookie(res, deviceId);
}

export async function POST(req: NextRequest) {
  const { deviceId } = readOrMintDeviceId(req);
  const body = await req.json().catch(() => null);
  if (!body) {
    return jsonWithDevice({ error: 'Invalid request.' }, 400, deviceId);
  }

  const {
    email,
    password,
    acceptedTerms,
    timezone,
    browser,
    browser_version,
    os,
    device_fp,
    turnstileToken,
  } = body;

  if (!acceptedTerms) {
    return jsonWithDevice({ error: 'Terms of service must be accepted' }, 400, deviceId);
  }

  if (!email || !password) {
    return jsonWithDevice({ error: 'Email and password are required.' }, 400, deviceId);
  }

  // Supabase verifies the token itself (it is single-use), so we only check it exists.
  if (!turnstileToken) {
    return jsonWithDevice({ error: 'Verification failed. Please try again.' }, 400, deviceId);
  }

  const ip = clientIpFrom(req);

  // Per-IP signup rate limit: 10 attempts per rolling 24 hours.
  const rateLimit = await checkAndLogRateLimit(
    "signup",
    ip || 'unknown',
    MAX_SIGNUPS_PER_WINDOW,
    SIGNUP_RATE_LIMIT_MS / 1000
  );

  if (rateLimit.error) {
    return jsonWithDevice(
      { error: "Something went wrong. Please try again." },
      500,
      deviceId
    );
  }

  if (!rateLimit.allowed) {
    return jsonWithDevice(
      { error: "Too many signup attempts. Please try again later." },
      429,
      deviceId,
      {
        "Retry-After": String(rateLimit.retryAfterSeconds),
        "X-RateLimit-Action": "signup",
        "X-RateLimit-Limit": String(MAX_SIGNUPS_PER_WINDOW),
        "X-RateLimit-Remaining": "0",
      }
    );
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
      captchaToken: turnstileToken,
      data: {
        browser_id: deviceId,
        signup_source: 'website',
      },
    },
  });

  if (error) {
    if (/captcha/i.test(error.message)) {
      return jsonWithDevice({ error: 'Verification failed. Please try again.' }, 400, deviceId);
    }
    return jsonWithDevice({ error: error.message }, 400, deviceId);
  }

  const userId = data.user?.id;

  // With email confirmation on, an already-registered email comes back as an
  // obfuscated user with an empty identities array. Don't touch that user's rows.
  const isObfuscatedExisting =
    Array.isArray(data.user?.identities) && data.user!.identities!.length === 0;

  let deviceRecorded = false;
  if (userId && !isObfuscatedExisting) {
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
  }

  return jsonWithDevice(
    {
      success: true,
      hasSession: Boolean(data.session),
      deviceRecorded,
    },
    200,
    deviceId,
    {
      'X-RateLimit-Action': 'signup',
      'X-RateLimit-Limit': String(MAX_SIGNUPS_PER_WINDOW),
    }
  );
}
