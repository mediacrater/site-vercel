'use client';

// lib/mediacrater/backgroundScanStore.ts
//
// CHANGES (URL creatives in batches):
// - fileKind now accepts 'image_url' and 'video_url'. normalizeBatchItems()
//   used to drop any item whose fileKind wasn't 'image' or 'video', and every
//   read of the stored state (progress updates, batch item updates, tab focus)
//   runs through it. URL creatives therefore vanished from batchItems right
//   after the scan started: no pause icons in the sidebar, no result bubbles,
//   and a wrong "x of x creatives completed" count.
// - makeIdleState() now includes batchItems: [] (it was missing, so
//   `state.batchItems.length` could throw on an idle state).

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

export type BackgroundCreativeKind =
  | 'image'
  | 'video'
  | 'image_url'
  | 'video_url';

const VALID_CREATIVE_KINDS:
  BackgroundCreativeKind[] = [
    'image',
    'video',
    'image_url',
    'video_url',
  ];

export type BackgroundBatchItemStatus =
  | 'queued'
  | 'cooldown'
  | 'processing'
  | 'success'
  | 'error';

export interface BackgroundBatchItem {
  creativeId: string;
  fileName: string;
  fileKind: BackgroundCreativeKind;
  batchPosition: number;
  status: BackgroundBatchItemStatus;
  scanIds: string[];
  error: string | null;
}

export interface BackgroundScanResult {
  creativeId: string;
  fileName: string;
  fileKind: BackgroundCreativeKind;
  batchPosition: number | null;
  scanId: string;
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
  batchItems: BackgroundBatchItem[];
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
    batchItems: [],
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

const VALID_BATCH_ITEM_STATUSES:
  BackgroundBatchItemStatus[] = [
    'queued',
    'cooldown',
    'processing',
    'success',
    'error',
  ];

function normalizeBatchItems(
  value: unknown
): BackgroundBatchItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== 'object'
    ) {
      return [];
    }

    const candidate =
      item as Partial<BackgroundBatchItem>;

    if (
      typeof candidate.creativeId !== 'string' ||
      typeof candidate.fileName !== 'string' ||
      !VALID_CREATIVE_KINDS.includes(
        candidate.fileKind as BackgroundCreativeKind
      ) ||
      !Number.isInteger(candidate.batchPosition) ||
      !VALID_BATCH_ITEM_STATUSES.includes(
        candidate.status as BackgroundBatchItemStatus
      )
    ) {
      return [];
    }

    return [{
      creativeId: candidate.creativeId,
      fileName: candidate.fileName,
      fileKind: candidate.fileKind,
      batchPosition:
        candidate.batchPosition as number,
      status:
        candidate.status as BackgroundBatchItemStatus,
      scanIds:
        Array.isArray(candidate.scanIds)
          ? candidate.scanIds.filter(
              (id): id is string =>
                typeof id === 'string'
            )
          : [],
      error:
        typeof candidate.error === 'string'
          ? candidate.error
          : null,
    }];
  });
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

    batchItems:
      normalizeBatchItems(
        state.batchItems
      ),

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
      batchItems:
        state.batchItems.map(
          (item) =>
            item.status === 'success' ||
            item.status === 'error'
              ? item
              : {
                  ...item,
                  status: 'error',
                  error: 'Scan interrupted.',
                }
        ),
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
  message = 'Preparing analysis...',
  batchItems:
    BackgroundBatchItem[] = []
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
    batchItems,
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

export function updateBackgroundBatchItem(
  operationId: string,
  creativeId: string,
  patch: Partial<
    Pick<
      BackgroundBatchItem,
      'status' | 'scanIds' | 'error'
    >
  >
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
    batchItems:
      current.batchItems.map(
        (item) =>
          item.creativeId ===
          creativeId
            ? {
                ...item,
                ...patch,
              }
            : item
      ),
    updatedAt:
      new Date().toISOString(),
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
    batchItems:
      current.batchItems.map(
        (item) =>
          item.status === 'success' ||
          item.status === 'error'
            ? item
            : {
                ...item,
                status: 'error',
                error: message,
              }
      ),
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
