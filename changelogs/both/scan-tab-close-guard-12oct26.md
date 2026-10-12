# Scans: "Leave Site?" Warning When Closing the Tab During an Active Scan

| | |
|---|---|
| **Date** | 12 October 2026 (`12oct26`) |
| **Conversation** | https://claude.ai/chat/d4b23f41-e563-40d3-a5ba-165fd98c9a36 |
| **Related work (same conversation)** | `dashboard-browser-support-warning-12oct26.md`, `batch-url-creatives-store-fix-12oct26.md` |
| **Stack** | Next.js on Vercel: new `hooks/use-scan-leave-guard.ts`, `components/app-shell.tsx`, `lib/mediacrater/backgroundScanStore.ts` |
| **Starting trigger** | Closing or reloading the tab mid-scan loses the scan. You wanted a browser warning like "Are you sure you want to close this tab? Your scan results will be lost." |

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
9. [Appendix A – hooks/use-scan-leave-guard.ts (final)](#appendix-a--hooksuse-scan-leave-guardts-final)
10. [Appendix B – AppShell mount and test steps](#appendix-b--appshell-mount-and-test-steps)

---

## 1. Summary

While a scan is **preparing or running** in the current tab, closing the tab, reloading, or typing a new address triggers the browser's "Leave site?" prompt. The hook is mounted in `AppShell`, so it protects scans on every app page (Dashboard, Scan History, Settings). Moving between app pages doesn't trigger it, because scans keep running across in-app navigation.

**Main outcomes**

- New `useScanLeaveGuard()` reads `isBackgroundScanActive()` from the existing background scan store, and adds or removes a `beforeunload` listener.
- You confirmed: **"Fix #5 works."**

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| `hooks/use-scan-leave-guard.ts` | ✅ Done | |
| Mounted in `components/app-shell.tsx` | ✅ Done | |
| Prompt appears during a scan | ✅ Verified | Your report |
| No prompt after the scan completes | ⚠️ Not reported | Expected, because the listener is removed when the scan isn't active |

---

## 3. Starting point

- `backgroundScanStore.ts` already exposed `useBackgroundScanState()` and `isBackgroundScanActive()`.
- Scans survive in-app navigation: the async work continues after `scan-workspace` unmounts. A tab close or reload kills it.

---

## 4. Timeline: what we did, in order

### Phase 1 – Limits I flagged (browser rules, not bugs)

- **Custom text isn't shown.** Chrome (since v51), Firefox (since v44) and Safari (since 9.1) show their own generic message. The custom string is only used by very old browsers.
- The prompt only appears after the user has interacted with the page. Clicking "Analyze" counts.
- **iOS Safari largely ignores `beforeunload`.**
- In-app navigation deliberately doesn't trigger it.

### Phase 2 – Build

The hook is in [Appendix A](#appendix-a--hooksuse-scan-leave-guardts-final), and the AppShell mount in [Appendix B](#appendix-b--appshell-mount-and-test-steps).

---

## 5. Errors and surprises

None reported.

---

## 6. Corrections / important decisions

### Decisions

1. **Mount in AppShell,** not the dashboard, so a scan is protected on every app page.
2. **Only while a scan is active,** to avoid nagging on normal navigation.
3. `event.preventDefault()` **and** `event.returnValue = message`, so both modern and legacy browsers show a prompt.

---

## 7. Open items checklist

- [x] Prompt works during scans
- [ ] Optional: check that no prompt appears after a scan finishes (expected)

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Hook | `useScanLeaveGuard()` in `hooks/use-scan-leave-guard.ts` |
| Mounted in | `components/app-shell.tsx` |
| Active when | `isBackgroundScanActive(useBackgroundScanState())` is true |
| Legacy message | "Are you sure you want to close this tab? Your scan results will be lost." |

---

## Appendix A – hooks/use-scan-leave-guard.ts (final)

```ts
// hooks/use-scan-leave-guard.ts
'use client';
//
// While a scan is preparing or running in this tab, closing / reloading the
// tab (or typing a new address) triggers the browser's "Leave site?" prompt.
//
// Limits (browser rules, not bugs):
// - Chrome, Edge, Firefox and Safari ignore custom text and show their own
//   generic message. SCAN_LEAVE_MESSAGE is only used by very old browsers.
// - The prompt only appears if the user has interacted with the page
//   (clicking "Analyze" counts).
// - iOS Safari largely ignores beforeunload.
// - In-app navigation (sidebar links) doesn't trigger it, by design: scans
//   keep running when you move between Dashboard / Scan History / Settings.

import { useEffect } from 'react';
import {
  isBackgroundScanActive,
  useBackgroundScanState,
} from '@/lib/mediacrater/backgroundScanStore';

export const SCAN_LEAVE_MESSAGE =
  'Are you sure you want to close this tab? Your scan results will be lost.';

export function useScanLeaveGuard() {
  const scan = useBackgroundScanState();
  const active = isBackgroundScanActive(scan);

  useEffect(() => {
    if (!active) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers need returnValue set to show the prompt.
      event.returnValue = SCAN_LEAVE_MESSAGE;
      return SCAN_LEAVE_MESSAGE;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [active]);
}
```

---

## Appendix B – AppShell mount and test steps

In `components/app-shell.tsx`:

```tsx
import { useScanLeaveGuard } from '@/hooks/use-scan-leave-guard';

// inside the AppShell component, after the mobileNavOpen state
  useScanLeaveGuard();
```

**Test:**
1. Start a scan, then try to close the tab. Expected: the browser's "Leave site?" prompt.
2. During a scan, click Scan History in the sidebar. Expected: no prompt, and the scan continues.
3. After the scan completes, close the tab. Expected: no prompt.

---

*End of index.  
Conversation: `<add this conversation's URL>`*
