## The iframe did not put users on Cloudflare’s network. Orange-cloud was already there. asn_org = Cloudflare Inc means you are geolocating Cloudflare’s edge IP (AS13335), not the visitor.
TCP peer on the VPS is always a Cloudflare anycast IP. The real client is in CF-Connecting-IP.
Your capture in authenticateUser is:

const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

## req.socket.remoteAddress is Cloudflare. X-Forwarded-For can start with another proxy, or be missing. After /cf-ok, the VPS sees more hits; if anything logs IP from the socket or a bad XFF, every user becomes Cloudflare.
Cloudflare’s own docs: use CF-Connecting-IP, not XFF, for the visitor IP.
Fix
1. Helper (e.g. top of server.js or helpers.js):

// --- START OF CODE ---
function getClientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();

  const trueClient = req.headers['true-client-ip'];
  if (trueClient) return String(trueClient).trim();

  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const parts = String(xff).split(',').map(s => s.trim()).filter(Boolean);
    return parts[0];
  }

  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
// --- END OF CODE ---

## 2. Replace the line in authenticateUser (the ip_at_creation block):
const clientIp = getClientIp(req);

## Change this function in lib/account-device.ts

Replace:

// --- START OF CODE ---
export function clientIpFrom(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
  return forwarded.split(',')[0].trim();
}
// --- END OF CODE ---

with:

// --- START OF CODE ---
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
// --- END OF CODE ---

Two different apps, two different IP reads:

Next.js clientIpFrom => signup/login asn_org, account_devices => cf-connecting-ip — this was the bug you just fixed

VPS authenticateUser => ip_at_creation, abuse, rate limits => same header — keep getClientIp
