# AI Prompt: Timestamps Are Single Moments, Never Ranges (helpers.js), Deployed to Live

| | |
|---|---|
| **Date** | 14 October 2026 (`14oct26`) |
| **Destination** | changelogs/server |
| **Conversation** | Not available to me. Paste this chat's URL here when you file this. |
| **Related prior work** | `results-video-player-with-violation-timeline-14oct26.md`<br>`results-evidence-frames-under-violations-14oct26.md`<br>`live-api-rollout-and-production-process-audit-14oct26.md` |
| **Stack** | Node API on the VPS (`helpers.js` prompt text, PM2) |
| **Starting trigger** | The timeline markers and frame thumbnails need single moments, so the scan prompt had to stop returning ranges. You had already made this prompt change on the test API. I found it in the test-to-live `diff` and it went to live with the URL-scan files |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included. `VPS_IPV4`, `VPS_IPV6`, `<customer uuid>`, `<your test account uuid>` and similar placeholders stand in for them. Real accounts are described by what happened, not by ID.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied (an expected output is given). ⏳ = open.

---
## Contents

1. [1. Summary](#1-summary)
2. [2. Status at a glance](#2-status-at-a-glance)
3. [3. Starting point](#3-starting-point)
4. [4. Timeline: what we did, in order](#4-timeline-what-we-did-in-order)
5. [5. Errors and surprises](#5-errors-and-surprises)
6. [6. Corrections / important decisions](#6-corrections--important-decisions)
7. [7. Open items checklist](#7-open-items-checklist)
8. [8. Reference: key settings](#8-reference-key-settings)
9. [Appendix A – Diff (live to test, as you pasted it)](#appendix-a--diff-live-to-test-as-you-pasted-it)
10. [Appendix B – Commands and expected output](#appendix-b--commands-and-expected-output)
11. [Appendix C – Rollback](#appendix-c--rollback)

---

## 1. Summary

The TIMESTAMP RULES in the scan prompt (`helpers.js`) now ask for **the moment an issue starts**, never a range. The model still lists separate moments separated by commas.

**Main outcomes**

- Old rules: "the narrowest timestamp or range where the issue is actually visible", with ranges allowed when the issue is continuously present.
- New rules: "the timestamp where the issue starts to become visible, on screen, or audible" and "Never provide a timestamp range". The output instruction now says "Provide timestamps" instead of "timestamp or range".
- **I did not write this change.** I first guessed the `helpers.js` difference was URL deep-scan support, and the diff proved me wrong.
- It is the prompt behind the timeline markers (`results-video-player-with-violation-timeline-14oct26.md`) and the thumbnails (`results-evidence-frames-under-violations-14oct26.md`): both parse single `MM:SS.cc` moments and skip anything else.
- **Trade-off:** the report loses duration for long violations such as a 20-second spoken claim. You chose this deliberately.
- Web app only. The extension no longer sends scans to the VPS.
- Live received the file on the same copy as `url-scan-thumbnail-download-via-safefetch-14oct26.md` and `url-scan-expired-link-error-message-14oct26.md`.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| Prompt change on the test API | ✅ Done | Test `helpers.js` modified 17:48:30 |
| Copied to live | ✅ Done | Live `helpers.js` modified 20:57:27 |
| Live API running it | ✅ Verified | Live process restarted 20:58:32 (see `live-api-rollout-and-production-process-audit-14oct26.md`) |
| Live scans return single moments | ⚠️ Not reported | Expected: results show `⏱` times like `00:02.08, 00:10.11` and never `00:10-00:15` |
| Scan History entries made before the change | ⚠️ Not checked | They may still contain ranges. The player only exists on live results, so nothing breaks |

---

## 3. Starting point

- The scan JSON had a `timestamp` string per violation (comma-joined when several moments).
- `scoreCalculator.deduplicateViolations` wraps it as `timestamps: [<string>]`.
- `parseTimestampSeconds` in `evidenceFrames.ts` accepts only `MM:SS` or `MM:SS.cc`. A range like `00:10-00:15` would be skipped (no marker, no thumbnail).

---

## 4. Timeline: what we did, in order

### Phase 1 – The test-to-live diff

To prepare the live copy I asked for the three diffs. `helpers.js` showed only the prompt change.

### Phase 2 – My wrong guess

I had guessed URL deep-scan support. I told you I was wrong and described the real change.

### Phase 3 – Copy and restart

You copied `helpers.js` with the other two files and restarted live. I did not see a live scan result that shows single moments.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | I mislabelled the `helpers.js` difference | I guessed before seeing the diff | Corrected after the diff |
| 2 | A range from the model would produce no marker | The parser takes single moments only | The prompt now forbids ranges |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. I said the `helpers.js` difference was probably URL deep-scan support. It was this prompt change.

### Decisions

1. Moments only, no ranges.
2. Separate moments are still comma-separated.
3. Keep the `MM:SS` or `MM:SS.ss` format with a dot before the fraction.

### Known limits

- Long issues have no duration in the report.
- Older stored scans may contain ranges.
- Timestamp accuracy is still the model's.

---

## 7. Open items checklist

- [x] Prompt changed on test
- [x] Copied to live and live restarted
- [ ] Confirm on live: run a video scan and check the `⏱` times are single moments
- [ ] Optional: check a handful of results for markers that land on the actual moment

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| File | `helpers.js` (prompt text, TIMESTAMP RULES block and the output instructions) |
| Format | `MM:SS` or `MM:SS.ss`, dot before the fraction, commas between separate moments |
| Consumers | `scoreCalculator.ts`, `evidenceFrames.ts`, `video-timeline.tsx` |

---

## Appendix A – Diff (live to test, as you pasted it)

```diff
--- mediacrater-api/helpers.js  2026-10-13 14:24:33.428449395 +0000
+++ mediacrater-api-test/helpers.js     2026-10-14 17:48:30.966736775 +0000
@@ -266,10 +266,8 @@
 
 TIMESTAMP RULES:
 
-- Give the narrowest timestamp or range where the issue is actually visible, on screen, or audible.
-
-- Use a range only when the issue is continuously present across it. Never use a range that covers most of the video unless the issue really lasts that long.
-
+- Give the timestamp where the issue starts to become visible, on screen, or audible.
+- Never provide a timestamp range
 - If the same issue appears at separate moments, list each moment separated by commas (e.g., "00:15, 00:47, 01:23") instead of one wide range.
 
 - Write every timestamp as MM:SS or MM:SS.ss, with a dot before any fraction of a second (e.g., "00:09.42"). Never use a second colon for the fraction.
@@ -302,7 +300,7 @@
 
    - Specify the policy being violated
 
-   - Provide timestamp or range (following the TIMESTAMP RULES above)
+   - Provide timestamps (following the TIMESTAMP RULES above)
 
    - Brief explanation (3 sentences max)
```

---

## Appendix B – Commands and expected output

```bash
cd /var/www
diff -u mediacrater-api/helpers.js mediacrater-api-test/helpers.js | head -300   # the diff above
cd /var/www/mediacrater-api && node --check helpers.js && echo SYNTAX_OK
ls -l --time-style=full-iso /var/www/mediacrater-api/helpers.js
```

**Expected (not confirmed):** `SYNTAX_OK`, a modification time of 20:57:27, and live results whose `⏱` lines contain only single times.

---

## Appendix C – Rollback

Put the old lines back (you didn't take a backup):

```
- Give the narrowest timestamp or range where the issue is actually visible, on screen, or audible.

- Use a range only when the issue is continuously present across it. Never use a range that covers most of the video unless the issue really lasts that long.
```

in place of the two new "Give the timestamp where the issue starts..." and "Never provide a timestamp range" lines, and change `- Provide timestamps (following the TIMESTAMP RULES above)` back to `- Provide timestamp or range (following the TIMESTAMP RULES above)`. Then `node --check helpers.js` and `pm2 restart mediacrater-api --update-env`.

---

*End of index.*
