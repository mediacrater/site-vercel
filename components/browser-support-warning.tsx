// components/browser-support-warning.tsx
'use client';
//
// Dashboard-only, dismissible warning for browsers we don't test scans on.
// Shown when EITHER:
//   1. the browser isn't one of: Chrome (desktop/Android/iOS), Edge, Brave,
//      Opera / Opera GX, Vivaldi, Samsung Internet, Arc, DuckDuckGo, Firefox; or
//   2. the APIs the scanner actually uses are missing: Canvas 2D (frame
//      extraction) and Web Audio incl. OfflineAudioContext (audio extraction).
//
// Browser detection is best-effort: Client Hints brands first (Chromium-based
// browsers, incl. Brave and Arc, report "Chromium"), then a User-Agent check.
// It never blocks scanning — it only informs. Dismissal lasts for this tab
// session (sessionStorage), so it doesn't nag on every navigation.

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const DISMISS_KEY = 'mc_browser_warning_dismissed_v1';

// Place official logos at these paths (see setup steps). Missing files are
// hidden automatically, so the dialog still works without them.
const RECOMMENDED_BROWSERS = [
  { name: 'Chrome', icon: '/images/browser-icons/chrome.svg', href: 'https://www.google.com/chrome/' },
  { name: 'Brave', icon: '/images/browser-icons/brave.svg', href: 'https://brave.com/download/' },
  { name: 'Firefox', icon: '/images/browser-icons/firefox.svg', href: 'https://www.mozilla.org/firefox/new/' },
  { name: 'DuckDuckGo', icon: '/images/browser-icons/duckduckgo.svg', href: 'https://duckduckgo.com/app' },
] as const;

// Tokens that identify the supported browsers in a User-Agent string.
// Chrome|Chromium covers Chromium-based browsers that don't add their own
// token (Arc, often Brave/Vivaldi). CriOS/FxiOS/EdgiOS/OPiOS are the iOS apps.
const SUPPORTED_UA =
  /(Chrome|Chromium|CriOS|Edg|EdgA|EdgiOS|OPR|OPT|OPiOS|SamsungBrowser|Vivaldi|Firefox|FxiOS|DuckDuckGo|Ddg)\//i;

const SUPPORTED_BRANDS = /Chromium|Google Chrome|Microsoft Edge|Opera|Brave/i;

type NavigatorWithHints = Navigator & {
  userAgentData?: { brands?: { brand: string }[] };
  brave?: unknown;
};

function isSupportedBrowser(): boolean {
  const nav = navigator as NavigatorWithHints;

  const brands = nav.userAgentData?.brands?.map((b) => b.brand) ?? [];
  if (brands.some((brand) => SUPPORTED_BRANDS.test(brand))) {
    return true;
  }

  // Brave can hide itself from the UA string but exposes navigator.brave.
  if (nav.brave) {
    return true;
  }

  return SUPPORTED_UA.test(nav.userAgent || '');
}

function hasCanvasApi(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('2d')) && typeof canvas.toDataURL === 'function';
  } catch {
    return false;
  }
}

function hasWebAudioApi(): boolean {
  const w = window as unknown as Record<string, unknown>;
  const realtime = w.AudioContext || w.webkitAudioContext;
  const offline = w.OfflineAudioContext || w.webkitOfflineAudioContext;
  return Boolean(realtime && offline);
}

function wasDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Storage blocked (private mode etc.) — the dialog just shows again next load.
  }
}

export function BrowserSupportWarning() {
  const [open, setOpen] = useState(false);
  const [missingApis, setMissingApis] = useState(false);
  const [hiddenIcons, setHiddenIcons] = useState<Set<string>>(() => new Set());

  // Runs on the client only, after hydration, so server and client HTML match.
  useEffect(() => {
    if (wasDismissed()) return;

    const apisMissing = !hasCanvasApi() || !hasWebAudioApi();
    if (apisMissing || !isSupportedBrowser()) {
      setMissingApis(apisMissing);
      setOpen(true);
    }
  }, []);

  function handleOpenChange(next: boolean) {
    if (!next) rememberDismissal();
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your browser may not be fully supported</DialogTitle>
          <DialogDescription className="pt-1 text-sm">
            {missingApis
              ? "Scans are processed in your browser, and this browser is missing features they need (Canvas or Web Audio). Scans may fail or skip audio."
              : "Scans are processed in your browser, and we haven't tested them on this one. Scans may fail or results may be incomplete."}{' '}
            For the most reliable results, use one of these browsers:
          </DialogDescription>
        </DialogHeader>

        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          {RECOMMENDED_BROWSERS.map((browser) => (
            <li key={browser.name}>
              <a
                href={browser.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-2 rounded-lg border border-border p-3 text-xs font-medium hover:bg-secondary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {!hiddenIcons.has(browser.name) && (
                  <img
                    src={browser.icon}
                    alt=""
                    width={32}
                    height={32}
                    className="h-8 w-8 object-contain"
                    onError={() =>
                      setHiddenIcons((prev) => new Set(prev).add(browser.name))
                    }
                  />
                )}
                {browser.name}
              </a>
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground">
          Edge, Opera, Vivaldi, Samsung Internet and Arc are supported too.
        </p>

        <button
          type="button"
          onClick={() => handleOpenChange(false)}
          className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors"
        >
          Continue anyway
        </button>
      </DialogContent>
    </Dialog>
  );
}
