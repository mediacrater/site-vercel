// lib/mediacrater/billing.ts
//
// Mirrors the extension's getBillingPortalUrl() in utils/supabase.js —
// same Edge Function (billing-portal), same auth model. No backend
// changes required; this is purely "point the web app at what already
// exists."

import { supabase } from './supabaseClient';

export async function getBillingPortalUrl(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/billing-portal`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to open billing portal');
  }

  const data = await response.json();
  return data.url as string;
}

/**
 * NOTE: buildUpgradeUrl() used to build a /buy-tokens URL with userId/email/
 * currentPlan as query params. That's gone — the web app's upgrade path is
 * now the authenticated /buy-scans page, which reads the session directly
 * the same way the rest of the dashboard does. No identity in the URL.
 */
