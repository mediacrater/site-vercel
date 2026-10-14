// components/violation-frames.tsx
'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const shots = evidence
    ? evidenceTimestamps(violation).filter((ts) => evidence[ts])
    : [];

  if (!evidence || shots.length === 0) return null;

  const frameData: EvidenceFrames = evidence;
  const total = shots.length;
  const activeIndex = ((index % total) + total) % total;
  const activeTimestamp = shots[activeIndex];

  function step(direction: 1 | -1) {
    setIndex((current) => (((current + direction) % total) + total) % total);
  }

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
        {shots.map((ts, shotIndex) => (
          <figure key={ts} className="shrink-0 m-0">
            <button
              type="button"
              onClick={() => {
                setIndex(shotIndex);
                setOpen(true);
              }}
              aria-label={`Enlarge video frame at ${ts}`}
              className="block cursor-zoom-in rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <img
                src={frameData[ts]}
                alt={`Video frame at ${ts}`}
                className="h-24 w-auto rounded-md border border-border object-cover"
              />
            </button>
            <figcaption className="mt-1 text-center text-[10px] text-muted-foreground">
              {ts}
            </figcaption>
          </figure>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-4xl p-4"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              step(-1);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              step(1);
            }
            // Keep the app's global w/a/s/d shortcuts from firing behind
            // the lightbox (see components/keyboard-shortcuts.tsx).
            event.stopPropagation();
          }}
        >
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base">
              Frame at {activeTimestamp}
            </DialogTitle>
            <DialogDescription>
              {activeIndex + 1} of {total}
              {total > 1 ? '. Use the left and right arrow keys to switch frames.' : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="relative flex items-center justify-center">
            <img
              src={frameData[activeTimestamp]}
              alt={`Video frame at ${activeTimestamp}`}
              className="max-h-[70vh] w-auto max-w-full rounded-md object-contain"
            />

            {total > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label="Previous frame"
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 shadow hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ChevronLeft className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Next frame"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 shadow hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ChevronRight className="size-5" />
                </button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
