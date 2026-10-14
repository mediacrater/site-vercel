# URL Scans: Clearer Message When a Video Link Can't Be Read (Expired Link Hint)

| | |
|---|---|
| **Date** | 14 October 2026 (`14oct26`) |
| **Destination** | changelogs/server |
| **Conversation** | Not available to me. Paste this chat's URL here when you file this. |
| **Related prior work** | `url-scan-thumbnail-download-via-safefetch-14oct26.md`<br>`live-api-rollout-and-production-process-audit-14oct26.md`<br>`url-scan-ssrf-protection-verification-14oct26.md` |
| **Stack** | Node API on the VPS (`routes/scanVideoUrl.js`, PM2) |
| **Starting trigger** | When the length check fails (for example an expired signed link), the old message blamed the video length. Your extension's "refresh URL" button fixes expired links, so the web app message should point to that |

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

One string changed in `routes/scanVideoUrl.js`, in the `URL_VIDEO_DURATION_UNKNOWN` response.

**Main outcomes**

- Old: "Could not verify the video length. Please use a direct video URL that is 2 minutes or shorter."
- New: "We couldn't read this video. The link may have expired (refresh it and try again), or it isn't a direct video URL of 2 minutes or less."
- The error code (`URL_VIDEO_DURATION_UNKNOWN`) and HTTP status (400) are unchanged.
- I checked the web app's error handling in `scan-workspace.tsx`: none of its keyword categories (duplicate scan, rate limit, account flagged, audio, batch, tokens, auth, `corrupt` / `Failed to load` / `decode`, `parse` / `JSON`) match the new text, so it is shown as written under an "Analysis failed" heading.
- It is on test (modified 19:51:29) and on live (copied with the other two server files).

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| Edit in `routes/scanVideoUrl.js` | ✅ Done | You said you added the expired-link message. It is in your pasted diff |
| Test API running it | ✅ Verified | The test process started at 20:00:34, after the file's 19:51:29 modification |
| Copied to live and live restarted | ✅ Done | See `live-api-rollout-and-production-process-audit-14oct26.md` (restart 20:58:32) |
| Seeing the new message in the browser with an expired link | ⚠️ Not reported | Expected: the banner reads "Analysis failed" with the new text |

---

## 3. Starting point

- The route probes the video length with ffprobe through a locked-down proxy (`utils/probeVideoDuration.js`). If the probe throws (expired signed link, a page URL instead of a video, a host that blocks the fetch), the route returns `URL_VIDEO_DURATION_UNKNOWN`.
- The extension has a "refresh URL" button that fetches a fresh signed link.

---

## 4. Timeline: what we did, in order

### Phase 1 – The idea

You said expired links are handled by the extension, so the message should say that a link may have expired.

### Phase 2 – The edit

I gave you the find-and-replace for that one line. You applied it on test.

### Phase 3 – Checks

You ran a deep scan on a video URL and a batch scan with a video URL and an image URL. Neither hit this error, so the new message hasn't been seen in the browser.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | The old message blamed the length for what is often an expired link | One catch-all error for any probe failure | Message now covers both causes |

No other errors.

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. None for this change.

### Decisions

1. Reword the message only. Don't split the error into separate codes.
2. Keep the code and status.

### Known limits

- The probe can't tell an expired link from a page URL, so the message names both.

---

## 7. Open items checklist

- [x] Message changed on test and on live
- [ ] Optional: confirm the wording in the browser with an expired signed link

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| File | `routes/scanVideoUrl.js` |
| Error code / status | `URL_VIDEO_DURATION_UNKNOWN` / 400 |
| Length limit | 121 seconds (`MAX_URL_VIDEO_DURATION_SECONDS`) |

---

## Appendix A – Diff (live to test, as you pasted it)

```diff
--- mediacrater-api/routes/scanVideoUrl.js      2026-10-13 14:24:53.394692372 +0000
+++ mediacrater-api-test/routes/scanVideoUrl.js 2026-10-14 19:51:29.669288885 +0000
@@ -235,7 +235,7 @@
 
         return failEarly(400, {
           error: 'URL_VIDEO_DURATION_UNKNOWN',
-          message: 'Could not verify the video length. Please use a direct video URL that is 2 minutes or shorter.'
+          message: "We couldn't read this video. The link may have expired (refresh it and try again), or it isn't a direct video URL of 2 minutes or less."
         });
       }
 
```

---

## Appendix B – Commands and expected output

```bash
cd /var/www/mediacrater-api-test
node --check routes/scanVideoUrl.js
pm2 restart mediacrater-api-test --update-env
```

**Expected (not confirmed):** paste a URL whose signed link has expired, add it, and scan it. The banner shows "Analysis failed" and "We couldn't read this video. The link may have expired (refresh it and try again), or it isn't a direct video URL of 2 minutes or less."

---

## Appendix C – Rollback

Put the old string back on that line:

```js
          message: 'Could not verify the video length. Please use a direct video URL that is 2 minutes or shorter.'
```

Then `node --check routes/scanVideoUrl.js` and `pm2 restart mediacrater-api --update-env`.

---

*End of index.*
