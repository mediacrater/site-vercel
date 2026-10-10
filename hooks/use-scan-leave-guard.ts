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
