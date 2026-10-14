// lib/mediacrater/evidenceStore.ts
//
// Keeps the evidence frames shown under each violation across a page
// refresh, in the same tab only. Same lifecycle as the results themselves
// (backgroundScanStore.ts): cleared by clearBackgroundScanState() on "New
// Scan", and gone when the tab closes. Nothing is sent to a server.

import type { EvidenceFrames } from '@/lib/mediacrater/evidenceFrames';

const STORAGE_KEY = 'mediacrater_evidence_v1';

// sessionStorage holds roughly 5 MB per origin (browser-dependent) and the
// background scan state lives there too, so stay well under that.
const MAX_TOTAL_FRAMES = 12;
const MAX_TOTAL_CHARS = 3_000_000;

const JPEG_DATA_URL_PREFIX = 'data:image/jpeg;base64,';

export function saveEvidence(
  evidenceByScan: Map<string, EvidenceFrames>
): void {
  if (typeof window === 'undefined') return;

  const toStore: Record<string, EvidenceFrames> = {};
  let frameCount = 0;
  let charCount = 0;

  outer: for (const [scanId, evidence] of evidenceByScan) {
    for (const [timestamp, dataUrl] of Object.entries(evidence)) {
      if (
        frameCount >= MAX_TOTAL_FRAMES ||
        charCount + dataUrl.length > MAX_TOTAL_CHARS
      ) {
        break outer;
      }

      if (!toStore[scanId]) toStore[scanId] = {};
      toStore[scanId][timestamp] = dataUrl;
      frameCount += 1;
      charCount += dataUrl.length;
    }
  }

  try {
    if (frameCount === 0) {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    }
  } catch (error) {
    // Quota exceeded or storage unavailable: thumbnails just won't survive
    // a refresh. Never worth failing anything over.
    console.warn('[EVIDENCE] Could not persist frames:', error);
  }
}

export function loadEvidence(): Map<string, EvidenceFrames> {
  const result = new Map<string, EvidenceFrames>();
  if (typeof window === 'undefined') return result;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return result;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return result;
    }

    for (const [scanId, frames] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (!frames || typeof frames !== 'object' || Array.isArray(frames)) {
        continue;
      }

      const clean: EvidenceFrames = {};
      for (const [timestamp, dataUrl] of Object.entries(
        frames as Record<string, unknown>
      )) {
        // Only accept the exact shape we write (a JPEG data URL from our
        // own canvas), nothing else ends up in an <img src>.
        if (
          typeof dataUrl === 'string' &&
          dataUrl.startsWith(JPEG_DATA_URL_PREFIX)
        ) {
          clean[timestamp] = dataUrl;
        }
      }

      if (Object.keys(clean).length > 0) result.set(scanId, clean);
    }
  } catch (error) {
    console.warn('[EVIDENCE] Could not read stored frames:', error);
  }

  return result;
}

export function clearEvidence(): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('[EVIDENCE] Could not clear stored frames:', error);
  }
}
