# Deep Scan Fix: 250-Image Limit, Thinking Mode, Cloudflare Timeout Recovery, LIVE→TEST Imports & Friendly Errors

| | |
|---|---|
| **Date** | 9 October 2026 (`09oct26`) |
| **Destination** | changelogs/server |
| **Conversation** | https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d |
| **Related prior work** | `security-review-phase1-vps-lockdown-07oct26.md` (scan routes, `server.js` 280 s timeout)<br>`security-review-phase2-headers-csp-08oct26.md` (Cloudflare in front of the site) |
| **Stack** | VPS API (`helpers.js`, `routes/scanVideo.js`, `routes/scanVideoUrl.js`, PM2), QwenCloud (DashScope `compatible-mode`, `VIDEO_MODEL` = `qwen3.7-flash`), Cloudflare, Next.js web app (`lib/mediacrater/dissector.ts`, `scanApi.ts`, `scanApiUrl.ts`, `scanRecovery.ts`) |
| **Starting trigger** | A new paying customer's deep scan failed: `QwenCloud API failed: 400 (video scan) {"error":{"message":"Exceeded limit on max data-uri per request: 250"…}}` |

> **Redaction note:** no secrets, keys, IP addresses, user IDs or email addresses are included. The QwenCloud key is read from `.env` in the commands and never printed.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied (expected output is given). ⏳ = open.

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
9. [Appendix A – Deployment runbook (as applied)](#appendix-a--deployment-runbook-as-applied)
10. [Appendix B – `apply-deep-thinking.js` (final)](#appendix-b--apply-deep-thinkingjs-final)
11. [Appendix C – `lib/mediacrater/scanRecovery.ts` (final)](#appendix-c--libmediacraterscanrecoveryts-final)
12. [Appendix D – Other code changes](#appendix-d--other-code-changes)
13. [Appendix E – Verification and troubleshooting commands](#appendix-e--verification-and-troubleshooting-commands)
14. [Appendix F – Rollback](#appendix-f--rollback)

---

## 1. Summary

**Deep scans now send the same frames as a regular scan and use the model's thinking mode.** Long deep scans no longer show "Failed to fetch", and LIVE no longer runs TEST's code. Works for video files and video URLs on TEST and LIVE.

**Main outcomes**

- **Root cause:** deep scans took a frame every **0.125 s**, so a 2-minute video produced ~968 frames, over QwenCloud's limit of **250 images per request**. Any deep scan of a video longer than ~31 s failed. The customer wasn't charged: deductions only happen after a successful analysis.
- **Server cap:** `scanVideo.js` thins frames evenly to **240** (keeping the first and last) before calling the AI, whatever the client sends.
- **Option A:**
  - **Deep = regular frames + thinking.** `dissector.ts` takes a frame every 0.5 s for both scan types.
  - **Thinking is on only for deep scans:** `enable_thinking: true`, `thinking_budget: 3000`, streamed, with a 250 s timeout and no silent fallback.
  - **Payload limit:** deep scans now use 6 MB, the same as regular.
- **Reasoning is discarded:** it's counted for a log line and never stored, logged or shown.
- **Cloudflare cuts requests at 100 s.** The first real deep scan took ~200 s; the server finished, charged and saved it, but the browser showed "Failed to fetch". The web app now waits for the saved scan (`scanRecovery.ts`) and shows it normally.
- **LIVE was importing TEST's code:** all four LIVE scan routes had `require('../../mediacrater-api-test/…')`. Fixed.
- **Friendly messages for lost connections:** scans show "Something went wrong on our end. If scans were deducted, your result should be in your Scan History (paid plans)…"; non-scan requests show "We couldn't reach our servers…". Image scans got the same recovery.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| 240-frame cap (`scanVideo.js`) | ✅ TEST + LIVE | |
| Thinking mode (`helpers.js` via `apply-deep-thinking.js`, budget 3000, 250 s) | ✅ TEST + LIVE | TEST was first patched with an earlier script version, then restored and re-patched with the final one |
| Thinking for deep URL scans (`scanVideoUrl.js`) | ✅ | |
| `dissector.ts` deep interval 0.5 s | ✅ | Your 158-frame log for a ~79 s video confirms it |
| Deep Scan description updated | ⚠️ Not confirmed | Expected: the new text under "Deep Scan" |
| Recovery after Cloudflare's 100 s cut (`scanRecovery.ts`, `scanApi.ts`, `scanApiUrl.ts`) | ✅ "Works exactly as described, both URLs and video" | |
| Friendly lost-connection messages + image-scan recovery | ✅ "This works" | |
| LIVE imports fixed (4 route files) | ✅ Part of the LIVE rollout | Expected `grep` output: nothing |
| Regular scans don't think | ⚠️ Not confirmed | Expected: `reasoning_tokens` absent or 0 for regular scans |
| Clean-up of backups and the patch script | ⚠️ Not confirmed | Expected: no `.bak-deep*` files or `apply-deep-thinking.js` on either server |
| VS Code "update imports on file move" set to never | ⚠️ Not confirmed | |
| Chrome extension deep scans | ⏳ Unknown | If it offers them: dense frames (capped by the server) and no recovery logic |
| Real deep-scan durations at budget 3000 | ⏳ Measure | First data point: ~200 s at budget 4000 |

---

## 3. Starting point

- `dissector.ts`: `regular: { interval: 0.5 }`, `deep: { interval: 0.125 }`.
- `scanVideo.js`: accepts up to 250 frames (regular) or 1000 (deep); `helpers.optimizeFramePayload` allowed 25 MB for deep, 6 MB for regular.
- `helpers.js`: every request sends `enable_thinking: false`; non-streamed; `max_tokens: 8000` for video.
- Requests go browser → Cloudflare → nginx → Express (`connect-timeout` 280 s).
- Deep scans cost 2 scans and are paid-plan only. Deductions happen after a successful analysis (`commitScanDeduction`).

---

## 4. Timeline: what we did, in order

### Step 1 – Diagnosis and hotfix

The 0.125 s interval explained the 400 error. A 240-frame cap was added to `scanVideo.js` right away (it logs `[scan-video] deep scan: N frames received, 240 sent to the AI`).

### Step 2 – Your idea: deep scan = thinking

Your proposal was to enable thinking on the same frames as a regular scan. I compared two options:
- **A:** your idea (same frames + thinking)
- **B:** thinking plus denser frames while they fit under the limit

**B** would keep the old "fast cuts" promise for short ads. **You chose A** for simplicity. That meant the Deep Scan copy had to change, since it promised to catch violations "hidden in fast cuts".

### Step 3 – Copy review

Your draft: "Thinking mode: Twice the cost but 3x to 6x slower. Send us hard to work to find violations not picked up by Regular scans." My notes on it:
- "but" should be "and" (both are downsides)
- "3x to 6x" isn't measured yet
- "Send us hard to work" doesn't read correctly
- "not picked up by" promises a result; "can catch" is accurate

Suggested:
> Costs 2 scans and takes longer. We analyze your ad more carefully, step by step, to catch subtler issues a Regular scan can miss.

### Step 4 – Does the model support thinking?

| Test | Result |
|---|---|
| `curl` with a 1×1 PNG | `400 … [height:1 or width:1 must be larger than 10]`: my test image was too small |
| `curl` with a 32×32 PNG | `"content":"Red"`, `"reasoning_content":"…"`, `reasoning_tokens: 176`: thinking works, and doesn't require streaming |

### Step 5 – Response formats

The first log you found was from **OpenRouter** (`"provider":"Alibaba"`, `gen-…` ID, a `reasoning` field). QwenCloud uses `reasoning_content`. The final patch accepts both. The answer's ` ```json ` wrapper is already stripped by your `parseAIResponse`.

### Step 6 – Store the reasoning?

Decision: **discard it, never show it.**
- It quotes your prompt's rules word for word, so storing it anywhere users can read (e.g. the `scans` table) would leak your prompt engineering.
- Discarding means nothing to secure, size-limit or cover in the privacy policy.
- For tuning, read it from your own test scans.

Your 30 September regular-scan log contained `reasoning_content`, so regular scans thought by default before `enable_thinking: false` was sent. That's worth confirming now (§7).

### Step 7 – First real deep scan: "Failed to fetch"

```
✓ Validation passed: 158 frames
Initial payload: 4.18MB (limit: 6MB)
[THINKING] video scan, thinking: reasoning 15188 chars, answer 1604 chars, finish stop {"completion_tokens":4394,…"reasoning_tokens":4000…,"prompt_tokens":79147,…"image_tokens":71100…}
✓ Video analysis complete
```

It took ~200 s. Cloudflare closes requests with no response after **100 s** (error 524, without CORS headers → "Failed to fetch"). The scan was saved and charged, but the user saw a failure, and could retry and pay again.

Fixes:
- **Web:** `scanRecovery.ts` polls the user's own `scans` row by the scan ID the page generated (every 5 s, up to 6 min) and returns it like a normal response. It's wired into `scanVideo`, `scanVideoUrl` and `scanImageUrl`.
- **Server:** the budget drops from 4000 to **3000** tokens (the scan had used the full 4000), and the timeout rises from 200 s to **250 s**.

Raising Cloudflare's 100 s limit needs the Enterprise plan; finishing under 100 s would need too little thinking.

### Step 8 – LIVE was running TEST's code

`grep` found `require('../../mediacrater-api-test/…')` in LIVE's `scanVideo.js`, `scanVideoUrl.js`, `scanImage.js` and `scanImageUrl.js`. The likely cause is VS Code rewriting imports when files are dragged between folders. Fixed by replacing the two video routes and running `sed` on the two image routes.

### Step 9 – Your file comparison

You pasted your current `scanApi.ts` and `scanApiUrl.ts`. They matched the bases exactly; I listed every intended difference for the **Preview changes** check.

### Step 10 – Friendly error messages

Your idea: replace "Failed to fetch" with a generic message pointing to Scan History. Adjusted:
- only for **lost connections** (real server errors keep their own messages)
- "scans", not "tokens"
- "(paid plans)" plus support as the alternative
- a separate message for non-charging requests (e.g. checking a pasted URL)

Image scans also got recovery.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | `Exceeded limit on max data-uri per request: 250` | 0.125 s frame interval → up to ~968 frames | 240-frame cap; 0.5 s interval for deep |
| 2 | `curl`: image must be larger than 10 px | My 1×1 test image | 32×32 image |
| 3 | Reasoning field named differently | OpenRouter `reasoning` vs QwenCloud `reasoning_content` | Both accepted |
| 4 | LIVE scan routes imported TEST modules | VS Code import rewriting on file move (likely) | New route files + `sed`; VS Code setting |
| 5 | TEST was patched with the earlier script version | Applied before the update | Restored from the backup and re-patched |
| 6 | "Failed to fetch" after a successful, charged deep scan | Cloudflare's 100 s cut-off (524) | `scanRecovery.ts` |
| 7 | `reasoning_tokens` = 4000 exactly | The budget was fully used | Budget 3000 (shorter, predictable) |
| 8 | ~200 s scan vs 200 s timeout | Too tight | 250 s timeout |
| 9 | Regular scans thought in September | `qwen3.7-flash` thinks by default when `enable_thinking` isn't sent | Now `false`; confirm with the log check |

---

## 6. Corrections / important decisions

1. **Option A** (your choice). Deep Scan's description no longer promises catching fast cuts.
2. **Server-side frame cap kept permanently**, as a guard against any client.
3. **Thinking requests are streamed** (tested, keeps the connection active), though not required by the model.
4. **No silent fallback:** if thinking fails, the scan fails uncharged rather than running a regular analysis at the deep price.
5. **Discard reasoning.**
6. **Recover on the client** rather than changing infrastructure.
7. **Friendly messages only for connection-level failures.**

**Known limits:**
- Cloudflare still cuts the HTTP request at 100 s; recovery depends on the scan being saved under the page's scan ID.
- Scan History is paid-only, so free users who lose a connection rely on recovery or support.
- Deep scans cost more in API fees (reasoning tokens are billed as output).

---

## 7. Open items checklist

- [ ] Regular scans don't think: `pm2 logs mediacrater-api --lines 200 --nostream | grep '"reasoning_tokens"' | tail -1` after a regular scan. Expected: no output or `0`
- [ ] Clean up both servers (Appendix A, Part 7)
- [ ] VS Code: "update imports on file move" → never (JavaScript and TypeScript)
- [ ] Chrome extension: send its frame-extraction and scan code if it offers deep scans
- [ ] Measure deep-scan durations for a week, then add a real number to the Deep Scan copy if you want one
- [ ] Phase 5: check the rest of the app for raw messages like "Failed to fetch"

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Frame interval (both scan types) | 0.5 s (`dissector.ts`) |
| Server frame cap | 240 (`MAX_FRAMES_PER_REQUEST`, `scanVideo.js`) |
| Payload limit | 6 MB for both (`optimizeFramePayload`) |
| Thinking | Deep scans only; `enable_thinking: true`, `thinking_budget: 3000`, streamed (`stream_options.include_usage`) |
| Thinking timeout | 250 s (`THINKING_REQUEST_TIMEOUT_MS`) |
| Express request timeout | 280 s (`connect-timeout`) |
| Cloudflare limit | 100 s (524) |
| Recovery | Poll `scans` (`status`, `generated_data`, `tokens_remaining`) every 5 s for up to 6 min |
| Log line | `[THINKING] <video scan / video URL scan>, thinking: reasoning N chars, answer N chars, finish <reason> <usage>` |
| Messages | `SCAN_LOST_MESSAGE`, `CONNECTION_LOST_MESSAGE` (`scanRecovery.ts`) |
| First measurement | 158 frames, 79,147 prompt tokens (71,100 image), 4,394 completion tokens (4,000 reasoning), ~200 s at budget 4000 |

---

## Appendix A – Deployment runbook (as applied)

Order: **VPS before web app** (otherwise deep scans briefly send regular frames to a server that doesn't think yet).

### Part 1 – TEST VPS

```bash
cd /var/www/mediacrater-api-test
cp routes/scanVideo.js routes/scanVideo.js.bak-deep
cp routes/scanVideoUrl.js routes/scanVideoUrl.js.bak-deep
# replace routes/scanVideo.js and routes/scanVideoUrl.js; add apply-deep-thinking.js next to helpers.js
node apply-deep-thinking.js          # five ✓ lines, then "Done. Backup: helpers.js.bak-deepthinking"
node --check helpers.js && node --check routes/scanVideo.js && node --check routes/scanVideoUrl.js && echo "syntax OK"
diff helpers.js.bak-deepthinking helpers.js
grep -n "THINKING_BUDGET = \|REQUEST_TIMEOUT_MS = " helpers.js   # 3000 and 250000
grep -rn "\.\./\.\./mediacrater-api" /var/www/mediacrater-api-test --include=*.js --exclude-dir=node_modules   # no output
pm2 restart mediacrater-api-test
pm2 logs mediacrater-api-test --lines 20 --nostream
```

To re-apply over an earlier patch: `cp helpers.js.bak-deepthinking helpers.js && rm helpers.js.bak-deepthinking`, then run the script again.

### Part 2 – TEST web app

1. `lib/mediacrater/dissector.ts`: `deep: { interval: 0.5 }` (plus a 4-line comment).
2. `components/scan-workspace.tsx`: replace the Deep Scan description.
3. Create `lib/mediacrater/scanRecovery.ts`; replace `scanApi.ts` and `scanApiUrl.ts`.
4. Wait for **Ready**.

### Part 3 – Tests

| Test | Expected |
|---|---|
| Deep scan, 60+ s video | "Analyzing" continues past 100 s, then the result appears; Network tab shows the `scan-video` request failing at ~100 s (expected) |
| Its log | `[THINKING] video scan, thinking: …` with `reasoning_tokens` ≤ 3000 |
| Charge | 2 scans, once |
| Regular scan | 1 scan, no `[THINKING]` line |
| Deep URL scan | Result shown; `[THINKING] video URL scan…` |
| DevTools → Network → **Offline**, paste a URL, **Add URL** | "We couldn't reach our servers…" |

### Part 4 – LIVE VPS (imports fixed first)

```bash
cd /var/www/mediacrater-api
for f in scanVideo scanVideoUrl scanImage scanImageUrl; do cp routes/$f.js routes/$f.js.bak-deep; done
# replace routes/scanVideo.js and routes/scanVideoUrl.js with the new files
sed -i "s#require('../../mediacrater-api-test/routes/_shared/#require('./_shared/#g; s#require('../../mediacrater-api-test/#require('../#g" \
  routes/scanImage.js routes/scanImageUrl.js
grep -rn "mediacrater-api-test" /var/www/mediacrater-api --include=*.js --exclude-dir=node_modules   # no output
node apply-deep-thinking.js
node --check helpers.js && for f in scanVideo scanVideoUrl scanImage scanImageUrl; do node --check routes/$f.js; done && echo "syntax OK"
pm2 restart mediacrater-api
pm2 logs mediacrater-api --lines 30 --nostream
```

### Part 5 – LIVE web app

Same as Part 2 in the LIVE repo.

### Part 6 – LIVE tests

Part 3 on LIVE, plus one regular image scan and one image URL scan (their imports changed).

### Part 7 – Clean-up

```bash
for d in /var/www/mediacrater-api-test /var/www/mediacrater-api; do
  rm -f "$d/apply-deep-thinking.js" "$d/helpers.js.bak-deepthinking" "$d"/routes/*.bak-deep
done
```

---

## Appendix B – `apply-deep-thinking.js` (final)

```js
// apply-deep-thinking.js
//
// One-time patch for helpers.js (Option A: Deep scan = same frames as a
// Regular scan + the model's thinking mode). Run it from the API folder:
//
//   node apply-deep-thinking.js
//
// It edits helpers.js in place with exact, single-line anchors, so every
// prompt and all other code stay byte-for-byte identical. If any anchor is
// missing or appears more than once, it stops WITHOUT writing anything.
// A backup is saved as helpers.js.bak-deepthinking.

'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'helpers.js');
const backup = `${file}.bak-deepthinking`;

if (!fs.existsSync(file)) {
  console.error('helpers.js not found. Run this from the API folder (e.g. /var/www/mediacrater-api-test).');
  process.exit(1);
}

let src = fs.readFileSync(file, 'utf8');

if (src.includes('completeWithOptionalThinking')) {
  console.error('helpers.js is already patched. Nothing to do.');
  process.exit(1);
}

const THINKING_BLOCK = `// ── Deep scan thinking mode ───────────────────────────────────
// Deep scans send the same frames as a Regular scan, with the model's
// thinking (reasoning) mode on. Thinking requests are streamed: QwenCloud
// only allows thinking on streamed responses for some models, and streaming
// works for all of them. The reasoning is only counted for the log line;
// it is never stored, logged or returned to users.
//
// Timing (first real deep scan, 158 frames): 4,000 reasoning tokens took
// ~200 s. 3,000 keeps a typical deep scan near 2.5 minutes, and the 250 s
// limit leaves room inside the server's 280 s request timeout. The browser
// connection is cut by Cloudflare at 100 s regardless; the web app then
// picks up the saved result (lib/mediacrater/scanRecovery.ts).
const DEEP_SCAN_THINKING_BUDGET = 3000;    // max reasoning tokens
const THINKING_REQUEST_TIMEOUT_MS = 250000; // stays inside the 280 s request timeout

async function fetchQwenCloudStream(requestBody, qwenCloudConfig, contextLabel) {
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    const response = await fetch(qwenCloudConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': \`Bearer \${qwenCloudConfig.apiKey}\`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({ ...requestBody, stream: true, stream_options: { include_usage: true } }),
      signal: AbortSignal.timeout(THINKING_REQUEST_TIMEOUT_MS)
    });

    if (response.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
      await response.body?.cancel().catch(() => {});
      console.log(\`⏳ Rate limited by QwenCloud (\${contextLabel}), retrying in \${RATE_LIMIT_RETRY_DELAY_MS}ms...\`);
      await sleep(RATE_LIMIT_RETRY_DELAY_MS);
      continue;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(\`QwenCloud API failed: \${response.status} (\${contextLabel}) \${errText.substring(0, 300)}\`);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoningChars = 0;
    let finishReason = null;
    let usage = null;
    let streamError = null;

    const handleLine = (rawLine) => {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        return;
      }
      if (event.error) streamError = event.error;
      const choice = event.choices?.[0];
      if (choice?.delta?.content) content += choice.delta.content;
      // QwenCloud sends "reasoning_content"; OpenRouter-style APIs send "reasoning".
      const reasoningPart = choice?.delta?.reasoning_content || choice?.delta?.reasoning;
      if (typeof reasoningPart === 'string') reasoningChars += reasoningPart.length;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (choice?.error) streamError = choice.error;
      if (event.usage) usage = event.usage;
    };

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\\n')) !== -1) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer) handleLine(buffer);

    console.log(
      \`[THINKING] \${contextLabel}: reasoning \${reasoningChars} chars, answer \${content.length} chars, finish \${finishReason}\`,
      usage ? JSON.stringify(usage) : ''
    );

    // Same shape as a non-streamed response, so getResponseError() and the
    // callers work unchanged.
    return {
      choices: [{
        message: { content },
        finish_reason: finishReason,
        ...(streamError ? { error: streamError } : {})
      }],
      usage
    };
  }
  throw new Error(\`QwenCloud error: rate limited after retry (\${contextLabel})\`);
}

// Regular scans: the existing request, unchanged. Deep scans: thinking on,
// streamed. No silent fallback: if thinking fails, the scan fails (and isn't
// charged) instead of quietly running a Regular analysis at the Deep price.
async function completeWithOptionalThinking(requestBody, qwenCloudConfig, contextLabel, thinking) {
  if (!thinking) {
    return fetchQwenCloudCompletion(requestBody, qwenCloudConfig, contextLabel);
  }

  const label = \`\${contextLabel}, thinking\`;
  const aiData = await fetchQwenCloudStream(
    { ...requestBody, enable_thinking: true, thinking_budget: DEEP_SCAN_THINKING_BUDGET },
    qwenCloudConfig,
    label
  );

  const responseError = getResponseError(aiData);
  if (responseError) {
    throw new Error(\`QwenCloud error: \${responseError.message || 'unknown error'} (\${label})\`);
  }
  return aiData;
}

`;

const edits = [
  {
    name: 'Deep scans use the same payload size limit as Regular scans',
    find: "const MAX_SIZE_MB = scanType === 'deep' ? 25 : 6;",
    replace: "const MAX_SIZE_MB = 6; // Deep scans now send the same frames as Regular scans",
  },
  {
    name: 'Insert the thinking-mode functions before analyzeWithAI',
    find: 'async function analyzeWithAI(frames, audio, transcript, policy, qwenCloudConfig) {',
    replace: THINKING_BLOCK + 'async function analyzeWithAI(frames, audio, transcript, policy, qwenCloudConfig, options = {}) {',
  },
  {
    name: 'Video scan uses thinking when options.thinking is set',
    find: "const aiData = await fetchQwenCloudCompletion(requestBody, qwenCloudConfig, 'video scan');",
    replace: "const aiData = await completeWithOptionalThinking(requestBody, qwenCloudConfig, 'video scan', options.thinking);",
  },
  {
    name: 'Video URL scan accepts options',
    find: 'async function analyzeVideoUrlWithAI(videoUrl, transcript, policy, qwenCloudConfig) {',
    replace: 'async function analyzeVideoUrlWithAI(videoUrl, transcript, policy, qwenCloudConfig, options = {}) {',
  },
  {
    name: 'Video URL scan uses thinking when options.thinking is set',
    find: "const aiData = await fetchQwenCloudCompletion(requestBody, qwenCloudConfig, 'video URL scan');",
    replace: "const aiData = await completeWithOptionalThinking(requestBody, qwenCloudConfig, 'video URL scan', options.thinking);",
  },
];

for (const edit of edits) {
  const count = src.split(edit.find).length - 1;
  if (count !== 1) {
    console.error(`STOPPED: expected 1 match for "${edit.name}", found ${count}. helpers.js was not changed.`);
    console.error(`Looking for: ${edit.find}`);
    process.exit(1);
  }
}

fs.copyFileSync(file, backup);
for (const edit of edits) {
  src = src.replace(edit.find, () => edit.replace);
  console.log(`✓ ${edit.name}`);
}
fs.writeFileSync(file, src);
console.log(`\nDone. Backup: ${path.basename(backup)}`);
console.log('Check with: node --check helpers.js && diff helpers.js.bak-deepthinking helpers.js');
```

---

## Appendix C – `lib/mediacrater/scanRecovery.ts` (final)

```ts
// lib/mediacrater/scanRecovery.ts
//
// Recovers the result of a scan whose HTTP response never reached the
// browser.
//
// Why: Cloudflare closes any request that takes longer than 100 seconds
// (error 524, sent without CORS headers, so the browser only reports
// "Failed to fetch"). Deep scans with thinking mode can take 2–4 minutes.
// The server keeps working, charges the scan and saves the result to the
// `scans` table under the scanId this page generated. So instead of showing
// "Failed to fetch" (and inviting a paid retry), we wait for that row to
// appear and show it as if the response had arrived.
//
// Reads go through the user's own session and RLS ("Users can view own
// scans"), so this can only ever find the user's own scan.

import { supabase } from './supabaseClient';

const POLL_INTERVAL_MS = 5_000;
const RECOVERY_TIMEOUT_MS = 6 * 60 * 1000; // the server gives up after 280 s

// Shown when a scan's connection is lost and its result can't be recovered.
// Scans are only charged after the analysis succeeds, so a deduction means a
// result exists (Scan History shows it on paid plans).
export const SCAN_LOST_MESSAGE =
  "Something went wrong on our end. If scans were deducted, your result should be in your Scan History (paid plans). If it isn't there, or you need help, please contact support.";

// Shown for non-scan requests (e.g. checking a pasted URL) that can't reach
// the server. Nothing is charged for these.
export const CONNECTION_LOST_MESSAGE =
  "We couldn't reach our servers. Please check your connection and try again. If this keeps happening, please contact support.";

// Statuses a proxy returns when it gave up waiting for the server.
const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 522, 524]);

export interface RecoveredScan {
  queued?: false;
  success: true;
  result: { platform: string; violations: Array<Record<string, unknown>> } & Record<string, unknown>;
  scansRemaining: number;
  maxScans: number;
  plan: string;
  recovered: true;
}

/** fetch() rejects with a TypeError when the connection is lost or blocked. */
export function isLostConnection(error: unknown): boolean {
  return error instanceof TypeError;
}

export function isGatewayTimeout(status: number): boolean {
  return GATEWAY_STATUSES.has(status);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Waits for the scan with this id to be saved, then returns it in the same
 * shape as a successful scan response. Throws a user-facing error if the
 * scan failed on the server or doesn't appear in time.
 */
export async function waitForSavedScan(scanId: string, signal?: AbortSignal): Promise<RecoveredScan> {
  const deadline = Date.now() + RECOVERY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const { data: scan, error } = await supabase
      .from('scans')
      .select('status, generated_data, tokens_remaining')
      .eq('id', scanId)
      .maybeSingle();

    if (!error && scan) {
      if (scan.status === 'completed' && scan.generated_data) {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const { data: profile } = session?.user
          ? await supabase
              .from('profiles')
              .select('plan, scans_remaining, scans_per_month')
              .eq('id', session.user.id)
              .maybeSingle()
          : { data: null };

        return {
          success: true,
          result: scan.generated_data,
          scansRemaining: profile?.scans_remaining ?? scan.tokens_remaining ?? 0,
          maxScans: profile?.scans_per_month ?? 0,
          plan: profile?.plan ?? 'free',
          recovered: true,
        };
      }

      throw new Error('Your scan could not be completed. Please try again.');
    }

    await sleep(POLL_INTERVAL_MS, signal);
  }

  throw new Error(
    "This scan is taking longer than expected. If scans were deducted, your result should appear in your Scan History (paid plans) shortly, so please check there before scanning again. If it doesn't, or you need help, please contact support."
  );
}
```

---

## Appendix D – Other code changes

**`routes/scanVideo.js`** (VPS): the frame cap, and thinking for deep scans:
```js
const MAX_FRAMES_PER_REQUEST = 240;

function capFrameCount(frames, max) {
  if (frames.length <= max) return frames;
  const picked = [];
  const step = (frames.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    picked.push(frames[Math.round(i * step)]);
  }
  return picked;
}
// …
    const optimizedFrames = capFrameCount(
      helpers.optimizeFramePayload(frames, scanType),
      MAX_FRAMES_PER_REQUEST
    );
// …
    const result = await helpers.analyzeWithAI(optimizedFrames, audio, null, policy, qwenCloudConfig, {
      thinking: scanType === 'deep'
    });
```

**`routes/scanVideoUrl.js`** (VPS): `helpers.analyzeVideoUrlWithAI(sourceUrl, null, policy, qwenCloudConfig, { thinking: scanType === 'deep' })`, and imports from `../rateLimiter`, `../errorHandler`, `./_shared/…`, `../utils/probeVideoDuration`.

**`lib/mediacrater/dissector.ts`:**
```ts
const SCAN_CONFIG: Record<ScanType, { interval: number }> = {
  regular: { interval: 0.5 },
  deep: { interval: 0.5 },
};
```

**`lib/mediacrater/scanApi.ts`:**
- import `isGatewayTimeout`, `isLostConnection`, `SCAN_LOST_MESSAGE`, `waitForSavedScan`
- in `scanVideo` and `scanImage`: a `recover` helper (cancelled → rethrow; scan ID → `waitForSavedScan`; otherwise `SCAN_LOST_MESSAGE`)
- the `fetch` wrapped in `try`/`catch`
- gateway statuses (502, 503, 504, 520, 522, 524) → `recover`
- `response.json()` wrapped in `try`/`catch`

**`lib/mediacrater/scanApiUrl.ts`:**
- `postJson` takes `recoverScanId`
- the `recover` helper picks `SCAN_LOST_MESSAGE` for `/scan-*` paths, otherwise `CONNECTION_LOST_MESSAGE`
- the `fetch` is wrapped in `try`/`catch`
- a gateway status, or a successful status with an unreadable body, → `recover`
- `scanVideoUrl` and `scanImageUrl` pass `scanId`

---

## Appendix E – Verification and troubleshooting commands

```bash
# Does the model support thinking? (key read from .env, never printed)
cd /var/www/mediacrater-api-test
set -a; . ./.env; set +a
curl -s https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions \
  -H "Authorization: Bearer $QWENCLOUD_API_KEY" -H "Content-Type: application/json" \
  -d "{\"model\":\"$VIDEO_MODEL\",\"enable_thinking\":true,\"thinking_budget\":500,\"max_tokens\":800,\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42mO4IydHU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAJI2YD30P/0LAAAAAElFTkSuQmCC\"}},{\"type\":\"text\",\"text\":\"What colour is this image? One word.\"}]}]}" | head -c 1500; echo
unset QWENCLOUD_API_KEY
# Expected: "content":"Red" and a "reasoning_content" field

# Thinking on deep scans, and none on regular scans
pm2 logs mediacrater-api --lines 100 --nostream | grep THINKING
pm2 logs mediacrater-api --lines 200 --nostream | grep '"reasoning_tokens"' | tail -1

# Frame cap in action
pm2 logs mediacrater-api --lines 200 --nostream | grep "sent to the AI"

# Nothing in LIVE points at TEST (and vice versa)
grep -rn "mediacrater-api-test" /var/www/mediacrater-api --include=*.js --exclude-dir=node_modules
grep -rn "\.\./\.\./mediacrater-api" /var/www/mediacrater-api-test --include=*.js --exclude-dir=node_modules
```

| Symptom | Likely cause |
|---|---|
| "Failed to fetch" still shown for a deep scan | The page didn't send a scan ID, or the scan ID was rejected (non-UUID or reused), so recovery can't find the row |
| "This scan is taking longer than expected…" | No saved row within 6 minutes (server error or > 280 s) |
| `QwenCloud error: Response was truncated…` | `max_tokens` reached in the answer |
| `QwenCloud API failed: 400 … data-uri` | Frame cap missing (old `scanVideo.js`) |

---

## Appendix F – Rollback

**VPS** (affected folder; `<app>` = `mediacrater-api-test` or `mediacrater-api`):
```bash
cp helpers.js.bak-deepthinking helpers.js
for f in routes/*.bak-deep; do cp "$f" "${f%.bak-deep}"; done
pm2 restart <app>
```
If the backups are already cleaned up, revert by re-deploying the previous web version (which pauses the new deep-scan behaviour on the client) and contact me for the server side.

**Web:** revert the commits in GitHub. Reverting only the web app brings back dense frames; the server's 240-frame cap still prevents the original 400 error.

---

*End of index.  
Conversation: https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d*
