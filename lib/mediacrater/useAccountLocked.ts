//lib/mediacrater/useAccountLocked.ts
'use client';

// One source of truth for "is this account locked (action required)?".
// AppShell (header pills), SettingsPanel and ScanWorkspace all read this
// instead of keeping their own copy.
// - module-level cache: navigating between pages keeps the right state
// - one shared in-flight request: many components don't each query Supabase
// - markAccountLocked(): a scan error can update every screen at once
// Display only. The server still enforces the lock on every scan.

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/mediacrater/supabaseClient';

let cachedLocked = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<(locked: boolean) => void>();

function publish(locked: boolean) {
  cachedLocked = locked;
  listeners.forEach((listener) => listener(locked));
}

export function markAccountLocked(locked = true) {
  publish(locked);
}

export function refreshAccountLocked(): Promise<void> {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        publish(false);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('account_status')
        .eq('id', session.user.id)
        .single();

      // On an error keep the last known state instead of flipping it.
      if (!error && data) publish(data.account_status === 'action_required');
    } catch {
      // keep the last known state
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function useAccountLocked(): boolean {
  const [locked, setLocked] = useState(cachedLocked);

  useEffect(() => {
    listeners.add(setLocked);
    setLocked(cachedLocked);
    refreshAccountLocked();

    // Re-check when the user comes back to the tab (the sweep may have
    // locked or unlocked the account meanwhile).
    const onFocus = () => {
      refreshAccountLocked();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      listeners.delete(setLocked);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return locked;
}
