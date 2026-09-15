# Mediacrater --- Scan Result Feedback Implementation

**Date:** September 14, 2026\
**Change type:** Product feature / feedback collection\
**Scope:** Dashboard UI + VPS feedback endpoint\
**Phase:** Phase 1 --- Scan Feedback\
**Status:** Implementation prepared for TEST

------------------------------------------------------------------------

## 1. Purpose

This change adds a lightweight post-scan feedback flow to Mediacrater.

After analysis results are successfully returned and displayed in the
dashboard, the existing **Scan History** card beneath the results is
temporarily replaced by:

> **Did we get this right?**\
> **Yes** / **No**

The purpose is to collect direct user-quality signals against completed
scans so Mediacrater can measure whether generated compliance analysis
was useful/correct.

The existing Supabase columns used by this feature were created manually
before this implementation:

-   `scans.feedback_answer`
-   `scans.feedback_comment`

No database migration is included in this change.

------------------------------------------------------------------------

## 2. User Experience

### Before successful results exist

The existing **Scan History** card remains unchanged.

### After successful results are returned to the UI

The Scan History card is replaced with the feedback card:

``` text
Did we get this right?

Your feedback helps us improve the quality of future scan results.

[ Yes ] [ No ]
```

### If the user selects Yes

The answer is submitted immediately.

On success:

``` text
✓ Thanks for the feedback

Your response was saved and will help us improve future scan results.
```

No comment is requested for a positive response.

### If the user selects No

The UI expands to:

``` text
What did we get wrong?

Optional, but specific details are especially useful.

[ comment textarea ]

[ Back ] [ Send feedback ]
```

The comment is optional and limited to 1,000 characters.

### When results are cleared or a new scan begins

The feedback state is cleared and the normal Scan History card returns.

### Multi-platform scans

A single feedback response applies to all scan IDs represented by the
currently displayed successful result set.

------------------------------------------------------------------------

## 3. Security and Backend Design

The feedback request is sent to the existing Mediacrater VPS API.

Endpoint:

``` text
POST /scan-feedback
```

The endpoint uses the same authenticated VPS architecture already used
by other Mediacrater routes:

``` text
Browser
  ↓ Supabase Bearer JWT
POST /scan-feedback
  ↓
authenticateUser
  ↓
requestLimit({ maxRequests: 5, windowMs: 60_000 })
  ↓
handleScanFeedback(req, res, supabase)
  ↓
Verify authenticated user owns every supplied scan
  ↓
Update feedback_answer / feedback_comment
```

Important security properties:

-   The browser does not send or receive `SUPABASE_SERVICE_ROLE_KEY`.
-   The authenticated user ID comes from the verified Supabase session,
    not request JSON.
-   Every scan is constrained to `user_id = req.user.id`.
-   The VPS service-role Supabase client performs the database operation
    only after ownership verification.
-   The endpoint is limited to 5 requests per 60 seconds using the
    existing Mediacrater `requestLimit` middleware.
-   Previously submitted feedback cannot be overwritten with different
    feedback through this endpoint.
-   Exact repeated submissions are treated as idempotent retries.
-   The comment is validated and capped server-side at 1,000 characters.
-   A maximum of 5 scan IDs can be submitted in one request.

------------------------------------------------------------------------

## 4. Environment Variables

No new application secrets are introduced by this change.

Existing frontend variables used:

``` env
NEXT_PUBLIC_VPS_API_URL=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_APP_URL=...
```

Existing VPS variables relevant to the surrounding infrastructure
include:

``` env
SUPABASE_SERVICE_ROLE_KEY=...
```

`SUPABASE_SERVICE_ROLE_KEY` must remain server-side and must never be
exposed through a `NEXT_PUBLIC_` variable or client component.

------------------------------------------------------------------------

# 5. New Frontend File

## File: `components/scan-feedback.tsx`

Create the following file in full:

``` tsx
'use client';

// components/scan-feedback.tsx

import { useState } from 'react';
import {
  Check,
  Loader2,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { supabase } from '@/lib/mediacrater/supabaseClient';

const MAX_COMMENT_LENGTH = 1000;

type FeedbackStage =
  | 'question'
  | 'details'
  | 'submitted';

export function ScanFeedback({
  scanIds,
}: {
  scanIds: string[];
}) {
  const [stage, setStage] =
    useState<FeedbackStage>('question');

  const [comment, setComment] =
    useState('');

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  async function submitFeedback(
    feedbackAnswer: boolean,
    feedbackComment: string | null
  ) {
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const {
        data: { session },
      } =
        await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error(
          'Your session has expired. Please sign in again.'
        );
      }

      const baseUrl =
        process.env.NEXT_PUBLIC_VPS_API_URL;

      if (!baseUrl) {
        throw new Error(
          'Feedback service is not configured.'
        );
      }

      const response =
        await fetch(
          `${baseUrl.replace(/\/$/, '')}/scan-feedback`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              Authorization:
                `Bearer ${session.access_token}`,
            },

            body: JSON.stringify({
              scanIds,
              feedbackAnswer,
              feedbackComment,
            }),
          }
        );

      const body =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(
            'Too many feedback attempts. Please wait a minute and try again.'
          );
        }

        throw new Error(
          body?.error ||
            'Unable to save your feedback. Please try again.'
        );
      }

      setStage('submitted');
    } catch (err: any) {
      setError(
        err?.message ||
          'Unable to save your feedback. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleNo() {
    setError(null);
    setStage('details');
  }

  function handleSubmitNegative() {
    const trimmedComment =
      comment.trim();

    submitFeedback(
      false,
      trimmedComment || null
    );
  }

  if (stage === 'submitted') {
    return (
      <div
        className="bg-card border border-border rounded-xl p-6"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
            <Check
              className="h-4 w-4"
              aria-hidden="true"
            />
          </div>

          <div>
            <p className="font-semibold text-sm">
              Thanks for the feedback
            </p>

            <p className="text-xs text-muted-foreground mt-1">
              Your response was saved and
              will help us improve future
              scan results.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-card border border-border rounded-xl p-6"
      aria-labelledby="scan-feedback-title"
    >
      <div className="flex flex-col gap-5">
        <div>
          <p
            id="scan-feedback-title"
            className="font-semibold text-sm"
          >
            Did we get this right?
          </p>

          <p className="text-xs text-muted-foreground mt-1">
            Your feedback helps us improve
            the quality of future scan results.
          </p>
        </div>

        {stage === 'question' ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() =>
                submitFeedback(
                  true,
                  null
                )
              }
              disabled={submitting}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <ThumbsUp
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}

              Yes
            </button>

            <button
              type="button"
              onClick={handleNo}
              disabled={submitting}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors hover:border-primary/60 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ThumbsDown
                className="h-4 w-4"
                aria-hidden="true"
              />

              No
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="scan-feedback-comment"
                className="text-sm font-semibold"
              >
                What did we get wrong?
              </label>

              <p className="text-xs text-muted-foreground mt-1">
                Optional, but specific details
                are especially useful.
              </p>
            </div>

            <textarea
              id="scan-feedback-comment"
              value={comment}
              onChange={(event) =>
                setComment(
                  event.target.value
                )
              }
              maxLength={
                MAX_COMMENT_LENGTH
              }
              rows={4}
              autoFocus
              placeholder="For example: a violation was incorrect, something was missed, or the suggested fix wasn't useful."
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={submitting}
            />

            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground">
                {comment.length}/
                {MAX_COMMENT_LENGTH}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStage(
                      'question'
                    );
                  }}
                  disabled={submitting}
                  className="px-3 py-2 rounded-lg text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Back
                </button>

                <button
                  type="button"
                  onClick={
                    handleSubmitNegative
                  }
                  disabled={submitting}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting && (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}

                  Send feedback
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p
            className="text-xs text-red-700 dark:text-red-400"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
```

------------------------------------------------------------------------

# 6. Dashboard Page Replacement

## File: `app/dashboard/page.tsx`

Replace the entire file with:

``` tsx
'use client';

import {
  Suspense,
  useEffect,
  useState,
} from 'react';

import {
  useRouter,
  useSearchParams,
} from 'next/navigation';

import Link from 'next/link';

import {
  AppShell,
} from '@/components/app-shell';

import {
  ScanWorkspace,
  type CompletedScanFeedbackTarget,
  type WorkspaceProfile,
} from '@/components/scan-workspace';

import {
  ScanFeedback,
} from '@/components/scan-feedback';

import {
  supabase,
} from '@/lib/mediacrater/supabaseClient';

interface UserProfile
  extends WorkspaceProfile {
  id: string;
  scans_made: number;
  account_status: string;
  scan_history: boolean;
  subscription_cancel_at?:
    | string
    | null;
  subscription_renews_at?:
    | string
    | null;
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <AppShell userEmail={null}>
          <p className="text-muted-foreground text-sm">
            Loading...
          </p>
        </AppShell>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router =
    useRouter();

  const searchParams =
    useSearchParams();

  const [
    showCheckoutSuccess,
    setShowCheckoutSuccess,
  ] =
    useState(false);

  const [
    user,
    setUser,
  ] =
    useState<any>(null);

  const [
    profile,
    setProfile,
  ] =
    useState<UserProfile | null>(
      null
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    feedbackTarget,
    setFeedbackTarget,
  ] =
    useState<CompletedScanFeedbackTarget | null>(
      null
    );

  useEffect(() => {
    if (
      searchParams.get(
        'checkout'
      ) === 'success'
    ) {
      setShowCheckoutSuccess(
        true
      );

      window.history.replaceState(
        {},
        '',
        '/dashboard'
      );
    }
  }, [searchParams]);

  useEffect(() => {
    const initAuth =
      async () => {
        const {
          data: {
            session,
          },
        } =
          await supabase.auth.getSession();

        if (!session) {
          router.push(
            '/signin'
          );

          return;
        }

        setUser(
          session.user
        );

        await fetchUserData(
          session.user.id
        );

        setLoading(false);
      };

    initAuth();

    const {
      data: {
        subscription,
      },
    } =
      supabase.auth.onAuthStateChange(
        async (
          event,
          session
        ) => {
          if (
            event ===
              'SIGNED_OUT' ||
            !session
          ) {
            setUser(null);

            router.push(
              '/signin'
            );
          } else {
            setUser(
              session.user
            );
          }
        }
      );

    return () =>
      subscription.unsubscribe();
  }, [router]);

  const fetchUserData =
    async (
      userId: string
    ) => {
      try {
        const {
          data:
            profileData,

          error:
            profileErr,
        } =
          await supabase
            .from(
              'profiles'
            )
            .select('*')
            .eq(
              'id',
              userId
            )
            .single();

        if (
          !profileErr &&
          profileData
        ) {
          setProfile(
            profileData
          );
        }
      } catch (err) {
        console.error(
          'Error fetching dashboard data:',
          err
        );
      }
    };

  if (loading) {
    return (
      <AppShell
        userEmail={null}
      >
        <p className="text-muted-foreground text-sm">
          Loading your dashboard...
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      userEmail={
        user?.email ??
        null
      }
      plan={
        profile?.plan ??
        null
      }
      scansRemaining={
        profile
          ?.scans_remaining ??
        null
      }
    >
      {showCheckoutSuccess && (
        <div className="mb-6 flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
          <p className="text-sm text-green-800 dark:text-green-400">
            <span className="font-semibold">
              You're all set!
            </span>

            {profile?.plan &&
            profile.plan !==
              'free'
              ? ` You're now on the ${profile.plan
                  .charAt(0)
                  .toUpperCase()}${profile.plan.slice(
                  1
                )} plan.`
              : ' Your plan has been updated.'}
          </p>

          <button
            onClick={() =>
              setShowCheckoutSuccess(
                false
              )
            }
            className="text-green-800 dark:text-green-400 hover:opacity-70 text-sm"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl font-bold">
          Dashboard
        </h1>

        <p className="text-muted-foreground text-sm mt-1">
          Logged in as{' '}
          {user?.email}
        </p>
      </div>

      <div className="mb-10">
        <h2 className="text-lg font-bold mb-4">
          Run Ad Compliance Scan
        </h2>

        <ScanWorkspace
          profile={
            profile
          }
          onScanComplete={() =>
            user &&
            fetchUserData(
              user.id
            )
          }
          onResultsChange={
            setFeedbackTarget
          }
        />
      </div>

      {feedbackTarget ? (
        <ScanFeedback
          scanIds={
            feedbackTarget.scanIds
          }
        />
      ) : (
        <div className="bg-card border border-border rounded-xl p-6 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-sm">
              Scan History
            </p>

            <p className="text-xs text-muted-foreground mt-0.5">
              {profile
                ?.scan_history
                ? 'Every scan you run is saved automatically.'
                : 'Available on paid plans — automatically saves every scan you run.'}
            </p>
          </div>

          <Link
            href="/scan-history"
            className="shrink-0 px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-secondary transition-colors"
          >
            {profile
              ?.scan_history
              ? 'View History'
              : 'Learn more'}
          </Link>
        </div>
      )}
    </AppShell>
  );
}
```

------------------------------------------------------------------------

# 7. `components/scan-workspace.tsx` Changes

This file is modified surgically rather than replaced wholesale.

## Change 1 --- Add feedback target type

Immediately after the existing `WorkspaceProfile` interface:

``` tsx
export interface CompletedScanFeedbackTarget {
  scanIds: string[];
}
```

## Change 2 --- Extend `ScanWorkspace` props

Replace:

``` tsx
export function ScanWorkspace({
  profile,
  onScanComplete,
}: {
  profile: WorkspaceProfile | null;
  onScanComplete: () => Promise<void> | void;
}) {
```

with:

``` tsx
export function ScanWorkspace({
  profile,
  onScanComplete,
  onResultsChange,
}: {
  profile: WorkspaceProfile | null;
  onScanComplete: () => Promise<void> | void;
  onResultsChange?: (
    target:
      | CompletedScanFeedbackTarget
      | null
  ) => void;
}) {
```

## Change 3 --- Clear feedback when selecting a new file

Replace:

``` tsx
async function handleFile(file: File) {
  setBanner(null);
  setResults(null);
```

with:

``` tsx
async function handleFile(file: File) {
  setBanner(null);
  setResults(null);
  onResultsChange?.(null);
```

## Change 4 --- Clear feedback when removing a file/results

Replace:

``` tsx
setCurrentFile(null);
setResults(null);
setAnalyzeAudio(false);
```

with:

``` tsx
setCurrentFile(null);
setResults(null);
onResultsChange?.(null);
setAnalyzeAudio(false);
```

## Change 5 --- Preserve each successful scan UUID

Inside the platform scan loop, replace:

``` tsx
return {
  platform,
  response: completed,
};
```

with:

``` tsx
return {
  platform,
  response: completed,
  scanId,
};
```

Then replace:

``` tsx
setResults(formatted);
await onScanComplete();
```

with:

``` tsx
setResults(formatted);

onResultsChange?.({
  scanIds: rawResults.map(
    ({ scanId }) =>
      scanId
  ),
});

await onScanComplete();
```

This ensures the feedback UI only receives scan IDs after successful
scan responses have been returned and formatted.

## Change 6 --- Clear previous feedback when another analysis begins

Replace:

``` tsx
setIsAnalyzing(true);
setResults(null);
setCanCancel(true);
```

with:

``` tsx
setIsAnalyzing(true);
setResults(null);
onResultsChange?.(null);
setCanCancel(true);
```

------------------------------------------------------------------------

# 8. VPS `server.js` Changes

The existing VPS architecture is reused rather than introducing
duplicate authentication, Supabase clients, JSON parsers, or rate-limit
stores.

## Import

Add to the route imports:

``` js
const { handleScanFeedback } = require('./routes/scanFeedback');
```

The relevant imports become:

``` js
const { detectOrigin } = require('./routes/_shared/detectOrigin');
const checkoutRoutes = require('./checkout');
const { handleScanVideo } = require('./routes/scanVideo');
const { handleScanImage } = require('./routes/scanImage');
const { getRateLimitStatus } = require('./rateLimiter');
const helpers = require('./helpers');
const queueManager = require('./queueManager');
const { initAbuseDetection } = require('./abuseDetection');
const { handleScanFeedback } = require('./routes/scanFeedback');
```

## Route

In the routes section, after:

``` js
app.use('/checkout', checkoutRoutes);
```

add:

``` js
app.post(
  '/scan-feedback',
  authenticateUser,
  requestLimit({ maxRequests: 5, windowMs: 60_000 }),
  (req, res) => handleScanFeedback(req, res, supabase)
);
```

The global JSON parser must remain before this route:

``` js
app.use(express.json({ limit: '150mb' }));
```

This route therefore reuses:

-   existing global JSON parsing
-   existing CORS handling
-   existing `authenticateUser`
-   existing `requestLimit`
-   existing server-side `supabase` client

No separate Express Router is required.

------------------------------------------------------------------------

# 9. New VPS File

## File: `routes/scanFeedback.js`

Create the following file in full:

``` js
// routes/scanFeedback.js

const MAX_COMMENT_LENGTH = 1000;
const MAX_SCAN_IDS = 5;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates, normalizes, and deduplicates scan IDs.
 */
function normalizeScanIds(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const scanIds = [
    ...new Set(
      value.map((id) =>
        String(id).trim()
      )
    ),
  ];

  if (
    scanIds.length === 0 ||
    scanIds.length > MAX_SCAN_IDS ||
    scanIds.some(
      (id) => !UUID_PATTERN.test(id)
    )
  ) {
    return null;
  }

  return scanIds;
}

/**
 * Positive feedback never stores a comment.
 *
 * Negative feedback may contain an optional comment,
 * capped at MAX_COMMENT_LENGTH characters.
 */
function normalizeComment(
  feedbackAnswer,
  value
) {
  if (feedbackAnswer === true) {
    return {
      valid: true,
      value: null,
    };
  }

  if (
    value === null ||
    value === undefined
  ) {
    return {
      valid: true,
      value: null,
    };
  }

  if (typeof value !== 'string') {
    return {
      valid: false,
      value: null,
    };
  }

  const trimmed = value.trim();

  if (
    trimmed.length >
    MAX_COMMENT_LENGTH
  ) {
    return {
      valid: false,
      value: null,
    };
  }

  return {
    valid: true,
    value: trimmed || null,
  };
}

/**
 * POST /scan-feedback
 *
 * Authentication:
 *   Already handled by authenticateUser in server.js.
 *   req.user is therefore the verified Supabase user.
 *
 * Rate limiting:
 *   Already handled by requestLimit in server.js.
 *
 * Supabase:
 *   The existing server-side Supabase client is passed
 *   in by server.js.
 */
async function handleScanFeedback(
  req,
  res,
  supabase
) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized.',
      });
    }

    const {
      scanIds: rawScanIds,
      feedbackAnswer,
      feedbackComment,
    } = req.body || {};

    /*
     * Validate scan IDs.
     */
    const scanIds =
      normalizeScanIds(rawScanIds);

    if (!scanIds) {
      return res.status(400).json({
        error: 'Invalid scan IDs.',
      });
    }

    /*
     * feedbackAnswer must be an actual
     * JSON boolean — not "true", "false",
     * 1, 0, etc.
     */
    if (
      typeof feedbackAnswer !==
      'boolean'
    ) {
      return res.status(400).json({
        error:
          'feedbackAnswer must be a boolean.',
      });
    }

    /*
     * Normalize optional comment.
     */
    const normalizedComment =
      normalizeComment(
        feedbackAnswer,
        feedbackComment
      );

    if (!normalizedComment.valid) {
      return res.status(400).json({
        error:
          `Feedback comments must be ${MAX_COMMENT_LENGTH} characters or fewer.`,
      });
    }

    const comment =
      normalizedComment.value;

    /*
     * Fetch every requested scan while
     * constraining the query to the
     * authenticated owner.
     *
     * This ownership check is important
     * because the Supabase client passed
     * into this handler uses the server's
     * service-role credentials and can
     * bypass RLS.
     */
    const {
      data: scans,
      error: lookupError,
    } = await supabase
      .from('scans')
      .select(
        'id, user_id, feedback_answer, feedback_comment'
      )
      .in('id', scanIds)
      .eq('user_id', userId);

    if (lookupError) {
      console.error(
        '[SCAN FEEDBACK] Scan lookup failed:',
        lookupError
      );

      return res.status(500).json({
        error:
          'Unable to save feedback. Please try again.',
      });
    }

    /*
     * Every supplied scan ID must exist
     * AND belong to this authenticated
     * user.
     *
     * We deliberately don't distinguish
     * "doesn't exist" from "belongs to
     * someone else."
     */
    if (
      !Array.isArray(scans) ||
      scans.length !== scanIds.length
    ) {
      return res.status(404).json({
        error:
          'One or more scans were not found.',
      });
    }

    /*
     * Feedback is immutable after its
     * first successful submission.
     *
     * However, submitting the exact same
     * value again is treated as an
     * idempotent retry rather than an
     * error.
     */
    const pendingScanIds = [];

    for (const scan of scans) {
      if (
        scan.feedback_answer ===
        null ||
        scan.feedback_answer ===
        undefined
      ) {
        pendingScanIds.push(
          scan.id
        );

        continue;
      }

      const storedComment =
        scan.feedback_comment ?? null;

      const sameAnswer =
        scan.feedback_answer ===
        feedbackAnswer;

      const sameComment =
        storedComment === comment;

      if (
        !sameAnswer ||
        !sameComment
      ) {
        return res.status(409).json({
          error:
            'Feedback has already been submitted for this scan.',
        });
      }
    }

    /*
     * If pendingScanIds is empty, every
     * requested scan already contains
     * this exact feedback.
     *
     * That's an idempotent retry, so
     * return success without writing.
     */
    if (
      pendingScanIds.length === 0
    ) {
      return res.status(200).json({
        ok: true,
        alreadySubmitted: true,
      });
    }

    /*
     * Write only to:
     *
     *   - requested scan IDs
     *   - owned by authenticated user
     *   - rows that still have no answer
     *
     * The final .is() provides another
     * guard against accidentally
     * overwriting existing feedback.
     */
    const {
      data: updatedScans,
      error: updateError,
    } = await supabase
      .from('scans')
      .update({
        feedback_answer:
          feedbackAnswer,

        feedback_comment:
          comment,
      })
      .in(
        'id',
        pendingScanIds
      )
      .eq(
        'user_id',
        userId
      )
      .is(
        'feedback_answer',
        null
      )
      .select('id');

    if (updateError) {
      console.error(
        '[SCAN FEEDBACK] Update failed:',
        updateError
      );

      return res.status(500).json({
        error:
          'Unable to save feedback. Please try again.',
      });
    }

    /*
     * Because we're using the privileged
     * server client, verify that every
     * pending row was actually updated.
     */
    if (
      !Array.isArray(updatedScans) ||
      updatedScans.length !==
        pendingScanIds.length
    ) {
      console.error(
        '[SCAN FEEDBACK] Update count mismatch.',
        {
          userId,
          expected:
            pendingScanIds.length,
          updated:
            updatedScans?.length ?? 0,
        }
      );

      return res.status(409).json({
        error:
          'Feedback could not be saved because the scan changed. Please refresh and try again.',
      });
    }

    console.log(
      `[SCAN FEEDBACK] user:${userId} | ` +
      `answer:${feedbackAnswer ? 'yes' : 'no'} | ` +
      `scans:${pendingScanIds.length} | ` +
      `comment:${comment ? 'yes' : 'no'}`
    );

    return res.status(200).json({
      ok: true,
      saved:
        pendingScanIds.length,
    });
  } catch (error) {
    console.error(
      '[SCAN FEEDBACK] Unexpected error:',
      error
    );

    return res.status(500).json({
      error:
        'Unable to save feedback. Please try again.',
    });
  }
}

module.exports = {
  handleScanFeedback,
};
```

------------------------------------------------------------------------

# 10. Database Assumptions

The implementation assumes the `scans` table uses:

``` text
scans.id
scans.user_id
scans.feedback_answer
scans.feedback_comment
```

It also assumes the UUID generated in `ScanWorkspace` and sent with the
scan request is ultimately stored in `scans.id`.

Before production deployment, verify this against the existing scan
insertion logic.

If the existing schema instead stores the generated UUID under a column
such as `scan_id`, the feedback handler must be adjusted accordingly
before deployment.

------------------------------------------------------------------------

# 11. Rate Limiting

The feedback endpoint uses the existing VPS limiter:

``` js
requestLimit({
  maxRequests: 5,
  windowMs: 60_000,
})
```

Therefore:

``` text
Maximum: 5 requests
Window:  60 seconds
Scope:   existing requestLimit implementation
```

No second feedback-specific in-memory rate limiter is introduced.

This keeps feedback consistent with the existing Mediacrater API
architecture.

------------------------------------------------------------------------

# 12. Data Behavior

## Positive response

Stored as:

``` text
feedback_answer = true
feedback_comment = NULL
```

## Negative response without comment

Stored as:

``` text
feedback_answer = false
feedback_comment = NULL
```

## Negative response with comment

Stored as:

``` text
feedback_answer = false
feedback_comment = "<trimmed user comment>"
```

Leading/trailing whitespace is removed before persistence.

Positive feedback always forces `feedback_comment` to `NULL`
server-side.

------------------------------------------------------------------------

# 13. Idempotency / Feedback Immutability

The endpoint deliberately does not allow an already-submitted response
to be silently replaced.

Example:

``` text
Existing:
feedback_answer = true

Later request:
feedback_answer = false
```

Result:

``` text
409 Conflict
```

However, an exact retry is accepted.

Example:

``` text
Existing:
feedback_answer = false
feedback_comment = "Violation is incorrect"

Retry:
feedback_answer = false
feedback_comment = "Violation is incorrect"
```

Result:

``` text
200 OK
alreadySubmitted = true
```

This makes ordinary browser/network retries safe without allowing the
feedback dataset to be repeatedly rewritten.

------------------------------------------------------------------------

# 14. Files Changed

## Website

### New

``` text
components/scan-feedback.tsx
```

### Modified

``` text
app/dashboard/page.tsx
components/scan-workspace.tsx
```

## VPS

### New

``` text
routes/scanFeedback.js
```

### Modified

``` text
server.js
```

## Supabase

Existing columns used:

``` text
scans.feedback_answer
scans.feedback_comment
```

No new database migration is part of this change.

------------------------------------------------------------------------

# 15. Expected End-to-End Sequence

``` text
1. User opens Dashboard
2. Scan History card is visible
3. User selects an ad
4. User starts analysis
5. Existing feedback target is cleared
6. ScanWorkspace generates scan UUID(s)
7. VPS processes scan(s)
8. Successful results return
9. Analysis Results render
10. ScanWorkspace passes successful scan UUID(s) to Dashboard
11. Dashboard replaces Scan History with ScanFeedback
12. User selects Yes or No

YES:
13. Browser obtains current Supabase access token
14. POST /scan-feedback
15. authenticateUser validates token
16. requestLimit enforces 5 / 60s
17. handleScanFeedback verifies scan ownership
18. feedback_answer=true is stored
19. Success acknowledgement is shown

NO:
13. Optional comment field appears
14. User submits
15. Browser obtains current Supabase access token
16. POST /scan-feedback
17. authenticateUser validates token
18. requestLimit enforces 5 / 60s
19. handleScanFeedback verifies scan ownership
20. feedback_answer=false is stored
21. feedback_comment is stored or NULL
22. Success acknowledgement is shown

NEW SCAN / CLEAR RESULTS:
23. Feedback target becomes null
24. Scan History card returns
```

------------------------------------------------------------------------

# 16. Why This Architecture Was Chosen

### Feedback is attached to successful scans, not upload attempts

The feedback UI is not displayed merely because a file was uploaded or
analysis started.

The UI receives the scan IDs only after successful results have
returned.

This prevents feedback from being collected against:

-   failed scans
-   cancelled scans
-   queued-but-not-completed scans
-   uploads that were never analyzed

### Existing VPS infrastructure is reused

The initial design considered a standalone Express Router with:

-   its own Supabase clients
-   its own authentication
-   its own JSON parser
-   its own rate limiter

After reviewing the existing Mediacrater VPS `server.js`, that
architecture was intentionally discarded.

The final implementation instead reuses:

``` text
authenticateUser
requestLimit
global express.json()
existing service-role Supabase client
existing CORS middleware
existing Express application
```

This reduces duplicated security logic and keeps the endpoint consistent
with the rest of Mediacrater.

### Service-role access remains server-side

The frontend authenticates with the user's normal Supabase access token.

The VPS verifies that token and derives the user identity itself.

The browser never controls the `user_id` used for authorization.

### Feedback comments remain optional

A negative boolean response is valuable even when a user does not want
to type an explanation.

Requiring a written response would add unnecessary friction and reduce
feedback completion.

### Feedback is immutable

Once submitted, different feedback cannot overwrite the original
response through this endpoint.

This keeps the feedback dataset more stable for later model/provider
quality analysis.

------------------------------------------------------------------------

# 17. Testing Checklist

Before promoting TEST to LIVE, verify all of the following.

### UI

-   [ ] Scan History appears normally before scanning.
-   [ ] Starting a scan does not display stale feedback from a previous
    result.
-   [ ] Successful results replace Scan History with the feedback card.
-   [ ] Failed results do not display the feedback card.
-   [ ] Cancelled scans do not display the feedback card.
-   [ ] Yes submits immediately.
-   [ ] No opens the optional comment field.
-   [ ] Back returns from the comment state to Yes/No.
-   [ ] Comment counter stops at 1,000 characters.
-   [ ] Successful submission displays the acknowledgement state.
-   [ ] New Scan / clearing results restores Scan History.
-   [ ] Light mode styling is correct.
-   [ ] Dark mode styling is correct.
-   [ ] Mobile layout is usable.

### Authentication / authorization

-   [ ] Valid signed-in user can submit feedback for their own scan.
-   [ ] Missing bearer token receives `401`.
-   [ ] Invalid/expired bearer token receives `401`.
-   [ ] User cannot submit feedback against another user's scan ID.
-   [ ] Unknown scan ID does not reveal whether another user owns it.

### Validation

-   [ ] Empty `scanIds` is rejected.
-   [ ] Invalid UUID is rejected.
-   [ ] More than 5 scan IDs is rejected.
-   [ ] Non-boolean `feedbackAnswer` is rejected.
-   [ ] Positive feedback stores comment as `NULL`.
-   [ ] Negative feedback accepts `NULL` comment.
-   [ ] Negative feedback accepts a valid comment.
-   [ ] More than 1,000 comment characters is rejected server-side.

### Persistence

-   [ ] Yes produces `feedback_answer = true`.
-   [ ] No produces `feedback_answer = false`.
-   [ ] Comment is written to `feedback_comment`.
-   [ ] Whitespace-only negative comment becomes `NULL`.
-   [ ] Existing feedback cannot be changed to another answer.
-   [ ] Exact duplicate retry returns success.

### Rate limiting

-   [ ] Requests 1--5 within 60 seconds behave normally.
-   [ ] Request 6 is rate-limited.
-   [ ] Endpoint becomes available again after the rate-limit window.

### Multi-platform

-   [ ] Multi-platform successful scan produces one feedback card.
-   [ ] One feedback response updates every scan represented by the
    displayed result set.
-   [ ] Ownership is verified for every scan ID before any update.

------------------------------------------------------------------------

# 18. Deployment Notes

Deploy to TEST first.

Recommended sequence:

``` text
1. Add routes/scanFeedback.js to TEST VPS.
2. Add import + POST /scan-feedback route to TEST server.js.
3. Restart TEST API.
4. Verify TEST API starts without import/syntax errors.
5. Add components/scan-feedback.tsx to TEST website.
6. Update app/dashboard/page.tsx.
7. Update components/scan-workspace.tsx.
8. Build/deploy TEST website.
9. Run a real TEST scan.
10. Verify scan UUID maps to scans.id.
11. Submit Yes feedback.
12. Inspect the corresponding Supabase row.
13. Run another scan and submit No + comment.
14. Inspect the corresponding Supabase row.
15. Test authorization and rate limiting.
16. Verify drift monitor reports only the intended TEST/LIVE changes.
17. Promote to LIVE only after TEST passes.
```

------------------------------------------------------------------------

# 19. Rollback

If the feature needs to be rolled back:

### Website

Remove:

``` text
components/scan-feedback.tsx
```

Restore the previous:

``` text
app/dashboard/page.tsx
components/scan-workspace.tsx
```

### VPS

Remove:

``` text
routes/scanFeedback.js
```

Remove this import from `server.js`:

``` js
const { handleScanFeedback } = require('./routes/scanFeedback');
```

Remove this route:

``` js
app.post(
  '/scan-feedback',
  authenticateUser,
  requestLimit({ maxRequests: 5, windowMs: 60_000 }),
  (req, res) => handleScanFeedback(req, res, supabase)
);
```

The existing Supabase columns can remain in place because nullable
feedback columns do not affect the pre-feature scan path.

------------------------------------------------------------------------

# 20. Final Result

This change introduces a low-friction feedback mechanism directly at the
point where users have enough context to judge a completed Mediacrater
analysis.

The implementation is intentionally narrow:

-   no new authentication system
-   no new rate-limit system
-   no new Supabase client architecture
-   no service-role exposure
-   no forced written feedback
-   no feedback on unsuccessful scans
-   no automatic overwriting of prior feedback
-   no database migration in this change

The result provides the foundational data needed for later comparison of
scan quality, policy-engine versions, and AI providers while keeping the
initial user interaction minimal.
