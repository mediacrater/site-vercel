'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/header';

const RESEND_COOLDOWN_SECONDS = 60;

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Resend recovery link state (matching signup flow)
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

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

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reset link');
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to request password reset. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Resend recovery link handler
  const handleResendReset = async () => {
    if (resendCooldown > 0 || resendStatus === 'sending') return;

    setResendStatus('sending');
    setResendError('');

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to resend recovery email');
      }

      setResendStatus('sent');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err: any) {
      setResendStatus('error');
      setResendError(err.message || 'Failed to resend recovery email');
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
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

              {/* Resend recovery link button */}
              <button
                onClick={handleResendReset}
                disabled={resendCooldown > 0 || resendStatus === 'sending'}
                className="text-sm font-semibold text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline mb-6 block w-full text-center"
              >
                {resendStatus === 'sending'
                  ? 'Sending...'
                  : resendCooldown > 0
                  ? `Resend available in ${resendCooldown}s`
                  : 'Resend recovery email'}
              </button>

              {resendStatus === 'sent' && resendCooldown === RESEND_COOLDOWN_SECONDS && (
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

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
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
