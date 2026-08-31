// lib/collect-device-client.ts
// Client-only. Import from app/signup/page.tsx (and later /signin).
// Sends browser-side signals the server cannot see (timezone, UA-CH, fp).
// Does NOT read or write mc_device_id — that cookie is HttpOnly and set by /api/signup.

export type DeviceClientPayload = {
  timezone: string | null;
  browser: string | null;
  browser_version: string | null;
  os: string | null;
  device_fp: string | null;
};

type UADataBrand = { brand: string; version: string };

type NavigatorUAData = {
  platform?: string;
  brands?: UADataBrand[];
  getHighEntropyValues?: (hints: string[]) => Promise<{
    platform?: string;
    platformVersion?: string;
    fullVersionList?: UADataBrand[];
  }>;
};

function pickBrand(brands: UADataBrand[] | undefined): UADataBrand | null {
  if (!brands?.length) return null;
  const real = brands.filter((b) => !/not.?a.?brand/i.test(b.brand));
  const named =
    real.find((b) => /google chrome/i.test(b.brand)) ||
    real.find((b) => /microsoft edge/i.test(b.brand)) ||
    real.find((b) => /firefox|safari|opera|brave|samsung/i.test(b.brand)) ||
    real.find((b) => /chromium/i.test(b.brand)) ||
    real[0];
  return named ?? null;
}

function parseUaFallback(ua: string): Pick<DeviceClientPayload, 'browser' | 'browser_version' | 'os'> {
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

async function sha256Hex(input: string): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

export async function collectDeviceClient(): Promise<DeviceClientPayload> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  const ua = navigator.userAgent || '';
  const fallback = parseUaFallback(ua);

  let browser = fallback.browser;
  let browser_version = fallback.browser_version;
  let os = fallback.os;

  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  if (uaData) {
    os = uaData.platform || os;
    const brand = pickBrand(uaData.brands);
    if (brand) {
      browser = brand.brand;
      browser_version = brand.version;
    }
    try {
      const high = await uaData.getHighEntropyValues?.([
        'platform',
        'platformVersion',
        'fullVersionList',
      ]);
      if (high?.platform) os = high.platform;
      const full = pickBrand(high?.fullVersionList);
      if (full) {
        browser = full.brand;
        browser_version = full.version;
      }
    } catch {
      // UA-CH can throw if the user denies high-entropy hints — fallback is enough.
    }
  }

  const langs = (navigator.languages?.length ? navigator.languages : [navigator.language])
    .filter(Boolean)
    .join(',');
  const screenKey =
    typeof screen !== 'undefined'
      ? `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`
      : '';

  const device_fp = await sha256Hex(
    [ua, timezone ?? '', langs, screenKey, os ?? '', navigator.platform ?? ''].join('|')
  );

  return {
    timezone,
    browser,
    browser_version,
    os,
    device_fp,
  };
}
