// lib/mediacrater/scanApi.ts
//
// Talks to the exact same VPS endpoints the extension's utils/supabase.js
// calls (/scan-video, /scan-image, /queue-status, /queue-cancel,
// /queue-timing) — same auth model (Supabase JWT via Authorization header),
// same queueing/rate-limit/abuse-lock behavior server-side, since it's the
// same server code (routes/scanVideo.js, routes/scanImage.js) handling both
// origins. The only difference on the wire is the `x-scan-origin: webapp`
// header, which is what server.js's origin-detection logic in
// scanVideo.js/scanImage.js uses to tag the `origin` column on `scans`.
//
// NOTE: the extension's scanVideo() took a `policy` argument positionally
// that was never actually used (server loads the policy itself from
// `platform`). Dropped here rather than ported as dead weight.

import type { ExtractedFrame, ScanType } from './dissector';
import { supabase } from './supabaseClient';

const VPS_URL = process.env.NEXT_PUBLIC_VPS_API_URL || '';

export interface ScanQueuedResponse {
  queued: true;
  jobId: string;
  position: number;
}

export interface ScanCompletedResponse {
  queued?: false;
  success: true;
  result: {
    platform: string;
    violations: Array<Record<string, unknown>>;
  };
  scansRemaining: number;
  maxScans: number;
  plan: string;
}

export type ScanResponse = ScanQueuedResponse | ScanCompletedResponse;

export interface ClientBatchMeta {
  batchedByClient: boolean;
  batchId: string | null;
  batchPosition: number | null;
}

async function requireAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }
  return session.access_token;
}

/**
 * Extracts a usable error message from a non-OK VPS response the same
 * way the extension's error taxonomy in popup.js expects to match against
 * (e.g. "Insufficient tokens", "ACCOUNT_FLAGGED", "Rate limit exceeded").
 */
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    if (response.status === 403 && data.error === 'ACCOUNT_FLAGGED') {
      return data.message || 'ACCOUNT_FLAGGED';
    }
    if (response.status === 402) {
      return `Insufficient tokens. You need ${data.tokensNeeded ?? 1} token(s).`;
    }
    if (response.status === 429) {
      return data.message || 'Rate limit exceeded';
    }
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

export async function scanVideo(
  frames: ExtractedFrame[],
  audio: { data: string; mimeType: string } | null,  // new parameter
  platform: string,
  scanType: ScanType,
  jobId: string | null,
  signal?: AbortSignal,
  scanId?: string | null,
  thumbnailUrl?: string | null,
  fileName?: string | null,
  batchMeta?: ClientBatchMeta
): Promise<ScanResponse> {
  const token = await requireAccessToken();

  const response = await fetch(`${VPS_URL}/scan-video`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-scan-origin': 'webapp',
    },
    body: JSON.stringify({
      frames,
      audio: audio || null,
      transcript: null,
      platform,
      scanType: scanType || 'regular',
      jobId: jobId || null,
      scanId: scanId || null,
      thumbnailUrl: thumbnailUrl || null,
      fileName: fileName || null,
      batchedByClient:
        batchMeta?.batchedByClient === true,
      batchId:
        batchMeta?.batchId ?? null,
      batchPosition:
        batchMeta?.batchPosition ?? null,
    }),
    signal,
  });

  if (response.status === 202) {
    const data = await response.json();
    return { queued: true, jobId: data.jobId, position: data.position };
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Failed to scan video (${response.status})`));
  }

  return response.json();
}

export async function scanImage(
  imageData: string,
  platform: string,
  jobId: string | null,
  signal?: AbortSignal,
  scanId?: string | null,
  thumbnailUrl?: string | null,
  fileName?: string | null,
  batchMeta?: ClientBatchMeta
): Promise<ScanResponse> {
  const token = await requireAccessToken();

  const response = await fetch(`${VPS_URL}/scan-image`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-scan-origin': 'webapp',
    },
    body: JSON.stringify({
      imageData,
      platform,
      jobId: jobId || null,
      scanId: scanId || null,
      thumbnailUrl: thumbnailUrl || null,
      fileName: fileName || null,
      batchedByClient:
        batchMeta?.batchedByClient === true,
      batchId:
        batchMeta?.batchId ?? null,
      batchPosition:
        batchMeta?.batchPosition ?? null,
    }),
    signal,
  });

  if (response.status === 202) {
    const data = await response.json();
    return { queued: true, jobId: data.jobId, position: data.position };
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Failed to scan image (${response.status})`));
  }

  return response.json();
}

export async function getQueueStatus(
  jobId: string
): Promise<{ status: 'running' | 'queued' | 'not_found'; position?: number }> {
  const token = await requireAccessToken();
  const response = await fetch(`${VPS_URL}/queue-status/${encodeURIComponent(jobId)}`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Failed to get queue status');
  return response.json();
}

export async function cancelQueuedScan(jobId: string): Promise<{ success: boolean }> {
  const token = await requireAccessToken();
  const response = await fetch(`${VPS_URL}/queue-cancel/${encodeURIComponent(jobId)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to cancel scan');
  }
  return response.json();
}

export async function reportQueueTiming(
  jobId: string,
  timings: { totalTimeMs: number; queueWaitMs: number; framesWaitMs: number }
): Promise<void> {
  try {
    const token = await requireAccessToken();
    await fetch(`${VPS_URL}/queue-timing/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(timings),
    });
  } catch (err) {
    // Non-critical, same as extension — never let timing reporting
    // break or delay the scan flow.
    console.warn('Failed to report queue timing:', err);
  }
}

/**
 * Polls /queue-status every 3s until the job is marked 'running'.
 * Resolves once it's the user's turn. Rejects with AbortError if
 * the signal is aborted (user cancelled).
 */
export function waitForQueueTurn(
  jobId: string,
  signal: AbortSignal,
  onPositionUpdate: (position: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const checkStatus = async () => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      try {
        const status = await getQueueStatus(jobId);
        if (status.status === 'running') {
          resolve();
          return;
        }
        if (status.status === 'not_found') {
          reject(new Error('Your queued scan could not be found. Please try again.'));
          return;
        }
        if (typeof status.position === 'number') onPositionUpdate(status.position);
        setTimeout(checkStatus, 3000);
      } catch (err) {
        reject(err);
      }
    };
    checkStatus();
  });
}
