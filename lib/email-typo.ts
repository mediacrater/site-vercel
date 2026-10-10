// lib/email-typo.ts
//
// Suggests a correction when an email's domain looks like a misspelling of a
// common provider ("gmial.com", "gmail.copm", "hotmial.com"). Runs in the
// browser only and never blocks sign-up: it just offers "Did you mean …?".
//
// It can't catch mistakes in the part before the @, which is why sign-up also
// shows the "Double check your email" popup and the server checks that the
// domain can receive mail.
//
// CHANGES (popup only for unknown domains):
// - PROVIDER_DOMAINS: every public mailbox domain we recognise (major webmail,
//   privacy providers, Fastmail / mail.com / GMX families, ISPs, regional
//   providers). isKnownProviderDomain() uses it, and sign-up skips the
//   "Double check your email" popup when it returns true.
// - SUGGESTION_TARGETS (the old KNOWN_DOMAINS list, unchanged) is still the only
//   list "Did you mean …?" suggests from. Suggesting from all ~250 domains would
//   "correct" real custom domains into obscure ones (e.g. Fastmail's eml.cc,
//   imap.cc, mailc.net), so the big list is only ever used for exact matches.
// - Domains are compared lowercased, trimmed, with a trailing dot removed.

// Popular providers that "Did you mean …?" may suggest. Legitimate look-alikes
// (mail.com, gmx.com, ymail.com, me.com, mac.com) are listed so they are never
// "corrected".
const SUGGESTION_TARGETS = [
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

// Exact-match list: an email on any of these skips the confirmation popup.
// Includes everything in SUGGESTION_TARGETS.
const PROVIDER_DOMAINS = [
  ...SUGGESTION_TARGETS,

  // Google
  // (gmail.com, googlemail.com above)

  // Microsoft
  'passport.com', 'windowslive.com', 'live.co.uk',

  // Yahoo
  'y7mail.com', 'kimo.com', 'yahoo.co.jp', 'yahoo.com.ar', 'yahoo.com.au',
  'yahoo.com.br', 'yahoo.co.in', 'yahoo.co.id',

  // Proton
  'protonmail.ch',

  // Tuta
  'tuta.com', 'tutanota.com', 'tutanota.de', 'tutamail.com', 'tuta.io', 'keemail.me',

  // Zoho
  'zohomail.com',

  // Fastmail
  'fastmail.com', 'sent.com', 'fastmail.fm', '123mail.org', '150mail.com', '150ml.com',
  '16mail.com', '2-mail.com', '4email.net', '50mail.com', 'airpost.net', 'eml.cc',
  'f-m.fm', 'fast-email.com', 'fast-mail.org', 'fastem.com', 'fastemailer.com',
  'fastest.cc', 'fastmail.ca', 'fastmail.cn', 'fastmail.co.uk', 'fastmail.de',
  'fastmail.es', 'fastmail.fr', 'fastmail.nl', 'fastmail.se', 'fastmail.uk',
  'fastmail.us', 'fmail.co.uk', 'h-mail.us', 'bestmail.us', 'fastemail.us', 'ftml.net',
  'hailmail.net', 'imap-mail.com', 'imap.cc', 'imapmail.org', 'immerbox.com',
  'immermail.com', 'inoutbox.com', 'internet-e-mail.com', 'internet-mail.org',
  'internetemails.net', 'internetmailing.net', 'jetemail.net', 'justemail.net',
  'letterboxes.org', 'lifetimeaddress.com', 'mail-central.com', 'mail-page.com',
  'mailas.com', 'mailbolt.com', 'mailc.net', 'siempremail.com', 'speedpost.net',
  'speedymail.org', 'ssl-mail.com', 'swift-mail.com', 'the-fastest.net',
  'the-quickest.com', 'theinternetemail.com', 'veribox.net', 'veryfast.biz',
  'warpmail.net', 'xsmail.com', 'yepmail.net', 'your-mail.com',

  // mail.com
  'email.com', 'usa.com', 'consultant.com', 'iname.com', 'myself.com', 'post.com',
  'writeme.com', 'dr.com', 'engineer.com', 'cheerful.com', 'techie.com', 'doctor.com',
  'workmail.com', 'europe.com', 'mail.org', 'homemail.com', 'mindless.com',
  'lawyer.com', 'realtyagent.com', 'execs.com', 'earthling.net', 'bikerider.com',
  'contractor.net', 'rescueteam.com',

  // GMX / Web.de
  'gmx.net', 'gmx.at', 'gmx.ch', 'gmx.fr', 'gmx.co.uk', 'gmx.us', 'gmx.es',
  'gmx-topmail.de', 'gmx.eu', 'gmx.li', 'email.de',

  // AT&T
  'bellsouth.net', 'pacbell.net', 'prodigy.net', 'swbell.net', 'ameritech.net',
  'snet.net', 'flash.net', 'currently.com',

  // Charter Spectrum / RoadRunner
  'charter.net', 'roadrunner.com', 'twc.com', 'tampabay.rr.com', 'cfl.rr.com', 'nc.rr.com',

  // CenturyLink
  'centurylink.net', 'q.com', 'embarqmail.com', 'centurytel.net',

  // Earthlink
  'earthlink.net', 'mindspring.com', 'peoplepc.com',

  // Optimum
  'optonline.net', 'optimum.net',

  // Tencent
  'qq.com', 'foxmail.com', 'vip.qq.com', 'qmail.com',

  // Yandex
  'yandex.ru', 'yandex.com.tr', 'ya.ru', 'narod.ru', 'yandex.by', 'yandex.kz',

  // Mail.ru
  'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'icqmail.com',

  // Seznam
  'seznam.cz', 'email.cz', 'post.cz',

  // Others
  't-online.de', 'libero.it',
];

const PROVIDER_SET = new Set(PROVIDER_DOMAINS);

// Lowercased domain of an email, or null if there isn't a usable one.
function domainOf(input: string): string | null {
  const email = input.trim();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase().replace(/\.$/, '');
}

/**
 * True when the email ends in a recognised public provider domain
 * (exact match, e.g. "gmail.com" yes, "gmail.copm" no). Sign-up skips the
 * confirmation popup for these.
 */
export function isKnownProviderDomain(input: string): boolean {
  const domain = domainOf(input);
  return domain !== null && PROVIDER_SET.has(domain);
}

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
 * misspelling of a popular provider, otherwise null.
 */
export function suggestEmailCorrection(input: string): string | null {
  const email = input.trim();
  const domain = domainOf(email);
  if (domain === null) return null;

  // Any recognised provider domain is correct as typed, never "corrected".
  if (PROVIDER_SET.has(domain)) return null;

  const local = email.slice(0, email.lastIndexOf('@'));

  // Short domains need a closer match, to avoid "correcting" real ones.
  const maxDistance = domain.length >= 8 ? 2 : 1;

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of SUGGESTION_TARGETS) {
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
