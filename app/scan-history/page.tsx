'use client';

// app/scan-history/page.tsx
//
// Redesigned to match the extension's history UI: a searchable list of
// past scans, each clickable into a full detail view (back-button
// navigation within the page, not a separate route — same pattern as
// the extension's popup swapping between its history list and history
// detail screens).
//
// Deliberately NOT porting the extension's "storage used / Manage
// Storage" bar — that's a chrome.storage.local quota concept, and
// Supabase Storage doesn't have an equivalent per-user cap, so showing
// a number there would be meaningless rather than just missing.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { supabase } from '@/lib/mediacrater/supabaseClient';
import { getThumbnailSignedUrl } from '@/lib/mediacrater/thumbnails';
import {
  calculateConfidenceScore,
  groupViolationsByType,
  severityBorderClass,
  type Violation,
} from '@/lib/mediacrater/scoreCalculator';

interface ScanRecord {
  id: string;
  created_at: string;
  target_platform: string;
  content_type: string;
  scan_type: string;
  violations_found: number;
  status: string;
  origin: string;
  thumbnail_url: string | null;
  file_name: string | null;
  generated_data: { platform?: string; violations?: Violation[] } | null;
}

const PLATFORM_ICON: Record<string, string> = {
  youtube: '/images/platform-icons/youtube.png',
  meta: '/images/platform-icons/meta.png',
  tiktok: '/images/platform-icons/tiktok.png',
  pinterest: '/images/platform-icons/pinterest.png',
  x: '/images/platform-icons/x.png',
};

const riskBadgeClass: Record<string, string> = {
  'confidence-low': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  'confidence-medium': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  'confidence-high': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

export default function ScanHistoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [scansRemaining, setScansRemaining] = useState<number | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [history, setHistory] = useState<ScanRecord[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/signin');
        return;
      }
      setEmail(session.user.email ?? null);

      const { data: profile } = await supabase
        .from('profiles')
        .select('scan_history, scans_remaining, plan')
        .eq('id', session.user.id)
        .single();

      setPlan(profile?.plan ?? null);
      setScansRemaining(profile?.scans_remaining ?? null);
      const access = Boolean(profile?.scan_history);
      setHasAccess(access);

      if (access) {
        const { data: scans } = await supabase
          .from('scans')
          .select(
            'id, created_at, target_platform, content_type, scan_type, violations_found, status, origin, thumbnail_url, file_name, generated_data'
          )
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(100);

        setHistory(scans || []);

        const paths = (scans || []).filter((s) => s.thumbnail_url).map((s) => s.thumbnail_url as string);
        const uniquePaths = Array.from(new Set(paths));
        const resolved = await Promise.all(
          uniquePaths.map(async (path) => [path, await getThumbnailSignedUrl(path)] as const)
        );
        const map: Record<string, string> = {};
        resolved.forEach(([path, url]) => {
          if (url) map[path] = url;
        });
        setThumbnails(map);
      }

      setLoading(false);
    };
    init();
  }, [router]);

  const filtered = useMemo(() => {
    if (!search.trim()) return history;
    const q = search.toLowerCase();
    return history.filter((scan) => {
      const violations = scan.generated_data?.violations || [];
      const violationText = violations.map((v) => `${v.type} ${v.reason}`).join(' ').toLowerCase();
      const dateText = new Date(scan.created_at).toLocaleDateString().toLowerCase();
      return (
        (scan.file_name || '').toLowerCase().includes(q) ||
        scan.target_platform.toLowerCase().includes(q) ||
        violationText.includes(q) ||
        dateText.includes(q)
      );
    });
  }, [history, search]);

  const selectedScan = history.find((s) => s.id === selectedId) || null;

  if (loading) {
    return (
      <AppShell userEmail={email}>
        <p className="text-muted-foreground text-sm">Loading...</p>
      </AppShell>
    );
  }

  return (
    <AppShell userEmail={email} plan={plan} scansRemaining={scansRemaining}>
      {!hasAccess ? (
        <>
          <h1 className="text-2xl font-bold mb-6">Scan History</h1>
          <div className="bg-card border border-border rounded-xl p-10 text-center max-w-md mx-auto">
            <p className="font-semibold mb-2">Scan History is a paid feature</p>
            <p className="text-sm text-muted-foreground mb-6">
              Upgrade to any paid plan to automatically save and browse every scan you run — full results,
              violation details, and timestamps, kept for as long as you're subscribed.
            </p>
            <Link
              href="/buy-scans"
              className="inline-block px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              View Plans
            </Link>
          </div>
        </>
      ) : selectedScan ? (
        <ScanDetail
          scan={selectedScan}
          thumbnailUrl={selectedScan.thumbnail_url ? thumbnails[selectedScan.thumbnail_url] : null}
          onBack={() => setSelectedId(null)}
        />
      ) : (
        <>
          <h1 className="text-2xl font-bold mb-4">Scan History</h1>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by file name, platform, violation, date..."
            className="w-full px-4 py-2.5 mb-6 bg-card border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {history.length === 0
                ? 'No scans yet. Run your first scan from the dashboard.'
                : 'No scans match your search.'}
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((scan) => {
                const thumbUrl = scan.thumbnail_url ? thumbnails[scan.thumbnail_url] : null;
                const violations = scan.generated_data?.violations || [];
                const { riskLevel, riskClass } = calculateConfidenceScore(violations);
                const types = Array.from(new Set(violations.map((v) => v.type).filter(Boolean)));

                return (
                  <button
                    key={scan.id}
                    onClick={() => setSelectedId(scan.id)}
                    className="w-full flex items-center gap-4 bg-card border border-border rounded-xl p-3 text-left hover:border-primary/40 transition-colors"
                  >
                    <div className="w-14 h-14 rounded-lg bg-muted/30 border border-border overflow-hidden shrink-0 flex items-center justify-center">
                      {thumbUrl ? (
                        <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground capitalize px-1 text-center">
                          {scan.content_type}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{scan.file_name || 'Untitled scan'}</p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        <span>
                          {new Date(scan.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                        {PLATFORM_ICON[scan.target_platform] && (
                          <img
                            src={PLATFORM_ICON[scan.target_platform]}
                            alt=""
                            className="w-3.5 h-3.5 object-contain ml-1"
                          />
                        )}
                        <span className="capitalize">{scan.target_platform}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {violations.length === 0
                          ? 'No violations found'
                          : `${violations.length} violation${violations.length === 1 ? '' : 's'} found · ${types.join(' + ')}`}
                      </p>
                    </div>

                    <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${riskBadgeClass[riskClass]}`}>
                      {riskLevel}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

function ScanDetail({
  scan,
  thumbnailUrl,
  onBack,
}: {
  scan: ScanRecord;
  thumbnailUrl: string | null | undefined;
  onBack: () => void;
}) {
  const violations = scan.generated_data?.violations || [];
  const { riskLevel, riskClass, processedViolations } = calculateConfidenceScore(violations);
  const grouped = groupViolationsByType(processedViolations);

  return (
    <div className="max-w-2xl">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {thumbnailUrl && (
          <div className="w-full bg-black/5 dark:bg-white/5 flex items-center justify-center">
            <img src={thumbnailUrl} alt="" className="max-h-72 w-full object-contain" />
          </div>
        )}

        <div className="p-5">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h1 className="text-lg font-bold break-all">{scan.file_name || 'Untitled scan'}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="px-2 py-0.5 rounded text-xs font-medium border border-border capitalize">
              {scan.scan_type || 'regular'} scan
            </span>
            <span className="px-2 py-0.5 rounded text-xs font-medium border border-border capitalize">
              {scan.content_type}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(scan.created_at).toLocaleDateString(undefined, {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          </div>

          <div className="flex items-center justify-between mb-4 pb-4 border-b border-border">
            <div className="flex items-center gap-2">
              {PLATFORM_ICON[scan.target_platform] && (
                <img src={PLATFORM_ICON[scan.target_platform]} alt="" className="w-4 h-4 object-contain" />
              )}
              <span className="font-semibold text-sm uppercase">{scan.target_platform}</span>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${riskBadgeClass[riskClass]}`}>
              {riskLevel}
            </span>
          </div>

          {processedViolations.length === 0 ? (
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm font-medium">
              <span>✓</span>
              <span>No violations detected for this platform!</span>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped).map(([type, typeViolations]) => (
                <div key={type}>
                  <p className="text-sm font-semibold mb-2">{type}</p>
                  <div className="space-y-2">
                    {typeViolations.map((v, idx) => {
                      const location = v.timestamps?.length
                        ? `⏱ ${v.timestamps.join(', ')}`
                        : v.frames?.length
                        ? `🎞️ Frames: ${v.frames.join(', ')}`
                        : null;
                      return (
                        <div
                          key={idx}
                          className={`bg-muted/30 border border-border ${severityBorderClass(v.severity)} rounded-lg p-3 text-sm`}
                        >
                          {location && <div className="text-xs text-muted-foreground mb-1">{location}</div>}
                          <div className="mb-2">{v.reason}</div>
                          {v.suggestedFix && (
                            <div className="text-xs bg-primary/5 border border-primary/20 rounded-md p-2">
                              💡 {v.suggestedFix}
                              {v.editingWorkaround && (
                                <details className="mt-1.5">
                                  <summary className="cursor-pointer text-primary font-medium">
                                    Can't reshoot? Try these editing fixes instead
                                  </summary>
                                  <div className="mt-1 text-muted-foreground">└─ {v.editingWorkaround}</div>
                                </details>
                              )}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mt-1.5 capitalize">
                            Severity: {v.severity || 'medium'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center mt-6 pt-4 border-t border-border">
            ⚠ This analysis provides guidance only and does not guarantee ad approval.
          </p>
        </div>
      </div>
    </div>
  );
}
