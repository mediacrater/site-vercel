// lib/mediacrater/evidenceFrames.ts

import type { ExtractedFrame } from '@/lib/mediacrater/dissector';
import type { Violation } from '@/lib/mediacrater/scoreCalculator';

// Frames are taken roughly every 0.5 s, so the nearest frame is never more
// than ~1 s from any moment in the video. Farther than that, show nothing.
const MAX_MATCH_DISTANCE_SECONDS = 1;
const MAX_FRAMES_PER_VIOLATION = 8;

export type EvidenceFrames = Record<string, string>;

// "MM:SS.cc" (see formatTimestamp in dissector.ts) -> seconds.
// Returns null for anything else the model might return.
export function parseTimestampSeconds(value: string): number | null {
  const match = /^(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (seconds > 59) return null;
  const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
  return minutes * 60 + seconds + fraction;
}

// Every distinct timestamp the model cited for a violation (no cap). The
// model returns them as one comma-joined string ("00:02.43, 00:10.67, ..."),
// which scoreCalculator wraps in an array, so split each entry on commas.
// Model output is untrusted, so non-strings are dropped.
export function violationTimestamps(violation: Violation): string[] {
  const all = (violation.timestamps ?? [])
    .filter((value): value is string => typeof value === 'string')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return Array.from(new Set(all));
}

// The first few, for thumbnails.
export function evidenceTimestamps(violation: Violation): string[] {
  return violationTimestamps(violation).slice(0, MAX_FRAMES_PER_VIOLATION);
}

// timestamp string -> frame data URL, only for timestamps with a close frame.
export function pickEvidenceFrames(
  frames: ExtractedFrame[],
  violations: Violation[]
): EvidenceFrames {
  const evidence: EvidenceFrames = {};
  if (frames.length === 0) return evidence;

  for (const violation of violations) {
    for (const timestamp of evidenceTimestamps(violation)) {
      if (evidence[timestamp]) continue;

      const target = parseTimestampSeconds(timestamp);
      if (target === null) continue;

      let best: ExtractedFrame | null = null;
      let bestDistance = Infinity;
      for (const frame of frames) {
        const distance = Math.abs(frame.timestampSeconds - target);
        if (distance < bestDistance) {
          best = frame;
          bestDistance = distance;
        }
      }

      if (best && bestDistance <= MAX_MATCH_DISTANCE_SECONDS) {
        evidence[timestamp] = best.data;
      }
    }
  }

  return evidence;
}
