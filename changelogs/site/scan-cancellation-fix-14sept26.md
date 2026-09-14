# Deployment Record: Scan Cancellation UX Fix

**Date:** 2026-09-14
**Environment:** Mediacrater (frontend — `scan-workspace.tsx`)
**Files changed:** `components/scan-workspace.tsx`
**Type:** UX/state fix — no backend or billing logic changed

---

## Context

Originally raised as item #5 in a pre-launch priority list ("remove the
cancel button for a scan once authenticated at the VPS level, so the
browser can't tell the VPS to stop and not charge, while still
returning a response").

**Investigation finding:** the backend already satisfies this
requirement fully, with no changes needed.

- `commitScanDeduction` (in both `routes/scanVideo.js` and
  `routes/scanImage.js`) only runs *after* `helpers.analyzeWithAI` /
  `helpers.analyzeImageWithAI` resolves successfully — never before,
  never conditionally on the client still being connected.
- `queueManager.cancelJob` (via `POST /queue-cancel/:jobId`) only
  affects jobs still in the **queue** — it has no effect once a job has
  passed the queue gate and is actively running against
  OpenRouter/QwenCloud.
- Client-side `AbortController.abort()` only stops the *browser* from
  waiting on the response. It never reaches the server, never touches
  the in-flight AI call, and never touches billing.

**Conclusion:** a user cannot stop an authenticated scan and cannot
avoid being charged for one that completes, regardless of what they do
in the browser. No backend change was required.

## The actual problem (reframed from the original ask)

Once investigated, the real issue was UX, not security/billing: the
Cancel button remained visible and clickable through the *entire*
`isAnalyzing` state — including during local frame/audio extraction,
during queueing, **and** during the actual AI analysis phase, where
clicking it does nothing meaningful (client gives up waiting; server
keeps running and still bills/logs the scan on completion, per the
existing correct-by-design deduct-after-success logic above). This
was confusing because the UI implied an action was being taken when,
during the analysis phase, none was.

**Requirement, once clarified:** Cancel should remain visible and
functional during local extraction (frames/audio — entirely
client-side, free to abandon) and during queueing (authenticated but
not yet billed/running). It should disappear specifically once the
scan enters the "Analyzing your content against `[PLATFORM]` policies"
phase — the phase where the AI provider call is actually in flight and
cancellation can no longer stop anything or avoid cost.

## Changes made

### 1. New `canCancel` state
Replaces reliance on a ref (`currentJobIdRef`, which doesn't trigger
re-renders) with real React state that the UI can react to.

```js
const [canCancel, setCanCancel] = useState(true);
```

### 2. State transitions added at each phase boundary

Four `setCanCancel` call sites, one at each phase transition:

- **`handleAnalyze()`, at the start of every run:**
  ```js
  setIsAnalyzing(true);
  setResults(null);
  setCanCancel(true);   // reset — extraction phase is always cancellable
  ```

- **`performAnalysis()`, right before the first (pre-queue) analysis
  call for each platform** — covers the case where a platform skips
  the queue entirely and goes straight to analysis:
  ```js
  const platformList = platforms.join(', ').toUpperCase();
  setProgressText(`Analyzing your content against ${platformList} policies...`);
  setCanCancel(false);   // AI call is about to start
  ```

- **Inside the per-platform `while ('queued' in response && response.queued)`
  loop, when a platform enters the queue:**
  ```js
  jobId = response.jobId;
  currentJobIdRef.current = jobId;
  setCanCancel(true);   // authenticated but not yet running — still cancellable
  setProgressText(`You're queued at position ${response.position}. Waiting for your turn...`);
  ```

- **Immediately after `waitForQueueTurn` resolves, once that platform's
  own analysis is about to start:**
  ```js
  currentJobIdRef.current = null;
  queueWaitMs = Date.now() - (queueEnteredAt as number);
  setProgressText(`Analyzing your content against ${platform.toUpperCase()} policies...`);
  setCanCancel(false);   // this platform's AI call is now running
  ```

This last pair (queued → analyzing) repeats per platform when multiple
platforms are selected, since each can independently re-enter the
queue before its own analysis begins — `canCancel` correctly flips
back to `true` for platform 2's queue wait even after being `false`
during platform 1's analysis.

### 3. UI now follows `canCancel`
- Cancel button only renders when `canCancel` is true.
- Added explanatory copy when `canCancel` is false: *"Your scan is now
  running and can no longer be cancelled."* — addresses the original
  complaint that there was no indication of what state the scan was in.
- `handleCancelAnalysis()` now guards on `canCancel` as a defensive
  no-op, in case it's ever invoked outside the button (e.g. a future
  keyboard shortcut or programmatic call).

### 4. Fixed incorrect error banner on cancellation
**Bug found:** clicking Cancel during the queued phase surfaced the
generic `"Analysis failed — Something went wrong..."` banner instead
of reflecting that the user cancelled on purpose. The existing
`error?.name === 'AbortError'` check in the catch block wasn't
reliably matching (likely because an intermediate layer — extraction
or the `scanVideo`/`scanImage` request wrapper — doesn't always
propagate a native `AbortError` under abort).

**Fix:** check `controller.signal.aborted` directly alongside
`error?.name === 'AbortError'`, since the signal's own state is ground
truth regardless of how the thrown error was shaped:

```js
if (error?.name === 'AbortError' || controller.signal.aborted) {
  setBanner({ tone: 'error', title: 'Analysis cancelled' });
  return;
}
```

Also made `Banner.message` conditionally rendered
(`{banner.message && <p>...</p>}`) rather than always rendering a
(possibly empty) message line, so a title-only banner like this one
doesn't leave a blank gap in the layout.

**Note:** this still reuses the existing `tone: 'error'` (red) styling
for a cancellation, which is user-initiated and arguably not an error.
Flagged as a possible future improvement (a neutral/grey `tone` variant)
but not changed in this pass.

## Explicitly not changed

- No backend/billing logic — already correct, confirmed via review of
  `routes/scanVideo.js` and `routes/scanImage.js`.
- No change to what happens server-side if a client disconnects mid-AI-call
  (the in-flight OpenRouter/QwenCloud request runs to completion and is
  billed to Mediacrater regardless — this is an unavoidable cost once
  that call has started, not something client or server code can undo,
  since the AI provider has no mid-flight cancellation mechanism).
  Raised as a known, accepted cost — not addressed in this pass.

## Result

- Cancel is available exactly when it's real (extraction + queueing),
  and disappears with an explanation the moment it stops being
  possible (active analysis).
- Cancelling now shows "Analysis cancelled" instead of a false
  "Analysis failed" error.
- No change to backend security/billing posture — it was already sound.
