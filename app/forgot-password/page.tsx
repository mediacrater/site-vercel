// app/forgot-password/page.tsx
'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Script from 'next/script';
import Link from 'next/link';
import { Header } from '@/components/header';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!;

type TurnstileAPI = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

function getTurnstile(): TurnstileAPI | undefined {
  return (window as unknown as { turnstile?: TurnstileAPI }).turnstile;
}

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Resend recovery link state. resendCooldown is a fixed 60s client-side
  // pacing cooldown — deliberately NOT tied to the server's 10/24hr
  // reset_password rate limit (that limit is backend abuse protection and
  // has no sane UI countdown), and NOT tied to Supabase's own internal
  // per-email send cooldown either (undocumented, not worth parsing from
  // its error response). This is just "don't let someone mash the button,"
  // shown clearly so the button's state is never a silent mystery.
  const RESEND_COOLDOWN_SECONDS = 90;
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const [scriptReady, setScriptReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Pre-fill email from extension URL query if available
  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) {
      setEmail(decodeURIComponent(emailParam));
    }
  }, [searchParams]);

  // Cooldown ticker
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (!scriptReady) return;
    const turnstile = getTurnstile();
    if (!turnstile || !widgetRef.current) return;

    // Re-render whenever the active container changes (the initial form
    // and the post-submit success view each have their own
    // <div ref={widgetRef}>, and only one is mounted at a time — success
    // swaps the entire returned JSX tree). Tearing down any previous
    // widget first avoids the original bug: checking only
    // widgetIdRef.current caused the effect to no-op after the first
    // render, leaving the success view's container permanently empty and
    // turnstileToken stuck null — which is why the resend button never
    // showed a countdown, just stayed disabled.
    if (widgetIdRef.current) {
      turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }

    widgetIdRef.current = turnstile.render(widgetRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: 'auto',
      size: 'flexible',
      callback: (token: string) => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(null),
      'error-callback': () => setTurnstileToken(null),
    });
    setTurnstileToken(null);

    return () => {
      if (widgetIdRef.current) {
        turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [scriptReady, success]);

  function resetTurnstile() {
    const id = widgetIdRef.current;
    if (id) getTurnstile()?.reset(id);
    setTurnstileToken(null);
  }

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!turnstileToken) {
      setError('Please complete the verification check.');
      return;
    }
    setLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reset link');
      }

      setSuccess(true);
      resetTurnstile();
      // Start the cooldown immediately on the original send, not just on
      // resend — this is the gap that caused the confusing "Email limit
      // exceeded" flash: the button was fully clickable with no visible
      // state right after the first email went out.
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err: any) {
      setError(err.message || 'Failed to request password reset. Please try again.');
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  };

  // Resend recovery link handler
  const handleResendReset = async () => {
    if (resendCooldown > 0 || resendStatus === 'sending') return;
    if (!turnstileToken) {
      setResendError('Please complete the verification check.');
      return;
    }

    setResendStatus('sending');
    setResendError('');

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        setResendStatus('error');
        setResendError(data.error || 'Failed to resend recovery email');
        resetTurnstile();
        return;
      }

      setResendStatus('sent');
      resetTurnstile();
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err: any) {
      setResendStatus('error');
      setResendError(err.message || 'Failed to resend recovery email');
      resetTurnstile();
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
        />
        <div className="flex items-center justify-center min-h-screen px-4 pt-16">
          <div className="w-full max-w-md">
            <div className="bg-card border border-border rounded-lg shadow-lg p-8 text-center">
              <div className="mb-6">
                <div className="w-20 h-20 mx-auto bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
                  <svg className="w-12 h-12 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <h1 className="text-3xl font-bold text-card-foreground mb-4">Check Your Email!</h1>
              <p className="text-muted-foreground mb-6">We've sent a recovery link to:</p>
              <p className="text-lg font-semibold text-foreground mb-6">{email}</p>
              
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6 text-left">
                <p className="text-sm text-blue-900 dark:text-blue-300 font-semibold mb-2">Next Steps:</p>
                <ol className="text-sm text-blue-800 dark:text-blue-400 space-y-1 ml-4">
                  <li>1. Click the recovery link inside your email</li>
                  <li>2. Enter a new secure password on the page</li>
                  <li>3. Open your Mediacrater extension</li>
                  <li>4. Sign in with your new password and continue!</li>
                </ol>
              </div>

              <p className="text-xs text-muted-foreground mb-2">Don't see the email? Check your spam folder.</p>

              <div ref={widgetRef} className="flex justify-center mb-4" />

              {/* Resend recovery link button */}
              <button
                onClick={handleResendReset}
                disabled={resendCooldown > 0 || resendStatus === 'sending' || !turnstileToken}
                className="text-sm font-semibold text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline mb-6 block w-full text-center"
              >
                {resendStatus === 'sending'
                  ? 'Sending...'
                  : resendCooldown > 0
                  ? `Resend available in ${resendCooldown}s`
                  : 'Resend recovery email'}
              </button>

              {resendStatus === 'sent' && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 mb-4">
                  <p className="text-sm text-green-800 dark:text-green-400">Recovery link resent. Check your inbox.</p>
                </div>
              )}

              {resendStatus === 'error' && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4">
                  <p className="text-sm text-red-800 dark:text-red-400">{resendError}</p>
                </div>
              )}

              <Link href="/" className="block w-full bg-secondary text-secondary-foreground px-6 py-3 rounded-lg font-semibold hover:bg-secondary/80 transition-colors">
                Back to Homepage
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div className="flex items-center justify-center min-h-screen px-4 pt-16">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-lg shadow-lg p-8">
            <h1 className="text-3xl font-bold text-card-foreground mb-2 text-center">Reset Your Password</h1>
            <p className="text-muted-foreground text-center mb-8">Enter your details to request a secure recovery link</p>

            <form onSubmit={handleResetRequest} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-card-foreground mb-2">Email Address</label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="your.email@example.com"
                />
              </div>

              <div ref={widgetRef} />
              {!TURNSTILE_SITE_KEY && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Turnstile site key is missing. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY and redeploy.
                </p>
              )}

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !turnstileToken}
                className="w-full bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Sending Recovery Link...' : 'Send Recovery Link'}
              </button>
            </form>

            <div className="mt-6 text-center text-sm">
              <Link href="/" className="text-primary hover:underline font-semibold">
                ← Back to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Next.js App Router requires useSearchParams to be wrapped inside a Suspense Boundary
export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
        </div>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}
