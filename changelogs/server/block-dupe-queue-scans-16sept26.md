# Deployment Index — Block Duplicate Scans During Queueing

- **Date:** 16 September 2026
- **Project:** Mediacrater
- **Component:** Server-side scan queue
- **Affected file:** `queueManager.js`
- **Affected function:** `enqueueJob()`
- **Change type:** Bug fix
- **Deployment status:** Change documented; TEST/LIVE deployment and runtime verification are not confirmed in this record.

## What changed

Extended the opening duplicate-scan guard in `enqueueJob()` to check both active scans and waiting jobs belonging to the same user.

Replace the existing opening check:

```js
  if (userHasActiveScan(userId)) {
    return { status: 'rejected_duplicate' };
  }
```

With:

```js
  if (
    userHasActiveScan(userId) ||
    queue.some(job => job.userId === userId)
  ) {
    return { status: 'rejected_duplicate' };
  }
```

Keep this guard at the start of `enqueueJob()`, before generating a job ID, logging to Supabase, or adding a job to the queue.

## Why this change was needed

The previous check only inspected `activeUserIds`. A user is added to that set when `markJobRunning()` runs, so a scan waiting in the queue did not block additional submissions by the same user.

When resources were busy, a user could submit multiple scans before the first one started. `drainQueue()` could then mark those scans running together because it does not independently enforce the per-user limit. Completing one of those duplicate scans could also clear the user's active flag while another remained running.

The added `queue.some(...)` check closes this admission gap by rejecting a submission when the same user already has a waiting job.

## Expected behavior

| User's current state | New submission through `enqueueJob()` |
| --- | --- |
| No queued or running scan | Accepted for normal queue/capacity handling |
| A queued scan | Rejected with `rejected_duplicate` |
| A running scan | Rejected with `rejected_duplicate` |
| Queued scan successfully cancelled | Eligible to submit again |
| Running scan released by `completeJob()` after success or failure | Eligible to submit again |

Other users can continue submitting scans. Sequential batching remains compatible when each next submission occurs after the previous job is completed and released; submitting multiple batch items upfront for the same user would be rejected by this guard.

## Deployment steps

1. Apply the replacement guard to server-side `queueManager.js` in TEST.
2. Restart the TEST API process using the normal deployment procedure to load the change.
3. Perform the checks below.
4. Apply the identical change to LIVE and restart its API process using the normal deployment procedure.

No database migration or environment-variable change is required for this patch. The change is limited to the opening admission guard.

## Verification checklist

These checks are pending; this document does not record executed tests.

- [ ] In TEST, hold a first scan in the queue using the existing test toggle or controlled capacity conditions. Submit another scan for the same user and confirm `rejected_duplicate` with no additional job created.
- [ ] While a scan is running, confirm another submission from that user returns `rejected_duplicate`.
- [ ] Confirm a different user can still submit a scan for normal queue/capacity handling.
- [ ] Cancel a queued job and confirm its user can submit again.
- [ ] Complete a running job successfully, then repeat with `completeJob(jobId, { success: false })`; confirm the user can submit again after each release.
- [ ] Confirm sequential batching submits the next job only after the prior job is released.
- [ ] If the TEST force-queue toggle was used, disable it after verification.

## Scope and limitation

This guard protects submissions handled by the same Node.js process through `enqueueJob()`. In the supplied implementation, no `await` separates the duplicate check from recording the accepted job, so those operations execute synchronously within that process.

The queue and active-user set are in memory. Multiple workers or server instances require a shared atomic per-user lock to enforce the same restriction across processes. Restarting the API clears its in-memory queue state; use the normal procedure for handling in-flight work during deployment.

## Rollback

Restore the original opening check shown above and restart the affected API process. This restores the previous behavior, including the vulnerability to duplicate submissions while a scan is queued.
