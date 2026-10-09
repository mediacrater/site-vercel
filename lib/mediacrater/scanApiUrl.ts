//scanApiUrl.ts
//
// CHANGES (deep scan): URL scans pass their scanId to postJson, so a scan
// whose response is cut off (Cloudflare's 100-second limit, while a deep scan
// is still thinking) is recovered from the saved scan instead of failing with
// "Failed to fetch". See scanRecovery.ts.

import { supabase } from '@/lib/mediacrater/supabaseClient';
import {
  CONNECTION_LOST_MESSAGE,
  isGatewayTimeout,
  isLostConnection,
  SCAN_LOST_MESSAGE,
  waitForSavedScan,
} from './scanRecovery';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_VPS_API_URL || '';

interface BatchMeta {
  batchedByClient: boolean;
  batchId: string;
  batchPosition: number;
}

interface QueuedScanResponse {
  queued: true;
  jobId: string;
  position: number;
}

interface CompletedScanResponse {
  success: true;
  result: any;
  scansRemaining: number;
  maxScans: number;
  plan: string;
}

export type UrlScanResponse =
  | QueuedScanResponse
  | CompletedScanResponse;

export interface ResolvedCreativeUrl {
  url: string;
  kind: 'video' | 'image';
  contentType: string;
  contentLength: number | null;
  fileName?: string | null;
}

async function getAuthHeader() {
  const {
    data: {
      session,
    },
  } =
    await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('Unauthorized');
  }

  return {
    Authorization:
      `Bearer ${session.access_token}`,
  };
}

async function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  recoverScanId?: string | null
): Promise<T> {
  const headers =
    await getAuthHeader();

  // Scans (with a scanId) wait for the saved result; other requests, like
  // checking a pasted URL, just get a clear message instead of "Failed to fetch".
  const isScan = path.startsWith('/scan-');
  const recover = async (error: unknown): Promise<T> => {
    if (signal?.aborted) throw error;
    if (recoverScanId) {
      return (await waitForSavedScan(recoverScanId, signal)) as unknown as T;
    }
    throw new Error(isScan ? SCAN_LOST_MESSAGE : CONNECTION_LOST_MESSAGE);
  };

  let response: Response;
  try {
    response =
    await fetch(
      `${API_BASE_URL}${path}`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type':
            'application/json',
          'x-scan-origin':
            'webapp',
        },
        body:
          JSON.stringify(body),
        signal,
      }
    );
  } catch (error) {
    if (isLostConnection(error)) return recover(error);
    throw error;
  }

  if (!response.ok && isGatewayTimeout(response.status)) {
    return recover(new Error('URL scan failed. Please try again.'));
  }

  const payload =
    await response.json().catch(
      () => null
    );

  // The connection dropped while the result was arriving.
  if (response.ok && payload === null) {
    return recover(new Error('URL scan failed. Please try again.'));
  }

  if (!response.ok) {
    throw new Error(
      payload?.message ||
        payload?.error ||
        'URL scan failed. Please try again.'
    );
  }

  return payload as T;
}

export async function resolveCreativeUrl(
  url: string
) {
  return postJson<ResolvedCreativeUrl>(
    '/resolve-url',
    { url }
  );
}

export async function scanVideoUrl(
  url: string,
  platform: string,
  scanType: string,
  jobId: string | null,
  signal: AbortSignal,
  scanId?: string | null,
  thumbnailUrl?: string | null,
  fileName?: string | null,
  batchMeta?: BatchMeta,
  analyzeAudio?: boolean
) {
  return postJson<UrlScanResponse>(
    '/scan-video-url',
    {
      url,
      platform,
      scanType,
      jobId,
      scanId,
      thumbnailUrl,
      fileName,
      analyzeAudio:
        Boolean(analyzeAudio),
      ...batchMeta,
    },
    signal,
    scanId
  );
}

export async function scanImageUrl(
  url: string,
  platform: string,
  jobId: string | null,
  signal: AbortSignal,
  scanId?: string | null,
  thumbnailUrl?: string | null,
  fileName?: string | null,
  batchMeta?: BatchMeta
) {
  return postJson<UrlScanResponse>(
    '/scan-image-url',
    {
      url,
      platform,
      jobId,
      scanId,
      thumbnailUrl,
      fileName,
      ...batchMeta,
    },
    signal,
    scanId
  );
}
