// lib/mediacrater/scanRecovery.ts
//
// Recovers the result of a scan whose HTTP response never reached the
// browser.
//
// Why: Cloudflare closes any request that takes longer than 100 seconds
// (error 524, sent without CORS headers, so the browser only reports
// "Failed to fetch"). Deep scans with thinking mode can take 2–4 minutes.
// The server keeps working, charges the scan and saves the result to the
// `scans` table under the scanId this page generated. So instead of showing
// "Failed to fetch" (and inviting a paid retry), we wait for that row to
// appear and show it as if the response had arrived.
//
// Reads go through the user's own session and RLS ("Users can view own
// scans"), so this can only ever find the user's own scan.

import { supabase } from './supabaseClient';

const POLL_INTERVAL_MS = 5_000;
const RECOVERY_TIMEOUT_MS = 6 * 60 * 1000; // the server gives up after 280 s

// Statuses a proxy returns when it gave up waiting for the server.
const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 522, 524]);

export interface RecoveredScan {
  queued?: false;
  success: true;
  result: { platform: string; violations: Array<Record<string, unknown>> } & Record<string, unknown>;
  scansRemaining: number;
  maxScans: number;
  plan: string;
  recovered: true;
}

/** fetch() rejects with a TypeError when the connection is lost or blocked. */
export function isLostConnection(error: unknown): boolean {
  return error instanceof TypeError;
}

export function isGatewayTimeout(status: number): boolean {
  return GATEWAY_STATUSES.has(status);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Waits for the scan with this id to be saved, then returns it in the same
 * shape as a successful scan response. Throws a user-facing error if the
 * scan failed on the server or doesn't appear in time.
 */
export async function waitForSavedScan(scanId: string, signal?: AbortSignal): Promise<RecoveredScan> {
  const deadline = Date.now() + RECOVERY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const { data: scan, error } = await supabase
      .from('scans')
      .select('status, generated_data, tokens_remaining')
      .eq('id', scanId)
      .maybeSingle();

    if (!error && scan) {
      if (scan.status === 'completed' && scan.generated_data) {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const { data: profile } = session?.user
          ? await supabase
              .from('profiles')
              .select('plan, scans_remaining, scans_per_month')
              .eq('id', session.user.id)
              .maybeSingle()
          : { data: null };

        return {
          success: true,
          result: scan.generated_data,
          scansRemaining: profile?.scans_remaining ?? scan.tokens_remaining ?? 0,
          maxScans: profile?.scans_per_month ?? 0,
          plan: profile?.plan ?? 'free',
          recovered: true,
        };
      }

      throw new Error('Your scan could not be completed. Please try again.');
    }

    await sleep(POLL_INTERVAL_MS, signal);
  }

  throw new Error(
    'This scan is taking longer than expected. It will appear in your Scan History when it finishes, so please check there before scanning again.'
  );
}
