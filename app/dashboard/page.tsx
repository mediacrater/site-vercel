//app/dashboard/page.tsx
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { ScanWorkspace, type WorkspaceProfile } from '@/components/scan-workspace';
import { supabase } from '@/lib/mediacrater/supabaseClient';

interface UserProfile extends WorkspaceProfile {
  id: string;
  scans_made: number;
  account_status: string;
  scan_history: boolean;
  subscription_cancel_at?: string | null;
  subscription_renews_at?: string | null;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<AppShell userEmail={null}><p className="text-muted-foreground text-sm">Loading...</p></AppShell>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showCheckoutSuccess, setShowCheckoutSuccess] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (searchParams.get('checkout') === 'success') {
      setShowCheckoutSuccess(true);
      // Strip the param so refreshing the page doesn't re-show the banner
      // — replaceState rather than router.replace() so this doesn't
      // trigger a Next.js navigation/re-render of the whole page.
      window.history.replaceState({}, '', '/dashboard');
    }
  }, [searchParams]);

  useEffect(() => {
    const initAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/signin');
        return;
      }
      setUser(session.user);
      await fetchUserData(session.user.id);
      setLoading(false);
    };
    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setUser(null);
        router.push('/signin');
      } else if (session) {
        setUser(session.user);
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  const fetchUserData = async (userId: string) => {
    try {
      const { data: profileData, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (!profileErr && profileData) {
        setProfile(profileData);
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    }
  };

  if (loading) {
    return (
      <AppShell userEmail={null}>
        <p className="text-muted-foreground text-sm">Loading your dashboard...</p>
      </AppShell>
    );
  }

  return (
    <AppShell userEmail={user?.email ?? null} plan={profile?.plan ?? null} scansRemaining={profile?.scans_remaining ?? null}>
      {showCheckoutSuccess && (
        <div className="mb-6 flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
          <p className="text-sm text-green-800 dark:text-green-400">
            <span className="font-semibold">You're all set!</span>
            {profile?.plan && profile.plan !== 'free' ? ` You're now on the ${profile.plan.charAt(0).toUpperCase()}${profile.plan.slice(1)} plan.` : ' Your plan has been updated.'}
          </p>
          <button
            onClick={() => setShowCheckoutSuccess(false)}
            className="text-green-800 dark:text-green-400 hover:opacity-70 text-sm"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Logged in as {user?.email}</p>
      </div>

      {/* Scan Workspace */}
      <div className="mb-10">
        <h2 className="text-lg font-bold mb-4">Run Ad Compliance Scan</h2>
        <ScanWorkspace profile={profile} onScanComplete={() => user && fetchUserData(user.id)} />
      </div>

      {/* Scan History teaser — full table lives at /scan-history now */}
      <div className="bg-card border border-border rounded-xl p-6 flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-sm">Scan History</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {profile?.scan_history
              ? 'Every scan you run is saved automatically.'
              : 'Available on paid plans — automatically saves every scan you run.'}
          </p>
        </div>
        <Link
          href="/scan-history"
          className="shrink-0 px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-secondary transition-colors"
        >
          {profile?.scan_history ? 'View History' : 'Learn more'}
        </Link>
      </div>
    </AppShell>
  );
}
