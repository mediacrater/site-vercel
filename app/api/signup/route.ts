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

async function verifyTurnstileToken(token: string, ip?: string | null) {
  const params = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY!,
    response: token,
  });
  if (ip) params.set('remoteip', ip);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error('[SIGNUP] Turnstile siteverify failed:', err);
    return false;
  }
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
    turnstileToken,
  } = await req.json();

  // Server-side guard — can't be bypassed by calling the API directly
  if (!acceptedTerms) {
    return jsonWithDevice({ error: 'Terms of service must be accepted' }, 400, deviceId);
  }

  const ip = clientIpFrom(req);

  // Verify Turnstile BEFORE writing the IP rate-limit row. An expired
  // widget token should not burn the user's signup slot.
  if (!turnstileToken || !(await verifyTurnstileToken(turnstileToken, ip))) {
    return jsonWithDevice(
      { error: 'Verification failed. Please try again.' },
      400,
      deviceId
    );
  }

    // Per-IP signup rate limit: 10 attempts per rolling 24 hours.
  if (ip) {
    const rateLimit = await checkAndLogRateLimit(
      "signup",
      ip,
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
    deviceId,
    {
      'X-RateLimit-Action': 'signup',
      'X-RateLimit-Limit': String(MAX_SIGNUPS_PER_WINDOW),
    }
  );
}
