//scanApiUrl.ts

import { supabase } from '@/lib/mediacrater/supabaseClient';

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
  signal?: AbortSignal
): Promise<T> {
  const headers =
    await getAuthHeader();

  const response =
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

  const payload =
    await response.json().catch(
      () => null
    );

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
    signal
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
    signal
  );
}
