# Deployment Index 01: Slack Form Integration

**Scope:** Custom Solutions contact form → Vercel serverless function → Slack webhook
**Status:** Deployed
**Related index:** See `deployment-index-02-rate-limiting.md` for rate limiting and bot protection layered on top of this integration.

---

## 1. Overview

The `/solutions` page contact form was originally a client-only simulated submit (a `setTimeout` standing in for a real request). This change routes real submissions through a Next.js App Router serverless function, which forwards the form data to a Slack channel via an Incoming Webhook. Replies to the person who submitted the form are handled manually, outside this system, via email.

## 2. Files touched

| File | Change |
|---|---|
| `app/api/custom-solutions-form/route.ts` | New file. Serverless POST endpoint. |
| `app/solutions/page.tsx` | Modified. `handleSubmit` now calls the real endpoint instead of simulating success. |

## 3. Environment variables required

| Variable | Where set | Purpose |
|---|---|---|
| `SLACK_FORM_WEBHOOK_URL` | Vercel → Project Settings → Environment Variables (server-side only, no `NEXT_PUBLIC_` prefix) | Slack Incoming Webhook URL that receives form submissions. |

## 4. Slack-side setup (one-time, manual, not code)

1. [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch.
2. App settings → Incoming Webhooks → toggle on.
3. Add New Webhook to Workspace → choose destination channel.
4. Copy the webhook URL (`https://hooks.slack.com/services/...`) into `SLACK_FORM_WEBHOOK_URL` in Vercel.

## 5. Chronological change log

### 5.1 — Initial route creation

**Reason:** Give the existing form a real backend. Needed server-side validation (never trust client input) and a clean forwarding step to Slack using Block Kit formatting instead of a flat text string, so submissions are readable at a glance in the Slack channel.

**File created:** `app/api/custom-solutions-form/route.ts`

Key pieces introduced at this stage (later modified — see sections 5.2 and 5.3 in the companion rate-limiting index for the rate-limit-specific evolution of this same file):

- `validatePayload()` — checks `name` and `email` are present and well-formed; caps every field's length; validates `volume` against a fixed allowed set.
- `buildSlackPayload()` — builds a Slack Block Kit message (header + two-column fields for name/email/company/volume, optional message section, divider). Escapes `&`, `<`, `>` per Slack mrkdwn rules so user input can't break formatting.
- `POST` handler — parses JSON body → validates → posts to `process.env.SLACK_FORM_WEBHOOK_URL` → returns `{ success: true }` or a scoped error status (`400` bad input, `500` missing webhook config, `502` Slack unreachable/non-OK response).

**File modified:** `app/solutions/page.tsx`

- `handleSubmit` changed from a simulated `await new Promise(...)` to a real `fetch("/api/custom-solutions-form", { method: "POST", ... })`.
- Added `errorMessage` state so the server's actual error text (not just a generic string) surfaces in the UI on failure.

### 5.2 — Required-field enforcement

**Reason:** Originally only `name` and `email` were required (both client-side HTML `required` and server-side validation); `company` and `volume` were optional despite the UI implying otherwise. Tightened to require `company` and `volume` as well. `message` was deliberately left optional — a free-text field that blocks submission if empty can suppress legitimate low-effort leads.

**`app/solutions/page.tsx`:**
- Added `required` attribute to the `company` text input.
- Added `required` attribute to the `volume` `<select>`. (Works correctly because the first `<option value="">Select a range</option>` is the empty-value placeholder that `required` blocks on.)

**`app/api/custom-solutions-form/route.ts`, inside `validatePayload()`:**

Before:
```typescript
if (company !== undefined && typeof company !== "string") {
  return { valid: false, error: "Invalid company value." }
}
if (typeof company === "string" && company.length > 200) {
  return { valid: false, error: "Company name is too long." }
}

if (volume !== undefined && typeof volume !== "string") {
  return { valid: false, error: "Invalid volume value." }
}
if (typeof volume === "string" && !VOLUME_OPTIONS.has(volume)) {
  return { valid: false, error: "Invalid volume selection." }
}
```

After:
```typescript
if (typeof company !== "string" || company.trim().length === 0) {
  return { valid: false, error: "Company / Platform is required." }
}
if (company.length > 200) {
  return { valid: false, error: "Company name is too long." }
}

if (typeof volume !== "string" || volume.trim().length === 0) {
  return { valid: false, error: "Please select an approximate monthly volume." }
}
if (!VOLUME_OPTIONS.has(volume)) {
  return { valid: false, error: "Invalid volume selection." }
}
```

## 6. Final route responsibilities (as of this index)

In order of execution inside `POST`:
1. Parse JSON body (`400` on parse failure).
2. `validatePayload()` — structural + required-field validation (`400` on failure).
3. *(Bot verification and rate limiting were added after this integration — see the rate-limiting index; as of this index alone, step 3 was directly: forward to Slack.)*
4. Forward to Slack via `buildSlackPayload()` + `fetch(process.env.SLACK_FORM_WEBHOOK_URL)`.
5. Return `{ success: true }` (`200`) or a scoped error.

## 7. Rollback notes

- To revert to the pre-integration (simulated) state: restore `handleSubmit` in `page.tsx` to its original `setTimeout`-based simulation and delete `app/api/custom-solutions-form/route.ts`. Not recommended — this would silently stop delivering real submissions.
- To revert only the required-field tightening: remove `required` from `company`/`volume` in `page.tsx`, and revert `validatePayload()`'s `company`/`volume` blocks to the "before" snippet in §5.2.
- `SLACK_FORM_WEBHOOK_URL` rotation: generate a new webhook in the Slack app settings, update the Vercel env var, redeploy. No code change required.
