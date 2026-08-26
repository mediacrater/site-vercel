'use client';

// app/settings/page.tsx
//
// Settings used to be an in-page toggle inside dashboard/page.tsx (gear
// icon swapping the main content). Now that Scan History is also its own
// page, a real sidebar with real routes made more sense than a single
// dashboard page juggling multiple view states — this is that page.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { SettingsPanel, type SettingsProfile } from '@/components/settings-panel';
import { getBillingPortalUrl } from '@/lib/mediacrater/billing';
import { supabase } from '@/lib/mediacrater/supabaseClient';

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<SettingsProfile | null>(null);

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/signin');
        return;
      }
      setUserId(session.user.id);
      setEmail(session.user.email ?? null);

      const { data: profileData } = await supabase
        .from('profiles')
        .select('plan, scans_remaining, subscription_cancel_at, subscription_renews_at')
        .eq('id', session.user.id)
        .single();
      setProfile(profileData);
      setLoading(false);
    };
    init();
  }, [router]);

  if (loading || !userId || !email || !profile) {
    return (
      <AppShell userEmail={email}>
        <p className="text-muted-foreground text-sm">Loading...</p>
      </AppShell>
    );
  }

  return (
    <AppShell userEmail={email} plan={profile.plan ?? null} scansRemaining={profile.scans_remaining ?? null}>
      <SettingsPanel userId={userId} email={email} profile={profile}
        onManagePlan={getBillingPortalUrl}
      />
    </AppShell>
  );
}
