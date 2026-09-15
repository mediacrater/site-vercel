'use client';

// components/app-sidebar.tsx

import Link from 'next/link';
import Image from 'next/image';
import {
  usePathname,
} from 'next/navigation';
import {
  useTheme,
} from 'next-themes';
import {
  useEffect,
  useState,
} from 'react';

import {
  CheckCircle2,
  History,
  LayoutDashboard,
  Loader2,
  Settings as SettingsIcon,
  XCircle,
} from 'lucide-react';

import {
  useBackgroundScanState,
} from '@/lib/mediacrater/backgroundScanStore';

const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    href: '/scan-history',
    label: 'Scan History',
    icon: History,
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: SettingsIcon,
  },
];

function DashboardScanStatus({
  status,
}: {
  status:
    | 'idle'
    | 'preparing'
    | 'running'
    | 'completed'
    | 'error';
}) {
  if (
    status === 'preparing' ||
    status === 'running'
  ) {
    return (
      <span
        className="ml-auto inline-flex items-center text-primary"
        title="Scan in progress"
        aria-label="Scan in progress"
      >
        <Loader2
          className="w-4 h-4 animate-spin"
          aria-hidden="true"
        />
      </span>
    );
  }

  if (status === 'completed') {
    return (
      <span
        className="ml-auto inline-flex items-center text-green-600 dark:text-green-400"
        title="Scan complete"
        aria-label="Scan complete"
      >
        <CheckCircle2
          className="w-4 h-4"
          aria-hidden="true"
        />
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span
        className="ml-auto inline-flex items-center text-red-600 dark:text-red-400"
        title="Scan failed"
        aria-label="Scan failed"
      >
        <XCircle
          className="w-4 h-4"
          aria-hidden="true"
        />
      </span>
    );
  }

  return null;
}

export function AppSidebar() {
  const pathname =
    usePathname();

  const {
    resolvedTheme,
  } =
    useTheme();

  const [
    mounted,
    setMounted,
  ] =
    useState(false);

  const backgroundScan =
    useBackgroundScanState();

  useEffect(
    () => setMounted(true),
    []
  );

  const logoSrc =
    mounted &&
    resolvedTheme === 'dark'
      ? '/images/header-logo-dark.png'
      : '/images/header-logo.png';

  return (
    <aside className="hidden lg:flex flex-col w-64 shrink-0 h-screen sticky top-0 border-r border-border bg-card">
      <Link
        href="/"
        className="flex items-center gap-2 px-6 h-16 border-b border-border"
      >
        <Image
          src={logoSrc}
          alt="Mediacrater"
          width={32}
          height={32}
          className="h-8 w-8"
        />

        <span className="text-lg font-bold text-foreground">
          Mediacrater
        </span>
      </Link>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(
          (item) => {
            const active =
              pathname ===
              item.href;

            const Icon =
              item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                <Icon
                  className="w-4 h-4 shrink-0"
                  aria-hidden="true"
                />

                <span>
                  {item.label}
                </span>

                {item.href ===
                  '/dashboard' && (
                  <DashboardScanStatus
                    status={
                      backgroundScan.status
                    }
                  />
                )}
              </Link>
            );
          }
        )}
      </nav>
    </aside>
  );
}
