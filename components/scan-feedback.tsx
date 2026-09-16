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

export interface ScanFeedbackItem {
  creativeId: string;
  fileName: string;
  batchPosition: number | null;
  scanIds: string[];
}

interface FeedbackItemState {
  stage: FeedbackStage;
  comment: string;
  answer: boolean | null;
}

export function ScanFeedback({
  items,
  isBatch,
}: {
  items: ScanFeedbackItem[];
  isBatch: boolean;
}) {
  const [
    selectedCreativeId,
    setSelectedCreativeId,
  ] =
    useState(
      items[0]
        ?.creativeId ??
        ''
    );

  const [
    states,
    setStates,
  ] =
    useState<
      Record<
        string,
        FeedbackItemState
      >
    >(() =>
      Object.fromEntries(
        items.map(
          (item) => [
            item.creativeId,
            {
              stage:
                'question' as FeedbackStage,
              comment: '',
              answer: null,
            },
          ]
        )
      )
    );

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const currentItem =
    items.find(
      (item) =>
        item.creativeId ===
        selectedCreativeId
    ) ??
    items[0] ??
    null;

  const currentState =
    currentItem
      ? states[
          currentItem
            .creativeId
        ]
      : null;

  const allSubmitted =
    items.length > 0 &&
    items.every(
      (item) =>
        states[
          item.creativeId
        ]?.stage ===
        'submitted'
    );

  function patchCurrentState(
    patch:
      Partial<FeedbackItemState>
  ) {
    if (!currentItem) {
      return;
    }

    setStates(
      (previous) => ({
        ...previous,
        [currentItem.creativeId]:
          {
            ...previous[
              currentItem.creativeId
            ],
            ...patch,
          },
      })
    );
  }

  async function submitFeedback(
    feedbackAnswer: boolean,
    feedbackComment: string | null
  ) {
    if (
      submitting ||
      !currentItem
    ) {
      return;
    }

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
              scanIds:
                currentItem.scanIds,
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

       patchCurrentState({
        stage:
          'submitted',
        answer:
          feedbackAnswer,
      });
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

    patchCurrentState({
      stage: 'details',
    });
  }

  function handleSubmitNegative() {
    const trimmedComment =
      currentState
        ?.comment
        .trim() ??
      '';

    submitFeedback(
      false,
      trimmedComment || null
    );
  }

  if (allSubmitted) {
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
        {currentState?.stage ===
          'submitted' && (
          <div
            className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-800 dark:text-green-400"
            role="status"
          >
            Feedback saved for this creative.
          </div>
        )}
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
        {isBatch &&
          items.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {items.map(
              (item) => {
                const state =
                  states[
                    item.creativeId
                  ];

                const status =
                  state?.stage ===
                  'submitted'
                    ? state.answer ===
                      true
                      ? 'Yes'
                      : 'No'
                    : 'Pending';

                return (
                  <button
                    key={
                      item.creativeId
                    }
                    type="button"
                    onClick={() => {
                      setSelectedCreativeId(
                        item.creativeId
                      );

                      setError(
                        null
                      );
                    }}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      currentItem
                        ?.creativeId ===
                      item.creativeId
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    #{item.batchPosition}{' '}
                    {
                      item.fileName
                    }{' '}
                    · {status}
                  </button>
                );
              }
            )}
          </div>
        )}
        </div>

        {currentState?.stage !== 'submitted' && (
          currentState?.stage === 'question' ? (
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
                  Optional, but specific details are especially useful.
                </p>
              </div>

              <textarea
                id="scan-feedback-comment"
                value={
                  currentState?.comment ??
                  ''
                }
                onChange={(event) =>
                  patchCurrentState({
                    comment:
                      event.target.value,
                  })
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
                  {currentState?.comment.length ?? 0}/
                  {MAX_COMMENT_LENGTH}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);

                      patchCurrentState({
                        stage:
                          'question',
                      });
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
          )
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
