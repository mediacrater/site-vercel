# Dashboard: Unsupported-Browser Warning Popup

| | |
|---|---|
| **Date** | 12 October 2026 (`12oct26`) |
| **Conversation** | https://claude.ai/chat/d4b23f41-e563-40d3-a5ba-165fd98c9a36 |
| **Related work (same conversation)** | `scan-tab-close-guard-12oct26.md` |
| **Stack** | Next.js on Vercel: new `components/browser-support-warning.tsx`, `app/dashboard/page.tsx`, existing `components/ui/dialog.tsx` |
| **Starting trigger** | Scans run in the browser (Canvas frame extraction, Web Audio). You wanted to warn dashboard users on browsers outside a known-good list, or missing those APIs, and show logos of recommended browsers |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied. ⏳ = open.

---

## Contents

1. [Summary](#1-summary)
2. [Status at a glance](#2-status-at-a-glance)
3. [Starting point](#3-starting-point)
4. [Timeline: what we did, in order](#4-timeline-what-we-did-in-order)
5. [Errors and surprises](#5-errors-and-surprises)
6. [Corrections / important decisions](#6-corrections--important-decisions)
7. [Open items checklist](#7-open-items-checklist)
8. [Reference: key settings](#8-reference-key-settings)
9. [Appendix A – components/browser-support-warning.tsx (final)](#appendix-a--componentsbrowser-support-warningtsx-final)
10. [Appendix B – Dashboard mount and test steps](#appendix-b--dashboard-mount-and-test-steps)

---

## 1. Summary

A dismissible dialog appears on the dashboard when **either** the browser isn't on the supported list (Chrome on desktop, Android and iOS, Edge, Brave, Opera / Opera GX, Vivaldi, Samsung Internet, Arc, DuckDuckGo, Firefox) **or** the APIs the scanner uses are missing (Canvas 2D, Web Audio including `OfflineAudioContext`). It shows Chrome, Brave, Firefox and DuckDuckGo logos linking to their official download pages, and never blocks scanning.

**Main outcomes**

- Detection: Client Hints brands first (Chromium-based browsers, including Brave and Arc, report "Chromium"), then `navigator.brave`, then a User-Agent check.
- The message changes depending on whether APIs are missing or the browser is just untested.
- Dismissal is stored in `sessionStorage` (once per **browser tab**).
- Logos load from `public/images/browser-icons/*.svg`. Any missing file is hidden automatically.
- You confirmed: **"Fix #4 works."**

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| `components/browser-support-warning.tsx` | ✅ Done | |
| Mounted in `app/dashboard/page.tsx` | ✅ Done | Renders after the dashboard has loaded |
| Shows on unsupported browsers (e.g. Safari) | ✅ Verified | Your report |
| Browser logos in `public/images/browser-icons/` | ⚠️ Unconfirmed | Official logos from each vendor's brand page; missing ones are hidden |
| Dismiss behaviour (once per tab) | ✅ Explained | Your question, answered in Phase 3 |

---

## 3. Starting point

- `components/ui/dialog.tsx` (shadcn) was already available.
- `lib/mediacrater/dissector.ts` uses canvas frame extraction and `OfflineAudioContext` for audio.

---

## 4. Timeline: what we did, in order

### Phase 1 – Design notes I raised

- **Safari has both Canvas and Web Audio**, so the API check alone wouldn't flag it. The browser list is what catches it.
- **Chrome on iOS and DuckDuckGo on iOS/macOS run on WebKit**, the same engine as Safari. Allowing them while warning on Safari is inconsistent, but it's what you asked for.
- User-agent sniffing is fragile; feature detection is the industry standard. The popup therefore only informs and never blocks.

### Phase 2 – Build

The component is in [Appendix A](#appendix-a--componentsbrowser-support-warningtsx-final), and the dashboard mount in [Appendix B](#appendix-b--dashboard-mount-and-test-steps). File path comment on line 1, then `'use client'`.

### Phase 3 – "Once per refresh or once per login?"

Neither: **once per browser tab.** Refreshing, moving around the app, or logging out and back in **in the same tab** won't show it again. A new tab, or closing and reopening the browser, will. To make "Don't show again" permanent, switch to `localStorage` and bump `DISMISS_KEY` to `_v2` whenever you want everyone to see it again.

---

## 5. Errors and surprises

None reported.

---

## 6. Corrections / important decisions

### Decisions

1. **Informational only,** never blocks scanning.
2. **Per-tab dismissal** (`sessionStorage`), with try/catch so private modes don't break it.
3. **Runs after hydration** (`useEffect`), so server and client HTML match.
4. **Logos from vendor press kits,** not drawn by me (brand guidelines). Missing files are hidden.
5. Honest wording: "may not be fully supported / scans may fail", with no promises.

---

## 7. Open items checklist

- [x] Popup works
- [ ] Confirm the logo files exist: `public/images/browser-icons/chrome.svg`, `brave.svg`, `firefox.svg`, `duckduckgo.svg`
- [ ] Optional: switch dismissal to `localStorage` for a permanent "don't show again"

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Dismiss key | `mc_browser_warning_dismissed_v1` (`sessionStorage`) |
| Supported UA tokens | `Chrome`, `Chromium`, `CriOS`, `Edg`, `EdgA`, `EdgiOS`, `OPR`, `OPT`, `OPiOS`, `SamsungBrowser`, `Vivaldi`, `Firefox`, `FxiOS`, `DuckDuckGo`, `Ddg` |
| Supported Client Hints brands | `Chromium`, `Google Chrome`, `Microsoft Edge`, `Opera`, `Brave` |
| API checks | `canvas.getContext('2d')` + `toDataURL`; `AudioContext` / `webkitAudioContext` + `OfflineAudioContext` / `webkitOfflineAudioContext` |
| Logo paths | `/images/browser-icons/{chrome,brave,firefox,duckduckgo}.svg` |

---

## Appendix A – components/browser-support-warning.tsx (final)

```tsx
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
```

---

## Appendix B – Dashboard mount and test steps

In `app/dashboard/page.tsx`:

```tsx
import {
  BrowserSupportWarning,
} from '@/components/browser-support-warning';

// in the loaded dashboard JSX, before {showCheckoutSuccess && (
      <BrowserSupportWarning />
```

**Test:**
1. Open `/dashboard` in Safari. Expected: the dialog, with "Continue anyway".
2. Open it in Chrome. Expected: no dialog.
3. Dismiss it in Safari, then refresh. Expected: no dialog in that tab. Open a new tab and it shows again.

---

*End of index.  
Conversation: `<add this conversation's URL>`*
