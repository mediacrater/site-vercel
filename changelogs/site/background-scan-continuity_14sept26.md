# Mediacrater — Background Scan Continuity + Dashboard Status UX

**Date:** September 14, 2026  
**Change type:** Scan UX / client-side continuity  
**Scope:** Dashboard scan workflow + persistent same-tab scan state + sidebar status  
**Status:** Prepared for TEST  
**Depends on:** Phase 1 scan feedback implementation

---

# 1. Objective

Allow a scan that has already started to continue while the user navigates away from `/dashboard` to another Mediacrater page such as `/settings`, without losing the result UI when they return.

The desired UX is:

```text
Scan starts
   ↓
Dashboard navigation shows spinner
   ↓
User may navigate to Settings while keeping the same browser tab open
   ↓
Scan continues
   ↓
Success → green check on Dashboard navigation
Failure → red X on Dashboard navigation
   ↓
User returns to Dashboard
   ↓
Completed results are restored
   ↓
Free users can still see the result even though Scan History is unavailable
```

The in-dashboard progress state also explicitly tells the user:

> **Scan in progress, keep this tab open. It is safe to leave this page, your results will be ready shortly.**

---

# 2. Important Scope Boundary

This implementation is intentionally designed for **same-tab Mediacrater navigation**.

It supports:

- Dashboard → Settings
- Settings → Dashboard
- Dashboard → other internal Mediacrater routes
- React/Next.js page unmounts during internal navigation
- restoring completed results when the user returns to Dashboard
- restoring an in-progress UI if the user returns before the scan finishes
- free users, who do not have Scan History access

The tab must remain open while the scan is running.

This implementation does **not** claim that an in-flight browser-side result can be recovered after:

- closing the browser tab
- closing the browser
- navigating the tab to a different website
- force-refreshing/reloading while the scan is still running
- killing the JavaScript runtime

The current scan implementation already does not abort the scan request in the `ScanWorkspace` unmount cleanup. The observed production/test behavior also shows that the VPS continues processing after leaving Dashboard because paid-user results still reach Scan History.

The missing layer is preserving the result/status for the current tab after the Dashboard component itself is unmounted.

---

# 3. Architecture

A small same-tab background-scan store is added.

Storage:

```text
sessionStorage
+
in-memory fallback
+
custom same-tab browser event
```

The store becomes the UI source of truth for these states:

```text
idle
preparing
running
completed
error
```

`sessionStorage` is used rather than `localStorage` because scan UI state belongs to the current tab/session and should not leak into unrelated tabs.

Each scan receives an `operationId`.

All later updates must match that `operationId`, preventing an old asynchronous request from overwriting the UI state of a newer scan.

A runtime ID is also stored. If the page is fully reloaded while a scan is still marked active, the new JavaScript runtime recognizes that the old in-flight browser process is no longer attached and converts the stale spinner into an error state rather than leaving the Dashboard spinner running forever.

---

# 4. Files Changed

## New website file

```text
lib/mediacrater/backgroundScanStore.ts
```

## Modified website files

```text
components/scan-workspace.tsx
components/app-sidebar.tsx
```

## No VPS change required

No new VPS endpoint is required for this same-tab continuity feature.

The existing scan request continues running because navigation does not call the scan's `AbortController.abort()` during component unmount.

---

# 5. New File — `lib/mediacrater/backgroundScanStore.ts`

Create the following file in full:

```tsx
'use client';

// lib/mediacrater/backgroundScanStore.ts

import {
  useEffect,
  useState,
} from 'react';

const STORAGE_KEY =
  'mediacrater_background_scan_v1';

const EVENT_NAME =
  'mediacrater:background-scan-state';

export type BackgroundScanStatus =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'error';

export interface BackgroundScanResult {
  platform: string;
  riskLevel: string;
  riskClass: string;
  processedViolations: unknown[];
}

export interface BackgroundScanState {
  version: 1;
  runtimeId: string;
  operationId: string | null;
  status: BackgroundScanStatus;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  message: string | null;
  results: BackgroundScanResult[] | null;
  scanIds: string[];
  error: {
    title: string;
    message: string;
  } | null;
}

function makeId() {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return (
    `${Date.now()}-` +
    `${Math.random().toString(36).slice(2)}`
  );
}

/*
 * This ID changes only when the actual browser JavaScript
 * runtime is recreated.
 *
 * Internal Next.js navigation keeps the same runtime.
 * A full reload creates a new runtime ID.
 */
const RUNTIME_ID =
  makeId();

function makeIdleState(): BackgroundScanState {
  return {
    version: 1,
    runtimeId: RUNTIME_ID,
    operationId: null,
    status: 'idle',
    startedAt: null,
    updatedAt: new Date().toISOString(),
    completedAt: null,
    message: null,
    results: null,
    scanIds: [],
    error: null,
  };
}

let memoryState: BackgroundScanState =
  makeIdleState();

function isActiveStatus(
  status: BackgroundScanStatus
) {
  return (
    status === 'preparing' ||
    status === 'running'
  );
}

function normalizeStoredState(
  value: unknown
): BackgroundScanState | null {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return null;
  }

  const state =
    value as Partial<BackgroundScanState>;

  if (
    state.version !== 1 ||
    typeof state.status !== 'string'
  ) {
    return null;
  }

  const validStatuses:
    BackgroundScanStatus[] = [
      'idle',
      'preparing',
      'running',
      'completed',
      'error',
    ];

  if (
    !validStatuses.includes(
      state.status as BackgroundScanStatus
    )
  ) {
    return null;
  }

  return {
    version: 1,

    runtimeId:
      typeof state.runtimeId === 'string'
        ? state.runtimeId
        : RUNTIME_ID,

    operationId:
      typeof state.operationId === 'string'
        ? state.operationId
        : null,

    status:
      state.status as BackgroundScanStatus,

    startedAt:
      typeof state.startedAt === 'string'
        ? state.startedAt
        : null,

    updatedAt:
      typeof state.updatedAt === 'string'
        ? state.updatedAt
        : new Date().toISOString(),

    completedAt:
      typeof state.completedAt === 'string'
        ? state.completedAt
        : null,

    message:
      typeof state.message === 'string'
        ? state.message
        : null,

    results:
      Array.isArray(state.results)
        ? state.results
        : null,

    scanIds:
      Array.isArray(state.scanIds)
        ? state.scanIds.filter(
            (id): id is string =>
              typeof id === 'string'
          )
        : [],

    error:
      state.error &&
      typeof state.error === 'object' &&
      typeof state.error.title === 'string' &&
      typeof state.error.message === 'string'
        ? {
            title: state.error.title,
            message: state.error.message,
          }
        : null,
  };
}

function convertStaleRuntime(
  state: BackgroundScanState
): BackgroundScanState {
  if (
    isActiveStatus(state.status) &&
    state.runtimeId !== RUNTIME_ID
  ) {
    return {
      ...state,
      runtimeId: RUNTIME_ID,
      operationId: null,
      status: 'error',
      updatedAt: new Date().toISOString(),
      completedAt: null,
      message: null,
      results: null,
      scanIds: [],
      error: {
        title: 'Scan interrupted',
        message:
          'This tab was reloaded while the scan was still running. Keep this tab open during future scans.',
      },
    };
  }

  return state;
}

export function getBackgroundScanState():
  BackgroundScanState {
  if (typeof window === 'undefined') {
    return memoryState;
  }

  try {
    const raw =
      window.sessionStorage.getItem(
        STORAGE_KEY
      );

    if (raw) {
      const parsed =
        normalizeStoredState(
          JSON.parse(raw)
        );

      if (parsed) {
        memoryState =
          convertStaleRuntime(parsed);

        return memoryState;
      }
    }
  } catch (error) {
    console.warn(
      '[BACKGROUND SCAN] Could not read session state:',
      error
    );
  }

  return memoryState;
}

function publishState(
  next: BackgroundScanState
) {
  memoryState = next;

  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(next)
    );
  } catch (error) {
    /*
     * Keep the in-memory state even if storage is unavailable.
     * Internal navigation within the same JS runtime can still work.
     */
    console.warn(
      '[BACKGROUND SCAN] Could not persist session state:',
      error
    );
  }

  window.dispatchEvent(
    new CustomEvent(
      EVENT_NAME,
      {
        detail: next,
      }
    )
  );
}

export function beginBackgroundScan(
  message = 'Preparing analysis...'
) {
  const operationId =
    makeId();

  const now =
    new Date().toISOString();

  publishState({
    version: 1,
    runtimeId: RUNTIME_ID,
    operationId,
    status: 'preparing',
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    message,
    results: null,
    scanIds: [],
    error: null,
  });

  return operationId;
}

export function updateBackgroundScanProgress(
  operationId: string,
  message: string,
  status:
    | 'preparing'
    | 'running' = 'running'
) {
  const current =
    getBackgroundScanState();

  if (
    current.operationId !==
    operationId
  ) {
    return;
  }

  publishState({
    ...current,
    runtimeId: RUNTIME_ID,
    status,
    message,
    updatedAt:
      new Date().toISOString(),
    error: null,
  });
}

export function completeBackgroundScan(
  operationId: string,
  results: BackgroundScanResult[],
  scanIds: string[]
) {
  const current =
    getBackgroundScanState();

  if (
    current.operationId !==
    operationId
  ) {
    return;
  }

  const now =
    new Date().toISOString();

  publishState({
    ...current,
    runtimeId: RUNTIME_ID,
    status: 'completed',
    message: null,
    results,
    scanIds,
    updatedAt: now,
    completedAt: now,
    error: null,
  });
}

export function failBackgroundScan(
  operationId: string,
  title: string,
  message: string
) {
  const current =
    getBackgroundScanState();

  if (
    current.operationId !==
    operationId
  ) {
    return;
  }

  publishState({
    ...current,
    runtimeId: RUNTIME_ID,
    status: 'error',
    operationId: null,
    message: null,
    results: null,
    scanIds: [],
    updatedAt:
      new Date().toISOString(),
    completedAt: null,
    error: {
      title,
      message,
    },
  });
}

export function clearBackgroundScanState() {
  memoryState =
    makeIdleState();

  if (
    typeof window !== 'undefined'
  ) {
    try {
      window.sessionStorage.removeItem(
        STORAGE_KEY
      );
    } catch (error) {
      console.warn(
        '[BACKGROUND SCAN] Could not clear session state:',
        error
      );
    }

    window.dispatchEvent(
      new CustomEvent(
        EVENT_NAME,
        {
          detail: memoryState,
        }
      )
    );
  }
}

export function useBackgroundScanState() {
  const [
    state,
    setState,
  ] =
    useState<BackgroundScanState>(
      () => getBackgroundScanState()
    );

  useEffect(() => {
    setState(
      getBackgroundScanState()
    );

    const handleCustomEvent =
      (event: Event) => {
        const custom =
          event as CustomEvent<
            BackgroundScanState
          >;

        if (custom.detail) {
          setState(
            custom.detail
          );
        } else {
          setState(
            getBackgroundScanState()
          );
        }
      };

    const handleVisibility =
      () => {
        if (
          document.visibilityState ===
          'visible'
        ) {
          setState(
            getBackgroundScanState()
          );
        }
      };

    window.addEventListener(
      EVENT_NAME,
      handleCustomEvent
    );

    document.addEventListener(
      'visibilitychange',
      handleVisibility
    );

    return () => {
      window.removeEventListener(
        EVENT_NAME,
        handleCustomEvent
      );

      document.removeEventListener(
        'visibilitychange',
        handleVisibility
      );
    };
  }, []);

  return state;
}

export function isBackgroundScanActive(
  state: BackgroundScanState
) {
  return isActiveStatus(
    state.status
  );
}
```

---

# 6. Replace `components/app-sidebar.tsx`

Replace the file in full with:

```tsx
'use client';

// components/app-sidebar.tsx
//
// Pure navigation now — account actions (email, extension link, sign
// out) moved entirely to app-topbar.tsx to avoid having two places that
// do the same thing. Logo links to '/' (actual homepage).

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
```

Result:

```text
Dashboard   ⟳   while working
Dashboard   ✓   when complete
Dashboard   ✕   when failed
```

The normal Dashboard icon remains on the left; scan status appears on the right so navigation meaning and scan state are not conflated.

---

# 7. `components/scan-workspace.tsx` Changes

These changes assume the Phase 1 feedback modifications are already present, including:

```tsx
export interface CompletedScanFeedbackTarget {
  scanIds: string[];
}
```

and:

```tsx
onResultsChange?: (
  target:
    | CompletedScanFeedbackTarget
    | null
) => void;
```

as well as the existing successful result code returning `scanId`.

---

## Change 1 — Add background-scan imports

After the existing imports, add:

```tsx
import {
  beginBackgroundScan,
  clearBackgroundScanState,
  completeBackgroundScan,
  failBackgroundScan,
  updateBackgroundScanProgress,
  useBackgroundScanState,
} from '@/lib/mediacrater/backgroundScanStore';
```

---

## Change 2 — Add background-scan refs/state

Immediately after the existing refs:

```tsx
const abortControllerRef = useRef<AbortController | null>(null);
const currentJobIdRef = useRef<string | null>(null);
const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
const fileInputRef = useRef<HTMLInputElement | null>(null);
```

add:

```tsx
const mountedRef =
  useRef(true);

const ownsActiveScanRef =
  useRef(false);

const backgroundOperationIdRef =
  useRef<string | null>(null);

const backgroundScan =
  useBackgroundScanState();
```

---

## Change 3 — Track whether this ScanWorkspace instance is mounted

Add:

```tsx
useEffect(() => {
  mountedRef.current = true;

  return () => {
    mountedRef.current = false;
  };
}, []);
```

Do **not** abort the scan from this cleanup.

---

## Change 4 — Make the elapsed timer resumable

Replace:

```tsx
function startElapsedTimer() {
  const startTime = Date.now();
  setElapsedSeconds(0);
  timerRef.current = setInterval(() => {
    setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
  }, 1000);
}
```

with:

```tsx
function startElapsedTimer(
  startTime = Date.now()
) {
  if (timerRef.current) {
    clearInterval(
      timerRef.current
    );
  }

  setElapsedSeconds(
    Math.max(
      0,
      Math.floor(
        (Date.now() -
          startTime) /
          1000
      )
    )
  );

  timerRef.current =
    setInterval(() => {
      setElapsedSeconds(
        Math.max(
          0,
          Math.floor(
            (Date.now() -
              startTime) /
              1000
          )
        )
      );
    }, 1000);
}
```

---

## Change 5 — Add helper for progress publication

Add after `stopElapsedTimer()`:

```tsx
function publishScanProgress(
  message: string,
  status:
    | 'preparing'
    | 'running' = 'running'
) {
  const operationId =
    backgroundOperationIdRef.current;

  if (operationId) {
    updateBackgroundScanProgress(
      operationId,
      message,
      status
    );
  }

  if (mountedRef.current) {
    setProgressText(
      message
    );
  }
}
```

---

## Change 6 — Restore background state when Dashboard remounts

Add this effect after the timer/helper functions:

```tsx
useEffect(() => {
  /*
   * The ScanWorkspace instance that originally started the
   * scan already owns its live local state. Do not mirror its
   * own store events back into itself.
   *
   * This effect is primarily for a NEW ScanWorkspace instance
   * created when the user returns to Dashboard.
   */
  if (
    ownsActiveScanRef.current
  ) {
    return;
  }

  if (
    backgroundScan.status ===
      'preparing' ||
    backgroundScan.status ===
      'running'
  ) {
    setResults(null);
    setBanner(null);
    setIsAnalyzing(true);
    setCanCancel(false);

    setProgressText(
      backgroundScan.message ||
        'Scan in progress...'
    );

    onResultsChange?.(
      null
    );

    if (
      backgroundScan.startedAt
    ) {
      const startedAt =
        Date.parse(
          backgroundScan.startedAt
        );

      if (
        Number.isFinite(
          startedAt
        )
      ) {
        startElapsedTimer(
          startedAt
        );
      }
    }

    return;
  }

  if (
    backgroundScan.status ===
      'completed' &&
    backgroundScan.results
  ) {
    stopElapsedTimer();
    setIsAnalyzing(false);
    setCanCancel(false);

    setResults(
      backgroundScan.results as PlatformResult[]
    );

    onResultsChange?.({
      scanIds:
        backgroundScan.scanIds,
    });

    return;
  }

  if (
    backgroundScan.status ===
    'error'
  ) {
    stopElapsedTimer();
    setIsAnalyzing(false);
    setCanCancel(false);
    setResults(null);

    setBanner({
      tone: 'error',

      title:
        backgroundScan.error
          ?.title ||
        'Analysis failed',

      message:
        backgroundScan.error
          ?.message ||
        'Something went wrong. Please try again.',
    });

    onResultsChange?.(
      null
    );
  }
}, [
  backgroundScan.updatedAt,
]);
```

---

## Change 7 — Clear old completion/error state when choosing another file

At the beginning of `handleFile()` the Phase 1 version should look similar to:

```tsx
async function handleFile(file: File) {
  setBanner(null);
  setResults(null);
  onResultsChange?.(null);
```

Change it to:

```tsx
async function handleFile(file: File) {
  clearBackgroundScanState();

  setBanner(null);
  setResults(null);
  onResultsChange?.(null);
```

---

## Change 8 — Clear background state when removing/resetting the current scan

Inside `removeFile()`, after:

```tsx
setResults(null);
```

add:

```tsx
clearBackgroundScanState();
```

The relevant section becomes:

```tsx
setPreviewUrl(null);
setFileKind(null);
setCurrentFile(null);
setResults(null);
clearBackgroundScanState();
onResultsChange?.(null);
setAnalyzeAudio(false);
```

If `onResultsChange?.(null)` is already present from Phase 1, do not add it twice.

---

## Change 9 — Cancellation clears the navigation status

Replace `handleCancelAnalysis()` with:

```tsx
function handleCancelAnalysis() {
  if (!canCancel) {
    return;
  }

  abortControllerRef.current
    ?.abort();

  if (
    currentJobIdRef.current
  ) {
    cancelQueuedScan(
      currentJobIdRef.current
    ).catch((err) =>
      console.warn(
        'Failed to cancel queued scan server-side:',
        err
      )
    );

    currentJobIdRef.current =
      null;
  }

  clearBackgroundScanState();

  ownsActiveScanRef.current =
    false;

  backgroundOperationIdRef.current =
    null;
}
```

A deliberate user cancellation returns the Dashboard indicator to idle rather than showing a red error X.

---

## Change 10 — Publish preparation/progress to the background store

At the top of `performAnalysis()` replace:

```tsx
setProgressText('Preparing analysis...');
```

with:

```tsx
publishScanProgress(
  'Preparing analysis...',
  'preparing'
);
```

Replace:

```tsx
setProgressText('Preparing your video...');
```

with:

```tsx
publishScanProgress(
  'Preparing your video...',
  'preparing'
);
```

Replace:

```tsx
setProgressText('Preparing audio track...');
```

with:

```tsx
publishScanProgress(
  'Preparing audio track...',
  'preparing'
);
```

Replace:

```tsx
setProgressText('Preparing your image...');
```

with:

```tsx
publishScanProgress(
  'Preparing your image...',
  'preparing'
);
```

Replace:

```tsx
setProgressText(`Analyzing your content against ${platformList} policies...`);
```

with:

```tsx
publishScanProgress(
  `Analyzing your content against ${platformList} policies...`,
  'running'
);
```

Inside the queue loop replace:

```tsx
setProgressText(`You're queued at position ${response.position}. Waiting for your turn...`);
```

with:

```tsx
publishScanProgress(
  `You're queued at position ${response.position}. Waiting for your turn...`,
  'running'
);
```

Change the queue callback from:

```tsx
await waitForQueueTurn(jobId, signal, (position) =>
  setProgressText(`You're queued at position ${position}. Waiting for your turn...`)
);
```

to:

```tsx
await waitForQueueTurn(
  jobId,
  signal,
  (position) =>
    publishScanProgress(
      `You're queued at position ${position}. Waiting for your turn...`,
      'running'
    )
);
```

Replace:

```tsx
setProgressText(`Analyzing your content against ${platform.toUpperCase()} policies...`);
```

with:

```tsx
publishScanProgress(
  `Analyzing your content against ${platform.toUpperCase()} policies...`,
  'running'
);
```

---

## Change 11 — Persist completed results before touching component state

The Phase 1 successful section should already preserve `scanId`:

```tsx
return {
  platform,
  response: completed,
  scanId,
};
```

After formatting results:

```tsx
const formatted: PlatformResult[] = rawResults.map(({ response }) => {
  const {
    riskLevel,
    riskClass,
    processedViolations,
  } =
    calculateConfidenceScore(
      response.result.violations as Violation[]
    );

  return {
    platform:
      response.result.platform,

    riskLevel,
    riskClass,
    processedViolations,
  };
});
```

replace the old completion section with:

```tsx
const completedScanIds =
  rawResults.map(
    ({ scanId }) =>
      scanId
  );

const operationId =
  backgroundOperationIdRef.current;

if (operationId) {
  completeBackgroundScan(
    operationId,
    formatted,
    completedScanIds
  );
}

if (mountedRef.current) {
  setResults(
    formatted
  );

  onResultsChange?.({
    scanIds:
      completedScanIds,
  });

  await onScanComplete();
}
```

The key ordering is intentional:

```text
persist background completion
THEN
update mounted React UI
```

This guarantees that if Dashboard was already unmounted, the result is still available for restoration when the user returns.

---

## Change 12 — Start the background operation in `handleAnalyze()`

After authentication and scan-balance validation have passed, but before the scan starts, replace the existing start block:

```tsx
setIsAnalyzing(true);
setResults(null);
onResultsChange?.(null);
setCanCancel(true);

const controller =
  new AbortController();

abortControllerRef.current =
  controller;

startElapsedTimer();
```

with:

```tsx
const operationId =
  beginBackgroundScan(
    'Preparing analysis...'
  );

backgroundOperationIdRef.current =
  operationId;

ownsActiveScanRef.current =
  true;

setIsAnalyzing(true);
setResults(null);
onResultsChange?.(null);
setCanCancel(true);

const controller =
  new AbortController();

abortControllerRef.current =
  controller;

startElapsedTimer();
```

If the Phase 1 `onResultsChange?.(null)` line is already present, keep exactly one copy.

---

## Change 13 — Persist scan errors

Immediately after:

```tsx
const message: string =
  error?.message || '';
```

add:

```tsx
const recordFailure = (
  nextBanner: Banner
) => {
  const operationId =
    backgroundOperationIdRef.current;

  if (operationId) {
    failBackgroundScan(
      operationId,
      nextBanner.title,
      nextBanner.message ||
        'Something went wrong. Please try again.'
    );
  }

  if (mountedRef.current) {
    setBanner(
      nextBanner
    );
  }
};
```

Then, **inside this scan catch block only**, replace each:

```tsx
setBanner({
```

with:

```tsx
recordFailure({
```

Do not change the file-upload validation banners outside this scan catch block.

For the explicit AbortError branch, use:

```tsx
if (
  error?.name ===
    'AbortError' ||
  controller.signal.aborted
) {
  clearBackgroundScanState();

  ownsActiveScanRef.current =
    false;

  backgroundOperationIdRef.current =
    null;

  if (mountedRef.current) {
    setBanner({
      tone: 'error',
      title: 'Analysis cancelled',
      message: '',
    });
  }

  return;
}
```

---

## Change 14 — Make the `finally` block safe after navigation

Replace:

```tsx
} finally {
  stopElapsedTimer();
  setIsAnalyzing(false);
  abortControllerRef.current = null;
}
```

with:

```tsx
} finally {
  stopElapsedTimer();

  if (mountedRef.current) {
    setIsAnalyzing(false);
  }

  abortControllerRef.current =
    null;

  ownsActiveScanRef.current =
    false;

  backgroundOperationIdRef.current =
    null;
}
```

The background state itself is **not** cleared here.

A completed result must remain `completed`, and a failure must remain `error`, so the sidebar can show the correct icon and Dashboard can restore the final state.

---

# 8. Progress UX Label

Inside the existing progress block, the current code includes:

```tsx
<p className="text-sm font-medium">
  {progressText}
</p>
```

Immediately after that line add:

```tsx
<p className="text-xs text-muted-foreground mt-2 max-w-lg">
  Scan in progress, keep this tab open.
  It is safe to leave this page, your
  results will be ready shortly.
</p>
```

Keep the existing non-cancellable text underneath it:

```tsx
{!canCancel && (
  <p className="text-xs text-muted-foreground mt-2">
    Your scan is now running and can no longer be cancelled.
  </p>
)}
```

The final progress hierarchy becomes:

```text
Analyzing Your Ad...

[spinner]

Analyzing your content against META policies...

Scan in progress, keep this tab open.
It is safe to leave this page, your results will be ready shortly.

Your scan is now running and can no longer be cancelled.

Elapsed: 18s
```

---

# 9. Why No VPS Change Is Required for This Version

The existing Dashboard `ScanWorkspace` creates an `AbortController`, but its component-unmount cleanup only:

- revokes the preview URL
- clears the elapsed timer

It does **not** call:

```tsx
abortControllerRef.current?.abort();
```

Therefore internal Next.js navigation does not intentionally cancel the active request.

This matches the already-observed behavior: paid users can leave Dashboard and the result later exists in Scan History.

The server-side scan is already finishing.

The problem is that React component state such as:

```tsx
results
isAnalyzing
banner
```

belongs to the Dashboard component instance and disappears when that component unmounts.

This change moves the cross-route UI state into a small same-tab persistence layer.

---

# 10. Free User Behavior

Before this change:

```text
Free user starts scan
↓
leaves Dashboard
↓
server may finish scan
↓
Dashboard component that was waiting for result is gone
↓
free user has no Scan History recovery path
```

After this change:

```text
Free user starts scan
↓
background store = running
↓
leaves Dashboard
↓
sidebar Dashboard button = spinner
↓
scan finishes
↓
formatted result written to sessionStorage
↓
sidebar Dashboard button = green check
↓
user returns to Dashboard
↓
ScanWorkspace restores the completed result
↓
Phase 1 feedback card receives the stored scan IDs
```

Paid history remains useful, but is no longer the only recovery mechanism.

---

# 11. Status Semantics

## Spinner

Displayed when:

```text
status = preparing
or
status = running
```

Meaning:

```text
Scan is currently active.
Keep this tab open.
Internal navigation is safe.
```

## Green check

Displayed when:

```text
status = completed
```

Meaning:

```text
Results are ready on Dashboard.
```

The completed state remains until the user starts/chooses a new scan or clears the old result.

## Red X

Displayed when:

```text
status = error
```

Meaning:

```text
The scan failed.
Return to Dashboard for the error message.
```

A deliberate user cancellation clears the status rather than showing a red error X.

---

# 12. Interaction With Phase 1 Feedback

The background completion payload stores:

```text
results
scanIds
```

When Dashboard is recreated after navigation:

1. `ScanWorkspace` restores the saved results.
2. `ScanWorkspace` calls:

```tsx
onResultsChange?.({
  scanIds:
    backgroundScan.scanIds,
});
```

3. The Phase 1 Dashboard logic replaces the Scan History teaser with:

```text
Did we get this right?
[ Yes ] [ No ]
```

Therefore background navigation does not break the feedback feature.

---

# 13. No New Environment Variables

This change adds no environment variables.

It uses only browser-side same-tab storage and the existing scan flow.

No secret values are stored.

The background result payload contains only the already-returned UI analysis result and associated scan IDs.

---

# 14. Testing Checklist

## Basic navigation continuity

- [ ] Start an image scan on Dashboard.
- [ ] Confirm Dashboard nav shows a spinner.
- [ ] Navigate to Settings before the scan completes.
- [ ] Confirm Settings loads normally.
- [ ] Confirm Dashboard nav continues showing spinner.
- [ ] Wait for scan completion.
- [ ] Confirm Dashboard nav changes to a green check without returning to Dashboard.
- [ ] Click Dashboard.
- [ ] Confirm the completed result is displayed.
- [ ] Confirm the Phase 1 feedback card is displayed.
- [ ] Confirm the scan does not rerun.

## Video scan

- [ ] Repeat the same test with a video.
- [ ] Repeat with audio analysis enabled on an eligible account.
- [ ] Repeat with Deep Scan on an eligible account.

## Queue

- [ ] Force or naturally create a queued scan.
- [ ] Confirm queue state produces the Dashboard spinner.
- [ ] Navigate to Settings.
- [ ] Confirm the scan remains active.
- [ ] Confirm completion changes the icon to green.
- [ ] Return to Dashboard and verify results.

## Free plan

- [ ] Use a free account without Scan History.
- [ ] Start a scan.
- [ ] Navigate to Settings.
- [ ] Wait for completion.
- [ ] Return to Dashboard.
- [ ] Confirm the result is restored despite no Scan History access.
- [ ] Submit Phase 1 feedback successfully.

## Failure

- [ ] Trigger a controlled scan failure.
- [ ] Navigate away before the failure returns.
- [ ] Confirm Dashboard nav changes to red X.
- [ ] Return to Dashboard.
- [ ] Confirm the error banner is restored.

## Cancellation

- [ ] Start a scan while cancellation is still allowed.
- [ ] Cancel it.
- [ ] Confirm Dashboard status returns to idle.
- [ ] Confirm no red X remains for deliberate cancellation.

## New scan reset

- [ ] Complete a scan.
- [ ] Confirm green check.
- [ ] Return to Dashboard.
- [ ] Click New Scan.
- [ ] Confirm stored completed state is cleared.
- [ ] Confirm green check disappears.
- [ ] Begin another scan.
- [ ] Confirm spinner represents the new scan only.

## Multiple-platform scan

- [ ] Scan one creative against multiple platforms.
- [ ] Navigate away while it runs.
- [ ] Return after completion.
- [ ] Confirm all platform results are restored.
- [ ] Confirm all Phase 1 scan IDs are preserved for feedback.

## Full reload behavior

- [ ] Start a scan.
- [ ] Hard-refresh the tab while still running.
- [ ] Confirm the stale spinner is converted to an error rather than spinning forever.
- [ ] Confirm UI tells the user to keep the tab open for future scans.

## Storage failure fallback

- [ ] Temporarily block/disable sessionStorage if practical.
- [ ] Confirm the in-memory custom-event path still works during same-runtime navigation.

---

# 15. Rollback

To roll back this feature:

## Remove

```text
lib/mediacrater/backgroundScanStore.ts
```

## Restore

```text
components/app-sidebar.tsx
components/scan-workspace.tsx
```

No VPS rollback is required.

No database rollback is required.

No environment-variable rollback is required.

---

# 16. Deployment Sequence

Recommended TEST deployment order:

```text
1. Create lib/mediacrater/backgroundScanStore.ts
2. Replace components/app-sidebar.tsx
3. Apply the documented scan-workspace.tsx changes
4. Build TEST website
5. Confirm TypeScript/build succeeds
6. Run a normal Dashboard scan
7. Test Dashboard → Settings while preparing
8. Test Dashboard → Settings while queued
9. Test Dashboard → Settings while actively analyzing
10. Verify spinner → green check
11. Verify restored result on Dashboard
12. Test failure → red X
13. Test free account specifically
14. Test Phase 1 feedback after restored result
15. Verify New Scan clears completed state
16. Verify drift monitor shows only intended TEST/LIVE changes
17. Promote to LIVE after TEST validation
```

---

# 17. Final Behavior

The intended final experience is:

```text
User starts scan
↓
Dashboard icon shows spinner
↓
"Scan in progress, keep this tab open.
It is safe to leave this page, your results will be ready shortly."
↓
User opens Settings
↓
scan continues
↓
success → Dashboard icon becomes green check
failure → Dashboard icon becomes red X
↓
user returns to Dashboard
↓
result/error is restored
↓
free users are no longer dependent on Scan History to recover results
```

This change deliberately solves the navigation-loss problem without introducing another server subsystem or duplicating the scan engine.
