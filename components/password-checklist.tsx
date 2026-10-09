// components/password-checklist.tsx
//
// Live password requirements list: each item turns green as it's met.
// Rules come from lib/password-policy.ts, the same rules the server uses.

'use client';

import { checkPassword } from '@/lib/password-policy';

type Props = {
  password: string;
  /** Optional: also show whether the confirmation field matches. */
  confirmPassword?: string;
  id?: string;
};

export function PasswordChecklist({ password, confirmPassword, id }: Props) {
  const { results } = checkPassword(password);

  type Item = { key: string; label: string; passed: boolean; alwaysRed: boolean };

  const items: Item[] = results
    .filter((r) => !r.showOnlyWhenFailing || (password.length > 0 && !r.passed))
    .map((r) => ({ key: r.id, label: r.label, passed: r.passed, alwaysRed: !!r.showOnlyWhenFailing }));

  if (confirmPassword !== undefined) {
    items.push({
      key: 'match',
      label: 'Passwords match',
      passed: password.length > 0 && password === confirmPassword,
      alwaysRed: false,
    });
  }

  return (
    <ul id={id} aria-live="polite" className="mt-2 space-y-1 text-xs">
      {items.map((item) => (
        <li
          key={item.key}
          className={`flex items-start gap-1.5 transition-colors ${
            item.passed
              ? 'text-green-600 dark:text-green-400'
              : item.alwaysRed
              ? 'text-red-600 dark:text-red-400'
              : 'text-muted-foreground'
          }`}
        >
          <span aria-hidden="true" className="w-3 shrink-0 text-center">
            {item.passed ? '✓' : item.alwaysRed ? '✕' : '○'}
          </span>
          <span>
            {item.label}
            <span className="sr-only">{item.passed ? ' (done)' : ' (not yet)'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
