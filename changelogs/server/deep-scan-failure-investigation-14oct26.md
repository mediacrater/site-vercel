# Deep-Scan Failures: What Happened to the Paying Customer's Scans, the Fixes You Made, and What Is Still Open

| | |
|---|---|
| **Date** | 14 October 2026 (`14oct26`) |
| **Destination** | changelogs/server |
| **Conversation** | Not available to me. Paste this chat's URL here when you file this. |
| **Related prior work** | `free-plan-abuse-vs-activation-analysis-14oct26.md`<br>`live-api-rollout-and-production-process-audit-14oct26.md`<br>`timestamp-prompt-single-moments-no-ranges-14oct26.md` |
| **Stack** | Node API on the VPS (`routes/scanVideo.js`, `helpers.js`, QwenCloud provider), Supabase `scans` table (read-only SQL on the live database), web app `scan-workspace.tsx` (notice display) |
| **Starting trigger** | Your second paying customer cancelled without saying why. You suspected a deep-scan failure. We checked the `scans` table for what they actually experienced |

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
9. [Appendix A – Queries and results](#appendix-a--queries-and-results)
10. [Appendix B – The customer's scans (redacted)](#appendix-b--the-customers-scans-redacted)
11. [Appendix C – Code notes (your changes and my flags)](#appendix-c--code-notes-your-changes-and-my-flags)

---

## 1. Summary

The customer ran two deep scans and both failed, a few days apart, for two different reasons. Neither was charged. They cancelled about a day after the second one.

**Main outcomes**

- **Failure 1 (Oct 9, 07:24):** `Exceeded limit on max data-uri per request: 250` with **432 frames** sent. Deep scans used to extract a frame every 0.125 s, so any deep scan of a video longer than about 31 seconds failed. That was a bug on your side.
- **Failure 2 (Oct 13, 03:51):** `DataInspectionFailed: Output data may contain inappropriate content. (video scan, thinking)` with **138 frames**. The provider's **output** filter tripped on the model's own reasoning text, which only exists since you turned on thinking mode between the two dates. Your ad's content wasn't the cause.
- **Nobody was charged for either failure.** Balance across the failed rows: the 17 to 16 drop comes from the regular scan that ran right after, not from the failed deep scan.
- **Between Oct 9 and Oct 10 the balance jumped from 1 to 19.** I read that as a purchase (not confirmed). If so, they paid right after the first failure and then hit the second.
- **You had already fixed both causes** before I saw the code: deep scans now use the same 0.5 s frames as regular scans, `capFrameCount` caps a request at 240 images, and a deep scan that trips the content filter falls back to a standard scan that costs 1 token. The web app shows the note (`scanNote`) above the result.
- **The "first scan fails" theory was wrong.** First scans failed for 2 of 40 repeat users and 1 of 31 one-scan users, so failures don't explain the drop-off (`free-plan-abuse-vs-activation-analysis-14oct26.md`).
- Deep scans are barely used: **4 in total**, 2 failed (both this customer's), 2 completed (your own, deleted test accounts).

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| Customer's scans traced | ✅ Done | Appendix B |
| Frame cap hotfix (`capFrameCount`, 240) | ✅ Done | You built it. I read it in the pasted `scanVideo.js` |
| Deep scans use the 0.5 s frame interval | ✅ Done | `SCAN_CONFIG` in `dissector.ts` |
| Thinking mode and content-filter fallback (`deepFallback`, charge 1) | ✅ Done | In `scanVideo.js`. The fallback was already there when I read it |
| Fallback notice shown in the web app | ✅ Verified | `scanNote` amber box in `scan-workspace.tsx` |
| `limits.deep` is still `maxFrames: 1000, maxPayloadMB: 22` | ⏳ Open | Stale. Tighten once no old client sends dense frames |
| `helpers.logScan(...)` runs after the deduction | ⏳ Open | If it throws, the user sees "could not be completed" after being charged. Wrap it in its own try/catch |
| `error_code` is null on failed rows | ⏳ Open | Set codes (for example `payload_limit`, `content_filter`) so failures can be grouped |
| Slack alert when a paid user's scan errors | ⏳ Open | The customer failed twice and you only found out after they left |
| A note to the customer saying what broke | ⏳ Unconfirmed | You said you know what went wrong. Not confirmed sent |

---

## 3. Starting point

- Your explanation of the two churned customers: **customer 1** (earlier in the year) tried a scan as a free user and hit the queue, because a system turned the queue on artificially for each scan, so they were stuck in it indefinitely. They probably paid to raise their priority, and you refunded them. **Customer 2** cancelled most likely because of a deep-scan failure.
- Deep scan = the same frames as a regular scan with the model's thinking mode on, and it costs 2 tokens.
- `scans.tokens_deducted` is null on a failed row because the scan deducts only after a successful result.

---

## 4. Timeline: what we did, in order

### Phase 1 – Does abuse or churn matter more?

While looking at conversion (`free-plan-abuse-vs-activation-analysis-14oct26.md`) you told me the churn reasons. I asked whether first scans fail more often for one-scan users. They don't.

### Phase 2 – The error that was logged

The query in Appendix A found one `DataInspectionFailed` row. I first read it as the AI judging the ad, you corrected me: it came from the model's own reasoning text.

### Phase 3 – The second failure

Counting deep scans showed 4 in total and 2 failed. Listing them showed both failures belonged to one customer and the two completed ones were your deleted test accounts.

### Phase 4 – The customer's whole history

Appendix B shows the sequence and that nothing was charged for the failures. You confirmed you had reduced the frames and turned on thinking mode between Oct 9 and Oct 13.

### Phase 5 – Your server file

You pasted `routes/scanVideo.js`. It already had the frame cap and the fallback. I flagged the stale deep limit, the `logScan` ordering and the missing error codes.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Oct 9 deep scan failed: max 250 images | Deep scans extracted 432 frames (every 0.125 s) | Same 0.5 s frames as regular, plus `capFrameCount` (240) |
| 2 | Oct 13 deep scan failed: `DataInspectionFailed (video scan, thinking)` | Provider output filter on the model's reasoning, after thinking mode was turned on | Fallback to a standard scan (charge 1) with a visible note |
| 3 | `limits.deep` still says 1000 frames | Left from the old dense-frame design | Open |
| 4 | I read the first error as the AI judging the ad | I didn't know it was the provider's output filter | You corrected me |
| 5 | I counted 50% of deep scans as failed | The two completed ones were your own tests | Both failures were one real customer's |
| 6 | The customer's balance rose from 1 to 19 | Probably a purchase (not confirmed) | Informational |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. I wrongly read the content-filter error as the AI judging the customer's ad.
2. I advised against building a content-filter fallback for a single occurrence. It was already built.
3. I called the "50% deep failure rate" a real rate. It was one customer's two scans.
4. I guessed that failed first scans might explain the drop-off. The data disproved it.

### Decisions and recommendations

1. Keep deducting only after success (your existing design).
2. Keep the fallback (a visible note, cost 1 token) instead of retrying silently (your build).
3. Recommended: don't build more retry logic until there's more than a handful of deep scans.
4. Recommended: explain the failures to the customer without a guarantee or an unfulfilled offer.

### Known limits

- Only 4 deep scans exist, so there is no failure rate to speak of.
- `error_code` is null, so failures can't be grouped.
- If the provider's filter keeps tripping on legitimate gore or violence ads, deep scans may fail most on the riskiest ads, the ones customers care about. Too few scans to know.

---

## 7. Open items checklist

- [x] The customer's two failures traced to two causes
- [x] Frame cap and 0.5 s deep frames in place
- [x] Content-filter fallback and notice in place
- [ ] Wrap `helpers.logScan(...)` in its own try/catch (Appendix C) so a logging failure can't turn a charged scan into an error
- [ ] Set `error_code` on the failure paths (for example `payload_limit`, `content_filter`)
- [ ] Add a Slack alert when a paid user's scan ends in an error (your `slackLogger.js` already exists)
- [ ] Tighten `limits.deep` after confirming no old client still sends dense frames
- [ ] Send the customer a short note saying what broke and that it is fixed. Don't offer a credit you won't honor
- [ ] Re-count deep scans and failures after a few weeks

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Provider image limit | 250 images per request |
| Frame cap | `MAX_FRAMES_PER_REQUEST = 240` (`routes/scanVideo.js`) |
| Frame interval | 0.5 s for regular and deep (`dissector.ts`) |
| Deep scan cost | 2 tokens (1 if it fell back to a standard analysis) |
| Failed scans | `status = 'error'`, `tokens_deducted` null |
| Deduction | After a successful result only |

---

## Appendix A – Queries and results

**First-scan failure check** (does the first scan fail more for one-scan users?):

```sql
with first_scan as (
  select distinct on (s.user_id) s.user_id, (s.error_message is not null) as failed
  from scans s join profiles p on p.id = s.user_id
  order by s.user_id, s.created_at
), n as (
  select user_id, count(*) as c from scans group by user_id
)
select (n.c = 1) as one_scan_only, f.failed, count(*)
from first_scan f join n using (user_id)
group by 1, 2 order by 1, 2;
```

```text
one_scan_only | failed | count
false         | false  | 38
false         | true   | 2
true          | false  | 30
true          | true   | 1
```

2 of 40 repeat users versus 1 of 31 one-scan users. No real difference.

**Find the content-filter error:**

```sql
select created_at, error_message from scans
where error_message ilike '%DataInspectionFailed%' or error_message ilike '%inappropriate%'
order by created_at desc limit 20;
```

```text
2026-10-13 03:51:05  QwenCloud error: <400> InternalError.Algo.DataInspectionFailed: Output data may contain inappropriate content. (video scan, thinking)
```

**Columns of `scans`:**

```sql
select column_name from information_schema.columns
where table_name = 'scans' order by ordinal_position;
```

```text
id, created_at, user_id, email, target_platform, scan_type, content_type, tokens_deducted, tokens_remaining, payload_size_mb, frame_count, violations_found, analysis_duration_ms, is_rate_limited, scans_remaining_24h, status, error_message, job_id, origin, generated_data, thumbnail_url, file_name, audio_analysis, feedback_answer, feedback_comment, batched_by_client, batch_id, batch_position, error_code
```

**Deep scans and failures:**

```sql
select count(*) as deep_scans,
       count(*) filter (where error_message is not null) as deep_failed
from scans where scan_type = 'deep';
```

```text
deep_scans 4, deep_failed 2
```

**All deep scans:**

```sql
select id, created_at, user_id, scan_type, status, error_message, tokens_deducted, tokens_remaining
from scans where scan_type = 'deep' order by created_at;
```

```text
2026-07-08 19:33  user_id null            deep  completed  2.00 deducted, 18.00 remaining   (your test account, deleted)
2026-10-09 07:24  <customer uuid>        deep  error      Exceeded limit on max data-uri per request: 250   (tokens null)
2026-10-13 03:51  <customer uuid>        deep  error      DataInspectionFailed ... (video scan, thinking)   (tokens null)
2026-10-13 16:52  user_id null            deep  completed  2.00 deducted, 15.00 remaining   (your test account, deleted)
```

---

## Appendix B – The customer's scans (redacted)

```sql
select created_at, scan_type, status, tokens_deducted, tokens_remaining, frame_count
from scans where user_id = '<customer uuid>' order by created_at;
```

```text
created_at            type     status     deducted  remaining  frames
2026-10-09 06:50:29   regular  completed  1.00      2.00       208
2026-10-09 07:08:57   regular  completed  1.00      1.00       208
2026-10-09 07:24:10   deep     error      null      null       432
2026-10-10 07:09:56   regular  completed  1.00      19.00      93
2026-10-10 07:15:28   regular  completed  1.00      18.00      208
2026-10-10 07:25:54   regular  completed  1.00      17.00      143
2026-10-13 03:51:05   deep     error      null      null       138
2026-10-13 03:52:56   regular  completed  1.00      16.00      138
```

Read it like this: the Oct 9 deep scan (432 frames) failed and charged nothing. The Oct 13 deep scan (138 frames) failed with the content filter and charged nothing. The next regular scan took one token (17 to 16). Cancellation came about a day later (your statement).

---

## Appendix C – Code notes (your changes and my flags)

```js
// routes/scanVideo.js (your file, as you pasted it). Parts relevant here:

const MAX_FRAMES_PER_REQUEST = 240;          // QwenCloud rejects more than 250 images

function capFrameCount(frames, max) {        // thins frames evenly, keeps first and last
  if (frames.length <= max) return frames;
  const picked = [];
  const step = (frames.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) picked.push(frames[Math.round(i * step)]);
  return picked;
}

const limits = {
  regular: { maxFrames: 250, maxPayloadMB: 10 },
  deep:    { maxFrames: 1000, maxPayloadMB: 22 }     // stale: deep now uses the same frames as regular
};

const result = await helpers.analyzeWithAI(optimizedFrames, audio, null, policy, qwenCloudConfig, {
  thinking: scanType === 'deep'
});

// a deep scan that fell back to a standard analysis costs 1
const chargedCost = result.deepFallback ? 1 : scanCost;
const deduction = await commitScanDeduction(user.id, rateLimitResult.remaining, chargedCost, supabase);
// ... profile update ...
await helpers.logScan(supabase, { ... });     // runs AFTER the deduction
```

**Flag: wrap the logging** so a failed `logScan` can't turn a charged scan into an error. This is a suggestion I haven't confirmed you applied:

```js
try {
  await helpers.logScan(supabase, { /* the same fields as now */ });
} catch (logError) {
  console.error('[scan-video] logScan failed after a successful scan:', logError?.message);
}
```

**Flag: error codes.** In the catch path, set a short `error_code` on the partial scan row (`payload_limit` for the "max data-uri" error, `content_filter` for `DataInspectionFailed`, `timeout` for timeouts) so the failures can be grouped with one query.

---

*End of index.*
