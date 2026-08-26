'use client';

// components/keyboard-shortcuts.tsx
//
// Direct port of popup.js's KEYBIND_MAP: w -> main, a -> history,
// s -> settings, d -> theme toggle. Same guard logic (skip while typing
// in an input/textarea/contenteditable) as the original.
//
// One adaptation: the extension gated 'a' behind a paid-plan check
// before navigating, showing an upgrade modal if the user was free.
// Not replicated here — /scan-history already shows its own upgrade
// prompt for free users (see app/scan-history/page.tsx), so gating twice
// would be redundant. 'a' just navigates there; the destination handles
// the free-plan case.
//
// No UI — mount this once per authenticated layout (inside AppShell).

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';

const KEYBIND_MAP: Record<string, string> = {
  w: '/dashboard',
  a: '/scan-history',
  s: '/settings',
  d: 'theme',
};

export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip while typing anywhere, or with a modifier held (don't hijack
      // browser/OS shortcuts like Cmd+A select-all)
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = KEYBIND_MAP[e.key.toLowerCase()];
      if (!target) return;

      e.preventDefault();

      if (target === 'theme') {
        setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
        return;
      }

      if (pathname === target) return; // already there, matches original's no-op check
      router.push(target);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [router, pathname, resolvedTheme, setTheme]);

  return null;
}
