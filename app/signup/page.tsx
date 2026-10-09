'use client';
// app/signup/page.tsx

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { AuthShowcasePanel } from '@/components/auth-showcase-panel';
import { collectDeviceClient } from '@/lib/collect-device-client';
import { supabase } from "@/lib/mediacrater/supabaseClient"
import { suggestEmailCorrection } from '@/lib/email-typo';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!;
// Mirrors RESEND_WINDOW_SECONDS in app/api/resend-verification/route.ts.
// Kept as a constant here (rather than only trusting the server's
// response) so the countdown can start immediately after the original
// signup send, before any /api/resend-verification call has happened to
// return a real retryAfterSeconds value.
const RESEND_WINDOW_SECONDS = 100;

type TurnstileAPI = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

function getTurnstile(): TurnstileAPI | undefined {
  return (window as unknown as { turnstile?: TurnstileAPI }).turnstile;
}

export default function SignUpPage() {
  const [checkingSession, setCheckingSession] = useState(true)
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  // True when the current resendError belongs to a countdown (429), so it can
  // disappear when the countdown ends. Other errors stay until the next try.
  const [resendErrorTiedToCooldown, setResendErrorTiedToCooldown] = useState(false);
  const [alreadyConfirmed, setAlreadyConfirmed] = useState(false);
  const [showEmailConfirm, setShowEmailConfirm] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  // Set by "You got this wrong" so closing the popup focuses the email field
  // instead of returning focus to the submit button.
  const focusEmailOnClose = useRef(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace("/dashboard")
        return
      }

      if (mounted) {
        setCheckingSession(false)
      }
    })

    return () => {
      mounted = false
    }
  }, [router])
  
  // Cooldown ticker — counts down whatever retryAfterSeconds the server
  // last returned (from a successful send, or from a 429's actual
  // remaining wait), one second at a time, down to 0.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);
  useEffect(() => setMounted(true), []);

  // While the "Check your email" screen is open, detect the confirmation
  // happening elsewhere in this browser: the link signs the user in, and
  // Supabase shares that sign-in across tabs. The focus check is a fallback
  // for when the user comes back to this tab.
  useEffect(() => {
    if (!checkEmail) return;

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setAlreadyConfirmed(true);
    });

    const checkSession = () => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) setAlreadyConfirmed(true);
      });
    };
    window.addEventListener('focus', checkSession);

    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener('focus', checkSession);
    };
  }, [checkEmail]);

  useEffect(() => {
    if (!mounted || !scriptReady) return;
    const turnstile = getTurnstile();
    if (!turnstile || !widgetRef.current) return;

    // Re-render whenever the active container changes (form view vs.
    // checkEmail view each have their own <div ref={widgetRef}>, and only
    // one is mounted in the DOM at a time). Tearing down any previous
    // widget first avoids silently no-op'ing because widgetIdRef.current
    // was already set from a render into the *other* view's now-unmounted
    // div — that was the original bug: the effect only checked
    // widgetIdRef.current and returned early, so switching views left the
    // new container empty and turnstileToken permanently null.
    if (widgetIdRef.current) {
      turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }

    widgetIdRef.current = turnstile.render(widgetRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      size: 'flexible',
      callback: (token: string) => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(null),
      'error-callback': () => setTurnstileToken(null),
    });
    setTurnstileToken(null); // fresh container, no token until user completes it

    return () => {
      if (widgetIdRef.current) {
        turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [mounted, scriptReady, resolvedTheme, checkEmail]);

  const logoSrc = mounted && resolvedTheme === 'dark' ? '/images/header-logo-dark.png' : '/images/header-logo.png';
  function resetTurnstile() {
    const id = widgetIdRef.current;
    if (id) getTurnstile()?.reset(id);
    setTurnstileToken(null);
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (!consentAccepted) {
      setError('Please confirm you are 18+ and accept the Terms, Refund Policy, and Privacy Policy to continue.');
      return;
    }
    if (!turnstileToken) {
      setError('Please complete the verification check.');
      return;
    }
    // Ask the user to double-check the address before anything is sent.
    setShowEmailConfirm(true);
  }

  function handleChangeEmail() {
    focusEmailOnClose.current = true;
    setShowEmailConfirm(false);
  }

  function handleConfirmEmail() {
    setShowEmailConfirm(false);
    void createAccount();
  }

  async function createAccount() {
    setError(null);
    setLoading(true);
    try {
      const device = await collectDeviceClient();
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          acceptedTerms: true,
          timezone: device.timezone,
          browser: device.browser,
          browser_version: device.browser_version,
          os: device.os,
          device_fp: device.device_fp,
          turnstileToken,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to create account.');
      }
      // TODO (Phase C): referral attribution hook goes here, once the
      // links table + consent banner exist — read mc_referrer cookie,
      // write into profiles.referrer for the new user.
      if (json.hasSession) {
        router.push('/dashboard');
      } else {
        setCheckEmail(true);
        resetTurnstile(); // fresh token required for the resend action
        // Start the same cooldown that /api/resend-verification enforces
        // (1 per 100s) immediately, since the original signup call just
        // sent the first confirmation email — the resend button should
        // reflect that from the moment this screen appears, not stay
        // silently clickable until the first rejected click reveals it.
        setResendCooldown(RESEND_WINDOW_SECONDS);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create account. Please try again.');
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  }
  // Calls /api/resend-verification, which now enforces Turnstile and a
  // 1-per-100-second rate limit server-side. retryAfterSeconds drives the
  // countdown in both the success and 429 cases, so the displayed number
  // always reflects the server's real state rather than a client guess.
  async function handleResendVerification() {
    if (resendCooldown > 0 || resendState === 'sending') return;
    if (!turnstileToken) {
      setResendError('Please complete the verification check.');
      return;
    }
    setResendError(null);
    setResendErrorTiedToCooldown(false);
    setResendState('sending');
    try {
      const response = await fetch('/api/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const data = await response.json();
      if (response.ok && data.alreadyConfirmed) {
        setAlreadyConfirmed(true);
        setResendState('idle');
        setResendCooldown(0);
        return;
      }
      if (!response.ok) {
        // Even on a 429, the server tells us the real remaining wait —
        // reflect it in the countdown rather than leaving it at 0.
        if (typeof data.retryAfterSeconds === 'number') {
          setResendCooldown(data.retryAfterSeconds);
          setResendErrorTiedToCooldown(true);
        }
        throw new Error(data.error || 'Failed to resend verification email');
      }
      setResendState('sent');
      setResendCooldown(data.retryAfterSeconds ?? RESEND_WINDOW_SECONDS);
      resetTurnstile();
    } catch (err: any) {
      setResendError(err.message || 'Failed to resend verification email. Please try again.');
      setResendState('idle');
      resetTurnstile();
    }
  }
  if (checkingSession) {
    return null
  }
  return (
    <div className="min-h-screen flex">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <AuthShowcasePanel variant="signup" />
      <div className="w-full lg:w-1/2 flex flex-col min-h-screen bg-background">
        <div className="flex items-center justify-between px-6 py-5 lg:hidden">
          <Link href="/" className="flex items-center gap-2 font-bold text-foreground">
            <img src={logoSrc} alt="Mediacrater" className="h-8 w-8" />
            Mediacrater
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            {checkEmail ? (
              <div className="text-center">
                <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-primary">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold mb-2">Check your email</h2>
                <p className="text-sm text-muted-foreground mb-5">
                  We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
                </p>
                {/* The widget container stays mounted (hidden) so the
                    Turnstile effect's cleanup keeps working. */}
                <div
                  ref={widgetRef}
                  className={alreadyConfirmed ? 'hidden' : 'flex justify-center mb-4'}
                />
                {alreadyConfirmed ? (
                  <div
                    role="status"
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-left text-sm text-amber-800 dark:text-amber-300"
                  >
                    Your email has already been confirmed. Please refresh the page to access
                    the dashboard. If you confirmed it on another device,{' '}
                    <Link href="/signin" className="font-medium underline">
                      sign in
                    </Link>{' '}
                    instead. If you&apos;re encountering issues, please contact support for
                    assistance.
                  </div>
                ) : (
                  <>
                    <button
                      onClick={handleResendVerification}
                      disabled={resendState === 'sending' || resendCooldown > 0 || !turnstileToken}
                      className="text-sm font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
                    >
                      {resendState === 'sending'
                        ? 'Sending...'
                        : resendCooldown > 0
                        ? `Resend available in ${resendCooldown}s`
                        : 'Resend Email'}
                    </button>
                    {resendState === 'sent' && (
                      <p className="text-sm text-green-600 dark:text-green-400 mt-2">✓ Verification email sent!</p>
                    )}
                    {/* Countdown errors disappear when the countdown reaches 0,
                        since a fresh attempt is allowed again. Other errors
                        stay visible until the next attempt. */}
                    {resendError && (!resendErrorTiedToCooldown || resendCooldown > 0) && (
                      <p className="text-sm text-red-600 dark:text-red-400 mt-2">{resendError}</p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-bold mb-1">Create your account</h2>
                <p className="text-sm text-muted-foreground mb-8">
                  Already have one?{' '}
                  <Link href="/signin" className="text-primary font-medium hover:underline">
                    Sign in
                  </Link>
                </p>
                <Dialog open={showEmailConfirm} onOpenChange={setShowEmailConfirm}>
                  <DialogContent
                    showCloseButton={false}
                    onCloseAutoFocus={(event) => {
                      if (focusEmailOnClose.current) {
                        event.preventDefault();
                        focusEmailOnClose.current = false;
                        emailInputRef.current?.focus();
                        emailInputRef.current?.select();
                      }
                    }}
                  >
                    <DialogHeader className="text-center">
                      {/* One line on tablet/desktop; may wrap on narrow phones. */}
                      <DialogTitle className="text-center sm:whitespace-nowrap">
                        Double check if we got your email right
                      </DialogTitle>
                      <DialogDescription className="break-all pt-2 text-center text-base font-semibold text-foreground">
                        {email.trim()}
                      </DialogDescription>
                    </DialogHeader>
                    {(() => {
                      const suggestion = suggestEmailCorrection(email);
                      return suggestion ? (
                        <p className="text-center text-sm text-muted-foreground">
                          Did you mean{' '}
                          <button
                            type="button"
                            onClick={() => setEmail(suggestion)}
                            className="break-all font-medium text-primary underline"
                          >
                            {suggestion}
                          </button>
                          ?
                        </p>
                      ) : null;
                    })()}
                    <div className="flex flex-col items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={handleChangeEmail}
                        className="text-sm text-muted-foreground underline hover:text-foreground"
                      >
                        You got this wrong, change email
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmEmail}
                        disabled={loading}
                        className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        That is my email
                      </button>
                    </div>
                  </DialogContent>
                </Dialog>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Email</label>
                    <input
                      ref={emailInputRef}
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-card border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="you@company.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Password</label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-card border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="At least 6 characters"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Confirm Password</label>
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-card border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="••••••••"
                    />
                  </div>
                  <label className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed pt-1">
                    <input
                      type="checkbox"
                      required
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
                      </Link>
                      {' '}
                      and{' '}
                      <Link href="/privacy" className="underline hover:text-foreground" target="_blank">
                        Privacy Policy
                      </Link>
                      . I consent to receiving a one time verification link to confirm my email address.
                    </span>
                  </label>
                  <div ref={widgetRef} />
                  {!TURNSTILE_SITE_KEY && (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Turnstile site key is missing. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY and redeploy.
                    </p>
                  )}
                  {error && (
                    <div className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-400">
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading || !turnstileToken}
                    className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Creating account...' : 'Create Account'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
