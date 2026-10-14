# Results Page Player: Volume Slider (Mute Button Kept, Hidden Where the Browser Ignores Volume)

| | |
|---|---|
| **Date** | 14 October 2026 (`14oct26`) |
| **Destination** | changelogs/site |
| **Conversation** | Not available to me. Paste this chat's URL here when you file this. |
| **Related prior work** | `results-video-player-with-violation-timeline-14oct26.md`<br>`results-player-refresh-note-and-privacy-link-14oct26.md` |
| **Stack** | Next.js web app on Vercel (`components/video-timeline.tsx` only) |
| **Starting trigger** | After the player worked you asked for a volume slider only: no fullscreen and no playback speed |

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
9. [Appendix A – The changes in video-timeline.tsx](#appendix-a--the-changes-in-video-timelinetsx)
10. [Appendix B – Test checklist and expected results](#appendix-b--test-checklist-and-expected-results)
11. [Appendix C – Rollback](#appendix-c--rollback)

---

## 1. Summary

The mute button now has a native range slider next to it.

**Main outcomes**

- Native `<input type="range">` (0 to 1, step 0.05), so keyboard and touch work and it is announced as "Volume" with a percentage.
- Dragging to 0 mutes and shows the muted icon. Dragging up unmutes. Unmuting from 0 restores **50%** (`DEFAULT_UNMUTE_VOLUME`).
- **iOS Safari ignores programmatic volume** (it always reads back 1), so the component tests at mount whether setting the volume sticks and **hides the slider** where it doesn't. The mute button works everywhere.
- Hidden below the `sm` breakpoint to keep the control row from squeezing the timeline bar on phones.
- A `volumechange` listener keeps React state in sync with the video element.
- No fullscreen and no playback speed, as you asked.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| Slider, handlers and feature test in `video-timeline.tsx` | ✅ Done | Found on `main` (`volumeSupported`, `DEFAULT_UNMUTE_VOLUME`, `handleVolumeChange`) |
| Browser test | ⚠️ Not reported | Appendix B. Expected results are listed |
| iPhone behaviour (no slider shown) | ⚠️ Not tested | Expected: the speaker button only |
| Copied to the live web repo | ✅ Done | You reported the web app files were copied. I haven't seen the live repo |

---

## 3. Starting point

- `results-video-player-with-violation-timeline-14oct26.md` shipped a mute toggle only.
- You asked for the volume slider alone ("no fullscreen and no playback speed").

---

## 4. Timeline: what we did in order

### Phase 1 – The request

You approved the player, said it stays free for free users, and asked for a volume slider only.

### Phase 2 – The change

I re-sent the whole `video-timeline.tsx` so there were no anchor mistakes. The actual delta is in [Appendix A](#appendix-a--the-changes-in-video-timelinetsx).

### Phase 3 – Testing

Results weren't reported.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | A slider on iPhones would do nothing | iOS Safari doesn't allow setting `video.volume` | Runtime feature test hides the slider |
| 2 | Unmuting after dragging to 0 would stay silent | Volume was 0 | Restore 50% on unmute |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. None for this change.

### Decisions

1. Native range input rather than a custom drawn slider.
2. 50% on unmute from zero.
3. Slider hidden on narrow screens.
4. Fullscreen and playback speed deliberately not added.

### Known limits

- No volume memory between scans.
- The iOS test happens once at mount.

---

## 7. Open items checklist

- [x] Slider added
- [x] Copied to the live web repo (you reported it)
- [ ] Run the Appendix B checklist

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Range | 0 to 1, step 0.05 |
| Unmute-from-zero level | 0.5 |
| Visible from | `sm` breakpoint and up, only where volume is settable |
| Test for support | Set `video.volume = 0.5`, read it back, restore |

---

## Appendix A – The changes in video-timeline.tsx

**Constant** (top of the file):

```ts
// Level restored when unmuting after the slider was dragged to 0.
const DEFAULT_UNMUTE_VOLUME = 0.5;
```

**State:**

```ts
  const [volume, setVolume] = useState(1);
  const [volumeSupported, setVolumeSupported] = useState(false);
```

**Inside the main `useEffect`:** the `volumechange` handler and the feature test (the matching `addEventListener` and `removeEventListener('volumechange', onVolumeChange)` lines are added next to the existing ones):

```ts
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
```

**Handlers** (replacing the old `toggleMute`):

```ts
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
```

**Derived values** (before the `return`):

```ts
  const soundOff = muted || volume === 0;
  const sliderValue = muted ? 0 : volume;
```

**JSX** (replaces the single mute button at the end of the controls row):

```tsx
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
```

---

## Appendix B – Test checklist and expected results

| Check | Expected result |
|---|---|
| Drag the slider | Loudness changes. At 0 the icon becomes muted |
| Click the speaker icon | Mutes and unmutes. Unmuting from 0 sets the slider to 50% |
| Phone width | Slider hidden, mute button works |
| iPhone | No slider, mute works |
| Tab to the slider and press ← or → | Volume changes in 5% steps |
| Drag the slider while a bubble is open | No seeking, bubble state unchanged |

---

## Appendix C – Rollback

Restore the earlier mute-only version: remove the constant, the two state lines, the `onVolumeChange` handler and feature test, the `handleVolumeChange` function, `soundOff` and `sliderValue`, and replace the new JSX block with a single button that calls `toggleMute` and shows `VolumeX` or `Volume2` based on `muted`.

---

*End of index.*
