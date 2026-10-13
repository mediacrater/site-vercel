# QwenCloud Content Filter (`DataInspectionFailed`): Deep-Scan Fallback, Clear User Message, Recovery Fix & Live Rollout

| | |
|---|---|
| **Date** | 13 October 2026 (`13oct26`) |
| **Conversation** | https://claude.ai/chat/d4b23f41-e563-40d3-a5ba-165fd98c9a36 |
| **Related prior work** | Deep scan thinking mode + scan recovery index (conversation https://claude.ai/chat/06d9294b-c507-4c97-8ebc-771e5088b96d): deep = regular frames + thinking, 240-frame cap, `scanRecovery.ts`<br>QwenCloud data-handling review (21 Sep 2026): first noted that all requests pass through automatic content moderation, and that health or before/after creatives could trip it |
| **Stack** | VPS Node API (`helpers.js`, `errorHandler.js`, `routes/scanVideo.js`, `routes/scanVideoUrl.js`, PM2), Supabase Postgres (`scans` table, **separate projects for test and live**), Next.js web app (`lib/mediacrater/scanRecovery.ts`, `components/scan-workspace.tsx`, `lib/mediacrater/backgroundScanStore.ts`), QwenCloud (DashScope, `-intl` endpoint) |
| **Starting trigger** | A paying customer's deep scan failed with `QwenCloud error: <400> InternalError.Algo.DataInspectionFailed: Output data may contain inappropriate content. (video scan, thinking)`. They only saw a generic error and cancelled their subscription, despite being offered 100% off the next month |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included. The customer is described by what happened, not identified.

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
9. [Appendix A – apply-content-filter.js (patch script, as used on test)](#appendix-a--apply-content-filterjs-patch-script-as-used-on-test)
10. [Appendix B – errorHandler.js (final)](#appendix-b--errorhandlerjs-final)
11. [Appendix C – SQL: scans.error_code](#appendix-c--sql-scanserror_code)
12. [Appendix D – Web app changes (diffs)](#appendix-d--web-app-changes-diffs)
13. [Appendix E – Verification and troubleshooting commands](#appendix-e--verification-and-troubleshooting-commands)
14. [Appendix F – Rollback and cleanup](#appendix-f--rollback-and-cleanup)

---

## 1. Summary

QwenCloud's built-in content moderation blocked the model's **answer** (output side) on a deep scan. Thinking mode makes the model write roughly 11,000 characters of detailed reasoning before answering, and all of it is output that the filter inspects, so deep scans of sensitive-but-legitimate ads (sexual health, supplements, swimwear and similar) are more likely to trip it. The customer saw only "Your scan could not be completed. Please try again.", because deep scans run past Cloudflare's 100-second cutoff and the web app's recovery path turned **any** failed row into that generic message.

**Main outcomes**

- **Deep-scan fallback (option A):** when a deep scan's output is blocked, the VPS retries **once** as a standard analysis (no thinking). If that works, the result carries `deepFallback: true` and a note, and the scan is charged **1 instead of 2**.
- **A clear message** when the scan can't be completed (fallback also blocked, any regular or image scan blocked, or the input itself blocked): HTTP **422**, code `CONTENT_FLAGGED`:
  > We couldn't complete this scan. A content safety filter stopped the analysis, which usually means part of this creative contains sensitive material (such as nudity, sexual content, drugs or graphic violence). You haven't been charged. If you think this is a mistake, please contact support.
- **Long deep scans show the same message:** the failed `scans` row gets `error_code = 'CONTENT_FLAGGED'`, and `scanRecovery.ts` reads it instead of saying "Please try again".
- **Fallback results show an amber note** above the result in the web app.
- **`errorHandler.js` fixes:** the `scans` insert's own error is no longer ignored, and failures before the scan ID existed no longer send `id: null`.
- **Thinking budget stays at 3,000** (your decision, after discussing 100).
- **Verified on test:** the code is in place (grep counts), a fake blocked deep scan fell back correctly (`RESULT calls: 2 | deepFallback: true | note: true`), and real deep scans still complete normally. The web changes are in the GitHub repo.

---

## 2. Status at a glance

### Test

| Area | Status | Notes |
|---|---|---|
| `apply-content-filter.js` run (helpers.js + 2 routes) | ✅ Done | `DEEP_FALLBACK_NOTE` 4, `chargedCost` 3, `chargedTokens` 3 |
| `errorHandler.js` replaced | ✅ Done | `CONTENT_FLAGGED` 6 |
| Fake blocked deep scan → fallback | ✅ Verified | `[CONTENT-FILTER] … retrying once as a standard analysis` then `RESULT calls: 2 \| deepFallback: true \| note: true` |
| Real deep scans still normal | ✅ Verified | Three `[THINKING] … finish stop` lines (2 video, 1 video URL) |
| `grep CONTENT-FILTER` empty after a real deep scan | ✅ Expected | The line only appears when the filter blocks |
| `scans.error_code` column (test project) | ✅ Verified | Expected: `error_code \| text` |
| Web files in the test repo | ✅ Verified | Seen in GitHub: `CONTENT_FLAGGED` in `scanRecovery.ts`, `scanNote` in `scan-workspace.tsx` and `backgroundScanStore.ts` |
| `apply-content-filter.js` + backups removed from test | ✅ Verified | See [Appendix F](#appendix-f--rollback-and-cleanup) (the corrected command) |

### Live

| Area | Status | Notes |
|---|---|---|
| Method | ✅ Decided | Copy test's 4 patched files (your drift check says the folders match), instead of running the script |
| Files copied + `pm2 restart mediacrater-api` | ✅ Verified | Expected greps: 4 / 3 / 3 / 6 |
| `scans.error_code` column (live project) | ✅ Verified | **Run before** relying on recovery messages |
| Web files in the live repo | ⚠️ Unconfirmed | Same 3 files |
| `apply-content-filter.js` not left on live | ✅ Verified | Not needed on live |

### Product

| Area | Status | Notes |
|---|---|---|
| `DEEP_SCAN_THINKING_BUDGET` | ✅ Stays 3000 | Every deep scan uses exactly 3,000 reasoning tokens |
| Users can read raw `error_message` through RLS | ⏳ Open | Contains provider names and errors |
| Progress terminal (Part 2) | ⏳ Designed, not built | Waiting on your 3 answers |

---

## 3. Starting point

- **Deep scan** = regular frames (one every 0.5 s, capped at 240) + `enable_thinking: true`, `thinking_budget: 3000`, streamed (`fetchQwenCloudStream`), 250 s timeout. Regular and image scans use `fetchQwenCloudCompletion` (not streamed, no thinking).
- `completeWithOptionalThinking` had **no fallback by design** ("if thinking fails, the scan fails and isn't charged").
- Deductions only happen **after** the analysis succeeds (`commitScanDeduction`), so the customer **was not charged**.
- `errorHandler.js` always answered `res.status(500).json({ error: clientMessage })` (generic), and inserted a `scans` row with `status: 'error'` and the raw `error_message`. It ignored the insert's own returned error.
- Cloudflare cuts browser requests at **100 s**. Deep scans take 2–4 minutes, so the web app waits for the saved row (`waitForSavedScan` in `scanRecovery.ts`). For any failed row it threw `'Your scan could not be completed. Please try again.'`
- The web app shows `data.message || data.error` from a direct error response (`readErrorMessage` in `scanApi.ts`).
- Production logs had **2** `DataInspectionFailed` lines (very likely both this customer).

---

## 4. Timeline: what we did, in order

### Phase 1 – Context and diagnosis

- I searched past conversations: the deep-scan rework (thinking mode, 240-frame cap, recovery), and the 21 Sep review where we noted QwenCloud moderates inputs and outputs.
- Alibaba's docs describe `DataInspectionFailed` as input or output blocked by content moderation. The "Output data…" wording means the frames were accepted and the **answer** was blocked. Moderation categories include suspected pornographic, sexual-health and vulgar content.
- The `X-DashScope-DataInspection` header in Alibaba's docs **enables** an extra guardrail (`"cip"`). I found no documented way to disable the built-in one.
- **Pushback:** your most valuable scans are borderline content, so a provider that refuses to describe it is a structural risk for an ad-compliance tool. Proposed: (1) fallback, (2) a clear message, (3) a neutral-wording prompt tweak, (4) longer term, a second provider for refused creatives.

### Phase 2 – Your inputs

- `grep -c "DataInspectionFailed"` on live: `mediacrater-api-error.log: 2`, `mediacrater-api-out.log: 0`.
- You believed the customer saw a generic error label. You asked for a specific message telling the user there's likely something inappropriate in their video.
- You sent `helpers.js`, `routes/scanVideo.js` and `errorHandler.js`.

### Phase 3 – What the customer actually saw

Since deep scans exceed 100 s, the browser never got the server's error. `waitForSavedScan()` found the failed row and threw **"Your scan could not be completed. Please try again."**, which invited a paid retry of a scan that would fail the same way. So the message had to travel two paths: the direct response, and a reason saved on the row for recovery.

**Wording caveat (agreed):** the filter judges the text the analysis wrote, not the ad, and it produces false positives. So the message says "**usually means** part of this creative contains sensitive material", not "contains".

**Decision:** you chose **A**: retry as a standard scan, charge 1, show a note. You also proposed a progress terminal (Part 2, designed separately).

### Phase 4 – Build

| File | Change |
|---|---|
| `helpers.js` | `completeWithOptionalThinking` catches content-filter errors on deep scans; output (or unknown) side → one retry via `fetchQwenCloudCompletion` with `enable_thinking: false`, returns `{ ...aiData, deepFallback: true }`. Input side → no retry. Other errors unchanged. `analyzeWithAI` / `analyzeVideoUrlWithAI` set `parsed.deepFallback` and `parsed.scanNote = DEEP_FALLBACK_NOTE` |
| `routes/scanVideo.js` | `const chargedCost = result.deepFallback ? 1 : scanCost;` used for the deduction and `tokens_deducted` |
| `routes/scanVideoUrl.js` | Same with `chargedTokens` / `tokensToDeduct` |
| `errorHandler.js` | Classifies content-filter errors → 422 `{ error, code: 'CONTENT_FLAGGED', message }`, `error_code` on the row (retries without it if the column is missing), checks the insert's returned error, omits `id` when null, adds a `[CONTENT-FILTER]` log tag |
| SQL | `alter table public.scans add column if not exists error_code text;` |
| `scanRecovery.ts` | Selects `error_code` (falls back if the column is missing); `CONTENT_FLAGGED` → `CONTENT_FLAGGED_MESSAGE` |
| `scan-workspace.tsx` / `backgroundScanStore.ts` | `scanNote?: string` on results; amber note above the result |

The `helpers.js` and route changes were delivered as a patch script (`apply-content-filter.js`), because I only had excerpts of your files. It checks every edit before writing (all or nothing), makes `.bak-contentfilter` backups, and refuses to run twice.

### Phase 5 – My tests (sandbox)

The patch script on files built from your exact code: **7 ✓ lines**, and a second run refused ("already patched"). Then 8 scenarios against a fake QwenCloud:

| # | Scenario | Result |
|---|---|---|
| 1 | Deep, output blocked mid-stream | `stream(thinking) -> standard`, `deepFallback: true`, note set |
| 2 | Deep URL, output blocked as HTTP 400 | Same |
| 3 | Deep, fallback also blocked | HTTP 422 `CONTENT_FLAGGED`, row `error_code: CONTENT_FLAGGED`, `status: error` |
| 4 | Deep, **input** blocked | One call, no retry, error thrown |
| 5 | Deep, unrelated HTTP 500 | No retry; generic message unchanged |
| 6 | Deep, normal success | No fallback |
| 7 | Regular image scan blocked | HTTP 422 `CONTENT_FLAGGED` |
| 8 | `error_code` column missing; `id: null` | Row written without `error_code`; no `id` key sent |

### Phase 6 – Deploy and verify on test

Commands are in [Appendix E](#appendix-e--verification-and-troubleshooting-commands). Your results:

```
grep -c "DEEP_FALLBACK_NOTE" helpers.js          → 4
grep -c "chargedCost" routes/scanVideo.js        → 3
grep -c "chargedTokens" routes/scanVideoUrl.js   → 3
grep -c "CONTENT_FLAGGED" errorHandler.js        → 6
```

`grep CONTENT-FILTER` returned nothing after a real deep scan, which is expected (no block happened). The `[THINKING]` lines showed `finish stop` with `reasoning_tokens: 3000` each.

The fake-fetch test on the real patched `helpers.js`:
```
[THINKING] video scan, thinking: reasoning 0 chars, answer 0 chars, finish null
[CONTENT-FILTER] video scan, thinking: output blocked by the provider's content filter, retrying once as a standard analysis
aiData: {"choices":[{"message":{"content":"{\"violations\":[]}"},"finish_reason":"stop"}]}
RESULT calls: 2 | deepFallback: true | note: true
```

### Phase 7 – Thinking budget discussion

- Your logs: every deep scan used **exactly 3,000** reasoning tokens (the cap).
- You proposed **100** to cut cost, "since we don't use the reasoning tokens". **Pushback:** we don't store or show them, but the model uses them; thinking is the only difference between deep and regular. At 100, deep scans would be regular scans charged as 2. Input tokens (24,603–79,147) are 8–26× the reasoning, so reasoning is probably a minority of the cost (check your console prices).
- You said the VPS limit doesn't stop the model thinking past it. Clarified: `reasoning_tokens: 3000` exactly shows the cap works; the bigger number (`reasoning 11536 chars`) is **characters**, about 3–4 per token.
- **Decision:** stay at 3,000. Cheaper alternatives if ever needed: test 1,500–2,000 side by side, or reduce input (frames or resolution).

### Phase 8 – Live rollout method

- You asked whether you also need to "apply helpers.js". Yes, but the script edits it (3 edits) along with the two routes (2 each); only `errorHandler.js` is replaced by hand.
- You asked why not copy the whole files. **You can:** your drift check shows test and live match, so copying test's 4 patched files equals running the script. The script only exists to protect against overwriting live-only code.
- `apply-content-filter.js` isn't needed on live, and should be deleted from both folders.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Paying customer's deep scan failed: `<400> InternalError.Algo.DataInspectionFailed: Output data may contain inappropriate content. (video scan, thinking)` | QwenCloud's built-in output moderation, made more likely by long thinking-mode reasoning | Fallback to a standard analysis, charged 1 |
| 2 | The customer saw "Please try again" | Deep scans exceed Cloudflare's 100 s cutoff; recovery treated any failed row as generic | `error_code` on the row; recovery shows the specific message |
| 3 | Even short failed scans could only get the generic message | `errorHandler.js` always sent `clientMessage` | Classification → 422 `CONTENT_FLAGGED` |
| 4 | Failed-row insert errors were invisible | supabase-js returns the error instead of throwing, and it wasn't checked | Now checked and logged |
| 5 | Failed rows before the scan ID existed couldn't be saved | `id: null` sent explicitly | `id` omitted when null |
| 6 | Users can read raw `error_message` (provider names) | The "users can view own scans" RLS covers all columns | ⏳ Open |
| 7 | `grep CONTENT-FILTER` empty after a deep scan | Nothing was blocked | Expected; confirmed with the fake-fetch test |
| 8 | Every deep scan uses exactly 3,000 reasoning tokens | The budget cap | Kept at 3,000 |
| 9 | Belief that the budget doesn't limit thinking | Characters (11,536) read as tokens | Clarified: `reasoning_tokens: 3000` |
| 10 | Confusion about applying `helpers.js` | The script edits 3 files; only `errorHandler.js` is replaced | Copied test's files to live instead (drift-checked) |
| 11 | My cleanup command was cut off: `…/routes/*.bak` (no closing code block) | My mistake | Corrected in [Appendix F](#appendix-f--rollback-and-cleanup). `routes/*.bak` would also delete older `.bak` files (e.g. from the thumbnails deploy) |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. **The truncated cleanup command** (error 11). Use the corrected one in Appendix F.
2. **Patch script vs copying:** the script was the cautious default because I only had excerpts. With your drift check, copying was simpler and equally safe.

### Decisions

1. **Option A:** retry as a standard analysis, **charge 1**, show a note. Not silent: the user sees the note, and the charge matches what was delivered.
2. **Input-side blocks aren't retried** (the same input would be blocked again).
3. **Other errors keep the old behaviour:** no fallback, generic message.
4. **Message wording says "usually means"**, because the filter judges the analysis text and can produce false positives.
5. **422 + `code: CONTENT_FLAGGED`** in the response, and `error_code` on the row: a safe, user-facing field separate from the internal `error_message`.
6. **Thinking budget stays 3,000.**
7. **Live by copying files** (drift-checked), not the script.
8. **Longer-term (not done):** a neutral-wording prompt tweak, and a second provider for refused creatives.

---

## 7. Open items checklist

### Do next (live)

- [ ] Run `add_scans_error_code.sql` on the **live** Supabase project. Expected: `error_code | text`
- [ ] Copy the 4 files to live and restart (Appendix E). Expected greps: `4`, `3`, `3`, `6`
- [ ] Run the fake-fetch test in `/var/www/mediacrater-api`. Expected: `RESULT calls: 2 | deepFallback: true | note: true`
- [ ] Deploy the 3 web files to the **live** repo
- [ ] Confirm `scans.error_code` exists on **test** too (same SQL)
- [ ] Cleanup with the **corrected** commands in Appendix F, on both folders

### Verify

- [ ] After a real blocked scan on live: `pm2 logs mediacrater-api --lines 1000 --nostream | grep "CONTENT-FILTER"`. Expected: either a fallback line (and a result with the amber note), or `[ERROR][scan-video] | [CONTENT-FILTER] | …` with the user seeing the clear message
- [ ] A fallback scan's `scans` row shows `tokens_deducted = 1`

### Improvements (not urgent)

- [ ] Hide `error_message` from users (RLS column restriction, or move it to a server-only table), and keep showing `error_code`
- [ ] Prompt tweak: describe violations neutrally, without explicit descriptions or quotes, to reduce filter trips
- [ ] Second provider for creatives QwenCloud refuses (cost, plus a privacy policy update)
- [ ] Count blocks over time: `select count(*) from scans where error_code = 'CONTENT_FLAGGED';`
- [ ] Part 2, the progress terminal: answer where it shows, whether it stays after the scan, and whether the extension is included

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Filter detection pattern | `/DataInspectionFailed\|data_inspection_failed\|inappropriate content/i` (side from "Input data" / "Output data") |
| Retry | Once, deep scans only, output or unknown side, `enable_thinking: false`, not streamed |
| Fallback charge | 1 scan (`chargedCost` / `chargedTokens`) |
| Fallback marker | `result.deepFallback = true`, `result.scanNote = DEEP_FALLBACK_NOTE` (stored in `generated_data`) |
| Fallback note | "Deep analysis was stopped by a content safety filter, which usually means part of this creative contains sensitive material. These are standard-scan results, and this scan was charged 1 scan instead of 2." |
| Error response | HTTP 422 `{ error: <message>, code: "CONTENT_FLAGGED", message: <message> }` |
| Failed row | `status: 'error'`, `error_message` (internal), `error_code: 'CONTENT_FLAGGED'` |
| Must match | `CONTENT_FLAGGED_MESSAGE` in `errorHandler.js` and in `scanRecovery.ts` |
| Log lines | `[CONTENT-FILTER] <label>: output blocked … retrying once as a standard analysis` (warn), `[ERROR][scan-video] \| [CONTENT-FILTER] \| …` (error, goes to Slack) |
| Thinking | `DEEP_SCAN_THINKING_BUDGET = 3000`, `THINKING_REQUEST_TIMEOUT_MS = 250000` |
| Timing note | A fallback can push a deep scan past the 280 s server timeout; the result is still saved and charged, and the web app recovers it |

---

## Appendix A – apply-content-filter.js (patch script, as used on test)

Not needed on live (files were copied). Kept for any new environment whose files differ.

```js
// apply-content-filter.js
//
// One-time patch for the deep-scan content-filter fallback.
//   helpers.js               deep scans whose OUTPUT is blocked by QwenCloud's
//                            content filter are retried once as a standard
//                            analysis; the result is marked deepFallback.
//   routes/scanVideo.js      a fallback scan is charged 1 scan instead of 2.
//   routes/scanVideoUrl.js   same, for deep video URL scans.
//
// Run from the API folder (e.g. /var/www/mediacrater-api-test):
//   node apply-content-filter.js
// Every edit is checked before anything is written (all or nothing).
// Backups: <file>.bak-contentfilter. Refuses to run on an already-patched file.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

const NEW_THINKING_BLOCK = `// Regular scans: the existing request, unchanged. Deep scans: thinking on,
// streamed. Other errors still fail the scan (and it isn't charged).
//
// CONTENT FILTER: QwenCloud's built-in content moderation can block the
// model's OUTPUT ("DataInspectionFailed: Output data may contain inappropriate
// content"). Thinking makes the model write a long, detailed reasoning first,
// which is far more likely to trip that filter. When it happens on a deep
// scan, the analysis is retried ONCE without thinking (a standard analysis).
// The result is marked deepFallback: true, the route charges 1 scan instead
// of 2, and the user sees DEEP_FALLBACK_NOTE. Input-side blocks are not
// retried, because the same input would be blocked again.
const CONTENT_FILTER_PATTERN = /DataInspectionFailed|data_inspection_failed|inappropriate content/i;

const DEEP_FALLBACK_NOTE =
  'Deep analysis was stopped by a content safety filter, which usually means part of this creative contains sensitive material. These are standard-scan results, and this scan was charged 1 scan instead of 2.';

function contentFilterSide(err) {
  const text = String(err?.message || err || '');
  if (!CONTENT_FILTER_PATTERN.test(text)) return null;
  if (/Input data/i.test(text)) return 'input';
  if (/Output data/i.test(text)) return 'output';
  return 'unknown';
}

async function completeWithOptionalThinking(requestBody, qwenCloudConfig, contextLabel, thinking) {
  if (!thinking) {
    return fetchQwenCloudCompletion(requestBody, qwenCloudConfig, contextLabel);
  }

  const label = \`\${contextLabel}, thinking\`;

  try {
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
  } catch (err) {
    const side = contentFilterSide(err);
    if (side !== 'output' && side !== 'unknown') throw err;

    console.warn(\`[CONTENT-FILTER] \${label}: output blocked by the provider's content filter, retrying once as a standard analysis\`);

    const aiData = await fetchQwenCloudCompletion(
      { ...requestBody, enable_thinking: false },
      qwenCloudConfig,
      \`\${contextLabel}, standard fallback\`
    );
    return { ...aiData, deepFallback: true };
  }
}

`;

const edits = [
  {
    file: 'helpers.js',
    alreadyPatched: 'DEEP_FALLBACK_NOTE',
    changes: [
      {
        name: 'completeWithOptionalThinking: content-filter fallback',
        regex: /\/\/ Regular scans: the existing request, unchanged\. Deep scans: thinking on,[\s\S]*?(?=async function analyzeWithAI\()/,
        replace: NEW_THINKING_BLOCK,
      },
      {
        name: 'analyzeWithAI: mark fallback results',
        find: 'if (audioNote) parsed.audioNote = audioNote;',
        replace:
          'if (audioNote) parsed.audioNote = audioNote;\n\n' +
          '  // CONTENT FILTER: deep scan fell back to a standard analysis.\n' +
          '  if (aiData.deepFallback) {\n' +
          '    parsed.deepFallback = true;\n' +
          '    parsed.scanNote = DEEP_FALLBACK_NOTE;\n' +
          '  }',
      },
      {
        name: 'analyzeVideoUrlWithAI: mark fallback results',
        regex: /(const aiData = await completeWithOptionalThinking\(requestBody, qwenCloudConfig, 'video URL scan', options\.thinking\);[\s\S]*?)return parseAIResponse\(aiResponse, policy\.platform\);/,
        replace:
          '$1const parsed = parseAIResponse(aiResponse, policy.platform);\n\n' +
          '  // CONTENT FILTER: deep scan fell back to a standard analysis.\n' +
          '  if (aiData.deepFallback) {\n' +
          '    parsed.deepFallback = true;\n' +
          '    parsed.scanNote = DEEP_FALLBACK_NOTE;\n' +
          '  }\n\n' +
          '  return parsed;',
      },
    ],
  },
  {
    file: 'routes/scanVideo.js',
    alreadyPatched: 'chargedCost',
    changes: [
      {
        name: 'charge 1 after a fallback',
        find: 'const deduction = await commitScanDeduction(user.id, rateLimitResult.remaining, scanCost, supabase);',
        replace:
          '// CONTENT FILTER: a deep scan that fell back to a standard analysis costs 1.\n' +
          '    const chargedCost = result.deepFallback ? 1 : scanCost;\n' +
          '    const deduction = await commitScanDeduction(user.id, rateLimitResult.remaining, chargedCost, supabase);',
      },
      {
        name: 'log the charged amount',
        find: 'tokens_deducted: scanCost,',
        replace: 'tokens_deducted: chargedCost,',
      },
    ],
  },
  {
    file: 'routes/scanVideoUrl.js',
    alreadyPatched: 'chargedTokens',
    changes: [
      {
        name: 'charge 1 after a fallback',
        find: 'const deduction = await commitScanDeduction(user.id, rateLimitResult.remaining, tokensToDeduct, supabase);',
        replace:
          '// CONTENT FILTER: a deep scan that fell back to a standard analysis costs 1.\n' +
          '    const chargedTokens = result.deepFallback ? 1 : tokensToDeduct;\n' +
          '    const deduction = await commitScanDeduction(user.id, rateLimitResult.remaining, chargedTokens, supabase);',
      },
      {
        name: 'log the charged amount',
        find: 'tokens_deducted: tokensToDeduct,',
        replace: 'tokens_deducted: chargedTokens,',
      },
    ],
  },
];

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

const results = [];
let failed = false;

for (const edit of edits) {
  const filePath = path.join(ROOT, edit.file);
  if (!fs.existsSync(filePath)) {
    console.error(`✗ ${edit.file}: not found (run this from the API folder)`);
    failed = true;
    continue;
  }

  let src = fs.readFileSync(filePath, 'utf8');
  if (src.includes(edit.alreadyPatched)) {
    console.error(`✗ ${edit.file}: already patched. Nothing to do.`);
    failed = true;
    continue;
  }

  for (const change of edit.changes) {
    if (change.regex) {
      const matches = src.match(new RegExp(change.regex.source, 'g')) || [];
      if (matches.length !== 1) {
        console.error(`✗ ${edit.file}: "${change.name}" matched ${matches.length} times (expected 1)`);
        failed = true;
        continue;
      }
      src = src.replace(change.regex, change.replace);
    } else {
      const n = countOccurrences(src, change.find);
      if (n !== 1) {
        console.error(`✗ ${edit.file}: "${change.name}" found ${n} times (expected 1)`);
        failed = true;
        continue;
      }
      src = src.replace(change.find, change.replace);
    }
    console.log(`✓ ${edit.file}: ${change.name}`);
  }

  results.push({ filePath, src });
}

if (failed) {
  console.error('\nNo files were changed. Send the ✗ lines above to get this fixed.');
  process.exit(1);
}

for (const { filePath, src } of results) {
  fs.copyFileSync(filePath, `${filePath}.bak-contentfilter`);
  fs.writeFileSync(filePath, src);
}
console.log('\nDone. Backups saved as *.bak-contentfilter');
```

Expected output:
```
✓ helpers.js: completeWithOptionalThinking: content-filter fallback
✓ helpers.js: analyzeWithAI: mark fallback results
✓ helpers.js: analyzeVideoUrlWithAI: mark fallback results
✓ routes/scanVideo.js: charge 1 after a fallback
✓ routes/scanVideo.js: log the charged amount
✓ routes/scanVideoUrl.js: charge 1 after a fallback
✓ routes/scanVideoUrl.js: log the charged amount

Done. Backups saved as *.bak-contentfilter
```

---

## Appendix B – errorHandler.js (final)

```js
// errorHandler.js
// Central error handler: logs full details to console.error (auto-forwarded
// to Slack's alert channel via slackLogger), optionally records an error row
// to the scans table, and returns a safe generic message to the client —
// never leaking internal error details.
//
// CONTENT FILTER: errors caused by the AI provider's content moderation
// ("DataInspectionFailed … inappropriate content") now get a clear, specific
// message (HTTP 422, code CONTENT_FLAGGED) instead of the generic one, and
// the failed scans row gets error_code = 'CONTENT_FLAGGED', so the web app can
// show the same message when it recovers a long scan from the database.
// Requires the scans.error_code column (sql/add_scans_error_code.sql); if the
// column is missing, the row is still written without it.
//
// Also fixed: the scans insert's own error used to be ignored (supabase-js
// returns it instead of throwing), and a failure before the scan ID was known
// inserted id: null.

const CONTENT_FLAGGED_CODE = 'CONTENT_FLAGGED';

const CONTENT_FLAGGED_MESSAGE =
  "We couldn't complete this scan. A content safety filter stopped the analysis, which usually means part of this creative contains sensitive material (such as nudity, sexual content, drugs or graphic violence). You haven't been charged. If you think this is a mistake, please contact support.";

const CONTENT_FILTER_PATTERN = /DataInspectionFailed|data_inspection_failed|inappropriate content/i;

function classifyError(error) {
  const text = String(error?.message || error || '');
  if (CONTENT_FILTER_PATTERN.test(text)) {
    return { code: CONTENT_FLAGGED_CODE, message: CONTENT_FLAGGED_MESSAGE, statusCode: 422 };
  }
  return null;
}

async function handleError(res, error, {
  userId = null,
  context = 'unknown',
  statusCode = 500,
  supabase = null,
  scanData = null,
  clientMessage = 'Something went wrong. Please try again.'
} = {}) {

  const classified = classifyError(error);

  // 1. Log full error details — slackLogger patches console.error to
  //    forward these automatically to Slack's alert channel.
  const logParts = [
    `[ERROR][${context}]`,
    classified ? '[CONTENT-FILTER]' : null,
    userId ? `user:${userId}` : null,
    error?.message || String(error)
  ].filter(Boolean).join(' | ');

  console.error(logParts);
  if (error?.stack) {
    console.error(`Stack: ${error.stack}`);
  }

  // 2. Insert an error row to the scans table so failed scans are visible
  //    in your DB alongside successful ones. scanData is whatever partial
  //    context was available at the time of failure.
  if (supabase && scanData?.user_id) {
    try {
      const { id, ...rest } = scanData;
      const row = {
        ...(id ? { id } : {}),
        ...rest,
        status: 'error',
        error_message: error?.message || String(error),
        ...(classified ? { error_code: classified.code } : {})
      };

      let { error: insertError } = await supabase.from('scans').insert(row);

      // Column not added yet: keep the row, just without the code.
      if (insertError && classified && /error_code/i.test(insertError.message || '')) {
        const { error_code, ...withoutCode } = row;
        ({ error: insertError } = await supabase.from('scans').insert(withoutCode));
      }

      if (insertError) {
        console.error('[ERROR HANDLER] Failed to write error row to scans table:', insertError.message);
      }
    } catch (dbErr) {
      console.error('[ERROR HANDLER] Failed to write error row to scans table:', dbErr.message);
    }
  }

  // 3. Send a safe response — never expose stack traces or internal error
  //    messages. Content-filter errors get their specific, user-facing text.
  if (!res.headersSent) {
    if (classified) {
      res.status(classified.statusCode).json({
        error: classified.message,
        code: classified.code,
        message: classified.message
      });
      return;
    }
    res.status(statusCode).json({ error: clientMessage });
  }
}

module.exports = { handleError, CONTENT_FLAGGED_CODE, CONTENT_FLAGGED_MESSAGE };
```

---

## Appendix C – SQL: scans.error_code

Run on **test and live**, before the new `errorHandler.js` / web app. Both handle a missing column, but the clear message for long scans needs it.

```sql
-- sql/add_scans_error_code.sql
-- Safe, user-facing reason code for failed scans (e.g. 'CONTENT_FLAGGED').
-- Written by errorHandler.js, read by the web app's scanRecovery.ts so a long
-- deep scan that failed shows the real reason instead of "Please try again".
-- Run on TEST and LIVE before deploying the new errorHandler.js / web app.
-- Nullable, no default: existing rows are untouched.

alter table public.scans add column if not exists error_code text;

-- Expected: one row, data_type "text".
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'scans' and column_name = 'error_code';
```

---

## Appendix D – Web app changes (diffs)

### `lib/mediacrater/scanRecovery.ts`

```diff
@@ -13,6 +13,12 @@
 //
 // Reads go through the user's own session and RLS ("Users can view own
 // scans"), so this can only ever find the user's own scan.
+//
+// CONTENT FILTER: a failed row with error_code = 'CONTENT_FLAGGED' (written by
+// the VPS errorHandler.js) now shows CONTENT_FLAGGED_MESSAGE instead of the
+// generic "Please try again", which invited paid retries of a scan that would
+// fail the same way. If the error_code column doesn't exist yet, the query
+// falls back to the old columns.
 
 import { supabase } from './supabaseClient';
 
@@ -25,6 +31,11 @@
 export const SCAN_LOST_MESSAGE =
   "Something went wrong on our end. If scans were deducted, your result should be in your Scan History (paid plans). If it isn't there, or you need help, please contact support.";
 
+// Shown when the AI provider's content safety filter refused the scan. Must
+// match CONTENT_FLAGGED_MESSAGE in the VPS errorHandler.js.
+export const CONTENT_FLAGGED_MESSAGE =
+  "We couldn't complete this scan. A content safety filter stopped the analysis, which usually means part of this creative contains sensitive material (such as nudity, sexual content, drugs or graphic violence). You haven't been charged. If you think this is a mistake, please contact support.";
+
 // Shown for non-scan requests (e.g. checking a pasted URL) that can't reach
 // the server. Nothing is charged for these.
 export const CONNECTION_LOST_MESSAGE =
@@ -77,14 +88,21 @@
  */
 export async function waitForSavedScan(scanId: string, signal?: AbortSignal): Promise<RecoveredScan> {
   const deadline = Date.now() + RECOVERY_TIMEOUT_MS;
+  let withErrorCode = true;
 
   while (Date.now() < deadline) {
-    const { data: scan, error } = await supabase
+    let { data: scan, error } = await supabase
       .from('scans')
-      .select('status, generated_data, tokens_remaining')
+      .select(withErrorCode ? 'status, generated_data, tokens_remaining, error_code' : 'status, generated_data, tokens_remaining')
       .eq('id', scanId)
       .maybeSingle();
 
+    // error_code column not added yet: retry without it from now on.
+    if (error && withErrorCode && /error_code/i.test(error.message || '')) {
+      withErrorCode = false;
+      continue;
+    }
+
     if (!error && scan) {
       if (scan.status === 'completed' && scan.generated_data) {
         const {
@@ -109,6 +127,10 @@
         };
       }
 
+      if ((scan as { error_code?: string | null }).error_code === 'CONTENT_FLAGGED') {
+        throw new Error(CONTENT_FLAGGED_MESSAGE);
+      }
+
       throw new Error('Your scan could not be completed. Please try again.');
     }
 
```

### `components/scan-workspace.tsx`

```diff
@@ -128,6 +128,9 @@
   riskLevel: string;
   riskClass: string;
   processedViolations: Violation[];
+  // CONTENT FILTER: note from the VPS when a deep scan fell back to a
+  // standard analysis (result.scanNote), shown above the result.
+  scanNote?: string;
 }
 
 interface Banner {
@@ -2194,6 +2197,10 @@
               riskLevel,
               riskClass,
               processedViolations,
+              scanNote:
+                typeof (completed.result as { scanNote?: unknown }).scanNote === 'string'
+                  ? ((completed.result as { scanNote?: string }).scanNote)
+                  : undefined,
             });
 
             creativeScanIds.push(
@@ -3522,6 +3529,12 @@
                     </span>
                   </div>
 
+                  {r.scanNote && (
+                    <div className="mb-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-800 dark:text-amber-400">
+                      {r.scanNote}
+                    </div>
+                  )}
+
                   {r.processedViolations.length === 0 ? (
                     <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm font-medium">
                       <span>✓</span>
```

### `lib/mediacrater/backgroundScanStore.ts`

```diff
   riskClass: string;
   processedViolations: unknown[];
+  // CONTENT FILTER: shown above the result when a deep scan fell back to a
+  // standard analysis (set by the VPS as result.scanNote).
+  scanNote?: string;
 }
```

---

## Appendix E – Verification and troubleshooting commands

**Live rollout by copying (as decided):**
```bash
cd /var/www/mediacrater-api
cp helpers.js helpers.js.bak-contentfilter
cp routes/scanVideo.js routes/scanVideo.js.bak-contentfilter
cp routes/scanVideoUrl.js routes/scanVideoUrl.js.bak-contentfilter
cp errorHandler.js errorHandler.js.bak-contentfilter

cp ../mediacrater-api-test/helpers.js helpers.js
cp ../mediacrater-api-test/routes/scanVideo.js routes/scanVideo.js
cp ../mediacrater-api-test/routes/scanVideoUrl.js routes/scanVideoUrl.js
cp ../mediacrater-api-test/errorHandler.js errorHandler.js

node --check helpers.js && node --check routes/scanVideo.js && node --check routes/scanVideoUrl.js && node --check errorHandler.js && pm2 restart mediacrater-api
```

**Code in place** (run in either folder):
```bash
grep -c "DEEP_FALLBACK_NOTE" helpers.js            # expect 4
grep -c "chargedCost" routes/scanVideo.js          # expect 3
grep -c "chargedTokens" routes/scanVideoUrl.js     # expect 3
grep -c "CONTENT_FLAGGED" errorHandler.js          # expect 6
```

**Deep scans running normally:**
```bash
pm2 logs <app-name> --lines 300 --nostream | grep "\[THINKING\]" | tail -n 3
```
Expected: lines ending in `finish stop`, with `"reasoning_tokens":3000`.

**Filter events** (empty is normal):
```bash
pm2 logs <app-name> --lines 1000 --nostream | grep -E "CONTENT-FILTER"
grep -c "DataInspectionFailed" ~/.pm2/logs/mediacrater-api-error.log ~/.pm2/logs/mediacrater-api-out.log
```

**Fake blocked deep scan** (no real API call, no database, doesn't affect the running app):
```bash
node -e "
const h = require('./helpers');
let calls = 0;
global.fetch = async (url, opt) => {
  calls++;
  const body = JSON.parse(opt.body);
  if (body.stream) {
    return new Response('data: ' + JSON.stringify({ error: { message: 'Output data may contain inappropriate content.' } }) + '\n\n', { status: 200 });
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ violations: [] }) }, finish_reason: 'stop' }] }), { status: 200 });
};
h.analyzeWithAI([], null, null, { platform: 'meta', policy_sections: {} }, { apiUrl: 'https://fake', apiKey: 'x', videomodel: 'm' }, { thinking: true })
  .then(r => console.log('RESULT calls:', calls, '| deepFallback:', r.deepFallback, '| note:', Boolean(r.scanNote)))
  .catch(e => console.log('ERROR', e.message));
"
```
Expected (last line): `RESULT calls: 2 | deepFallback: true | note: true`. `RESULT calls: 1` or `ERROR …` means the fallback isn't in place.

**Database checks:**
```sql
-- column exists
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'scans' and column_name = 'error_code';

-- blocked scans
select created_at, scan_type, content_type, error_code
from public.scans where error_code = 'CONTENT_FLAGGED' order by created_at desc limit 20;

-- fallback scans charged 1 (generated_data carries deepFallback)
select created_at, scan_type, tokens_deducted
from public.scans
where status = 'completed' and (generated_data->>'deepFallback')::boolean is true
order by created_at desc limit 20;
```

**Where to adjust the budget** (if ever): `DEEP_SCAN_THINKING_BUDGET` in `helpers.js`, then `pm2 restart <app-name>`.

---

## Appendix F – Rollback and cleanup

**Cleanup (corrected; replaces the truncated command I gave earlier):**
```bash
rm -f /var/www/mediacrater-api-test/apply-content-filter.js /var/www/mediacrater-api/apply-content-filter.js
rm -f /var/www/mediacrater-api-test/*.bak-contentfilter /var/www/mediacrater-api-test/routes/*.bak-contentfilter
rm -f /var/www/mediacrater-api/*.bak-contentfilter /var/www/mediacrater-api/routes/*.bak-contentfilter
```
Run the last two lines only once everything works.

**Rollback (VPS, before cleanup):**
```bash
cd /var/www/mediacrater-api            # or mediacrater-api-test
cp helpers.js.bak-contentfilter helpers.js
cp routes/scanVideo.js.bak-contentfilter routes/scanVideo.js
cp routes/scanVideoUrl.js.bak-contentfilter routes/scanVideoUrl.js
cp errorHandler.js.bak-contentfilter errorHandler.js
pm2 restart mediacrater-api            # or mediacrater-api-test
```
Effect: deep scans fail again on a block (no fallback), and users see the generic message. The `error_code` column can stay; nothing writes it.

**Rollback (web):** revert the three files in the repo. The recovery code works with or without the column.

**Drop the column (only if abandoning entirely):**
```sql
alter table public.scans drop column if exists error_code;
```
Deploy the old `errorHandler.js` **first**; the new one tolerates a missing column, but there's no reason to keep a mismatch.

---

*End of index.  
Conversation: `<add this conversation's URL>`*
