'use client';

// components/app-shell.tsx
//
// Sidebar (nav) + top bar (scan count, dark mode, account) together —
// the standard combo, not an either/or. CommandPalette and
// KeyboardShortcuts mount once here so every page under the shell gets
// both automatically without wiring them individually.
//
// Mobile: sidebar and top bar are both desktop-only (lg: breakpoint).
// Below that, a single compact strip covers navigation + scan count +
// account in one hamburger panel — full parity, just consolidated for
// the smaller screen instead of two separate desktop-style bars stacked
// on top of each other.

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X, LayoutDashboard, History, Settings as SettingsIcon } from 'lucide-react';
import { AppSidebar } from '@/components/app-sidebar';
import { AppTopBar } from '@/components/app-topbar';
import { CommandPalette } from '@/components/command-palette';
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { ThemeToggle } from '@/components/theme-toggle';
import { supabase } from '@/lib/mediacrater/supabaseClient';

const EXTENSION_LINK =
  'https://chromewebstore.google.com/detail/mediacrater-ad-compliance/fgekklkpomdcadiaekpigidkimnkjpnf?utm_medium=app_mobile_nav';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/scan-history', label: 'Scan History', icon: History },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function AppShell({
  userEmail,
  plan = null,
  scansRemaining = null,
  children,
}: {
  userEmail: string | null;
  plan?: string | null;
  scansRemaining?: number | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/signin');
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <AppSidebar />
      <CommandPalette />
      <KeyboardShortcuts />

      <div className="flex-1 min-w-0">
        <AppTopBar userEmail={userEmail} plan={plan} scansRemaining={scansRemaining} />

        {/* Mobile top bar — sidebar + desktop top bar are both lg:-only */}
        <div className="lg:hidden sticky top-0 z-40 flex items-center justify-between h-14 px-4 border-b border-border bg-background/95 backdrop-blur-sm">
          <Link href="/" className="font-bold text-sm">
            Mediacrater
          </Link>
          <div className="flex items-center gap-2">
            {plan && (
              <span className="text-xs font-medium text-foreground border border-border rounded-full px-2 py-1 capitalize">
                {plan}
              </span>
            )}
            {scansRemaining !== null && (
              <span className="font-mono text-xs tabular-nums px-2 py-1 rounded-full bg-primary/10 text-primary">
                {scansRemaining} left
              </span>
            )}
            <button
              type="button"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="p-2 text-muted-foreground hover:text-foreground"
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileNavOpen && (
          <div className="lg:hidden border-b border-border bg-background px-4 py-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileNavOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
            <div className="pt-2 mt-2 border-t border-border space-y-1">
              <div className="flex items-center justify-between px-3 py-1">
                {userEmail && <p className="text-xs text-muted-foreground truncate">{userEmail}</p>}
                <ThemeToggle />
              </div>
              <a
                href={EXTENSION_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-secondary"
              >
                Get the Chrome extension ↗
              </a>
              <button
                type="button"
                onClick={handleSignOut}
                className="block w-full text-left px-3 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-secondary"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}

        <main className="max-w-[1200px] mx-auto px-6 lg:px-10 py-10">{children}</main>
      </div>
    </div>
  );
}
