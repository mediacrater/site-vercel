# Results Page: Evidence Frames Under Each Violation (Nearest-Frame Matching and the Comma-Joined Timestamp Fix)

| | |
|---|---|
| **Date** | 14 October 2026 (`14oct26`) |
| **Destination** | changelogs/site |
| **Conversation** | Not available to me. Paste this chat's URL here when you file this. |
| **Related prior work** | `results-frame-lightbox-click-to-enlarge-14oct26.md`<br>`results-evidence-frames-session-persistence-14oct26.md`<br>`results-video-player-with-violation-timeline-14oct26.md`<br>`timestamp-prompt-single-moments-no-ranges-14oct26.md` |
| **Stack** | Next.js web app on Vercel (`components/scan-workspace.tsx`, new `lib/mediacrater/evidenceFrames.ts`, new `components/violation-frames.tsx`). Test repo: `mediacrater/test-site-vercel` |
| **Starting trigger** | After a first scan most free users never came back, and the results page was plain text. You wanted proof of where each violation happens: a still frame at every timestamp the model cites |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included. `VPS_IPV4`, `VPS_IPV6`, `<customer uuid>`, `<your test account uuid>` and similar placeholders stand in for them. Real accounts are described by what happened, not by ID.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied (an expected output is given). ⏳ = open.

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
9. [Appendix A – evidenceFrames.ts (final)](#appendix-a--evidenceframests-final)
10. [Appendix B – violation-frames.tsx (first version)](#appendix-b--violation-framestsx-first-version)
11. [Appendix C – scan-workspace.tsx edits](#appendix-c--scan-workspacetsx-edits)
12. [Appendix D – Verification](#appendix-d--verification)
13. [Appendix E – Rollback](#appendix-e--rollback)

---

## 1. Summary

Each violation card on the results page now shows up to **4 thumbnails** of the video frames closest to the timestamps the model cited, each captioned with its timestamp.

**Main outcomes**

- The frames are the ones the browser already extracted for the scan (`ExtractedFrame[]`, JPEG data URLs, quality 0.30, 900 px longest edge). **Nothing is uploaded or stored on a server** for this feature.
- Frames are taken at a random point inside each 0.5 s window, so the code matches the **nearest** frame within 1 s of the cited time. Farther than 1 s, no thumbnail is shown rather than a wrong one.
- It works for **file uploads only** (`creative.kind === 'video'`). URL scans have no frames in the browser (see `url-scan-video-playback-in-results-14oct26.md`).
- It is free for every plan.
- The first version would have shown nothing for real responses: the model returns **one comma-joined string** (`"00:02.43, 00:10.67, ..."`), and my parser expected one timestamp per entry. A one-function fix (`evidenceTimestamps` splits on commas) made it work.
- You verified it in the browser with two screenshots of the animal video (four thumbnails matching the cited times) and said it "definitely helps a lot".

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| `lib/mediacrater/evidenceFrames.ts` created | ✅ Done | Present on the repo's `main` (76 lines) |
| `components/violation-frames.tsx` created | ✅ Done | Later replaced by the lightbox version (`results-frame-lightbox-click-to-enlarge-14oct26.md`) |
| `scan-workspace.tsx` edits (import, ref, clear, capture, render) | ✅ Done | All five markers found on `main` |
| Comma-joined timestamp fix | ✅ Done | `violationTimestamps` and `evidenceTimestamps` present |
| Browser check with the animal video | ✅ Verified | Two screenshots, four thumbnails each, captions matching the cited times |
| Copied to the live web repo | ✅ Done | You reported the web app files were already copied. I haven't seen the live repo |
| Thumbnails for URL scans | ⏳ Not possible here | The browser can't read pixels from other sites' videos |
| Accuracy on more videos | ⏳ Not tested | Two runs of one video so far |

---

## 3. Starting point

- Violations arrive as JSON. For a **video** scan each violation has `type`, `timestamp` (one string, comma-joined when the issue appears at several moments), `reason`, `suggestedFix`, `editingWorkaround`, `severity`. An **image** scan response has no timestamps (the first screenshot you sent as "the video response" was actually a `scan-image` response, and I asked for the real one).
- `scoreCalculator.ts` (`deduplicateViolations`) turns `timestamp` into `timestamps: [<that whole string>]`. The results card already joined that array back into text, which hid the problem.
- `dissector.ts` (`extractFrames`) takes a frame every 0.5 s, at a random point inside each window (`randomize = true`), and labels it with `formatTimestamp()` as `MM:SS.cc`. The server thins frames before the AI call (`capFrameCount`), so frame **numbers** are unreliable. Timestamps are used instead.
- `scan-workspace.tsx` keeps results in `PlatformResult` objects that also go into the background scan store (sessionStorage), so frames are kept out of them.

---

## 4. Timeline: what we did, in order

### Phase 1 – Reading the code

I read `scan-workspace.tsx`, `scoreCalculator.ts` and `dissector.ts` from the repo. Decisions: keep frames in a `useRef` map keyed by `scanId` (not in `PlatformResult`), only for file uploads, and match by timestamp.

### Phase 2 – First build

Two new files and five edits to `scan-workspace.tsx` ([Appendix A](#appendix-a--evidenceframests-final), [B](#appendix-b--violation-framestsx-first-version), [C](#appendix-c--scan-workspacetsx-edits)).

### Phase 3 – The real response shape

You sent the video response. It showed `"timestamp": "00:02.43, 00:10.67, 00:21.51, 00:29.20"`, so my parser would have rejected the whole string and skipped every thumbnail. I replaced `evidenceTimestamps` with a version that splits on commas, trims, de-duplicates and drops non-strings (model output is untrusted).

### Phase 4 – Verified

Your screenshot showed four thumbnails labelled `00:02.43`, `00:10.73`, `00:21.31`, `00:29.36`. You said it "actually looks solid". A later run showed `00:02.08`, `00:10.11`, `00:21.39`, `00:29.45`. The cited times differ between runs of the same video, which fits the random frame offsets.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | The screenshot sent as the video response showed no timestamps | It was a `scan-image` response | You sent the real `scan-video` response |
| 2 | My first parser would have shown no thumbnails | The model returns one comma-joined string, which `scoreCalculator` wraps as a one-element array | `evidenceTimestamps` splits each entry on commas |
| 3 | Cited timestamps change between runs | Random frame offsets plus model variance | Nearest-frame matching within 1 s |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. I assumed `timestamps` held one timestamp per entry. It holds one string with commas.
2. I called the Vercel preview build your type-check. `next.config.mjs` has `typescript: { ignoreBuildErrors: true }`, so a type error does **not** fail the build. Test by hand and watch the browser console.

### Decisions

1. Up to **4** thumbnails per violation (`MAX_FRAMES_PER_VIOLATION`).
2. Match the **nearest** frame within **1 s** (`MAX_MATCH_DISTANCE_SECONDS`), otherwise show nothing.
3. Match by timestamp, not frame number.
4. Keep frames in memory only, never in `PlatformResult` or on a server.
5. File uploads only.
6. Free for all plans (your call: the free result is the demo).

### Known limits

- If the model's timestamp is off, the thumbnail shows the wrong moment. A wrong picture is worse than none, so check this on more videos.
- Enlarged frames look compressed (quality 0.30). See `results-frame-lightbox-click-to-enlarge-14oct26.md`.
- Refreshing the page loses the frames unless the session store is used (`results-evidence-frames-session-persistence-14oct26.md`).

---

## 7. Open items checklist

- [x] `evidenceFrames.ts` and `violation-frames.tsx` created
- [x] Five `scan-workspace.tsx` edits applied
- [x] Comma-joined timestamp fix applied and verified
- [x] Copied to the live web repo (you reported it)
- [ ] Check accuracy on 3 or 4 more videos: scrub to each cited timestamp and compare with its thumbnail
- [ ] Optional: re-render a full-quality frame from the original video when a thumbnail is opened

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Files | `lib/mediacrater/evidenceFrames.ts`, `components/violation-frames.tsx`, `components/scan-workspace.tsx` |
| Max thumbnails per violation | 4 |
| Max match distance | 1 second |
| Timestamp format | `MM:SS.cc` (from `formatTimestamp` in `dissector.ts`) |
| Frame source | `extractFrames()` output, JPEG quality 0.30, longest edge 900 px, one frame per 0.5 s window |
| Where frames live | `evidenceRef` (a `useRef` map of `scanId` to `{ timestamp: dataUrl }`) |
| Scope | File-upload videos only |

---

## Appendix A – evidenceFrames.ts (final)

This is the file as it is on `main` now. `violationTimestamps` was added later for the video player (`results-video-player-with-violation-timeline-14oct26.md`). The comma-splitting fix from this change is inside it.

```ts
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
```

---

## Appendix B – violation-frames.tsx (first version)

Replaced by the lightbox version (`results-frame-lightbox-click-to-enlarge-14oct26.md`).

```tsx
// components/violation-frames.tsx  (FIRST version, later replaced by the lightbox version)

import {
  evidenceTimestamps,
  type EvidenceFrames,
} from '@/lib/mediacrater/evidenceFrames';
import type { Violation } from '@/lib/mediacrater/scoreCalculator';

export function ViolationFrames({
  violation,
  evidence,
}: {
  violation: Violation;
  evidence: EvidenceFrames | undefined;
}) {
  if (!evidence) return null;

  const frameData: EvidenceFrames = evidence;
  const shots = evidenceTimestamps(violation).filter((ts) => frameData[ts]);
  if (shots.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
      {shots.map((ts) => (
        <figure key={ts} className="shrink-0 m-0">
          <img
            src={frameData[ts]}
            alt={`Video frame at ${ts}`}
            className="h-24 w-auto rounded-md border border-border object-cover"
          />
          <figcaption className="mt-1 text-center text-[10px] text-muted-foreground">
            {ts}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
```

---

## Appendix C – scan-workspace.tsx edits

**Imports** (after the `thumbnails` import):

```ts
import { ViolationFrames } from '@/components/violation-frames';
import {
  pickEvidenceFrames,
  type EvidenceFrames,
} from '@/lib/mediacrater/evidenceFrames';
import { loadEvidence, saveEvidence } from '@/lib/mediacrater/evidenceStore';
import { VideoTimeline, violationDomId } from '@/components/video-timeline';
```

**Ref** (after `fileInputRef`):

```ts
  // scanId -> { timestamp -> frame data URL }. Kept in a ref, not in
  // PlatformResult, so frames never go through the background scan store.
  const evidenceRef = useRef<Map<string, EvidenceFrames>>(new Map());
```

**Clear the map** (two places): as the first statement of `performAnalysis`, and in `resetForNewScan` after `setCreatives([]);`:

```ts
evidenceRef.current.clear();
```

**Capture** (in `performAnalysis`, directly before `creativeResults.push({`):

```ts
            if (creative.kind === 'video') {
              const evidence = pickEvidenceFrames(frames, processedViolations);
              if (Object.keys(evidence).length > 0) {
                evidenceRef.current.set(scanId, evidence);
              }
            }
```

**Render** (in the violation card, after the `location` line):

```tsx
                                  <ViolationFrames violation={v} evidence={evidenceRef.current.get(r.scanId)} />
```

---

## Appendix D – Verification

1. Scan a video file you know has a violation.
2. Each violation card shows up to 4 thumbnails with timestamps under the `⏱` line.
3. Scrub the original video to each cited time and compare.
4. Scan an image: no thumbnails, no errors.
5. Scan a video URL: no thumbnails (expected).

**Expected output:** thumbnails whose captions match the `⏱` times. If none appear, open the browser console and look for red errors. If the cards show the timestamps but no pictures, the response format changed (check the `timestamp` field).

---

## Appendix E – Rollback

1. Delete `components/violation-frames.tsx` and `lib/mediacrater/evidenceFrames.ts`.
2. Remove the import, ref, both `clear()` lines, the capture block and the `<ViolationFrames ... />` line from `scan-workspace.tsx`.
3. Later features import these files (`video-timeline.tsx`, `evidenceStore.ts`). Roll those back first or the build will fail on the missing imports.

---

*End of index.*
