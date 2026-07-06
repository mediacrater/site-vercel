'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/header';

const RESEND_COOLDOWN_SECONDS = 60;

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false); // NEW
  const router = useRouter();

  // NEW: resend verification state
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // NEW: cooldown ticker
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      setLoading(false);
      return;
    }

    // NEW
    if (!acceptedTerms) {
      setError('You must accept the terms of service and privacy policy to create an account');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, acceptedTerms }) // acceptedTerms added
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Signup failed');
      }

      setSuccess(true);

    } catch (err: any) {
      setError(err.message || 'Failed to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // NEW: resend verification handler
  const handleResendVerification = async () => {
    if (resendCooldown > 0 || resendStatus === 'sending') return;

    setResendStatus('sending');
    setResendError('');

    try {
      const response = await fetch('/api/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to resend verification email');
      }

      setResendStatus('sent');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err: any) {
      setResendStatus('error');
      setResendError(err.message || 'Failed to resend verification email');
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
              <p className="text-muted-foreground mb-6">We've sent a verification link to:</p>
              <p className="text-lg font-semibold text-foreground mb-6">{email}</p>
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6 text-left">
                <p className="text-sm text-blue-900 dark:text-blue-300 font-semibold mb-2">Next Steps:</p>
                <ol className="text-sm text-blue-800 dark:text-blue-400 space-y-1 ml-4">
                  <li>1. Click the verification link in your email</li>
                  <li>2. Open the Mediacrater extension</li>
                  <li>3. Sign in with your email and password</li>
                  <li>4. Start scanning with your 3 free scans!</li>
                </ol>
              </div>
              <div className="bg-primary/10 border-l-4 border-primary rounded p-3 mb-6">
                <p className="text-sm font-semibold text-card-foreground">You'll receive 3 monthly scans after verification</p>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Don't see the email? Check your spam folder.</p>

              {/* NEW: resend verification button */}
              <button
                onClick={handleResendVerification}
                disabled={resendCooldown > 0 || resendStatus === 'sending'}
                className="text-sm font-semibold text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline mb-4"
              >
                {resendStatus === 'sending'
                  ? 'Sending...'
                  : resendCooldown > 0
                  ? `Resend available in ${resendCooldown}s`
                  : 'Resend verification email'}
              </button>

              {resendStatus === 'sent' && resendCooldown === RESEND_COOLDOWN_SECONDS && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 mb-4">
                  <p className="text-sm text-green-800 dark:text-green-400">Verification email resent. Check your inbox.</p>
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
            <h1 className="text-3xl font-bold text-card-foreground mb-2 text-center">Create Your Account</h1>
            <p className="text-muted-foreground text-center mb-8">Get started with 3 free scans</p>

            <form onSubmit={handleSignup} className="space-y-6">
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

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-card-foreground mb-2">Password</label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-4 py-3 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Minimum 6 characters"
                />
                <p className="text-xs text-muted-foreground mt-1">Must be at least 6 characters long</p>
              </div>

              {/* NEW: Terms checkbox */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="terms"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-input accent-primary cursor-pointer"
                />
                <label htmlFor="terms" className="text-sm text-muted-foreground">
                  I accept the{' '}
                  <a href="/terms" target="_blank" className="text-primary hover:underline">Terms of Service</a>
                  {', '}
                  <a href="/refund" target="_blank" className="text-primary hover:underline">Refund Policy</a>
                  {' and '}
                  <a href="/privacy" target="_blank" className="text-primary hover:underline">Privacy Policy</a>. I consent to receiving a one time verification link to confirm my email address.
                </label>
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
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
