# URL Scan Thumbnails: Server-Side First-Frame Thumbnails for Image and Video URL Scans

| | |
|---|---|
| **Date** | 12 October 2026 (`12oct26`) |
| **Conversation** | `<add this conversation's URL>` |
| **Related prior work** | `vps-hardening-cloudflare-lockdown-ssrf-fix-02oct26.md` (2 Oct 2026, SSRF-safe fetch and `assertPublicFetchUrl`) |
| **Related work (same conversation)** | `batch-url-creatives-store-fix-12oct26.md` |
| **Stack** | VPS Node API (`routes/scanVideoUrl.js`, `routes/scanImageUrl.js`, new `utils/urlThumbnail.js`), ffmpeg, Supabase Storage bucket `scan-thumbnails`, Scan History page (`app/scan-history/page.tsx`) |
| **Starting trigger** | URL scans (image and video, including in batches) never showed a thumbnail in Scan History, because both URL calls in `scan-workspace.tsx` passed `null` as the thumbnail |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included. `userId` / `scanId` in examples are fake UUIDs.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied. ⏳ = open.

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
9. [Appendix A – utils/urlThumbnail.js (final, v2)](#appendix-a--utilsurlthumbnailjs-final-v2)
10. [Appendix B – Route changes (THUMBS blocks)](#appendix-b--route-changes-thumbs-blocks)
11. [Appendix C – Tests, verification and troubleshooting commands](#appendix-c--tests-verification-and-troubleshooting-commands)
12. [Appendix D – Rollback](#appendix-d--rollback)

---

## 1. Summary

The browser can't read pixels from a video or image on another site's CDN (fbcdn and others block cross-origin canvas reads), so URL scans can't produce a thumbnail client-side. The VPS now makes one: it downloads the media itself with SSRF checks on every hop, grabs the first frame with ffmpeg, shrinks it to a 200 px JPEG, and uploads it to the user's folder in `scan-thumbnails`. The path is saved in `scans.thumbnail_url`, which Scan History already reads.

**Main outcomes**

- New `utils/urlThumbnail.js` (v2). It downloads through your `assertPublicFetchUrl()` (re-checked on each redirect), uses ffmpeg via `spawn()` with an argument array and `-protocol_whitelist file`, caps size and time, and never throws.
- Videos only fetch the **first 8 MB**, which is enough for "faststart" MP4s. Videos with their index at the end are skipped rather than downloaded in full.
- Both URL routes start the thumbnail **in parallel with the AI analysis** and **no longer trust a client-sent `thumbnailUrl`**.
- Only users whose plan includes Scan History (`profile.scan_history`) get a thumbnail.
- You confirmed: **"Everything works on that front now."**
- Quality: I set `-q:v 7`. You chose maximum compression and set **37**. ffmpeg's JPEG range is 2–31, so 37 is silently capped to 31 (tested: byte-identical output).

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| `utils/urlThumbnail.js` v2 on the **test** VPS | ✅ Done | Thumbnails working (your report) |
| `routes/scanVideoUrl.js` + `routes/scanImageUrl.js` (THUMBS changes) on test | ✅ Done | Same |
| Thumbnails in Scan History for URL scans | ✅ Verified | Your report |
| Production VPS has `utils/urlThumbnail.js` | ✅ Done | You moved it into prod `utils/` during the Google rollout after a startup error |
| Production URL routes are the THUMBS versions | ⚠️ Likely | Production now runs code copied from test, but I didn't see the files |
| `-q:v 37` → effectively 31 | ✅ Working | ⚠️ Advised: write `31` explicitly |
| Use the pinned `safeFetch` from `security/ssrf.js` instead of plain `fetch` | ⏳ Open | Closes the remaining DNS-rebinding gap (see Decisions) |

---

## 3. Starting point

- In `components/scan-workspace.tsx`, both URL scan calls pass `null` where uploads pass a thumbnail:
  ```ts
  : creative.kind === 'video_url' ? await scanVideoUrl( creative.sourceUrl, platform, creative.scanType, null, signal, scanId, null, fileName, batchMeta, false )
  : creative.kind === 'image_url' ? await scanImageUrl( creative.sourceUrl, platform, null, signal, scanId, null, fileName, batchMeta )
  ```
- Uploads get thumbnails because the browser extracts frames from the user's own file. URL media lives on someone else's CDN.
- The VPS URL routes **don't download the media**: they pass the URL to the AI (`helpers.analyzeVideoUrlWithAI(sourceUrl, …)`). Only `probeVideoDurationSeconds(sourceUrl)` touches the URL, via ffprobe.
- Scan History reads `scans.thumbnail_url` as a storage path (`<userId>/<scanId>.jpg`) and signs it.
- The routes passed the client's `thumbnailUrl` to `resolveScanIdentity()` (Phase 1 security), which validated it.

---

## 4. Timeline: what we did, in order

### Phase 1 – First helper (v1) and guide

I wrote `utils/urlThumbnail.js` v1, which made a thumbnail **from a file the route had already downloaded** (`filePath` or `buffer`). It was tested locally with real ffmpeg:

| Input | Result |
|---|---|
| 1280×720 MP4 | JPEG, 200×112 |
| 600×900 PNG | JPEG, 134×200 |
| 300×300 GIF | JPEG, 200×200 |
| HLS playlist pointing at `169.254.169.254` | Refused (`-protocol_whitelist file`) |

The guide told you to call it "after the media is downloaded".

### Phase 2 – Your integration, and the bug it exposed

You pasted both routes. `scanVideoUrl.js` contained:

```js
const thumbPath = profile.scan_history
  ? await createUrlScanThumbnail({ supabaseAdmin, userId: verifiedUser.id, scanId, filePath /* or buffer */ })
  : null;
```

Two problems:

1. **My mistake:** v1 assumed the VPS downloads the media. It doesn't, so there was no `filePath` or `buffer` to pass.
2. **It would crash after charging the user.** `createUrlScanThumbnail`, `supabaseAdmin`, `verifiedUser` and `filePath` don't exist in that file (no import, wrong names), so it throws a `ReferenceError`. And it ran **after** `commitScanDeduction`, so the user would lose tokens and see "Your scan could not be completed".

This error did reach the test logs:
```
[ERROR][scan-video-url] | user:<uuid> | createUrlScanThumbnail is not defined
Stack: ReferenceError: createUrlScanThumbnail is not defined
    at handleScanVideoUrl (/var/www/mediacrater-api-test/routes/scanVideoUrl.js:321:9)
```
It stopped repeating once the fixed routes were deployed.

### Phase 3 – v2 helper and fixed routes

**`urlThumbnail.js` v2** ([Appendix A](#appendix-a--utilsurlthumbnailjs-final-v2)) downloads the media itself:

- every hop, including each redirect (`redirect: 'manual'`, max 3), goes through `assertPublicFetchUrl()`;
- no cookies or auth headers; only `image/*`, `video/*` or generic binary responses are accepted;
- 20 s download timeout; images must be complete and ≤ 15 MB; videos read only the first 8 MB;
- written to a private `mkdtemp()` folder (file mode 0600), always deleted;
- ffmpeg timeout 15 s, output capped at 512 KB, output checked for the JPEG signature;
- `userId` and `scanId` are UUID-checked before building the storage path;
- the upload uses `upsert: false`; "already exists" counts as success (the same scanId after a queue re-call);
- returns `"<userId>/<scanId>.jpg"` or `null`, and never throws.

**Routes** ([Appendix B](#appendix-b--route-changes-thumbs-blocks)):

- `require('../utils/urlThumbnail')` added;
- `thumbnailUrl` is no longer read from the request body, and `resolveScanIdentity(supabase, user.id, reqScanId, null)` gets `null`;
- `thumbnailPromise` starts right after `resolveScanIdentity`, so it runs alongside the AI;
- `thumbnailUrl = await thumbnailPromise` runs after the AI result and **before** `commitScanDeduction`;
- in the `catch`, the error response is **not** delayed waiting for the thumbnail (a small unreferenced file may stay in storage after a failed scan).

**Tests run (local server, real ffmpeg, fake Supabase):**

| Case | Result |
|---|---|
| Faststart MP4 (36 MB), first 8 MB only | Thumbnail ✅ |
| MP4 with index at the end (36 MB) | `null` (skipped) ✅ |
| PNG | Thumbnail ✅ |
| 301 redirect to a valid image | Thumbnail ✅ |
| 302 redirect to `169.254.169.254` | `null`, logged `SSRF_BLOCKED` ✅ |
| `text/html` response | `null` ✅ |
| 404 | `null` ✅ |

The deploy steps are in [Appendix C](#appendix-c--tests-verification-and-troubleshooting-commands).

### Phase 4 – Compression

You asked whether thumbnails are compressed "to the absolute max". Not at first: 200 px longest side, `-q:v 7`, about 3–5 KB each, no EXIF copied. Your policy is deliberate maximum compression. You tested **37** and found it fine. I checked that 37 and 31 produce identical bytes (ffmpeg caps the value), and advised writing `31` so a future ffmpeg doesn't reject it.

### Phase 5 – Production

During the Google sign-in rollout (`google-oauth-signin-12oct26.md`), production failed to start until `urlThumbnail.js` was placed in `/var/www/mediacrater-api/utils/`. You fixed that yourself, then copied test's `server.js` to production.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Thumbnails couldn't be made in the browser for URL scans | Cross-origin CDNs block canvas reads | Server-side thumbnails |
| 2 | The v1 helper had nothing to work from | I assumed the VPS downloads URL media. It passes the URL to the AI | v2 downloads the media itself |
| 3 | The pasted route used `createUrlScanThumbnail`, `supabaseAdmin`, `verifiedUser`, `filePath`, none of which exist there | Guide written against the wrong assumption | Rewrote both routes |
| 4 | It would throw **after** `commitScanDeduction` | Placement in the route | Thumbnail awaited before deduction, and it never throws |
| 5 | `createUrlScanThumbnail is not defined` in test logs (`scanVideoUrl.js:321`) | The broken paste ran once | Fixed routes deployed. Not seen since |
| 6 | The first local test run hit the 300 s tool limit | My 15 s lossless noise video was too big to generate | Used a 1 s video (36 MB) |
| 7 | `-q:v 37` accepted | ffmpeg caps mjpeg quality at 31 | Same output as 31. ⚠️ Write 31 |
| 8 | Production failed to start | `utils/urlThumbnail.js` missing on production | You copied it in |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. **v1 assumed a downloaded file.** I couldn't see the VPS code and guessed wrong. v2 downloads it safely.
2. **I first suggested "the existing safe proxy".** Your `server.js` (seen later) has a pinned `safeFetch` in `security/ssrf.js` that checks the IP inside the socket's own DNS lookup. My v2 uses plain `fetch` plus `assertPublicFetchUrl` on each hop, which leaves a small DNS-rebinding window. Switching to your pinned fetcher would close it.

### Decisions

1. **Thumbnail from the URL, not from data the AI receives.** The AI gets only the URL, so the VPS fetches it once more, carefully.
2. **Partial download for video (8 MB).** Most ad CDNs serve faststart MP4s. Others are skipped instead of downloading whole videos.
3. **Never trust a client `thumbnailUrl` on URL routes.** The server builds the path from `userId` + `scanId`.
4. **Thumbnails never fail a scan.** Any failure returns `null`.
5. **Only for Scan History plans** (`profile.scan_history`).
6. **Maximum compression** (your policy): q 31 (written as 37).

---

## 7. Open items checklist

- [x] Thumbnails working for URL scans (test)
- [x] Production has `utils/urlThumbnail.js`
- [ ] Change `'-q:v', '37'` to `'-q:v', '31'` in `utils/urlThumbnail.js` (same output, future-proof)
- [ ] Confirm production's `routes/scanVideoUrl.js` and `routes/scanImageUrl.js` contain the `THUMBS:` blocks:
  ```bash
  grep -c "THUMBS:" /var/www/mediacrater-api/routes/scanVideoUrl.js /var/www/mediacrater-api/routes/scanImageUrl.js
  ```
  Expected: a non-zero count for both files.
- [ ] Optional: replace `fetch` in `downloadPublicMedia()` with your pinned `safeFetch` from `security/ssrf.js`
- [ ] Optional: periodically clean thumbnails left by failed scans (files in `scan-thumbnails` with no matching `scans` row)

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Storage bucket / path | `scan-thumbnails` / `<userId>/<scanId>.jpg` |
| Saved in | `scans.thumbnail_url` (a path, not a URL) |
| Size | Longest side 200 px, JPEG (`yuvj420p`), `-q:v` 37 → 31 |
| Video download | First 8 MB |
| Image download | Complete, ≤ 15 MB |
| Timeouts | Download 20 s, ffmpeg 15 s |
| Output cap | 512 KB |
| Redirects | Max 3, each re-checked with `assertPublicFetchUrl` |
| Accepted content types | `image/*`, `video/*`, `application/octet-stream`, `binary/octet-stream` |
| ffmpeg | `FFMPEG_PATH` env var, default `ffmpeg`. Requires ffmpeg installed |
| Node | 18+ (global `fetch`) |
| Log prefix | `[THUMB] … (non-fatal)`. The URL is never logged |

---

## Appendix A – utils/urlThumbnail.js (final, v2)

As delivered (`-q:v 7`; you changed it to `37`):

```js
// utils/urlThumbnail.js
//
// Server-side thumbnails for URL scans (image_url / video_url).
//
// Why server-side: the browser can't read pixels from a video/image on
// someone else's CDN (fbcdn etc. block cross-origin canvas reads), so URL
// scans reached the API with no thumbnail and Scan History showed none.
//
// v2: the scan routes never download the media (the AI is given the URL),
// so this module now downloads it itself, safely:
// - Every hop is checked with your assertPublicFetchUrl(), including each
//   redirect (redirect: 'manual'), so a public URL can't bounce the server to
//   127.0.0.1 / 169.254.169.254 / private ranges. Max 3 redirects.
// - No cookies or auth headers are sent. Only image/* and video/* (or generic
//   binary) responses are accepted.
// - Hard size caps and timeouts. Videos only fetch the first 8 MB: enough for
//   the first frame of a "faststart" MP4 (most ad CDNs). If a video keeps its
//   index at the end, ffmpeg fails on the partial file and we skip the
//   thumbnail instead of downloading the whole video.
// - ffmpeg runs via spawn() with an argument array (no shell = no command
//   injection) and -protocol_whitelist file, so a crafted playlist (HLS /
//   concat) can't make ffmpeg open network URLs on its own.
// - Temp files live in a private mkdtemp() folder (0600) and are always deleted.
// - userId must come from the verified token (req.user.id). Both IDs are
//   UUID-checked before building the storage path.
// - Never throws. Any failure returns null and the scan carries on.
//
// Residual risk (same as any validate-then-fetch design): DNS can change
// between assertPublicFetchUrl's lookup and fetch's own lookup (DNS
// rebinding). Closing that fully needs an IP-pinned HTTP agent.
//
// Requires Node 18+ (global fetch).

'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
const THUMB_MAX_EDGE = 200;            // matches the web app's compressThumbnail()
const FFMPEG_TIMEOUT_MS = 15000;
const MAX_THUMB_BYTES = 512 * 1024;
const THUMB_BUCKET = 'scan-thumbnails';

const DOWNLOAD_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 3;
const VIDEO_PREFIX_BYTES = 8 * 1024 * 1024;   // partial read is fine for video
const IMAGE_MAX_BYTES = 15 * 1024 * 1024;     // images must be complete

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_CONTENT_TYPE =
  /^(image\/|video\/|application\/octet-stream|binary\/octet-stream)/i;

/**
 * First frame of a local image/video file -> small JPEG Buffer, or null.
 */
function renderFirstFrameJpeg(inputPath) {
  return new Promise((resolve) => {
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-nostdin',
      '-protocol_whitelist', 'file',
      '-i', inputPath,
      '-frames:v', '1',
      '-vf',
      `scale='if(gt(iw,ih),min(${THUMB_MAX_EDGE},iw),-2)':'if(gt(iw,ih),-2,min(${THUMB_MAX_EDGE},ih))'`,
      '-pix_fmt', 'yuvj420p',
      '-c:v', 'mjpeg',
      '-q:v', '7',
      '-f', 'image2pipe',
      'pipe:1',
    ];

    let child;
    try {
      child = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      console.warn('[THUMB] ffmpeg spawn failed (non-fatal):', err.message);
      resolve(null);
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      console.warn('[THUMB] ffmpeg timed out (non-fatal)');
      finish(null);
    }, FFMPEG_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_THUMB_BYTES) {
        child.kill('SIGKILL');
        console.warn('[THUMB] thumbnail too large (non-fatal)');
        finish(null);
        return;
      }
      chunks.push(chunk);
    });

    // Drain stderr so ffmpeg can't stall on a full pipe; keep only the tail.
    // The input is a local temp path, so no URL or token can appear here.
    let stderrTail = '';
    child.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-500);
    });

    child.on('error', (err) => {
      console.warn('[THUMB] ffmpeg error (non-fatal):', err.message);
      finish(null);
    });

    child.on('close', (code) => {
      const jpeg = Buffer.concat(chunks);
      const isJpeg = jpeg.length > 3 && jpeg[0] === 0xff && jpeg[1] === 0xd8;
      if (code !== 0 || !isJpeg) {
        console.warn(`[THUMB] ffmpeg exit ${code} (non-fatal): ${stderrTail.trim()}`);
        finish(null);
        return;
      }
      finish(jpeg);
    });
  });
}

/**
 * Downloads a public URL into destPath with SSRF checks on every hop.
 * Returns true if usable bytes were written, false otherwise.
 */
async function downloadPublicMedia(url, destPath, assertPublicFetchUrl, { maxBytes, allowPartial }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let handle = null;

  try {
    let currentUrl = await assertPublicFetchUrl(url);
    let response = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        credentials: 'omit',
        headers: {
          Accept: 'image/*,video/*;q=0.9,*/*;q=0.1',
          'User-Agent': 'MediacraterThumbnailer/1.0',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location || hop === MAX_REDIRECTS) return false;
        // Re-validate the redirect target before following it.
        currentUrl = await assertPublicFetchUrl(new URL(location, currentUrl).href);
        continue;
      }
      break;
    }

    if (!response || !response.ok || !response.body) return false;

    const contentType = response.headers.get('content-type') || '';
    if (!ALLOWED_CONTENT_TYPE.test(contentType)) {
      await response.body.cancel().catch(() => {});
      return false;
    }

    const declared = Number(response.headers.get('content-length'));
    if (!allowPartial && Number.isFinite(declared) && declared > maxBytes) {
      await response.body.cancel().catch(() => {});
      return false;
    }

    handle = await fs.open(destPath, 'wx', 0o600);
    const reader = response.body.getReader();
    let written = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const remaining = maxBytes - written;
      if (value.length > remaining) {
        if (!allowPartial) {
          await reader.cancel().catch(() => {});
          return false;
        }
        await handle.write(value.subarray(0, remaining));
        written += remaining;
        await reader.cancel().catch(() => {});
        break;
      }

      await handle.write(value);
      written += value.length;
    }

    return written > 0;
  } catch (err) {
    // Message only: never log the URL (signed links carry tokens).
    console.warn('[THUMB] download failed (non-fatal):', err?.code || err?.name || 'error');
    return false;
  } finally {
    clearTimeout(timer);
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * Builds and uploads the thumbnail for a URL scan.
 *
 * @param {object}   opts
 * @param {object}   opts.supabase              service-role Supabase client
 * @param {string}   opts.userId                req.user.id (verified token)
 * @param {string}   opts.scanId                scanId from resolveScanIdentity()
 * @param {string}   opts.sourceUrl             URL already passed through assertPublicFetchUrl
 * @param {Function} opts.assertPublicFetchUrl  same validator the route uses
 * @param {'image'|'video'} opts.kind
 * @returns {Promise<string|null>}  "userId/scanId.jpg" for scans.thumbnail_url, or null
 */
async function createUrlScanThumbnail({ supabase, userId, scanId, sourceUrl, assertPublicFetchUrl, kind }) {
  let dir = null;

  try {
    if (!UUID_RE.test(String(userId)) || !UUID_RE.test(String(scanId))) return null;
    if (!sourceUrl || typeof assertPublicFetchUrl !== 'function') return null;

    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-thumb-'));
    const inputPath = path.join(dir, 'input');

    const downloaded = await downloadPublicMedia(
      sourceUrl,
      inputPath,
      assertPublicFetchUrl,
      kind === 'video'
        ? { maxBytes: VIDEO_PREFIX_BYTES, allowPartial: true }
        : { maxBytes: IMAGE_MAX_BYTES, allowPartial: false }
    );
    if (!downloaded) return null;

    const jpeg = await renderFirstFrameJpeg(inputPath);
    if (!jpeg) return null;

    const storagePath = `${userId}/${scanId}.jpg`;
    const { error } = await supabase.storage
      .from(THUMB_BUCKET)
      .upload(storagePath, jpeg, { contentType: 'image/jpeg', upsert: false });

    if (error) {
      // Same scanId retried (queue re-call / recovery): the file is already ours.
      if (/already exists|duplicate/i.test(error.message || '') || String(error.statusCode) === '409') {
        return storagePath;
      }
      console.warn('[THUMB] upload failed (non-fatal):', error.message);
      return null;
    }

    return storagePath;
  } catch (err) {
    console.warn('[THUMB] unexpected error (non-fatal):', err?.message);
    return null;
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  createUrlScanThumbnail,
  renderFirstFrameJpeg,
  downloadPublicMedia,
};
```

---

## Appendix B – Route changes (THUMBS blocks)

The same pattern in `routes/scanVideoUrl.js` (`kind: 'video'`) and `routes/scanImageUrl.js` (`kind: 'image'`).

**1. Import (top of file):**
```js
// THUMBS: server-side thumbnail for URL scans (the browser can't read other sites' pixels).
const { createUrlScanThumbnail } = require('../utils/urlThumbnail');
```

**2. New variable next to the others:**
```js
  // THUMBS: thumbnail work started alongside the AI analysis (never rejects).
  let thumbnailPromise = null;
```

**3. Request body: `thumbnailUrl: reqThumbnailUrl` removed from the destructuring.**
```js
    // THUMBS: thumbnailUrl from the request body is no longer read. For URL scans the
    // server makes the thumbnail itself, so a client-supplied path is never trusted here.
```

**4. Identity check without a client thumbnail, then start the thumbnail:**
```js
    ({ scanId } = await resolveScanIdentity(
      supabase,
      user.id,
      reqScanId,
      null
    ));

    thumbnailPromise = profile.scan_history
      ? createUrlScanThumbnail({
          supabase,
          userId: user.id,
          scanId,
          sourceUrl,
          assertPublicFetchUrl,
          kind: 'video' // 'image' in scanImageUrl.js
        })
      : Promise.resolve(null);
```

**5. After the AI result, before the deduction:**
```js
    // THUMBS: usually finished long before the AI is.
    thumbnailUrl = await thumbnailPromise;

    const deduction = await commitScanDeduction(/* unchanged */);
```

**6. `logScan` keeps `thumbnail_url: thumbnailUrl`.** The `catch` block is unchanged apart from a comment: it doesn't wait for the thumbnail.

---

## Appendix C – Tests, verification and troubleshooting commands

**Deploy (each VPS folder):**
```bash
node -v                       # must be 18 or higher
ffmpeg -version               # install with: sudo apt install ffmpeg
cp routes/scanVideoUrl.js routes/scanVideoUrl.js.bak
cp routes/scanImageUrl.js routes/scanImageUrl.js.bak
# copy utils/urlThumbnail.js, routes/scanVideoUrl.js, routes/scanImageUrl.js into place
node --check routes/scanVideoUrl.js routes/scanImageUrl.js utils/urlThumbnail.js
pm2 restart <app-name>        # mediacrater-api-test or mediacrater-api
```

**Verify:** run one image URL scan and one video URL scan on a plan with Scan History, then open Scan History. Expected: both show thumbnails.

**Troubleshoot:**
```bash
pm2 logs <app-name> --lines 200 --nostream | grep "\[THUMB\]"
```
| Log line | Meaning |
|---|---|
| `download failed (non-fatal): SSRF_BLOCKED` | The URL or a redirect points at a private address |
| `ffmpeg exit 183 … Invalid data` | Not media, or an MP4 whose index is past the first 8 MB |
| `ffmpeg timed out` | Over 15 s |
| `thumbnail too large` | JPEG over 512 KB (shouldn't happen at 200 px) |
| `upload failed` | Supabase Storage rejected it (check that the bucket exists, and the service-role key) |

**Check that `-q:v 37` equals 31** (as tested):
```bash
ffmpeg -loglevel error -f lavfi -i testsrc=size=640x360 -frames:v 1 -c:v mjpeg -q:v 37 -f image2pipe pipe:1 | wc -c
ffmpeg -loglevel error -f lavfi -i testsrc=size=640x360 -frames:v 1 -c:v mjpeg -q:v 31 -f image2pipe pipe:1 | wc -c
```
Expected: identical byte counts (8224 in my test).

---

## Appendix D – Rollback

```bash
cp routes/scanVideoUrl.js.bak routes/scanVideoUrl.js
cp routes/scanImageUrl.js.bak routes/scanImageUrl.js
pm2 restart <app-name>
```
URL scans then go back to having no thumbnail. `utils/urlThumbnail.js` can stay; nothing else uses it.

---

*End of index.  
Conversation: `<add this conversation's URL>`*
