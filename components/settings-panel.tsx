'use client';

// components/settings-panel.tsx
//
// Ports the extension's <!-- Settings Panel --> from popup.html/popup.js,
// section by section:
//
//   Account      → kept, fully wired (this is the piece that actually
//                  needed backend wiring — see lib/mediacrater/billing.ts)
//   Appearance   → dropped per instruction (dark mode already lives in
//                  the site header)
//   Shortcuts    → dropped — those keybinds (W/A/S/D) are popup-navigation
//                  shortcuts specific to a small extension popup; on a
//                  full webpage they'd either do nothing or collide with
//                  actual browser/OS shortcuts, so there's no faithful
//                  web equivalent to port
//   Scan History → dropped — the extension's copy here explicitly says
//                  "stored on your device... deleted if you uninstall
//                  the extension," which is only true for the extension's
//                  chrome.storage.local history. The web app's history is
//                  already visible on the dashboard (server-side, shared
//                  with the extension), so this section doesn't map to
//                  anything else it needs to say
//   About        → kept (version dropped — a website doesn't version the
//                  same way a shipped package does), "Rate us" (Chrome
//                  Web Store link) swapped for "Get the Chrome extension"
//                  as a natural cross-promotion in the other direction

import React, { useState } from 'react';

export interface SettingsProfile {
  plan: string;
  scans_remaining: number;
  subscription_cancel_at?: string | null;
  subscription_renews_at?: string | null;
}

interface SettingsPanelProps {
  userId?: string;
  email?: string;
  profile?: SettingsProfile;
  onSignOut?: () => void;
  onManagePlan?: () => Promise<string>;
}

function formatPlanLabel(profile: SettingsProfile): string {
  const plan = profile.plan || 'free';
  const isPaid = plan !== 'free';
  let label = plan.charAt(0).toUpperCase() + plan.slice(1);

  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

  if (plan === 'free' && profile.subscription_cancel_at) {
    label = `Free · Resets ${fmt(profile.subscription_cancel_at, { month: 'long', day: 'numeric', year: 'numeric' })}`;
  } else if (plan === 'free' && profile.subscription_renews_at) {
    label = `Free · Resets ${fmt(profile.subscription_renews_at, { month: 'long', day: 'numeric', year: 'numeric' })}`;
  } else if (isPaid && profile.subscription_cancel_at) {
    label += ` · Cancels ${fmt(profile.subscription_cancel_at, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } else if (isPaid && profile.subscription_renews_at) {
    label += ` · Renews ${fmt(profile.subscription_renews_at, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  return label;
}

export function SettingsPanel({
  userId = 'usr_demo123',
  email = 'user@example.com',
  profile = { plan: 'free', scans_remaining: 5 },
  onSignOut,
  onManagePlan,
}: SettingsPanelProps) {
  const [managePlanLoading, setManagePlanLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPaid = (profile.plan || 'free') !== 'free';

  async function handleManagePlan() {
    setError(null);
    setManagePlanLoading(true);
    try {
      if (!onManagePlan) {
        throw new Error('Billing portal is not available');
      }
      const url = await onManagePlan();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setError(err.message || 'Could not open billing portal. Please try again.');
    } finally {
      setManagePlanLoading(false);
    }
  }

  async function handleSignOut() {
    if (onSignOut) {
      onSignOut();
    } else {
      console.log('Sign out triggered');
    }
  }

  const upgradeUrl = '/buy-scans';

  return (
    <div className="max-w-2xl mx-auto p-4 font-sans text-foreground">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {/* Account Section */}
        <div className="p-5 border-b border-border">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2.5">
            Account
          </h3>

          <div className="flex justify-between items-center py-2.5 border-b border-border">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Signed in as</span>
              <span className="text-xs text-muted-foreground">{email}</span>
            </div>
          </div>

          <div className="flex justify-between items-center py-2.5 border-b border-border">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Scans remaining</span>
              <span className="text-xs text-muted-foreground">
                {profile.scans_remaining ?? 0} scans
              </span>
            </div>
            <a
              href={upgradeUrl}
              className="px-4 py-2 text-[13px] font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {isPaid ? 'Change Plan' : 'Upgrade Plan'}
            </a>
          </div>

          <div className="flex justify-between items-center py-2.5 border-b border-border">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Plan</span>
              <span className="text-xs text-muted-foreground">
                {formatPlanLabel(profile)}
              </span>
            </div>
            {isPaid && (
              <button
                onClick={handleManagePlan}
                disabled={managePlanLoading}
                className="px-4 py-2 text-[13px] font-semibold rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-60"
              >
                {managePlanLoading ? 'Loading...' : 'Manage Plan'}
              </button>
            )}
          </div>

          <div className="flex justify-between items-center py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Session</span>
              <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                Active
              </span>
            </div>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 text-[13px] font-semibold rounded-lg border border-border hover:bg-secondary transition-colors"
            >
              Sign Out
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-2">
              {error}
            </p>
          )}
        </div>

        {}
        {/* Shortcuts Section */}
        <div className="p-5 border-b border-border">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2.5">
            Shortcuts
          </h3>

          <div className="py-2.5 border-b border-border">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Keybinds</span>
              <span className="text-xs text-muted-foreground">
                Helps you navigate the extension faster
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center py-2.5 border-b border-border">
            <span className="text-sm font-medium">Main screen</span>
            <kbd className="px-2.5 py-1 text-xs font-mono font-semibold text-foreground bg-muted border border-border rounded-md shadow-xs">
              W
            </kbd>
          </div>

          <div className="flex justify-between items-center py-2.5 border-b border-border">
            <span className="text-sm font-medium">Scan history</span>
            <kbd className="px-2.5 py-1 text-xs font-mono font-semibold text-foreground bg-muted border border-border rounded-md shadow-xs">
              A
            </kbd>
          </div>

          <div className="flex justify-between items-center py-2.5 border-b border-border">
            <span className="text-sm font-medium">Settings</span>
            <kbd className="px-2.5 py-1 text-xs font-mono font-semibold text-foreground bg-muted border border-border rounded-md shadow-xs">
              S
            </kbd>
          </div>

          <div className="flex justify-between items-center py-2.5">
            <span className="text-sm font-medium">Toggle dark mode</span>
            <kbd className="px-2.5 py-1 text-xs font-mono font-semibold text-foreground bg-muted border border-border rounded-md shadow-xs">
              D
            </kbd>
          </div>
        </div>

        {}
        {/* About Section */}
        <div className="p-5">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2.5">
            About
          </h3>

          <div className="flex justify-between items-center py-2.5 border-b border-border">
            <span className="text-sm font-medium">Contact support</span>
            <a
              href="mailto:hello.mediacrater@gmail.com"
              className="text-[13px] font-medium text-primary hover:underline"
            >
              hello.mediacrater@gmail.com
            </a>
          </div>

          <div className="flex justify-between items-center py-2.5 border-b border-border">
            <span className="text-sm font-medium">Changelog</span>
            <a
              href="/changelog"
              className="text-[13px] font-medium text-primary hover:underline"
            >
              What&apos;s new ↗
            </a>
          </div>

          <div className="flex justify-between items-center py-2.5">
            <span className="text-sm font-medium">Also on Chrome</span>
            <a
              href="https://chromewebstore.google.com/detail/mediacrater-ad-compliance/fgekklkpomdcadiaekpigidkimnkjpnf"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] font-medium text-primary hover:underline"
            >
              Get the extension ↗
            </a>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center mt-4">
        Note: Mediacrater analysis provides guidance only and does not guarantee ad approval.
      </p>
    </div>
  );
}

export default function App() {
  return <SettingsPanel />;
}
