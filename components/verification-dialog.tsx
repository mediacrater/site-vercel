'use client';
// components/verification-dialogue.tsx
// CHANGES (password policy): the reset form uses the shared rules in
// lib/password-policy.ts (10+ characters, lowercase, uppercase, number,
// symbol) with the same live checklist as sign-up. "Reset Password" stays
// disabled until every rule passes and both passwords match. Supabase
// enforces the same rules when the password is saved.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { isPasswordValid } from '@/lib/password-policy';
import { PasswordChecklist } from '@/components/password-checklist';

type DialogType = 'email-verified' | 'password-reset' | 'error' | null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function VerificationDialogContent() {
  const [open, setOpen] = useState(false);
  const [dialogType, setDialogType] = useState<DialogType>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [redirectCountdown, setRedirectCountdown] = useState(3);
  
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const urlAccessToken = searchParams.get('access_token');
    const type = searchParams.get('type');

    const hash = window.location.hash;
    const hashParams = new URLSearchParams(hash.substring(1));
    const hashAccessToken = hashParams.get('access_token');
    const hashType = hashParams.get('type');
    const hashError = hashParams.get('error');
    const hashErrorDesc = hashParams.get('error_description');

    const finalAccessToken = urlAccessToken || hashAccessToken;
    const finalType = type || hashType;

    if (hash) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (hashError) {
      if (hashError === 'access_denied' && hashErrorDesc?.includes('expired')) {
        setErrorMessage('This link has expired or is invalid. Please request a new one.');
      } else {
        setErrorMessage(hashErrorDesc || 'An error occurred. Please try again.');
      }
      setDialogType('error');
      setOpen(true);
      return;
    }

    if (finalAccessToken && finalType === 'signup') {
      setDialogType('email-verified');
      setOpen(true);
    }

    if (finalAccessToken && finalType === 'recovery') {
      setAccessToken(finalAccessToken);
      setDialogType('password-reset');
      setOpen(true);
    }
  }, [searchParams]);

  // Auto-redirect effect when email is verified
  useEffect(() => {
    if (dialogType !== 'email-verified' || !open) return;

    const timer = setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.push('/dashboard');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [dialogType, open, router]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isPasswordValid(password)) {
      setErrorMessage('Please choose a password that meets all the requirements below.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.msg || 'Failed to reset password');
      }

      setResetSuccess(true);

    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    window.history.replaceState({}, document.title, '/');
  };

  const goToDashboard = () => {
    setOpen(false);
    router.push('/dashboard');
  };

  if (!open) return null;

  // ── Email Verified ──────────────────────────────────────────
  if (dialogType === 'email-verified') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-xl border border-border">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
            <svg className="h-10 w-10 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-center text-2xl font-bold text-card-foreground">Email Verified!</h2>
          <p className="text-center text-sm text-muted-foreground mt-1 mb-4">
            Your account has been successfully verified.
          </p>

          <div className="space-y-4">
            <div className="rounded-lg bg-primary/10 border-l-4 border-primary p-4">
              <p className="text-sm font-semibold text-foreground">
                🎉 3 free scans added to your account!
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Free plan includes 3 scans per month.
              </p>
            </div>

            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4">
              <p className="text-sm text-blue-900 dark:text-blue-300 font-semibold mb-1">
                Redirecting to your Dashboard in {redirectCountdown}s...
              </p>
              <p className="text-xs text-blue-800 dark:text-blue-400">
                You can start running ad compliance scans immediately on the web or via the Chrome extension.
              </p>
            </div>

            <button
              onClick={goToDashboard}
              className="w-full bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors"
            >
              Go to Dashboard Now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Password Reset ──────────────────────────────────────────
  if (dialogType === 'password-reset') {
    if (resetSuccess) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-xl border border-border">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
              <svg className="h-10 w-10 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-center text-2xl font-bold text-card-foreground">Password Updated!</h2>
            <p className="text-center text-sm text-muted-foreground mt-1 mb-4">
              Your password has been successfully reset.
            </p>

            <div className="space-y-4">
              <button
                onClick={() => router.push('/signin')}
                className="w-full bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors"
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-xl border border-border">
          <h2 className="text-center text-2xl font-bold text-card-foreground">Reset Your Password</h2>
          <p className="text-center text-sm text-muted-foreground mt-1 mb-4">
            Enter your new password below
          </p>

          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2 text-card-foreground">
                New Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                aria-describedby="reset-password-requirements"
                className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
                placeholder="At least 10 characters"
              />
              <PasswordChecklist
                id="reset-password-requirements"
                password={password}
                confirmPassword={confirmPassword}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2 text-card-foreground">
                Confirm Password
              </label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
                placeholder="Re-enter your password"
              />
            </div>

            {errorMessage && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-800 dark:text-red-400">{errorMessage}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !isPasswordValid(password) || password !== confirmPassword}
              className="w-full bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────
  if (dialogType === 'error') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-xl border border-border">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
            <svg className="h-10 w-10 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-center text-2xl font-bold text-card-foreground">Link Expired</h2>
          <p className="text-center text-sm text-muted-foreground mt-1 mb-4">
            {errorMessage}
          </p>

          <button
            onClick={handleClose}
            className="w-full bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export function VerificationDialog() {
  return (
    <Suspense fallback={null}>
      <VerificationDialogContent />
    </Suspense>
  );
}
