// app/auth/callback/page.tsx
'use client';

// Google sends users back here (via Supabase). This page:
// 1. Waits for supabase-js to read the session from the URL, then removes
//    the tokens from the address bar.
// 2. Calls POST /api/oauth/complete (VPS, through the Cloudflare Worker) with
//    the access token and this browser's device signals. That records IP +
//    device and, for new accounts, checks the /start intent and consent and
//    activates the account.
// 3. Handles the two special answers:
//    - CONSENT_REQUIRED: new account created from the Sign-in page. Shows the
//      same 18+/Terms checkbox as /signup, then retries.
//    - INTENT_REQUIRED: the Google flow wasn't started from our button (or
//      took too long). Signs out and sends the user back to /signup.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/mediacrater/supabaseClient';
import { collectDeviceClient } from '@/lib/collect-device-client';

type Stage = 'working' | 'consent' | 'error' | 'restart';

function readOAuthError(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const description =
    hash.get('error_description') || query.get('error_description') ||
    hash.get('error') || query.get('error');
  return description ? description.replace(/\+/g, ' ').slice(0, 200) : null;
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('working');
  const [message, setMessage] = useState<string | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const startedRef = useRef(false);

  async function complete(acceptedTerms: boolean) {
    setSubmitting(true);
    setMessage(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setStage('restart');
        setMessage('Google sign-in was cancelled or did not finish. Please try again.');
        return;
      }

      const device = await collectDeviceClient();
      const res = await fetch('/api/oauth/complete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          acceptedTerms,
          timezone: device.timezone,
          browser: device.browser,
          browser_version: device.browser_version,
          os: device.os,
          device_fp: device.device_fp,
        }),
      });
      const json = await res.json().catch(() => null);

      if (res.ok && json?.ok) {
        router.replace('/dashboard');
        return;
      }

      if (res.status === 409 && json?.code === 'CONSENT_REQUIRED') {
        setStage('consent');
        return;
      }

      if (res.status === 403 && json?.code === 'INTENT_REQUIRED') {
        await supabase.auth.signOut();
        setStage('restart');
        setMessage(json.error || 'Your sign-up session expired. Please start again.');
        return;
      }

      setStage('error');
      setMessage(json?.error || 'Something went wrong. Please try again.');
    } catch {
      setStage('error');
      setMessage('Something went wrong. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const oauthError = readOAuthError();
    // Remove tokens / codes from the address bar and browser history.
    // getSession() below still works: supabase-js has already read the URL
    // while it initialised.
    (async () => {
      await supabase.auth.getSession();
      window.history.replaceState(null, '', window.location.pathname);

      if (oauthError) {
        setStage('restart');
        setMessage(`Google sign-in failed: ${oauthError}`);
        return;
      }
      await complete(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-background">
      <div className="w-full max-w-sm text-center">
        {stage === 'working' && (
          <>
            <div className="mx-auto mb-4 w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium">Finishing sign-in...</p>
          </>
        )}

        {stage === 'consent' && (
          <div className="text-left">
            <h2 className="text-2xl font-bold mb-2">One last step</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Please confirm the following to finish creating your account.
            </p>
            <label className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed">
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span>
                I represent that I am at least 18 years old. I accept the{' '}
                <Link href="/terms" className="underline hover:text-foreground" target="_blank">
                  Terms of Service
                </Link>
                ,{' '}
                <Link href="/refund" className="underline hover:text-foreground" target="_blank">
                  Refund Policy
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className="underline hover:text-foreground" target="_blank">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            {message && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{message}</p>
            )}
            <button
              type="button"
              onClick={() => complete(true)}
              disabled={!consentAccepted || submitting}
              className="mt-5 w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Finishing...' : 'Finish creating account'}
            </button>
          </div>
        )}

        {stage === 'error' && (
          <>
            <h2 className="text-xl font-bold mb-2">Sign-in didn&apos;t finish</h2>
            <p className="text-sm text-muted-foreground mb-5">{message}</p>
            <button
              type="button"
              onClick={() => complete(false)}
              disabled={submitting}
              className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Retrying...' : 'Try again'}
            </button>
          </>
        )}

        {stage === 'restart' && (
          <>
            <h2 className="text-xl font-bold mb-2">Please start again</h2>
            <p className="text-sm text-muted-foreground mb-5">{message}</p>
            <div className="flex flex-col gap-2">
              <Link
                href="/signup"
                className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors"
              >
                Go to sign up
              </Link>
              <Link href="/signin" className="text-sm text-primary hover:underline">
                Go to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
