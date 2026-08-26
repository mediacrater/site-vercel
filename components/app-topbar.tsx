'use client';

// components/app-topbar.tsx
//
// Mirrors the extension's popup header layout — email, scan count,
// settings — but adapted: Settings already has its own sidebar entry, so
// putting it a second time in this dropdown would just be a redundant
// second path to the same page. Dropdown here is deliberately minimal:
// Get extension + Sign out only.
//
// Scan count is the signature element per the design pass — mono font,
// its own pill, not just another line of body text. Only rendered when
// scansRemaining is a real number (i.e. actually signed in with a loaded
// profile) — never shown mid-load or signed out.

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { supabase } from '@/lib/mediacrater/supabaseClient';

const EXTENSION_LINK =
  'https://chromewebstore.google.com/detail/mediacrater-ad-compliance/fgekklkpomdcadiaekpigidkimnkjpnf?utm_medium=app_topbar';

export function AppTopBar({
  userEmail,
  plan,
  scansRemaining,
}: {
  userEmail: string | null;
  plan: string | null;
  scansRemaining: number | null;
}) {
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleSignOut() {
    setDropdownOpen(false);
    await supabase.auth.signOut();
    router.push('/signin');
  }

  return (
    <div className="hidden lg:flex items-center justify-end gap-3 h-16 px-8 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-30">
      {plan && (
        <div className="px-3 py-1.5 rounded-full border border-border text-xs font-medium text-foreground capitalize">
          {plan}
        </div>
      )}

      {scansRemaining !== null && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary">
          <span className="font-mono text-xs tabular-nums font-semibold">{scansRemaining}</span>
          <span className="text-xs text-primary/80">scans left</span>
        </div>
      )}

      <ThemeToggle />

      {userEmail && (
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-muted-foreground transition-colors max-w-[200px]"
          >
            <span className="truncate">{userEmail}</span>
            <ChevronDown className="h-4 w-4 flex-shrink-0" />
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-card shadow-lg py-1.5 z-50">
              <a
                href={EXTENSION_LINK}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setDropdownOpen(false)}
                className="block px-4 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
              >
                Get the Chrome extension ↗
              </a>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                onClick={handleSignOut}
                className="block w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-secondary transition-colors"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
