// components/google-auth-button.tsx
'use client';

// "Continue with Google" for /signup and /signin.
//
// 1. POST /api/oauth/start (VPS, through the Cloudflare Worker): Turnstile,
//    rate limit, consent (sign-up), and the signed intent cookie.
// 2. Only then hand off to Google via Supabase.
// The Turnstile token is single-use, so onTurnstileUsed() always runs after
// /start, success or not.
//
// Logo: Google's brand rules require their official "G" mark. Download it
// from Google's Sign-In branding guidelines and save it as
// public/images/google-g.svg. If the file is missing, the logo is hidden.

import { useState } from 'react';
import { supabase } from '@/lib/mediacrater/supabaseClient';

type Mode = 'signup' | 'signin';

export function GoogleAuthButton({
  mode,
  turnstileToken,
  consentAccepted = false,
  disabled = false,
  onError,
  onTurnstileUsed,
}: {
  mode: Mode;
  turnstileToken: string | null;
  consentAccepted?: boolean;
  disabled?: boolean;
  onError: (message: string | null) => void;
  onTurnstileUsed: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [logoMissing, setLogoMissing] = useState(false);

  async function handleClick() {
    onError(null);

    if (mode === 'signup' && !consentAccepted) {
      onError('Please confirm you are 18+ and accept the Terms, Refund Policy, and Privacy Policy to continue.');
      return;
    }
    if (!turnstileToken) {
      onError('Please complete the verification check.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/oauth/start', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          acceptedTerms: mode === 'signup' ? consentAccepted : false,
          turnstileToken,
        }),
      });
      onTurnstileUsed();

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Google sign-in is unavailable right now. Please try again.');
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) throw error;
      // The browser is now leaving for Google; keep the loading state.
    } catch (err: any) {
      onError(err?.message || 'Google sign-in failed. Please try again.');
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading}
      className="w-full flex items-center justify-center gap-2.5 border border-input bg-card py-2.5 rounded-lg font-semibold text-sm hover:bg-secondary transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {!logoMissing && (
        <img
          src="/images/google-g.png"
          alt=""
          width={18}
          height={18}
          className="h-[18px] w-[18px]"
          onError={() => setLogoMissing(true)}
        />
      )}
      {loading
        ? 'Redirecting to Google...'
        : mode === 'signup'
        ? 'Sign up with Google'
        : 'Sign in with Google'}
    </button>
  );
}
