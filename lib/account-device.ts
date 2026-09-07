// lib/account-device.ts
// Server-only. Used by app/api/signup/route.ts (and later the login route).
//
// mc_device_id is a durable first-party cookie, independent of the Supabase
// session in localStorage / chrome.storage. Session cookies die on logout;
// this one must not.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const DEVICE_COOKIE = 'mc_device_id';
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // ~400d, Chrome's cap
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DeviceClientFields = {
  timezone?: string | null;
  browser?: string | null;
  browser_version?: string | null;
  os?: string | null;
  device_fp?: string | null;
};

export type IpIntel = {
  asn: number | null;
  asn_org: string | null;
  country: string | null;
  city: string | null;
  is_vpn: boolean | null;
  is_hosting: boolean | null;
};

const HOSTING_ORG_RE =
  /\b(amazon|aws|google cloud|gcp|microsoft azure|azure|digitalocean|linode|akamai|ovh|hetzner|vultr|cloudflare|datacamp|m247|choopa|leaseweb|hivelocity|contabo|oracle cloud|alibaba)\b/i;

const VPN_ORG_RE =
  /\b(nordvpn|nord vpn|expressvpn|mullvad|surfshark|protonvpn|proton vpn|cyberghost|private internet access|\bpia\b|windscribe|ipvanish|tunnelbear|purevpn|ivpn|m247|datacamp|packethub|vpn)\b/i;

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length ? t : null;
}

export function clientIpFrom(req: NextRequest): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;

  const trueClient = req.headers.get('true-client-ip')?.trim();
  if (trueClient) return trueClient;

  // Last resort only — behind Cloudflare these are often the edge IP
  const forwarded =
    req.headers.get('x-forwarded-for') ||
    req.headers.get('x-vercel-forwarded-for') ||
    req.headers.get('x-real-ip') ||
    '';
  return forwarded.split(',')[0].trim();
}

export function readOrMintDeviceId(req: NextRequest): { deviceId: string; minted: boolean } {
  const existing = req.cookies.get(DEVICE_COOKIE)?.value;
  if (existing && UUID_RE.test(existing)) {
    return { deviceId: existing, minted: false };
  }
  return { deviceId: crypto.randomUUID(), minted: true };
}

export function attachDeviceCookie(res: NextResponse, deviceId: string): NextResponse {
  res.cookies.set(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE,
  });
  return res;
}

export function parseUserAgent(ua: string | null): {
  browser: string | null;
  browser_version: string | null;
  os: string | null;
} {
  if (!ua) return { browser: null, browser_version: null, os: null };

  let os: string | null = null;
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/CrOS/i.test(ua)) os = 'Chrome OS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  const rules: Array<[RegExp, string]> = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  for (const [re, name] of rules) {
    const m = ua.match(re);
    if (m) return { browser: name, browser_version: m[1] ?? null, os };
  }
  return { browser: null, browser_version: null, os };
}

function parseSecChUa(header: string | null): { browser: string | null; browser_version: string | null } {
  if (!header) return { browser: null, browser_version: null };
  const parts = [...header.matchAll(/"([^"]+)";v="([^"]+)"/g)].map((m) => ({
    brand: m[1],
    version: m[2],
  }));
  const real = parts.filter((p) => !/not.?a.?brand/i.test(p.brand));
  const pick =
    real.find((p) => /google chrome/i.test(p.brand)) ||
    real.find((p) => /microsoft edge/i.test(p.brand)) ||
    real.find((p) => /firefox|safari|opera|brave/i.test(p.brand)) ||
    real.find((p) => /chromium/i.test(p.brand)) ||
    real[0];
  return pick
    ? { browser: pick.brand, browser_version: pick.version }
    : { browser: null, browser_version: null };
}

function vercelGeo(req: NextRequest): Pick<IpIntel, 'country' | 'city'> {
  const country = asText(req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry'));
  const rawCity = req.headers.get('x-vercel-ip-city');
  let city: string | null = null;
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity);
    } catch {
      city = rawCity;
    }
  }
  return { country: country && country !== 'XX' ? country : null, city };
}

function parseAsnOrg(org: string | null): { asn: number | null; asn_org: string | null } {
  if (!org) return { asn: null, asn_org: null };
  const m = org.match(/^AS(\d+)\s+(.*)$/i);
  if (m) return { asn: Number(m[1]), asn_org: m[2].trim() };
  return { asn: null, asn_org: org };
}

function inferFlags(asnOrg: string | null, privacy?: { vpn?: boolean; proxy?: boolean; tor?: boolean; hosting?: boolean }) {
  const is_vpn =
    privacy?.vpn || privacy?.proxy || privacy?.tor
      ? true
      : asnOrg
        ? VPN_ORG_RE.test(asnOrg)
        : null;
  const is_hosting = privacy?.hosting ? true : asnOrg ? HOSTING_ORG_RE.test(asnOrg) : null;
  return {
    is_vpn: is_vpn === true ? true : is_vpn === false ? false : is_vpn,
    is_hosting: is_hosting === true ? true : is_hosting === false ? false : is_hosting,
  };
}

export async function lookupIpIntel(req: NextRequest, ip: string): Promise<IpIntel> {
  const geo = vercelGeo(req);
  const empty: IpIntel = {
    asn: null,
    asn_org: null,
    country: geo.country,
    city: geo.city,
    is_vpn: null,
    is_hosting: null,
  };
  if (!ip) return empty;

  const token = process.env.IPINFO_TOKEN;
  const url = token
    ? `https://ipinfo.io/${encodeURIComponent(ip)}?token=${encodeURIComponent(token)}`
    : `https://ipinfo.io/${encodeURIComponent(ip)}/json`;

  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    clearTimeout(t);
    if (!res.ok) return empty;
    const json = (await res.json()) as {
      org?: string;
      city?: string;
      country?: string;
      asn?: { asn?: string; name?: string; type?: string };
      privacy?: { vpn?: boolean; proxy?: boolean; tor?: boolean; hosting?: boolean };
    };

    let asn: number | null = null;
    let asn_org: string | null = null;
    if (json.asn?.asn) {
      asn = Number(String(json.asn.asn).replace(/^AS/i, '')) || null;
      asn_org = json.asn.name ?? null;
    } else {
      const parsed = parseAsnOrg(json.org ?? null);
      asn = parsed.asn;
      asn_org = parsed.asn_org;
    }

    const flags = inferFlags(
      asn_org,
      json.privacy ?? (json.asn?.type === 'hosting' ? { hosting: true } : undefined)
    );

    return {
      asn,
      asn_org,
      country: json.country || geo.country,
      city: json.city || geo.city,
      is_vpn: flags.is_vpn,
      is_hosting: flags.is_hosting,
    };
  } catch (err) {
    console.error('[DEVICE] IP intel lookup failed:', err instanceof Error ? err.message : err);
    return empty;
  }
}

export function mergeDeviceFields(
  req: NextRequest,
  client: DeviceClientFields
): Required<DeviceClientFields> {
  const uaParsed = parseUserAgent(req.headers.get('user-agent'));
  const ch = parseSecChUa(req.headers.get('sec-ch-ua'));
  const chOs = asText(req.headers.get('sec-ch-ua-platform'))?.replace(/"/g, '') ?? null;

  return {
    timezone: asText(client.timezone),
    browser: asText(client.browser) || ch.browser || uaParsed.browser,
    browser_version: asText(client.browser_version) || ch.browser_version || uaParsed.browser_version,
    os: asText(client.os) || chOs || uaParsed.os,
    device_fp: asText(client.device_fp),
  };
}

export async function recordAccountDevice(
  admin: SupabaseClient,
  args: {
    userId: string;
    event: 'signup' | 'login';
    deviceId: string;
    ip: string | null;
    client: DeviceClientFields;
    intel: IpIntel;
  }
): Promise<{ ok: boolean; error: string | null }> {
  const fields = args.client;

  // Direct insert — same pattern as the profiles upsert. Do not use the RPC
  // as the only path: if the function wasn't created, signup still succeeds
  // and account_devices stays empty with no signal.
  const { error } = await admin.from('account_devices').insert({
    user_id: args.userId,
    event: args.event,
    device_id: args.deviceId,
    device_fp: fields.device_fp ?? null,
    timezone: fields.timezone ?? null,
    browser: fields.browser ?? null,
    browser_version: fields.browser_version ?? null,
    os: fields.os ?? null,
    ip: args.ip,
    asn: args.intel.asn,
    asn_org: args.intel.asn_org,
    country: args.intel.country,
    city: args.intel.city,
    is_vpn: args.intel.is_vpn,
    is_hosting: args.intel.is_hosting,
  });

  if (error) {
    console.error('[DEVICE] account_devices insert failed:', error.message, error.details, error.hint);
    return { ok: false, error: error.message };
  }

  const { error: snapshotError } = await admin
    .from('profiles')
    .update({
      last_device_id: args.deviceId,
      last_ip: args.ip,
      last_seen_at: new Date().toISOString(),
    })
    .eq('id', args.userId);

  if (snapshotError) {
    // last_* columns are optional; don't fail the device row over them
    console.error('[DEVICE] profiles last_* snapshot failed:', snapshotError.message);
  }

  return { ok: true, error: null };
}

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
