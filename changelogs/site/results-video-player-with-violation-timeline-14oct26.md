# Results Page: Video Player With a Severity-Colored Violation Timeline (Markers, Bubbles, Jump to Report)

| | |
|---|---|
| **Date** | 14 October 2026 (`14oct26`) |
| **Destination** | changelogs/site |
| **Conversation** | Not available to me. Paste this chat's URL here when you file this. |
| **Related prior work** | `results-evidence-frames-under-violations-14oct26.md`<br>`results-frame-lightbox-click-to-enlarge-14oct26.md`<br>`results-player-volume-slider-14oct26.md`<br>`results-player-refresh-note-and-privacy-link-14oct26.md`<br>`url-scan-video-playback-in-results-14oct26.md`<br>`timestamp-prompt-single-moments-no-ranges-14oct26.md` |
| **Stack** | Next.js web app on Vercel (new `components/video-timeline.tsx`; edits to `components/scan-workspace.tsx` and `lib/mediacrater/evidenceFrames.ts`) |
| **Starting trigger** | Your spec: show the uploaded video above the results with a YouTube-style bar, color-coded violation markers at the cited times, a bubble on click (severity-colored left stripe plus the violation title), and a way to jump from the bubble to the report |

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
9. [Appendix A – video-timeline.tsx (as on main now)](#appendix-a--video-timelinetsx-as-on-main-now)
10. [Appendix B – violationTimestamps in evidenceFrames.ts](#appendix-b--violationtimestamps-in-evidenceframests)
11. [Appendix C – scan-workspace.tsx edits](#appendix-c--scan-workspacetsx-edits)
12. [Appendix D – Verification](#appendix-d--verification)
13. [Appendix E – Rollback](#appendix-e--rollback)

---

## 1. Summary

After a scan of an uploaded video, the original video now plays above the results with a custom control bar. Violations appear on the bar as colored markers. Clicking a marker jumps the video there and opens a small bubble. Clicking the bubble scrolls to that violation's card and highlights it for 2 seconds.

**Main outcomes**

- **Layout:** the player sits between the "Analysis Results" header and the first result card, capped at 45% of the screen height. Controls are **under** the video (not overlaid), so the bar always spans the full card width, which matters for portrait ads.
- **Markers are points, not ranges.** The model cites moments (`SEEK_LEAD_SECONDS = 0` lands exactly on the cited time).
- **Clustering:** markers closer than `max(0.75 s, 1.5% of the duration)` merge into one. Its color is the highest severity in the group (green low, amber medium, red high), and its bubble lists every violation there.
- **Interaction:** click or drag the bar to seek, arrow keys move 5 s, Home and End jump to the ends, Escape or an outside click closes the bubble, clicking the video toggles play and pause.
- If the video can't play, the component hides itself (`onError`).
- **Free for all plans**, your decision: the free result is the main draw.
- This change **depends on the prompt change** in `timestamp-prompt-single-moments-no-ranges-14oct26.md`, which makes the model return moments instead of ranges.
- You verified it in the browser: "It looks good, I think this is very good."

The file in Appendix A is the version on `main` **today**, so it already contains the later volume slider (`results-player-volume-slider-14oct26.md`) and the refresh note (`results-player-refresh-note-and-privacy-link-14oct26.md`).

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| `components/video-timeline.tsx` created | ✅ Done | On `main` (480 lines) |
| `violationTimestamps` added to `evidenceFrames.ts` | ✅ Done | On `main` |
| `scan-workspace.tsx`: import, highlight state, `focusViolation`, `activeVideoCreative`, render, card id and ring | ✅ Done | All markers found on `main` |
| Browser check with the animal video | ✅ Verified | You said it looks good and keep it free for free users |
| Copied to the live web repo | ✅ Done | You reported the web app files were copied. I haven't seen the live repo |
| Is the risk verdict still visible without scrolling? | ⏳ Not answered | I asked; the player makes the page taller |
| Player after a refresh or in Scan History | ⏳ By design absent | The original file only exists in React state |

---

## 3. Starting point

- Your first idea was a "reconstructed video timeline", which you later said didn't make sense. You then described the real spec: play the video where the red arrow was, put the results lower, color-code the markers by severity, show a title bubble on click, and let the bubble jump to the report.
- Violations carry `type`, `severity` and `timestamps` (see `results-evidence-frames-under-violations-14oct26.md` for the comma-joined string detail). Cards had no DOM ids, so the timeline couldn't scroll to them.
- The preview URL of an uploaded video (`creative.previewUrl`) is a blob URL that stays alive until "New Scan".

---

## 4. Timeline: what we did in order

### Phase 1 – Clarifying the idea

I asked what the timeline should do. You sent the full spec and a screenshot marking where the video should go.

### Phase 2 – Design choices I made

Controls below the video, markers as points, clustering, per-severity colors, the bubble listing all violations of a cluster, a 45vh height cap, no change to play/pause when the bar is clicked.

### Phase 3 – Build

New component, a `violationTimestamps` split helper, and six `scan-workspace.tsx` edits ([Appendices A to C](#appendix-a--video-timelinetsx-as-on-main-now)). You tested it and reported back.

### Phase 4 – Your verdict

"It looks good, I think this is very good." You also decided it stays free, and asked for the volume slider and the refresh note (next two files).

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | "A reconstructed video timeline" made no sense | My first reading of your idea was wrong | You re-specified it in detail |
| 2 | Timeline needs one marker per cited moment, not one per violation | Timestamps arrive comma-joined | `violationTimestamps` splits them (Appendix B) |
| 3 | Cards couldn't be scrolled to | No DOM ids | `violationDomId(scanId, index)` ids on each card |

No runtime errors were reported.

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. My first interpretation of the timeline idea was wrong (see error 1).
2. Earlier I called the Vercel preview a type-check. `next.config.mjs` ignores TypeScript build errors, so only your own testing catches them.

### Decisions

1. Controls **under** the video.
2. Markers are points, clustered when close, colored by the highest severity.
3. The bubble lists every violation in its cluster. Each row jumps to its own card.
4. `SEEK_LEAD_SECONDS = 0` (exact moment). Set to 1 for a one-second lead-in.
5. Player height cap `45vh`.
6. Free for all plans.
7. The component hides itself if the video errors.

### Known limits

- Session-only: the original file only exists in memory, so a refresh removes the player (the refresh note in `results-player-refresh-note-and-privacy-link-14oct26.md` says so). Storing videos for Scan History would mean a heavy upload (limit 1.1 GB) and privacy exposure.
- Marker accuracy is only as good as the model's timestamps.
- Fullscreen and playback speed were deliberately left out.
- The page gets taller, so the verdict may move down.

---

## 7. Open items checklist

- [x] Player, markers, bubbles and jump-to-report built and verified
- [x] Copied to the live web repo (you reported it)
- [ ] Check that the risk verdict is visible without scrolling. If not, add a one-line verdict above the player
- [ ] Check marker accuracy on a few more videos
- [ ] Optional: gate by plan (it is currently free for all)

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Component | `components/video-timeline.tsx` (props: `src`, `violations`, `onSelectViolation`) |
| Card ids | `violation-<scanId>-<violationIndex>` (`violationDomId`) |
| Cluster window | `max(0.75 s, duration × 0.015)` |
| Severity colors | low green, medium amber, high red (unknown severity counts as medium) |
| Seek lead | `SEEK_LEAD_SECONDS = 0` |
| Keys on the bar | ← and → ±5 s, Home, End |
| Highlight | `ring-2 ring-primary` for 2 seconds after a jump |
| Height cap | `max-h-[45vh]` |

---

## Appendix A – video-timeline.tsx (as on main now)

```tsx
// components/video-timeline.tsx
'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import {
  parseTimestampSeconds,
  violationTimestamps,
} from '@/lib/mediacrater/evidenceFrames';
import type { Violation } from '@/lib/mediacrater/scoreCalculator';

// Seconds before a marker's timestamp to land on when it is clicked.
// 0 = exactly the cited moment. Set to 1 for a short lead-in.
const SEEK_LEAD_SECONDS = 0;

// Level restored when unmuting after the slider was dragged to 0.
const DEFAULT_UNMUTE_VOLUME = 0.5;

type Severity = 'low' | 'medium' | 'high';

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

const SEVERITY_BG: Record<Severity, string> = {
  low: 'bg-green-500',
  medium: 'bg-amber-500',
  high: 'bg-red-500',
};

// Same fallback as scoreCalculator.ts: anything unrecognized counts as medium.
function normalizeSeverity(value: unknown): Severity {
  const s = typeof value === 'string' ? value.toLowerCase() : '';
  if (s === 'low') return 'low';
  if (s === 'high') return 'high';
  return 'medium';
}

interface Marker {
  time: number;
  severity: Severity;
  violationIndexes: number[];
}

function buildMarkers(violations: Violation[], duration: number): Marker[] {
  const points: { time: number; index: number }[] = [];

  violations.forEach((violation, index) => {
    for (const label of violationTimestamps(violation)) {
      const time = parseTimestampSeconds(label);
      // Ignore anything the model placed past the end of the video.
      if (time === null || time > duration + 0.5) continue;
      points.push({ time: Math.min(time, duration), index });
    }
  });

  points.sort((a, b) => a.time - b.time);

  // Markers closer than ~1.5% of the bar would overlap, so merge them.
  const clusterWindow = Math.max(0.75, duration * 0.015);
  const markers: Marker[] = [];
  let clusterStart = -Infinity;

  for (const point of points) {
    const severity = normalizeSeverity(violations[point.index].severity);
    const last = markers[markers.length - 1];

    if (last && point.time - clusterStart <= clusterWindow) {
      if (!last.violationIndexes.includes(point.index)) {
        last.violationIndexes.push(point.index);
      }
      if (SEVERITY_RANK[severity] > SEVERITY_RANK[last.severity]) {
        last.severity = severity;
      }
    } else {
      markers.push({
        time: point.time,
        severity,
        violationIndexes: [point.index],
      });
      clusterStart = point.time;
    }
  }

  return markers;
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function bubbleStyle(percent: number): CSSProperties {
  if (percent < 25) {
    return { left: `${percent}%`, transform: 'translateX(-8px)' };
  }
  if (percent > 75) {
    return {
      left: `${percent}%`,
      transform: 'translateX(calc(-100% + 8px))',
    };
  }
  return { left: `${percent}%`, transform: 'translateX(-50%)' };
}

// DOM id of a violation card in the results, so the timeline can scroll to it.
export function violationDomId(scanId: string, violationIndex: number): string {
  return `violation-${scanId}-${violationIndex}`;
}

export function VideoTimeline({
  src,
  violations,
  onSelectViolation,
}: {
  src: string;
  violations: Violation[];
  onSelectViolation: (violationIndex: number) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [volumeSupported, setVolumeSupported] = useState(false);
  const [failed, setFailed] = useState(false);
  const [openMarker, setOpenMarker] = useState<number | null>(null);

  const markers = useMemo(
    () => (duration > 0 ? buildMarkers(violations, duration) : []),
    [violations, duration]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let raf = 0;

    const syncDuration = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
    };
    const tick = () => {
      setCurrentTime(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      setCurrentTime(video.currentTime);
    };
    const onSeeked = () => setCurrentTime(video.currentTime);
    const onVolumeChange = () => {
      setMuted(video.muted);
      setVolume(video.volume);
    };
    const onError = () => setFailed(true);

    // iOS Safari ignores programmatic volume (it always reads back 1), so
    // only show the slider where setting the volume actually sticks.
    const originalVolume = video.volume;
    video.volume = 0.5;
    setVolumeSupported(Math.abs(video.volume - 0.5) < 0.01);
    video.volume = originalVolume;

    syncDuration();
    video.addEventListener('loadedmetadata', syncDuration);
    video.addEventListener('durationchange', syncDuration);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('error', onError);

    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener('loadedmetadata', syncDuration);
      video.removeEventListener('durationchange', syncDuration);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('error', onError);
    };
  }, []);

  // Close the bubble on an outside click or Escape.
  useEffect(() => {
    if (openMarker === null) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpenMarker(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMarker(null);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMarker]);

  if (failed) return null;

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video || duration <= 0) return;
    const clamped = Math.min(Math.max(seconds, 0), duration);
    video.currentTime = clamped;
    setCurrentTime(clamped);
  }

  function seekFromPointer(clientX: number) {
    const track = trackRef.current;
    if (!track || duration <= 0) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    seekTo(ratio * duration);
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;

    if (video.muted || video.volume === 0) {
      // Unmute. If the slider had been dragged to 0, restore an audible level.
      if (video.volume === 0) {
        video.volume = DEFAULT_UNMUTE_VOLUME;
        setVolume(DEFAULT_UNMUTE_VOLUME);
      }
      video.muted = false;
      setMuted(false);
    } else {
      video.muted = true;
      setMuted(true);
    }
  }

  function handleVolumeChange(next: number) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(next)) return;
    const clamped = Math.min(Math.max(next, 0), 1);
    video.volume = clamped;
    video.muted = clamped === 0;
    setVolume(clamped);
    setMuted(clamped === 0);
  }

  function handleMarkerClick(markerIndex: number) {
    seekTo(markers[markerIndex].time - SEEK_LEAD_SECONDS);
    setOpenMarker((current) => (current === markerIndex ? null : markerIndex));
  }

  const progressPercent =
    duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const open = openMarker !== null ? markers[openMarker] : undefined;
  const openPercent = open && duration > 0 ? (open.time / duration) * 100 : 0;
  const soundOff = muted || volume === 0;
  const sliderValue = muted ? 0 : volume;

  return (
    <div ref={wrapperRef} className="space-y-2">
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="metadata"
        onClick={togglePlay}
        className="mx-auto block max-h-[45vh] w-auto max-w-full cursor-pointer rounded-lg bg-black"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="shrink-0 rounded-full p-1.5 hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </button>

        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatClock(currentTime)} / {formatClock(duration)}
        </span>

        <div className="relative h-8 min-w-0 flex-1">
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Video timeline"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={`${formatClock(currentTime)} of ${formatClock(duration)}`}
            onPointerDown={(event) => {
              draggingRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              setOpenMarker(null);
              seekFromPointer(event.clientX);
            }}
            onPointerMove={(event) => {
              if (draggingRef.current) seekFromPointer(event.clientX);
            }}
            onPointerUp={(event) => {
              draggingRef.current = false;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={() => {
              draggingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                seekTo(currentTime - 5);
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                seekTo(currentTime + 5);
              } else if (event.key === 'Home') {
                event.preventDefault();
                seekTo(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                seekTo(duration);
              }
            }}
            className="absolute inset-0 cursor-pointer touch-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
            <div
              className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary"
              style={{ width: `${progressPercent}%` }}
            />
            <div
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow"
              style={{ left: `${progressPercent}%` }}
            />
          </div>

          {markers.map((marker, markerIndex) => {
            const percent = (marker.time / duration) * 100;
            const titles = marker.violationIndexes
              .map((index) => violations[index].type || 'Violation')
              .join(', ');

            return (
              <button
                key={`${marker.time}-${markerIndex}`}
                type="button"
                onClick={() => handleMarkerClick(markerIndex)}
                aria-label={`Violation at ${formatClock(marker.time)}: ${titles}`}
                aria-expanded={openMarker === markerIndex}
                className="group absolute top-1/2 z-10 flex h-8 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center focus:outline-none"
                style={{ left: `${percent}%` }}
              >
                <span
                  className={`h-4 w-1.5 rounded-full ring-2 ring-background transition-transform group-hover:scale-125 group-focus-visible:scale-125 ${
                    SEVERITY_BG[marker.severity]
                  } ${openMarker === markerIndex ? 'scale-125' : ''}`}
                />
              </button>
            );
          })}

          {open && (
            <div
              className="absolute bottom-full z-20 mb-2 w-60 max-w-[80vw] overflow-hidden rounded-lg border border-border bg-card shadow-lg"
              style={bubbleStyle(openPercent)}
            >
              {open.violationIndexes.map((violationIndex) => {
                const violation = violations[violationIndex];
                const severity = normalizeSeverity(violation.severity);

                return (
                  <button
                    key={violationIndex}
                    type="button"
                    onClick={() => {
                      setOpenMarker(null);
                      onSelectViolation(violationIndex);
                    }}
                    className="flex w-full text-left hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span
                      className={`w-1.5 shrink-0 ${SEVERITY_BG[severity]}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 p-2">
                      <span className="block text-xs font-semibold leading-snug">
                        {violation.type || 'Violation'}
                      </span>
                      <span className="block text-[10px] capitalize text-muted-foreground">
                        {severity} severity · {formatClock(open.time)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={soundOff ? 'Unmute' : 'Mute'}
            className="rounded-full p-1.5 hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {soundOff ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>

          {volumeSupported && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sliderValue}
              onChange={(event) => handleVolumeChange(Number(event.target.value))}
              aria-label="Volume"
              aria-valuetext={`${Math.round(sliderValue * 100)}%`}
              className="hidden h-1.5 w-20 cursor-pointer accent-primary sm:block"
            />
          )}
        </div>
      </div>

      <p className="text-xs italic text-muted-foreground">
        Refreshing the page after receiving your results will result in loss of video playback features and cannot be recovered. Scan results below will persist until you close this tab or click &quot;New Scan&quot; in the top right.{' '}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline underline-offset-2 hover:text-foreground"
        >
          Why do we do this? ↗
        </a>
      </p>
    </div>
  );
}
```

---

## Appendix B – violationTimestamps in evidenceFrames.ts

This replaced the earlier single `evidenceTimestamps` function. `evidenceTimestamps` (first 4) now builds on it, so the thumbnails and the timeline share one parser.

```ts
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
```

---

## Appendix C – scan-workspace.tsx edits

**Import:**

```ts
import { VideoTimeline, violationDomId } from '@/components/video-timeline';
```

**Highlight state** (after the `evidenceRef` declaration):

```ts
    // Which violation card to flash after a timeline bubble is clicked
  // ("scanId:violationIndex").
  const [highlightedViolation, setHighlightedViolation] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const previewUrlsRef =
```

**`focusViolation`** (directly above `handleAnalyze`):

```ts
  function focusViolation(scanId: string, violationIndex: number) {
    document
      .getElementById(violationDomId(scanId, violationIndex))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    setHighlightedViolation(`${scanId}:${violationIndex}`);

    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }

    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedViolation(null);
      highlightTimerRef.current = null;
    }, 2000);
  }
```

**`activeVideoCreative`** (as first shipped, before URL scans were added in `url-scan-video-playback-in-results-14oct26.md`), placed directly above `const activeResultOption =`:

```ts
const activeVideoCreative =
  creatives.find(
    (creative) =>
      creative.id === activeResultCreativeId &&
      creative.kind === 'video'
  ) ?? null;
```

**Render** (as first shipped), directly above `{visibleResults.map((r) => {`:

```tsx
{activeVideoCreative && visibleResults[0] && (
  <VideoTimeline
    key={visibleResults[0].scanId}
    src={activeVideoCreative.previewUrl}
    violations={visibleResults[0].processedViolations}
    onSelectViolation={(violationIndex) =>
      focusViolation(visibleResults[0].scanId, violationIndex)
    }
  />
)}
```

**Card id and highlight ring** (replaces the opening `<div key={idx} className=...>` of each violation card):

```tsx
                                  <div
                                    key={idx}
                                     id={violationDomId(r.scanId, r.processedViolations.indexOf(v))}
                                      className={`bg-muted/30 border border-border ${severityBorderClass(v.severity)} rounded-lg p-3 text-sm transition-shadow ${
                                         highlightedViolation === `${r.scanId}:${r.processedViolations.indexOf(v)}`
                                         ? 'ring-2 ring-primary'
                                         : ''
                                     }`}
                                  >                               
```

---

## Appendix D – Verification

| Check | Expected result |
|---|---|
| Scan an uploaded video | The player appears between the header and the first card |
| Play, pause, click the bar, drag the bar | Video follows. Time readout updates |
| Click a marker | Video jumps to that time and a bubble opens with a severity-colored stripe and the title |
| Click the bubble row | Page scrolls to that card, which flashes for 2 s |
| Esc, outside click, clicking the bar | Bubble closes |
| Refresh the page | Player disappears. Results and thumbnails stay (see `results-evidence-frames-session-persistence-14oct26.md`) |
| Scan an image | No player |
| Batch with several videos, switch result tabs | Player always matches the selected video |
| Portrait video, phone width, dark mode | Layout holds |

---

## Appendix E – Rollback

1. In `scan-workspace.tsx`, remove the import, the highlight state and its `useEffect`, `focusViolation`, the `activeVideoCreative` block, the `<VideoTimeline ... />` block, and restore the card's opening `<div key={idx} ...>`.
2. Delete `components/video-timeline.tsx`.
3. `violationTimestamps` in `evidenceFrames.ts` can stay (the thumbnails use it).

---

*End of index.*
