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
