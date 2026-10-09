'use client';
// app/signin/page.tsx
//
// Deliberately does NOT use the full marketing <Header /> (Features/How
// It Works/Pricing/FAQ) — every one of those is a way to navigate away
// from a page whose only job is "get this person signed in." Just a
// minimal top strip: logo (links home) + dark mode toggle. Full nav
// comes back the moment they're actually inside the dashboard.
//
// handleSubmit now calls /api/signin instead of calling
// supabase.auth.signInWithPassword() directly — the direct-from-client
// call had no server-side chokepoint to rate-limit at. The route
// verifies Turnstile and enforces the rate limit, then returns the
// session, which we set locally via supabase.auth.setSession() so the
// existing checkingSession/getSession() redirect logic below is
// unaffected.
//
// CHANGES (password policy): when /api/signin reports weakPassword (e.g. an
// account created under the old 6-character minimum), sign-in still
// succeeds, but instead of going straight to the dashboard a gentle prompt
// offers to set a new password right there (with the same live checklist as
// sign-up). "Not now" continues to the dashboard. It appears on every
// sign-in until the password is updated.
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import Link from 'next/link';
import { supabase } from '@/lib/mediacrater/supabaseClient';
import { AuthShowcasePanel } from '@/components/auth-showcase-panel';
import { isPasswordValid } from '@/lib/password-policy';
import { PasswordChecklist } from '@/components/password-checklist';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!;

type TurnstileAPI = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

function getTurnstile(): TurnstileAPI | undefined {
  return (window as unknown as { turnstile?: TurnstileAPI }).turnstile;
}

export default function SignInPage() {
  const [checkingSession, setCheckingSession] = useState(true)
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const [showWeakPasswordPrompt, setShowWeakPasswordPrompt] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [updatePasswordError, setUpdatePasswordError] = useState<string | null>(null);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get('reason') === 'scan_login_required') {
      setLoginNotice(
        'You need to be logged in to scan an ad. Please sign in, then go back to the extension and click Scan again.'
      );
    }
  }, []);
  
  useEffect(() => {
    if (!scriptReady) return;
    const turnstile = getTurnstile();
    if (!turnstile || !widgetRef.current || widgetIdRef.current) return;
    widgetIdRef.current = turnstile.render(widgetRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: 'auto',
      size: 'flexible',
      callback: (token: string) => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(null),
      'error-callback': () => setTurnstileToken(null),
    });
    return () => {
      if (widgetIdRef.current) {
        turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      setTurnstileToken(null);
    };
  }, [scriptReady]);

  function resetTurnstile() {
    const id = widgetIdRef.current;
    if (id) getTurnstile()?.reset(id);
    setTurnstileToken(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!turnstileToken) {
      setError('Please complete the verification check.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, turnstileToken }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to sign in. Please check your credentials.');
      }
      if (json.session) {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: json.session.access_token,
          refresh_token: json.session.refresh_token,
        });
        if (setSessionError) throw setSessionError;
      }
      if (json.weakPassword) {
        setShowWeakPasswordPrompt(true);
        return;
      }
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to sign in. Please check your credentials.');
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateWeakPassword(e: React.FormEvent) {
    e.preventDefault();
    setUpdatePasswordError(null);
    if (!isPasswordValid(newPassword) || newPassword !== confirmNewPassword) return;

    setUpdatingPassword(true);
    try {
      // The user just signed in, so Supabase accepts the change without
      // asking them to re-authenticate. Supabase re-checks the same rules.
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setShowWeakPasswordPrompt(false);
      router.push('/dashboard');
    } catch (err: any) {
      setUpdatePasswordError(err?.message || 'Could not update your password. Please try again.');
    } finally {
      setUpdatingPassword(false);
    }
  }

  function skipWeakPasswordUpdate() {
    setShowWeakPasswordPrompt(false);
    router.push('/dashboard');
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
      <AuthShowcasePanel variant="signin" />
      <Dialog
        open={showWeakPasswordPrompt}
        onOpenChange={(open) => {
          if (!open) skipWeakPasswordUpdate();
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Time to update your password</DialogTitle>
            <DialogDescription>
              Your password doesn&apos;t meet our updated security requirements. You can keep
              using it for now, but we recommend choosing a new one.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateWeakPassword} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium mb-1.5">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                aria-describedby="new-password-requirements"
                className="w-full px-3.5 py-2.5 bg-card border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="At least 10 characters"
              />
              <PasswordChecklist
                id="new-password-requirements"
                password={newPassword}
                confirmPassword={confirmNewPassword}
              />
            </div>
            <div>
              <label htmlFor="confirm-new-password" className="block text-sm font-medium mb-1.5">
                Confirm new password
              </label>
              <input
                id="confirm-new-password"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full px-3.5 py-2.5 bg-card border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="••••••••"
              />
            </div>
            {updatePasswordError && (
              <div className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-400">
                {updatePasswordError}
              </div>
            )}
            <div className="flex flex-col items-center gap-3">
              <button
                type="submit"
                disabled={
                  updatingPassword ||
                  !isPasswordValid(newPassword) ||
                  newPassword !== confirmNewPassword
                }
                className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {updatingPassword ? 'Updating...' : 'Update password'}
              </button>
              <button
                type="button"
                onClick={skipWeakPasswordUpdate}
                className="text-sm text-muted-foreground underline hover:text-foreground"
              >
                Not now, continue to dashboard
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <div className="w-full lg:w-1/2 flex flex-col min-h-screen bg-background">
        <div className="flex items-center justify-between px-6 py-5 lg:hidden">
          <Link href="/" className="font-bold text-foreground">
            Mediacrater
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <h2 className="text-2xl font-bold mb-1">Sign in</h2>
            <p className="text-sm text-muted-foreground mb-8">
              New here?{' '}
              <Link href="/signup" className="text-primary font-medium hover:underline">
                Create an account
              </Link>
            </p>
            {loginNotice && (
              <div className="mb-5 p-3 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 text-sm text-orange-800 dark:text-orange-300">
                {loginNotice}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-card border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium">Password</label>
                  <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-card border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="••••••••"
                />
              </div>
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
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
