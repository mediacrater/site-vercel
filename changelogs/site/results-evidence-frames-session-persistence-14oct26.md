# Results Page: Evidence Frames Survive a Page Refresh (Session Storage, Cleared on New Scan)

| | |
|---|---|
| **Date** | 14 October 2026 (`14oct26`) |
| **Destination** | changelogs/site |
| **Conversation** | Not available to me. Paste this chat's URL here when you file this. |
| **Related prior work** | `results-evidence-frames-under-violations-14oct26.md`<br>`results-frame-lightbox-click-to-enlarge-14oct26.md`<br>`results-video-player-with-violation-timeline-14oct26.md` |
| **Stack** | Next.js web app on Vercel (new `lib/mediacrater/evidenceStore.ts`, edits to `lib/mediacrater/backgroundScanStore.ts` and `components/scan-workspace.tsx`) |
| **Starting trigger** | Results survived a refresh but the frames didn't, which you found annoying. You asked whether to store frames temporarily and delete them on "New Scan", and weren't sure how that fits Scan History |

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
9. [Appendix A – evidenceStore.ts](#appendix-a--evidencestorets)
10. [Appendix B – backgroundScanStore.ts edits](#appendix-b--backgroundscanstorets-edits)
11. [Appendix C – scan-workspace.tsx edits](#appendix-c--scan-workspacetsx-edits)
12. [Appendix D – Test checklist and expected results](#appendix-d--test-checklist-and-expected-results)
13. [Appendix E – Rollback](#appendix-e--rollback)

---

## 1. Summary

The evidence frames now live in their own `sessionStorage` key, with the same lifecycle as the results themselves: they survive a refresh in the same tab, and "New Scan" (or closing the tab) removes them. Nothing goes to a server.

**Main outcomes**

- New file `lib/mediacrater/evidenceStore.ts` with `saveEvidence`, `loadEvidence`, `clearEvidence`. Key: `mediacrater_evidence_v1`.
- The frames are written **once**, when the scan completes, and **not inside the background scan store**, because that store rewrites its whole state on every progress update.
- `clearBackgroundScanState()` now also calls `clearEvidence()`, so every path that clears results (New Scan, adding files, removing a creative, cancelling) clears the frames too.
- Caps: **12 frames** in total and about **3 MB** of text, to stay under the roughly 5 MB sessionStorage quota. A quota failure just means no thumbnails after a refresh.
- `loadEvidence` only accepts strings that start with `data:image/jpeg;base64,` (the shape we write), so nothing else ends up in an `<img src>`.
- **Not built:** the paid Scan History tier (frames kept with each scan). See Decisions.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| `evidenceStore.ts` created | ✅ Done | On `main` (108 lines, key and caps as described) |
| `backgroundScanStore.ts` import and `clearEvidence()` call | ✅ Done | Both found on `main` |
| `scan-workspace.tsx`: import, `loadEvidence()` on restore, `saveEvidence()` before completion | ✅ Done | All three found on `main` |
| Browser test of refresh and New Scan | ⚠️ Not reported | Appendix D. Expected output is listed |
| Quota behaviour with a large batch | ⚠️ Not reported | Expected: no crash. A `[EVIDENCE] Could not persist frames` console warning if the quota is hit |
| Copied to the live web repo | ✅ Done | You reported the web app files were copied. I haven't seen the live repo |
| Paid Scan History storage of frames | ⏳ Not built | Deferred, see Decisions |

---

## 3. Starting point

- `backgroundScanStore.ts` persists the scan state (including `results`) to `sessionStorage` under `mediacrater_background_scan_v1`, so a refresh restores the results text but not the frames (they lived only in a `useRef`).
- Scan History (paid plans) shows one 200 px thumbnail from the private `scan-thumbnails` bucket (`{user_id}/{scan_id}.jpg`, signed URLs) and promises results are "kept for as long as you're subscribed".
- A session-only copy has none of the privacy or retention questions that storing customers' ad frames on a server would raise.

---

## 4. Timeline: what we did, in order

### Phase 1 – The question

You asked how to keep the frames after a refresh without breaking Scan History. I read `lib/mediacrater/thumbnails.ts`, `app/scan-history/page.tsx` and `backgroundScanStore.ts` and proposed two tiers: session storage for everyone, and uploaded frames for paid history later.

### Phase 2 – Tier 1 only

You said "sure" to the session tier. I wrote `evidenceStore.ts`, the two small `backgroundScanStore.ts` edits and the three `scan-workspace.tsx` edits ([Appendices A to C](#appendix-a--evidencestorets)).

### Phase 3 – Testing

Results of the test checklist weren't reported, so those lines are ⚠️.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Frames vanish on refresh while results stay | Frames lived in a `useRef`, results in sessionStorage | This change |
| 2 | Writing frames into the background store would be wasteful | That store is re-serialised on every progress update | Separate key, written once |
| 3 | Possible quota failure on big batches | sessionStorage is about 5 MB per origin | 12-frame and 3 MB caps, try/catch around the write |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. None for this change.

### Decisions

1. **Tier 1 (session storage) is built. Tier 2 is not.** Tier 2 would upload the matched frames to a new private bucket (for example `scan-evidence`, path `{user_id}/{scan_id}/<timestamp>.jpg`) for plans with Scan History, and the history page would rebuild the paths from `generated_data` and request signed URLs.
2. Before building tier 2: copy the `scan-thumbnails` bucket policies and test that a second account can't read the first one's paths; update the privacy policy (these are customers' unreleased ads and may show faces; Quebec's Law 25 is worth a look, and I'm not a lawyer); decide what happens at subscription cancellation; delete frames when a scan or account is deleted.
3. With no paying customers at the time, tier 2 benefits nobody yet, so it was deferred.
4. "New Scan" must not delete frames for paid history users once tier 2 exists. It would only clear the session copy.

### Known limits

- Tab-scoped. A result opened in another tab has no frames.
- At most 12 frames per session, so a violation-heavy scan or a batch may show fewer thumbnails after a refresh than before.
- The frames stay in the browser's session storage until New Scan or tab close, so on a shared computer someone could see them while the tab stays open.

---

## 7. Open items checklist

- [x] `evidenceStore.ts` created
- [x] `backgroundScanStore.ts` edits applied
- [x] `scan-workspace.tsx` edits applied
- [x] Copied to the live web repo (you reported it)
- [ ] Run the Appendix D checklist
- [ ] Decide on tier 2 (paid Scan History frames) once paying users ask for history

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Storage key | `mediacrater_evidence_v1` (sessionStorage) |
| Background scan key (existing) | `mediacrater_background_scan_v1` |
| Frame cap | 12 (`MAX_TOTAL_FRAMES`) |
| Size cap | 3,000,000 characters (`MAX_TOTAL_CHARS`) |
| Accepted value shape | `data:image/jpeg;base64,...` |
| Cleared by | `clearBackgroundScanState()` (calls `clearEvidence()`), tab close |

---

## Appendix A – evidenceStore.ts

```ts
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
```

---

## Appendix B – backgroundScanStore.ts edits

**Import** (after the `react` import):

```ts
import { clearEvidence } from './evidenceStore';
```

**Inside `clearBackgroundScanState()`**, as its first statement:

```ts
  });
}
```

---

## Appendix C – scan-workspace.tsx edits

**Import:**

```ts
import { loadEvidence, saveEvidence } from '@/lib/mediacrater/evidenceStore';
```

**On restore** (in the effect that handles `backgroundScan.status === 'completed'`, right after `restoredResults` is defined):

```ts
      const restoredResults =
```

**On completion** (in `performAnalysis`, directly above the `if (operationId) {` that calls `completeBackgroundScan`):

```ts
      backgroundOperationIdRef.current;
    saveEvidence(evidenceRef.current);
```

---

## Appendix D – Test checklist and expected results

| Check | Expected result |
|---|---|
| Scan a video, press F5 | Results and thumbnails come back |
| DevTools, Application, Session Storage | A key `mediacrater_evidence_v1` exists after the scan |
| Click "New Scan" | `mediacrater_evidence_v1` and `mediacrater_background_scan_v1` both disappear |
| Navigate to Scan History and back | Results return with thumbnails |
| Run a batch of videos | No crash. If the quota is hit, the console shows `[EVIDENCE] Could not persist frames` |
| Scan an image | No evidence key appears |
| Close the tab and reopen the dashboard | Nothing is restored (intended) |
| Click a restored thumbnail | The lightbox still works |

---

## Appendix E – Rollback

1. Remove the `saveEvidence(...)` line and the `evidenceRef.current = loadEvidence();` line from `scan-workspace.tsx`, and the `import { loadEvidence, saveEvidence }` line.
2. Remove the `import { clearEvidence }` line and the `clearEvidence();` call from `backgroundScanStore.ts`.
3. Delete `lib/mediacrater/evidenceStore.ts`.
4. Frames then disappear on refresh again, as before.

---

*End of index.*
