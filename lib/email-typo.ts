// lib/email-typo.ts
//
// Suggests a correction when an email's domain looks like a misspelling of a
// common provider ("gmial.com", "gmail.copm", "hotmial.com"). Runs in the
// browser only and never blocks sign-up: it just offers "Did you mean …?".
//
// It can't catch mistakes in the part before the @, which is why sign-up also
// shows the "Double check your email" popup and the server checks that the
// domain can receive mail.

// Domains that are correct as typed. Legitimate look-alikes (mail.com, gmx.com,
// ymail.com, me.com, mac.com) are listed so they are never "corrected".
const KNOWN_DOMAINS = [
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.ca', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.ca', 'hotmail.co.uk', 'hotmail.fr',
  'outlook.com', 'live.com', 'live.ca', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me', 'pm.me',
  'gmx.com', 'gmx.de', 'mail.com', 'zoho.com', 'yandex.com',
  'yahoo.fr', 'yahoo.de', 'hotmail.de', 'outlook.fr', 'web.de', 'orange.fr', 'free.fr', 'laposte.net',
  'videotron.ca', 'sympatico.ca', 'bell.net', 'rogers.com', 'shaw.ca',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
];

const KNOWN_SET = new Set(KNOWN_DOMAINS);

// Damerau–Levenshtein distance (insert, delete, substitute, swap neighbours).
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * Returns a corrected email ("name@gmail.com") when the domain is a likely
 * misspelling of a known provider, otherwise null.
 */
export function suggestEmailCorrection(input: string): string | null {
  const email = input.trim();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (KNOWN_SET.has(domain)) return null;

  // Short domains need a closer match, to avoid "correcting" real ones.
  const maxDistance = domain.length >= 8 ? 2 : 1;

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of KNOWN_DOMAINS) {
    if (Math.abs(candidate.length - domain.length) > maxDistance) continue;
    const distance = editDistance(domain, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (best && bestDistance > 0 && bestDistance <= maxDistance) {
    return `${local}@${best}`;
  }
  return null;
}
