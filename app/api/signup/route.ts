import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const { email, password, acceptedTerms } = await req.json(); // acceptedTerms added

  // Server-side guard — can't be bypassed by calling the API directly
  if (!acceptedTerms) {
    return NextResponse.json({ error: 'Terms of service must be accepted' }, { status: 400 });
  }

  const ip = (
    req.headers.get('x-forwarded-for') ||
    req.headers.get('x-real-ip') ||
    ''
  ).split(',')[0].trim();

  const { data, error } = await supabaseAnon.auth.signUp({
    email,
    password,
    options: {
      data: {
        browser_id: null,
        signup_source: 'website'
      }
    }
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const userId = data.user?.id;
  if (userId) {
    const { error: upsertError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        email: email, // add this
        ip_at_creation: ip || null,
        accept_tos_privacy_refund_emailconsent_age18plus: new Date().toISOString()
      }, {
        onConflict: 'id',
        ignoreDuplicates: false
      });

    if (upsertError) {
      console.error('[SIGNUP] Failed to write profile data:', upsertError.message);
    }
  }
  return NextResponse.json({ success: true });
}
