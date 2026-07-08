'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type DialogType = 'email-verified' | 'password-reset' | 'error' | null;

function VerificationDialogContent() {
  const [open, setOpen] = useState(false);
  const [dialogType, setDialogType] = useState<DialogType>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const searchParams = useSearchParams();

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

    // Clean URL immediately so token never lingers visibly
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

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
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

  // ── Email Verified ──────────────────────────────────────────
  if (dialogType === 'email-verified') {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
              <svg className="h-10 w-10 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <DialogTitle className="text-center text-2xl">Email Verified!</DialogTitle>
            <DialogDescription className="text-center">
              Your account has been successfully verified.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg bg-primary/10 border-l-4 border-primary p-4">
              <p className="text-sm font-semibold text-foreground">
                🎉 3 free scans added to your account!
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Free plan includes 3 scans per month. Upgrade anytime for more.
              </p>
            </div>

            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4">
              <p className="text-sm text-blue-900 dark:text-blue-300 font-semibold mb-2">
                📌 Next Steps:
              </p>
              <ol className="text-sm text-blue-800 dark:text-blue-400 space-y-1 ml-4">
                <li>1. Open the Mediacrater Chrome extension</li>
                <li>2. Sign in with your email and password</li>
                <li>3. Start scanning your ads!</li>
              </ol>
            </div>

            <button
              onClick={handleClose}
              className="w-full bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors"
            >
              Got it!
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Password Reset ──────────────────────────────────────────
  if (dialogType === 'password-reset') {
    if (resetSuccess) {
      return (
        <Dialog open={open} onOpenChange={handleClose}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
                <svg className="h-10 w-10 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <DialogTitle className="text-center text-2xl">Password Updated!</DialogTitle>
              <DialogDescription className="text-center">
                Your password has been successfully reset.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4">
                <p className="text-sm text-blue-900 dark:text-blue-300 font-semibold mb-2">
                  📌 Next Steps:
                </p>
                <ol className="text-sm text-blue-800 dark:text-blue-400 space-y-1 ml-4">
                  <li>1. Open the Mediacrater Chrome extension</li>
                  <li>2. Sign in with your new password</li>
                  <li>3. Start scanning your ads!</li>
                </ol>
              </div>

              <button
                onClick={handleClose}
                className="w-full bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors"
              >
                Got it!
              </button>
            </div>
          </DialogContent>
        </Dialog>
      );
    }

    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center text-2xl">Reset Your Password</DialogTitle>
            <DialogDescription className="text-center">
              Enter your new password below
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2">
                New Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Minimum 6 characters"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2">
                Confirm Password
              </label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
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
              disabled={loading}
              className="w-full bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Error ───────────────────────────────────────────────────
  if (dialogType === 'error') {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
              <svg className="h-10 w-10 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <DialogTitle className="text-center text-2xl">Link Expired</DialogTitle>
            <DialogDescription className="text-center">
              {errorMessage}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <button
              onClick={handleClose}
              className="w-full bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
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
