// app/api/resend-verification/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase env vars in resend-verification route');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // ── Server-side already-confirmed gate ──────────────────────────
    // This is the actual enforcement layer — nothing in the frontend
    // can bypass it, since the check happens here regardless of what
    // UI state the client believes it's in.
    //
    // auth.users isn't queryable directly via the REST client (not
    // exposed through PostgREST by default), so this looks the user up
    // via profiles (populated with id/email at signup) and then uses
    // the admin API's getUserById, which reliably returns
    // email_confirmed_at — rather than relying on an email-filter
    // parameter on listUsers() that may or may not behave as expected
    // across supabase-js versions.
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (profile?.id) {
      const { data: userData, error: userLookupError } = await supabaseAdmin.auth.admin.getUserById(profile.id);

      if (!userLookupError && userData?.user?.email_confirmed_at) {
        // Already confirmed — block here, not just in the UI.
        return NextResponse.json(
          { error: 'This email is already verified. Please sign in.' },
          { status: 400 }
        );
      }
    }
    // If no profile is found, fall through to attempting the resend —
    // Supabase's own resend() will fail gracefully for an unknown
    // email without this route needing to reveal whether the account
    // exists.

    const { error } = await supabaseAdmin.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`
      }
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to resend verification email' },
      { status: 500 }
    );
  }
}
