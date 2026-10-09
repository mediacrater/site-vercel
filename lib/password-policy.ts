// lib/password-policy.ts
//
// The password rules, shared by the sign-up page, the password-reset dialog
// (both show them as a live checklist) and the server (/api/signup,
// /api/signin). Keep this file and the Supabase setting in sync:
//
//   Supabase → Authentication → (Sign In / Providers →) Email:
//     Minimum password length: 10
//     Password requirements: "Lowercase, uppercase letters, digits and symbols"
//
// Supabase enforces those on EVERY path (sign-up, reset, password change),
// so the checklist only has to make the rules visible.
//
// Notes:
// - Any character is safe. Supabase stores a bcrypt hash, never the text.
// - bcrypt only uses the first 72 BYTES, so longer passwords are refused.
//   Accented letters and emoji take 2–4 bytes each.
// - Spaces are allowed (passphrases), but not at the start or end, where they
//   are invisible and cause "wrong password" confusion at sign-in.
// - Letters and symbols are counted exactly like Supabase counts them: plain
//   a–z / A–Z, and this symbol set. Accented letters or "€" don't count.

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 72;

// Supabase Auth's symbol set for the "...and symbols" requirement.
const SYMBOLS = `!@#$%^&*()_+-=[]{};'\\:"|<>?,./\`~`;

export type PasswordRuleId =
  | 'length'
  | 'lowercase'
  | 'uppercase'
  | 'number'
  | 'symbol'
  | 'edges'
  | 'maxBytes';

export type PasswordRule = {
  id: PasswordRuleId;
  label: string;
  /** Rules that only matter when broken are hidden until they fail. */
  showOnlyWhenFailing?: boolean;
  test: (password: string) => boolean;
};

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (p) => Array.from(p).length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'lowercase',
    label: 'At least one lowercase letter (a–z)',
    test: (p) => /[a-z]/.test(p),
  },
  {
    id: 'uppercase',
    label: 'At least one uppercase letter (A–Z)',
    test: (p) => /[A-Z]/.test(p),
  },
  {
    id: 'number',
    label: 'At least one number',
    test: (p) => /[0-9]/.test(p),
  },
  {
    id: 'symbol',
    label: 'At least one special character (e.g. ! @ # $ %)',
    test: (p) => Array.from(p).some((c) => SYMBOLS.includes(c)),
  },
  {
    id: 'edges',
    label: 'No space at the start or end',
    showOnlyWhenFailing: true,
    test: (p) => p === p.trim(),
  },
  {
    id: 'maxBytes',
    label: 'Too long (maximum 72 characters, fewer with accents or emoji)',
    showOnlyWhenFailing: true,
    test: (p) => utf8Length(p) <= PASSWORD_MAX_BYTES,
  },
];

export function checkPassword(password: string) {
  const results = PASSWORD_RULES.map((rule) => ({
    ...rule,
    passed: rule.test(password),
  }));
  return {
    results,
    valid: results.every((r) => r.passed),
  };
}

export function isPasswordValid(password: unknown): password is string {
  return typeof password === 'string' && checkPassword(password).valid;
}
