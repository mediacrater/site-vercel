// next.config.mjs
//
// PHASE 2: security headers + baseline Content Security Policy.
//
// CSP_MODE (Vercel environment variable, read at BUILD time, so redeploy
// after changing it):
//   unset / "report-only"  -> Content-Security-Policy-Report-Only (nothing blocked,
//                             violations reported to /api/csp-report)
//   "enforce"              -> Content-Security-Policy (violations blocked AND reported)
//   "off"                  -> no CSP header (emergency switch)
//
// The CSP is skipped in `next dev`, because the dev server relies on eval and
// inline scripts that would trip it.

/** Returns the origin ("https://host") of a URL env var, or null. */
function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const isProductionBuild = process.env.NODE_ENV === 'production';
const supabaseOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const vpsOrigin = originOf(process.env.NEXT_PUBLIC_VPS_API_URL);
const cspMode = (process.env.CSP_MODE || 'report-only').trim().toLowerCase();

if (!['report-only', 'enforce', 'off'].includes(cspMode)) {
  throw new Error(`CSP_MODE must be "report-only", "enforce" or "off" (got "${cspMode}")`);
}

// Fail the build instead of shipping a policy that blocks Supabase or the VPS.
if (isProductionBuild && cspMode !== 'off' && (!supabaseOrigin || !vpsOrigin)) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_VPS_API_URL must be valid URLs to build the Content Security Policy'
  );
}

const TURNSTILE = 'https://challenges.cloudflare.com';
// Cloudflare Web Analytics: Cloudflare inserts this beacon into every proxied
// page in the mediacrater.com zone (LIVE uses these stats), and it sends its
// data to cloudflareinsights.com.
const CF_INSIGHTS_SCRIPT = 'https://static.cloudflareinsights.com';
const CF_INSIGHTS_CONNECT = 'https://cloudflareinsights.com';

function buildCsp() {
  const directives = {
    'default-src': ["'self'"],
    // 'unsafe-inline' is required for Next.js's inline scripts on static pages.
    // Replacing it with per-page hashes is the possible future upgrade.
    'script-src': ["'self'", "'unsafe-inline'", TURNSTILE, CF_INSIGHTS_SCRIPT],
    // React style={} attributes and the chart component's <style> need this.
    'style-src': ["'self'", "'unsafe-inline'"],
    // data:/blob: = canvas and video thumbnails; Supabase = signed thumbnail URLs;
    // https: = previews of image URLs users paste into the scanner, which can be
    // on any host (e.g. fbcdn.net). Images can't run code.
    'img-src': ["'self'", 'data:', 'blob:', supabaseOrigin, 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", supabaseOrigin, vpsOrigin, TURNSTILE, CF_INSIGHTS_CONNECT],
    // Turnstile widget + the VPS cf-ok clearance iframe (ApiHostClearance.tsx).
    'frame-src': [TURNSTILE, vpsOrigin],
    // Audio extraction worker; blob: covers bundlers that start workers from blob URLs.
    'worker-src': ["'self'", 'blob:'],
    // https: = createVideoUrlThumbnail() loads pasted video URLs to grab a frame.
    'media-src': ["'self'", 'blob:', 'https:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'report-uri': ['/api/csp-report'],
  };

  const parts = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.filter(Boolean).join(' ')}`
  );

  // Browsers ignore (and warn about) this directive in report-only mode.
  if (cspMode === 'enforce') parts.push('upgrade-insecure-requests');

  return parts.join('; ');
}

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // same-origin-allow-popups keeps window.open() (Stripe billing portal) working.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  {
    // browsing-topics was removed: current Chrome no longer recognises it and
    // logs a console error on every page.
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
];

if (isProductionBuild && cspMode !== 'off') {
  securityHeaders.push({
    key: cspMode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    value: buildCsp(),
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // PHASE 2: stop advertising "X-Powered-By: Next.js".
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/db/:path*",
        destination: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/:path*`,
      },
    ];
  },
}

export default nextConfig
