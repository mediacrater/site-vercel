// lib/mediacrater/supabaseClient.ts
//
// Single shared Supabase client for the whole web app. Import this
// everywhere instead of calling createClient() again in individual
// pages/components — multiple client instances against the same
// storageKey trigger Supabase's "Multiple GoTrueClient instances"
// warning and can cause auth state to fall out of sync between them.
//
// This is the SAME Supabase project (same URL/anon key) the extension
// points at, and Supabase Auth sessions are just JWTs backed by rows
// in auth.users — so a user signed into the extension and signed into
// this web app are simply two independent sessions against the same
// account. Nothing extra is needed to "link" them: scans_remaining,
// account_status, plan, etc. all live on one profiles row keyed by
// auth.users.id, so a scan run from either client updates the same
// row the other client reads on its next fetch.

import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
