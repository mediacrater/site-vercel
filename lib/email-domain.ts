// lib/email-domain.ts
//
// Server-only. Checks that an email's domain can receive mail at all, so
// sign-ups with typos like "gmail.copm" or "outlok.con" are rejected before a
// confirmation email bounces (bounces hurt the domain's sending reputation,
// and Resend then suppresses the address).
//
// Fails OPEN: if DNS is slow or broken, the sign-up is allowed. Only a clear
// "this domain doesn't exist / can't receive mail" answer blocks it.

import { Resolver } from 'node:dns/promises';

export type EmailDomainResult = 'ok' | 'no_mail' | 'unknown';

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 2_000;
const cache = new Map<string, { result: EmailDomainResult; expires: number }>();

// No such domain, or the domain exists but has no records of this type.
const NOT_FOUND_CODES = new Set(['ENOTFOUND', 'ENODATA']);

function newResolver(): Resolver {
  return new Resolver({ timeout: 2_000, tries: 1 });
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const raw = email.slice(at + 1).trim().toLowerCase();
  if (!raw || raw.length > 253) return null;
  try {
    // Converts international domain names to their ASCII (punycode) form.
    const hostname = new URL(`http://${raw}`).hostname;
    return hostname.includes('.') ? hostname : null;
  } catch {
    return null;
  }
}

async function lookup(domain: string): Promise<EmailDomainResult> {
  const resolver = newResolver();
  try {
    const records = await resolver.resolveMx(domain);
    // RFC 7505 "null MX" (exchange "." or empty) means: accepts no mail.
    const usable = records.filter((r) => r.exchange && r.exchange !== '.');
    return usable.length > 0 ? 'ok' : 'no_mail';
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (!NOT_FOUND_CODES.has(code)) return 'unknown';
  }

  // No MX record: mail servers fall back to the domain's own address
  // (A/AAAA), so only reject if there's no address either.
  for (const type of ['A', 'AAAA'] as const) {
    try {
      const addresses = type === 'A' ? await resolver.resolve4(domain) : await resolver.resolve6(domain);
      if (addresses.length > 0) return 'ok';
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      if (!NOT_FOUND_CODES.has(code)) return 'unknown';
    }
  }
  return 'no_mail';
}

export async function checkEmailDomain(email: string): Promise<EmailDomainResult> {
  const domain = domainOf(email);
  if (!domain) return 'no_mail';

  const cached = cache.get(domain);
  if (cached && cached.expires > Date.now()) return cached.result;

  const result = await lookup(domain);

  // Don't cache "unknown" (a temporary DNS problem).
  if (result !== 'unknown') {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(domain, { result, expires: Date.now() + CACHE_TTL_MS });
  }
  return result;
}
