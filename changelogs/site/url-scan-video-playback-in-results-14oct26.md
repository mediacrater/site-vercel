# URL Scans: The Results Page Plays the Video From Its Source Link (Markers Work, No Thumbnail Strip)

| | |
|---|---|
| **Date** | 14 October 2026 (`14oct26`) |
| **Destination** | changelogs/site |
| **Conversation** | Not available to me. Paste this chat's URL here when you file this. |
| **Related prior work** | `results-video-player-with-violation-timeline-14oct26.md`<br>`results-evidence-frames-under-violations-14oct26.md`<br>`url-scan-thumbnail-download-via-safefetch-14oct26.md`<br>`url-scan-expired-link-error-message-14oct26.md`<br>`url-scan-ssrf-protection-verification-14oct26.md` |
| **Stack** | Next.js web app on Vercel (`components/scan-workspace.tsx`); URL-scan client code in `lib/mediacrater/scanApiUrl.ts`; CSP in `next.config.mjs` |
| **Starting trigger** | URL scans were added to complement the Chrome extension, which pulls Facebook Ad Library video URLs. You wanted to know what the results page could do for them |

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
9. [Appendix A – scan-workspace.tsx edits (as on main)](#appendix-a--scan-workspacetsx-edits-as-on-main)
10. [Appendix B – Test steps and expected results](#appendix-b--test-steps-and-expected-results)
11. [Appendix C – Rollback](#appendix-c--rollback)

---

## 1. Summary

For a scanned **video URL**, the timeline player now plays straight from the source link. For uploads it still uses the local file's preview URL.

**Main outcomes**

- New helper `playbackSrcFor()` in `scan-workspace.tsx` returns the local preview URL for uploads and, for URL videos, `creative.sourceUrl` only if it parses as an **https** URL.
- Browsers can play cross-origin video without CORS (CORS only matters for reading pixels), and your CSP already allows `media-src 'self' blob: https:`.
- The three edits that enable this were already on `main` when I checked, and you confirmed that after scanning a video URL "the entire playback feature works right away". **I had sent the same edits twice before reading your current file.**
- **No thumbnail strip for URL scans.** The VPS never extracts frames for them (the AI is given the URL), and the browser can't read pixels from CDNs like fbcdn (your own comment in `utils/urlThumbnail.js` says so).
- The player hides itself if the link fails to play. Expired signed links are handled by the extension's "refresh URL" button, as you said.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| `playbackSrcFor`, `activeVideoCreative` (video and video_url), `activePlaybackSrc`, render condition | ✅ Done | All found on `main` |
| Playback on a scanned video URL | ✅ Verified | You reported it works right away |
| CSP allows video from any https host | ✅ Verified | `media-src 'self' blob: https:` in `next.config.mjs` |
| Markers on URL scans | ✅ Verified | You reported the whole playback feature works |
| Timestamp precision on URL scans | ⏳ Not checked | The AI watches the video itself instead of reading labelled frames |
| Thumbnails for URL scans | ⏳ Not available | Needs server-side frame extraction |
| Copied to the live web repo | ✅ Done | You reported the web app files were copied. I haven't seen the live repo |

---

## 3. Starting point

- `scanVideoUrl()` in `scanApiUrl.ts` sends only the URL (plus platform and scan type). No frames are available in the browser for URL creatives.
- `handleUrlSubmit` builds a `video_url` creative whose `previewUrl` is only a small canvas thumbnail (empty if the host blocks canvas reads).
- Your extension is a standalone offline tool that pulls Ad Library URLs when media is selected, so URL scans are the bridge from the free tool to the web app. The web app reads a `?scan_url=` query parameter on load, which is presumably how the hand-off works (I haven't seen the extension code). No users had used URL scans yet.

---

## 4. Timeline: what we did in order

### Phase 1 – What the code allows

I read `scanApiUrl.ts`, `scanVideoUrl.js` and `urlThumbnail.js`. Conclusions: playback can work from the source URL, frames can't be made in the browser, and server-side frame extraction would be a bigger, riskier build.

### Phase 2 – The three edits

I sent the edits. I held them back once because URL scans weren't used yet, then re-sent them after the Ad Library flow worked.

### Phase 3 – It already worked

You said no changes were needed. I read the current `scan-workspace.tsx` and found all three edits already on `main`, which explained it.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | I sent the same three edits again | I worked from my notes instead of your current file | I read the repo file, confirmed they were present, and said so |
| 2 | No thumbnails for URL videos | No frames server-side and no canvas reads from other sites | Accepted limit |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. I re-sent edits you already had.
2. I earlier suggested that the VPS might return frames; the code showed the VPS has no frames for URL scans.

### Decisions

1. Play URL videos straight from the source link.
2. Only https sources.
3. No thumbnails for URL scans for now.
4. Don't store signed video URLs in sessionStorage (they carry access tokens), so there is no player after a refresh.

### Known limits

- Signed links can expire mid-session, and the player then hides itself.
- Seeking needs Range-request support from the host.
- A live stream without a finite duration won't show markers.
- Timestamp precision on URL scans may be lower than for uploads (not verified).

---

## 7. Open items checklist

- [x] URL video playback working
- [x] Copied to the live web repo (you reported it)
- [ ] Optional: check timestamp accuracy on a few URL scans
- [ ] Optional: thumbnails for URL scans via server-side extraction (bigger build, wider attack surface)

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Helper | `playbackSrcFor()` in `components/scan-workspace.tsx` |
| URL source | `creative.sourceUrl` (the resolved URL), https only |
| CSP | `media-src 'self' blob: https:` |
| Web app entry from the extension | `?scan_url=<url>` is read on load by `scan-workspace.tsx` (presumably the extension hand-off, unconfirmed) |

---

## Appendix A – scan-workspace.tsx edits (as on main)

**Helper** (directly above `function orderCreativesForExecution(`):

```ts
// What the results-page video player plays. Uploads play from the local
// file's preview URL. URL scans play straight from the source (browsers can
// play cross-origin video without CORS; CORS only matters for reading
// pixels). The server only accepts https URLs, so anything else is refused
// here too.
function playbackSrcFor(creative: BatchCreative | null): string | null {
  if (!creative) return null;

  if (creative.kind === 'video') {
    return creative.previewUrl || null;
  }

  if (creative.kind === 'video_url') {
    try {
      const parsed = new URL(creative.sourceUrl);
      return parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
      return null;
    }
  }

  return null;
}
```

**`activeVideoCreative` and `activePlaybackSrc`** (replacing the first-shipped block):

```ts
const activeVideoCreative =
  creatives.find(
    (creative) =>
      creative.id === activeResultCreativeId &&
      (creative.kind === 'video' || creative.kind === 'video_url')
  ) ?? null;

const activePlaybackSrc = playbackSrcFor(activeVideoCreative);
  
const activeResultOption =
```

**Render condition and source:**

```tsx
            {activePlaybackSrc && visibleResults[0] && (
              <VideoTimeline
                key={visibleResults[0].scanId}
                src={activePlaybackSrc}
                violations={visibleResults[0].processedViolations}
                onSelectViolation={(violationIndex) =>
                  focusViolation(visibleResults[0].scanId, violationIndex)
                }
              />
            )}
            {visibleResults.map((r) => {
```

---

## Appendix B – Test steps and expected results

1. In the extension, select a Facebook Ad Library video and open it in the web app.
2. Scan it.

**Expected:** the player appears above the results, plays, seeks when you click ahead, and shows markers at the cited times. If no player appears, open the browser console for a red error and check the video request in DevTools, Network (status and the `Accept-Ranges` header). If the player appears with no markers, check the `scan-video-url` response's `violations` timestamps format.

---

## Appendix C – Rollback

Restore the first-shipped `activeVideoCreative` block and render condition from `results-video-player-with-violation-timeline-14oct26.md` (Appendix C) and delete `playbackSrcFor`.

---

*End of index.*
