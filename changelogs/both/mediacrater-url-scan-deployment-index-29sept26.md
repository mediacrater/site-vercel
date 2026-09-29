# Mediacrater URL Scan Deployment Index

conversation link: https://chatgpt.com/c/6abbd973-f948-83ea-b16c-b21ff74048c1

Date: 2026-Sept-29

## Scope

This index covers the URL scan connection between the Chrome extension, the Next.js web app, and the VPS scan API.

The implementation goal is:

- Extension opens the web app with the selected creative URL in `scan_url`.
- Web app reads `scan_url`, pre-fills the URL flow, and displays the scan settings.
- URL scans call the VPS API through `NEXT_PUBLIC_VPS_API_URL`.
- Unauthenticated URL scan attempts redirect to sign in with a clear message.
- URL video scans should be limited to 2 minutes.
- Audio analysis should be disabled for URL video scans unless the backend later extracts audio.

## Current Status

| Area | Status | Notes |
| --- | --- | --- |
| URL analysis flow | Working | The analysis process now works through the web app. |
| Extension to web app handoff | Ready to apply | Extension should open `/dashboard?scan_url=...&scan_kind=video`. |
| Sign-in guidance | Partially applied | Dashboard and sign-in need to preserve/show `reason=scan_login_required`. |
| URL audio analysis | Should be disabled | Current URL flow does not extract audio from remote videos. |
| 2-minute URL video limit | Not fully implemented yet | Needs backend duration probing before scan execution. |
| `/api/mediacrater/resolve-url` proxy | Not required | Use `NEXT_PUBLIC_VPS_API_URL` directly instead. |

## Environment Variables

The web app already has these relevant values:

```env
NEXT_PUBLIC_VPS_API_URL=https://your-vps-api.example.com
NEXT_PUBLIC_APP_URL=https://your-web-app.example.com
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
TURNSTILE_SECRET_KEY=...
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
```

Optional VPS variable:

```env
URL_SCAN_ALLOWED_HOSTS=facebook.com,instagram.com,tiktok.com,youtube.com,googlevideo.com
```

The Chrome extension uses `SITE_URL` from `utils/config.js`.

```js
export const SITE_URL = 'https://test-website-os8787wpu565renk6lgvpuhp87ic3kfruwf.mediacrater.com';
```

## Important Routing Decision

Do not call this from the browser:

```txt
/api/mediacrater/resolve-url
```

That route only exists if the Next.js app contains this proxy file:

```txt
app/api/mediacrater/[...path]/route.ts
```

Because this project already has `NEXT_PUBLIC_VPS_API_URL`, the simpler deployment is to call the VPS directly from the frontend.

Use this in `lib/mediacrater/scanApiUrl.ts`:

```ts
import { supabase } from '@/lib/mediacrater/supabaseClient';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_VPS_API_URL || '';
```

Then URL scan requests go to:

```txt
${NEXT_PUBLIC_VPS_API_URL}/resolve-url
${NEXT_PUBLIC_VPS_API_URL}/scan-video-url
${NEXT_PUBLIC_VPS_API_URL}/scan-image-url
```

## Web App Changes

### `lib/mediacrater/scanApiUrl.ts`

Purpose:

- Resolve pasted ad URLs.
- Send image/video URL scans to the VPS API.
- Attach Supabase bearer token from the current session.

Expected functions:

```ts
export async function resolveCreativeUrl(url: string) {
  const response = await fetch(`${API_BASE_URL}/resolve-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error('Could not resolve URL.');
  }

  return response.json();
}
```

```ts
export async function scanVideoUrl(
  sourceUrl: string,
  platform: string,
  scanType: string,
  profile: unknown,
  analyzeAudio: boolean
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch(`${API_BASE_URL}/scan-video-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({
      sourceUrl,
      platform,
      scanType,
      profile,
      analyzeAudio,
    }),
  });

  if (!response.ok) {
    throw new Error('Video URL scan failed.');
  }

  return response.json();
}
```

```ts
export async function scanImageUrl(
  sourceUrl: string,
  platform: string,
  scanType: string,
  profile: unknown
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch(`${API_BASE_URL}/scan-image-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({
      sourceUrl,
      platform,
      scanType,
      profile,
    }),
  });

  if (!response.ok) {
    throw new Error('Image URL scan failed.');
  }

  return response.json();
}
```

### `components/scan-workspace.tsx`

Purpose:

- Add URL input flow.
- Make the URL input visually clear.
- Prevent URL input clicks from opening the file picker.
- On URL detection, show the rest of the scan component below it.
- Use a temporary low-resolution thumbnail for video URLs when available.
- Read `scan_url` from the dashboard query string.
- Disable audio analysis for URL scans.

Important fix:

```tsx
const selectedVideoIsUrl =
  selectedVideoCreative?.kind === 'video_url';
```

For URL video scans, force audio analysis off:

```tsx
await scanVideoUrl(
  creative.previewUrl,
  creative.platform,
  creative.scanType,
  profile,
  false
);
```

The audio option should be disabled for URL scans:

```tsx
disabled={!canAnalyzeAudio || selectedVideoIsUrl}
```

Recommended label state:

```tsx
canAnalyzeAudio && !selectedVideoIsUrl
  ? 'border-border cursor-pointer'
  : 'border-border opacity-60 cursor-not-allowed'
```

Recommended helper text:

```tsx
{selectedVideoIsUrl
  ? 'Audio analysis is only available for uploaded video files right now.'
  : canAnalyzeAudio
    ? 'Audio will be extracted and included in the compliance scan.'
    : 'File upload only.'}
```

### `app/dashboard/page.tsx`

Purpose:

- Detect unauthenticated extension URL scans.
- Redirect to sign in with a reason code.
- Preserve the explanation path instead of silently dropping the query string.

Add after `const searchParams = useSearchParams();`:

```tsx
const getSigninRedirectUrl = () => {
  const scanUrl =
    searchParams.get('scan_url');

  return scanUrl
    ? '/signin?reason=scan_login_required'
    : '/signin';
};
```

Use it inside the initial auth check:

```tsx
if (!session) {
  router.replace(getSigninRedirectUrl());
  return;
}
```

Use it inside the auth-state listener:

```tsx
if (
  event === 'SIGNED_OUT' ||
  !session
) {
  setUser(null);

  router.replace(
    getSigninRedirectUrl()
  );
}
```

Make sure the effect dependency list includes `searchParams`:

```tsx
}, [router, searchParams]);
```

### `app/signin/page.tsx`

Purpose:

- Show a useful message when someone arrives from an extension scan while logged out.

Add state:

```tsx
const [loginNotice, setLoginNotice] = useState<string | null>(null);
```

Add this effect:

```tsx
useEffect(() => {
  const params = new URLSearchParams(window.location.search);

  if (params.get('reason') === 'scan_login_required') {
    setLoginNotice(
      'You need to be logged in to scan an ad. Please sign in, then go back to the extension and click Scan again.'
    );
  }
}, []);
```

Render above the form:

```tsx
{loginNotice && (
  <div className="mb-5 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-800 dark:text-blue-300">
    {loginNotice}
  </div>
)}
```

## Chrome Extension Changes

The uploaded extension already contains most of the needed handoff logic.

### `utils/config.js`

Confirm `SITE_URL` points at the deployed web app:

```js
export const SITE_URL = 'https://test-website-os8787wpu565renk6lgvpuhp87ic3kfruwf.mediacrater.com';
```

### `background.js`

Existing helper:

```js
function openCreativeInWebApp(url, kind = 'video') {
  if (!url) {
    return { ok: false, error: 'Missing creative URL.' };
  }

  const dashboardUrl = new URL('/dashboard', SITE_URL);
  dashboardUrl.searchParams.set('scan_url', url);
  dashboardUrl.searchParams.set('scan_kind', kind);

  chrome.tabs.create({ url: dashboardUrl.toString() });

  return { ok: true };
}
```

Add a message handler near the existing background message handlers:

```js
if (request?.type === 'MC_OPEN_CREATIVE_IN_WEBAPP') {
  const creativeUrl = request.url || request.video?.url;
  const kind = request.kind || request.video?.kind || 'video';

  const result = openCreativeInWebApp(creativeUrl, kind);
  sendResponse(result);
  return false;
}
```

### `popup.js`

Add helper near the existing URL copy helpers:

```js
async function openSelectedVideoInWebApp(video) {
  try {
    const response = await sendMessage({
      type: 'MC_OPEN_CREATIVE_IN_WEBAPP',
      url: video.url,
      kind: 'video',
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Could not open Mediacrater.');
    }

    setStatus(elements.downloadStatus, 'Opening scan in Mediacrater...', 'success');
  } catch (error) {
    showError('Could not open scan', error.message || 'Please try again.');
  }
}
```

Replace the selected-card `Scan` action:

```js
createCardAction('Scan', () => scanSelectedVideo(video), {
  disabled: !isPaidAccess() || state.scanInProgress,
  title: isPaidAccess() ? 'Run a Meta compliance scan' : 'Paid plan required'
}),
```

With:

```js
createCardAction('Scan', () => openSelectedVideoInWebApp(video), {
  title: 'Open this ad in the Mediacrater dashboard'
}),
```

## VPS API Changes

### `server.js`

Required routes:

```js
app.post('/resolve-url', async (req, res) => {
  // Resolve and validate the submitted URL.
});

app.post('/scan-video-url', authenticateUser, scanVideoUrl);

app.post('/scan-image-url', authenticateUser, scanImageUrl);
```

Make sure route imports exist:

```js
const { scanVideoUrl } = require('./routes/scanVideoUrl');
const { scanImageUrl } = require('./routes/scanImageUrl');
```

If the code uses `handleError`, make sure it is imported from the existing helper module instead of being referenced without an import.

### `helpers.js`

Required helpers:

```js
async function analyzeVideoUrlWithAI(sourceUrl, audioBuffer, policy, options = {}) {
  // Send remote video URL to QwenCloud / model provider.
}
```

```js
async function analyzeImageUrlWithAI(sourceUrl, policy, options = {}) {
  // Send remote image URL to QwenCloud / model provider.
}
```

Current URL video analysis does not extract audio because it passes no local uploaded file through the existing audio extraction flow.

### `routes/scanVideoUrl.js`

Purpose:

- Authenticate user.
- Validate account status.
- Enforce scan rate limits.
- Deduct scan usage.
- Queue or execute remote video URL analysis.
- Log scan metadata.

Important current behavior:

```js
const result = await analyzeVideoUrlWithAI(sourceUrl, null, policy, {
  platform,
  scanType,
  analyzeAudio: false,
});
```

The `null` audio argument means remote URL scans do not currently include extracted audio.

### `routes/scanImageUrl.js`

Purpose:

- Authenticate user.
- Validate account status.
- Enforce scan rate limits.
- Deduct scan usage.
- Queue or execute remote image URL analysis.
- Log scan metadata.

## 2-Minute Video URL Limit

The duration limit should be enforced on the VPS before any expensive model call.

Recommended implementation:

1. Resolve the URL.
2. Probe video metadata server-side.
3. Reject videos longer than 120 seconds.
4. Only then run the scan.

Recommended server constant:

```js
const MAX_URL_VIDEO_DURATION_SECONDS = 120;
```

Recommended rejection response:

```js
return res.status(400).json({
  error: 'URL videos must be 2 minutes or shorter.',
  code: 'URL_VIDEO_TOO_LONG',
  durationSeconds,
  maxDurationSeconds: MAX_URL_VIDEO_DURATION_SECONDS,
});
```

Possible probing options:

| Option | Best for | Notes |
| --- | --- | --- |
| `ffprobe` on VPS | Direct video files and streamable video URLs | Most practical if `ffmpeg` is installed on the VPS. |
| Provider metadata API | Known sources like Meta or YouTube | Cleaner when available, but source-specific. |
| Headless browser metadata | Pages with embedded players | More complex and slower. |

If using `ffprobe`, add a helper like:

```js
async function probeVideoDurationSeconds(sourceUrl) {
  // Run ffprobe with a timeout and return duration in seconds.
}
```

Then in `scanVideoUrl.js`:

```js
const durationSeconds = await probeVideoDurationSeconds(sourceUrl);

if (
  Number.isFinite(durationSeconds) &&
  durationSeconds > MAX_URL_VIDEO_DURATION_SECONDS
) {
  return res.status(400).json({
    error: 'URL videos must be 2 minutes or shorter.',
    code: 'URL_VIDEO_TOO_LONG',
    durationSeconds,
    maxDurationSeconds: MAX_URL_VIDEO_DURATION_SECONDS,
  });
}
```

## URL Audio Analysis Decision

Current answer: do not allow "Analyze Audio Content" for URL scans yet.

Reason:

- The existing uploaded-file video flow can extract audio from a local file.
- The URL flow passes a remote URL to the backend/model.
- No current URL route downloads the video, extracts audio, and passes that audio into the model.

Recommended UX:

```txt
Audio analysis is only available for uploaded video files right now.
```

Future upgrade path:

1. Download the remote video to a temporary server file.
2. Enforce max file size and 2-minute duration first.
3. Extract audio with the existing audio extraction path.
4. Pass extracted audio into the same scan logic used by uploads.
5. Delete temporary files after completion or failure.

## Commands Run During Diagnosis

These were run against the uploaded files and scratch copies during the implementation review:

```bash
unzip "MEDIACRATER ALPHA V 2.0.0 - chatgpt.zip" -d extension-inspect
```

```bash
find extension-inspect -maxdepth 3 -type f
```

```bash
rg -n "chrome.tabs.create|SITE_URL|scan_url|Scan|scanSelectedVideo|background|sendMessage" extension-inspect
```

```bash
sed -n '1,220p' extension-inspect/MEDIACRATER\ ALPHA\ V\ 2.0.0/background.js
```

```bash
sed -n '1,220p' extension-inspect/MEDIACRATER\ ALPHA\ V\ 2.0.0/utils/config.js
```

```bash
sed -n '1,260p' extension-inspect/MEDIACRATER\ ALPHA\ V\ 2.0.0/popup.js
```

```bash
file "upload/Pasted text(20260929-203634).txt"
```

```bash
wc -l "upload/Pasted text(20260929-203634).txt"
```

```bash
rg -n "selectedVideoIsUrl|video_url|Analyze Audio|File upload only|probeVideoDuration|ffprobe|duration|MAX_VIDEO|scanVideoUrl|analyzeAudio" "upload/Pasted text(20260929-203634).txt"
```

```bash
node --check patched-files/server.js
```

```bash
node --check patched-files/helpers.js
```

```bash
node --check patched-files/routes/scanVideo.js
```

```bash
node --check patched-files/routes/scanImageUrl.js
```

```bash
node --check patched-files/routes/scanVideoUrl.js
```

```bash
zip -r mediacrater-url-scan-patched-files-v2.zip patched-files
```

## Deployment Checklist

1. Deploy the VPS API updates.
2. Confirm the VPS exposes:
   - `/resolve-url`
   - `/scan-video-url`
   - `/scan-image-url`
3. Confirm CORS allows the deployed web app origin.
4. Confirm `NEXT_PUBLIC_VPS_API_URL` is set in the web app deployment.
5. Deploy the web app changes.
6. Confirm the dashboard accepts `scan_url`:
   ```txt
   /dashboard?scan_url=https%3A%2F%2Fexample.com%2Fvideo.mp4&scan_kind=video
   ```
7. Confirm logged-out users are redirected to:
   ```txt
   /signin?reason=scan_login_required
   ```
8. Confirm the sign-in page shows:
   ```txt
   You need to be logged in to scan an ad. Please sign in, then go back to the extension and click Scan again.
   ```
9. Update extension `SITE_URL` if the web app URL changed.
10. Apply the extension background and popup changes.
11. Reload the extension in Chrome.
12. Test the extension Scan button from a supported ad creative.

## Verification Checklist

| Test | Expected result |
| --- | --- |
| Paste URL into dashboard while logged in | URL resolves and scan options appear below the URL box. |
| Click URL input | File explorer does not open. |
| Extension Scan while logged in | New tab opens dashboard with `scan_url` populated. |
| Extension Scan while logged out | User lands on sign-in page with scan guidance message. |
| URL video scan | Audio option is disabled. |
| Uploaded video scan | Audio option remains available when plan allows it. |
| URL longer than 2 minutes | Should be rejected once backend duration check is added. |
| Missing/invalid URL | User sees a clear error instead of a silent failure. |

## Known Issues And Follow-Up

- The current URL scan flow does not extract remote video audio.
- The 2-minute URL duration check still needs server-side implementation.
- If the web app still tries `/api/mediacrater/resolve-url`, `scanApiUrl.ts` has not been updated to use `NEXT_PUBLIC_VPS_API_URL`.
- If the sign-in notice does not show, the dashboard redirect is probably still using `router.push('/signin')` somewhere and stripping the `reason` query param.
- If the URL input still opens the file picker, the URL input or its wrapper needs `e.stopPropagation()` on click/pointer events.

## Rollback Notes

To roll back safely:

1. Revert the extension Scan action to `scanSelectedVideo(video)`.
2. Remove or ignore `scan_url` handling in the dashboard.
3. Leave the VPS URL routes deployed if unused; they are isolated endpoints.
4. Keep the sign-in notice logic if desired, since it is harmless without `reason=scan_login_required`.

