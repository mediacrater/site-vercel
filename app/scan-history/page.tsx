'use client';

// app/scan-history/page.tsx

import {
  useEffect,
  useMemo,
  useState,
} from 'react';
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

  generated_data: {
    platform?: string;
    violations?: Violation[];
  } | null;

  batched_by_client: boolean;
  batch_id: string | null;
  batch_position: number | null;
}

interface BatchRecord {
  id: string;
  created_at: string;
  total_creatives: number | null;
}

interface SoloHistoryEntry {
  type: 'scan';
  scan: ScanRecord;
  createdAt: string;
}

interface BatchHistoryEntry {
  type: 'batch';
  batchId: string;
  createdAt: string;
  totalCreatives: number;
  scans: ScanRecord[];
}

type HistoryEntry =
  | SoloHistoryEntry
  | BatchHistoryEntry;

const PLATFORM_ICON: Record<
  string,
  string
> = {
  youtube:
    '/images/platform-icons/youtube.png',
  meta:
    '/images/platform-icons/meta.png',
  tiktok:
    '/images/platform-icons/tiktok.png',
  pinterest:
    '/images/platform-icons/pinterest.png',
  x:
    '/images/platform-icons/x.png',
};

const riskBadgeClass: Record<
  string,
  string
> = {
  'confidence-low':
    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',

  'confidence-medium':
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',

  'confidence-high':
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

function isScanError(
  scan: ScanRecord
) {
  const status =
    (scan.status || '')
      .trim()
      .toLowerCase();

  return (
    status === 'error' ||
    status === 'failed' ||
    !scan.generated_data
  );
}

function scanMatchesSearch(
  scan: ScanRecord,
  q: string
) {
  const violations =
    scan.generated_data
      ?.violations || [];

  const violationText =
    violations
      .map(
        (violation) =>
          `${violation.type} ${violation.reason}`
      )
      .join(' ')
      .toLowerCase();

  const dateText =
    new Date(
      scan.created_at
    )
      .toLocaleDateString()
      .toLowerCase();

  return (
    (scan.file_name || '')
      .toLowerCase()
      .includes(q) ||

    (scan.target_platform || '')
      .toLowerCase()
      .includes(q) ||

    violationText.includes(q) ||

    dateText.includes(q) ||

    (scan.status || '')
      .toLowerCase()
      .includes(q) ||

    (isScanError(scan) &&
      'error failed scan'
        .includes(q))
  );
}

function formattedShortDate(
  value: string
) {
  return new Date(
    value
  ).toLocaleDateString(
    undefined,
    {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }
  );
}

export default function ScanHistoryPage() {
  const router =
    useRouter();

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    email,
    setEmail,
  ] =
    useState<
      string | null
    >(null);

  const [
    plan,
    setPlan,
  ] =
    useState<
      string | null
    >(null);

  const [
    scansRemaining,
    setScansRemaining,
  ] =
    useState<
      number | null
    >(null);

  const [
    hasAccess,
    setHasAccess,
  ] =
    useState(false);

  const [
    history,
    setHistory,
  ] =
    useState<
      ScanRecord[]
    >([]);

  const [
    batches,
    setBatches,
  ] =
    useState<
      Record<
        string,
        BatchRecord
      >
    >({});

  const [
    thumbnails,
    setThumbnails,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

  const [
    search,
    setSearch,
  ] =
    useState('');

  const [
    selectedId,
    setSelectedId,
  ] =
    useState<
      string | null
    >(null);

  const [
    selectedBatchId,
    setSelectedBatchId,
  ] =
    useState<
      string | null
    >(null);

  useEffect(() => {
    const init =
      async () => {
        const {
          data: {
            session,
          },
        } =
          await supabase.auth
            .getSession();

        if (!session) {
          router.push(
            '/signin'
          );

          return;
        }

        setEmail(
          session.user
            .email ??
            null
        );

        const {
          data:
            profile,
        } =
          await supabase
            .from(
              'profiles'
            )
            .select(
              'scan_history, scans_remaining, plan'
            )
            .eq(
              'id',
              session.user.id
            )
            .single();

        setPlan(
          profile?.plan ??
            null
        );

        setScansRemaining(
          profile
            ?.scans_remaining ??
            null
        );

        const access =
          Boolean(
            profile
              ?.scan_history
          );

        setHasAccess(
          access
        );

        if (access) {
          const {
            data: scans,
          } =
            await supabase
              .from(
                'scans'
              )
              .select(
                [
                  'id',
                  'created_at',
                  'target_platform',
                  'content_type',
                  'scan_type',
                  'violations_found',
                  'status',
                  'origin',
                  'thumbnail_url',
                  'file_name',
                  'generated_data',
                  'batched_by_client',
                  'batch_id',
                  'batch_position',
                ].join(', ')
              )
              .eq(
                'user_id',
                session
                  .user.id
              )
              .order(
                'created_at',
                {
                  ascending:
                    false,
                }
              )
              .limit(100);

          const scanRows =
            (scans ||
              []) as ScanRecord[];

          setHistory(
            scanRows
          );

          /*
           * Load the parent rows for
           * batches represented in
           * this history result.
           */
          const batchIds =
            Array.from(
              new Set(
                scanRows
                  .map(
                    (
                      scan
                    ) =>
                      scan.batch_id
                  )
                  .filter(
                    (
                      id
                    ): id is string =>
                      Boolean(
                        id
                      )
                  )
              )
            );

          if (
            batchIds.length >
            0
          ) {
            const {
              data:
                batchRows,
            } =
              await supabase
                .from(
                  'scan_batches'
                )
                .select(
                  'id, created_at, total_creatives'
                )
                .in(
                  'id',
                  batchIds
                );

            const nextBatchMap:
              Record<
                string,
                BatchRecord
              > = {};

            (
              batchRows ||
              []
            ).forEach(
              (
                batch
              ) => {
                nextBatchMap[
                  batch.id
                ] =
                  batch as BatchRecord;
              }
            );

            setBatches(
              nextBatchMap
            );
          } else {
            setBatches(
              {}
            );
          }

          /*
           * Resolve thumbnail
           * signed URLs.
           */
          const paths =
            scanRows
              .filter(
                (
                  scan
                ) =>
                  scan.thumbnail_url
              )
              .map(
                (
                  scan
                ) =>
                  scan.thumbnail_url as string
              );

          const uniquePaths =
            Array.from(
              new Set(
                paths
              )
            );

          const resolved =
            await Promise.all(
              uniquePaths.map(
                async (
                  path
                ) =>
                  [
                    path,
                    await getThumbnailSignedUrl(
                      path
                    ),
                  ] as const
              )
            );

          const map:
            Record<
              string,
              string
            > = {};

          resolved.forEach(
            ([
              path,
              url,
            ]) => {
              if (url) {
                map[
                  path
                ] =
                  url;
              }
            }
          );

          setThumbnails(
            map
          );
        }

        setLoading(
          false
        );
      };

    init();
  }, [router]);

  /*
   * Build top-level history:
   *
   * - solo scans remain normal rows
   * - scans sharing a batch_id become
   *   one folder
   */
  const entries =
    useMemo<
      HistoryEntry[]
    >(() => {
      const grouped =
        new Map<
          string,
          ScanRecord[]
        >();

      const result:
        HistoryEntry[] =
        [];

      for (
        const scan of
        history
      ) {
        if (
          scan.batch_id
        ) {
          const existing =
            grouped.get(
              scan.batch_id
            ) || [];

          existing.push(
            scan
          );

          grouped.set(
            scan.batch_id,
            existing
          );

          continue;
        }

        result.push({
          type: 'scan',
          scan,
          createdAt:
            scan.created_at,
        });
      }

      for (
        const [
          batchId,
          scans,
        ] of grouped
      ) {
        const parent =
          batches[
            batchId
          ];

        /*
         * Fallback to the newest child
         * timestamp if the parent row
         * couldn't be loaded.
         */
        const childCreatedAt =
          scans.reduce(
            (
              latest,
              scan
            ) =>
              new Date(
                scan.created_at
              ).getTime() >
              new Date(
                latest
              ).getTime()
                ? scan.created_at
                : latest,
            scans[0]
              ?.created_at ||
              new Date(
                0
              ).toISOString()
          );

        result.push({
          type:
            'batch',
          batchId,
          createdAt:
            parent
              ?.created_at ||
            childCreatedAt,

          totalCreatives:
            parent
              ?.total_creatives ??
            scans.length,

          scans,
        });
      }

      result.sort(
        (
          a,
          b
        ) =>
          new Date(
            b.createdAt
          ).getTime() -
          new Date(
            a.createdAt
          ).getTime()
      );

      return result;
    }, [
      history,
      batches,
    ]);

  const filteredEntries =
    useMemo(() => {
      const trimmed =
        search
          .trim()
          .toLowerCase();

      if (!trimmed) {
        return entries;
      }

      return entries.filter(
        (
          entry
        ) => {
          if (
            entry.type ===
            'scan'
          ) {
            return scanMatchesSearch(
              entry.scan,
              trimmed
            );
          }

          if (
            entry.batchId
              .toLowerCase()
              .includes(
                trimmed
              )
          ) {
            return true;
          }

          const dateText =
            new Date(
              entry.createdAt
            )
              .toLocaleDateString()
              .toLowerCase();

          if (
            dateText.includes(
              trimmed
            )
          ) {
            return true;
          }

          return entry.scans.some(
            (
              scan
            ) =>
              scanMatchesSearch(
                scan,
                trimmed
              )
          );
        }
      );
    }, [
      entries,
      search,
    ]);

  const selectedScan =
    history.find(
      (
        scan
      ) =>
        scan.id ===
        selectedId
    ) ||
    null;

  const selectedBatch =
    entries.find(
      (
        entry
      ): entry is BatchHistoryEntry =>
        entry.type ===
          'batch' &&
        entry.batchId ===
          selectedBatchId
    ) ||
    null;

  if (loading) {
    return (
      <AppShell
        userEmail={
          email
        }
      >
        <p className="text-muted-foreground text-sm">
          Loading...
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      userEmail={
        email
      }
      plan={plan}
      scansRemaining={
        scansRemaining
      }
    >
      {!hasAccess ? (
        <>
          <h1 className="text-2xl font-bold mb-6">
            Scan History
          </h1>

          <div className="bg-card border border-border rounded-xl p-10 text-center max-w-md mx-auto">
            <p className="font-semibold mb-2">
              Scan History
              is a paid
              feature
            </p>

            <p className="text-sm text-muted-foreground mb-6">
              Upgrade to
              any paid
              plan to
              automatically
              save and
              browse every
              scan you run
              — full
              results,
              violation
              details, and
              timestamps,
              kept for as
              long as
              you're
              subscribed.
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
          scan={
            selectedScan
          }
          thumbnailUrl={
            selectedScan
              .thumbnail_url
              ? thumbnails[
                  selectedScan
                    .thumbnail_url
                ]
              : null
          }
          onBack={() =>
            setSelectedId(
              null
            )
          }
        />
      ) : selectedBatch ? (
        <BatchDetail
          batch={
            selectedBatch
          }
          thumbnails={
            thumbnails
          }
          onBack={() =>
            setSelectedBatchId(
              null
            )
          }
          onSelectScan={(
            id
          ) =>
            setSelectedId(
              id
            )
          }
        />
      ) : (
        <>
          <h1 className="text-2xl font-bold mb-4">
            Scan History
          </h1>

          <input
            type="text"
            value={
              search
            }
            onChange={(
              event
            ) =>
              setSearch(
                event
                  .target
                  .value
              )
            }
            placeholder="Search by file name, platform, violation, date..."
            className="w-full px-4 py-2.5 mb-6 bg-card border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />

          {filteredEntries.length ===
          0 ? (
            <p className="text-sm text-muted-foreground">
              {history.length ===
              0
                ? 'No scans yet. Run your first scan from the dashboard.'
                : 'No scans match your search.'}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredEntries.map(
                (
                  entry
                ) => {
                  if (
                    entry.type ===
                    'batch'
                  ) {
                    return (
                      <BatchFolderRow
                        key={
                          entry.batchId
                        }
                        batch={
                          entry
                        }
                        onClick={() => {
                          setSelectedId(
                            null
                          );

                          setSelectedBatchId(
                            entry.batchId
                          );
                        }}
                      />
                    );
                  }

                  const scan =
                    entry.scan;

                  return (
                    <ScanRow
                      key={
                        scan.id
                      }
                      scan={
                        scan
                      }
                      thumbnailUrl={
                        scan.thumbnail_url
                          ? thumbnails[
                              scan
                                .thumbnail_url
                            ]
                          : null
                      }
                      onClick={() => {
                        setSelectedBatchId(
                          null
                        );

                        setSelectedId(
                          scan.id
                        );
                      }}
                    />
                  );
                }
              )}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

function BatchFolderRow({
  batch,
  onClick,
}: {
  batch: BatchHistoryEntry;
  onClick: () => void;
}) {
  const failedCount =
    batch.scans.filter(
      isScanError
    ).length;

  const completedCount =
    batch.scans.length -
    failedCount;

  const missingCount =
    Math.max(
      0,
      batch.totalCreatives -
        batch.scans.length
    );

  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className="w-full flex items-center gap-4 bg-card border border-border rounded-xl p-3 text-left hover:border-primary/40 transition-colors"
    >
      <div className="w-14 h-14 rounded-lg bg-muted/30 border border-border shrink-0 flex items-center justify-center">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-foreground"
          aria-hidden="true"
        >
          <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">
          Batch scan
        </p>

        <p className="text-xs text-muted-foreground mt-0.5">
          {formattedShortDate(
            batch.createdAt
          )}
          {' · '}
          {
            batch.totalCreatives
          }{' '}
          creative
          {batch.totalCreatives ===
          1
            ? ''
            : 's'}
        </p>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs mt-1">
          <span className="text-muted-foreground">
            {
              completedCount
            }{' '}
            completed
          </span>

          {failedCount >
            0 && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              {
                failedCount
              }{' '}
              error
              {failedCount ===
              1
                ? ''
                : 's'}
            </span>
          )}

          {missingCount >
            0 && (
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              {
                missingCount
              }{' '}
              missing
            </span>
          )}
        </div>
      </div>

      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-muted-foreground"
        aria-hidden="true"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}

function ScanRow({
  scan,
  thumbnailUrl,
  onClick,
}: {
  scan: ScanRecord;
  thumbnailUrl:
    | string
    | null
    | undefined;
  onClick: () => void;
}) {
  const failed =
    isScanError(
      scan
    );

  const violations =
    failed
      ? []
      : scan
          .generated_data
          ?.violations ||
        [];

  const confidence =
    failed
      ? null
      : calculateConfidenceScore(
          violations
        );

  const types =
    Array.from(
      new Set(
        violations
          .map(
            (
              violation
            ) =>
              violation.type
          )
          .filter(
            Boolean
          )
      )
    );

  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className="w-full flex items-center gap-4 bg-card border border-border rounded-xl p-3 text-left hover:border-primary/40 transition-colors"
    >
      <div className="w-14 h-14 rounded-lg bg-muted/30 border border-border overflow-hidden shrink-0 flex items-center justify-center">
        {thumbnailUrl ? (
          <img
            src={
              thumbnailUrl
            }
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-[10px] text-muted-foreground capitalize px-1 text-center">
            {
              scan.content_type
            }
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">
          {scan.file_name ||
            'Untitled scan'}
        </p>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
          <span>
            {formattedShortDate(
              scan.created_at
            )}
          </span>

          {PLATFORM_ICON[
            scan
              .target_platform
          ] && (
            <img
              src={
                PLATFORM_ICON[
                  scan
                    .target_platform
                ]
              }
              alt=""
              className="w-3.5 h-3.5 object-contain ml-1"
            />
          )}

          <span className="capitalize">
            {
              scan.target_platform
            }
          </span>

          {scan.batch_position !==
            null && (
            <span>
              · #
              {
                scan.batch_position
              }
            </span>
          )}
        </div>

        <p
          className={`text-xs mt-0.5 truncate ${
            failed
              ? 'text-red-600 dark:text-red-400 font-medium'
              : 'text-muted-foreground'
          }`}
        >
          {failed
            ? 'Scan failed'
            : violations.length ===
              0
            ? 'No violations found'
            : `${violations.length} violation${violations.length === 1 ? '' : 's'} found · ${types.join(' + ')}`}
        </p>
      </div>

      {failed ? (
        <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
          Error
        </span>
      ) : (
        confidence && (
          <span
            className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${
              riskBadgeClass[
                confidence
                  .riskClass
              ]
            }`}
          >
            {
              confidence.riskLevel
            }
          </span>
        )
      )}
    </button>
  );
}

function BatchDetail({
  batch,
  thumbnails,
  onBack,
  onSelectScan,
}: {
  batch: BatchHistoryEntry;
  thumbnails: Record<
    string,
    string
  >;
  onBack: () => void;
  onSelectScan: (
    id: string
  ) => void;
}) {
  const sortedScans =
    [...batch.scans].sort(
      (
        a,
        b
      ) => {
        const aPosition =
          a.batch_position ??
          Number.MAX_SAFE_INTEGER;

        const bPosition =
          b.batch_position ??
          Number.MAX_SAFE_INTEGER;

        if (
          aPosition !==
          bPosition
        ) {
          return (
            aPosition -
            bPosition
          );
        }

        return (
          new Date(
            a.created_at
          ).getTime() -
          new Date(
            b.created_at
          ).getTime()
        );
      }
    );

  const failedCount =
    sortedScans.filter(
      isScanError
    ).length;

  const successfulCount =
    sortedScans.length -
    failedCount;

  const missingCount =
    Math.max(
      0,
      batch.totalCreatives -
        sortedScans.length
    );

  return (
    <div className="max-w-2xl">
      <button
        type="button"
        onClick={
          onBack
        }
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>

        Back
      </button>

      <div className="mb-5">
        <h1 className="text-xl font-bold">
          Batch scan
        </h1>

        <p className="text-sm text-muted-foreground mt-1">
          {formattedShortDate(
            batch.createdAt
          )}
          {' · '}
          {
            batch.totalCreatives
          }{' '}
          creative
          {batch.totalCreatives ===
          1
            ? ''
            : 's'}
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
          <span className="text-muted-foreground">
            {
              successfulCount
            }{' '}
            completed
          </span>

          {failedCount >
            0 && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              {
                failedCount
              }{' '}
              error
              {failedCount ===
              1
                ? ''
                : 's'}
            </span>
          )}

          {missingCount >
            0 && (
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              {
                missingCount
              }{' '}
              missing
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {sortedScans.map(
          (
            scan
          ) => (
            <ScanRow
              key={
                scan.id
              }
              scan={
                scan
              }
              thumbnailUrl={
                scan.thumbnail_url
                  ? thumbnails[
                      scan
                        .thumbnail_url
                    ]
                  : null
              }
              onClick={() =>
                onSelectScan(
                  scan.id
                )
              }
            />
          )
        )}
      </div>
    </div>
  );
}

function ScanDetail({
  scan,
  thumbnailUrl,
  onBack,
}: {
  scan: ScanRecord;
  thumbnailUrl:
    | string
    | null
    | undefined;
  onBack: () => void;
}) {
  const failed =
    isScanError(
      scan
    );

  const violations =
    failed
      ? []
      : scan
          .generated_data
          ?.violations ||
        [];

  const confidence =
    failed
      ? null
      : calculateConfidenceScore(
          violations
        );

  const processedViolations =
    confidence
      ?.processedViolations ||
    [];

  const grouped =
    groupViolationsByType(
      processedViolations
    );

  return (
    <div className="max-w-2xl">
      <button
        type="button"
        onClick={
          onBack
        }
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>

        Back
      </button>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {thumbnailUrl && (
          <div className="w-full bg-black/5 dark:bg-white/5 flex items-center justify-center">
            <img
              src={
                thumbnailUrl
              }
              alt=""
              className="max-h-72 w-full object-contain"
            />
          </div>
        )}

        <div className="p-5">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h1 className="text-lg font-bold break-all">
              {scan.file_name ||
                'Untitled scan'}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="px-2 py-0.5 rounded text-xs font-medium border border-border capitalize">
              {scan.scan_type ||
                'regular'}{' '}
              scan
            </span>

            <span className="px-2 py-0.5 rounded text-xs font-medium border border-border capitalize">
              {
                scan.content_type
              }
            </span>

            {scan.batch_position !==
              null && (
              <span className="px-2 py-0.5 rounded text-xs font-medium border border-border">
                Batch #
                {
                  scan.batch_position
                }
              </span>
            )}

            <span className="text-xs text-muted-foreground">
              {new Date(
                scan.created_at
              ).toLocaleDateString(
                undefined,
                {
                  month:
                    'long',
                  day:
                    'numeric',
                  year:
                    'numeric',
                  hour:
                    'numeric',
                  minute:
                    '2-digit',
                }
              )}
            </span>
          </div>

          <div className="flex items-center justify-between mb-4 pb-4 border-b border-border">
            <div className="flex items-center gap-2">
              {PLATFORM_ICON[
                scan
                  .target_platform
              ] && (
                <img
                  src={
                    PLATFORM_ICON[
                      scan
                        .target_platform
                    ]
                  }
                  alt=""
                  className="w-4 h-4 object-contain"
                />
              )}

              <span className="font-semibold text-sm uppercase">
                {
                  scan.target_platform
                }
              </span>
            </div>

            {failed ? (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                Error
              </span>
            ) : (
              confidence && (
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                    riskBadgeClass[
                      confidence
                        .riskClass
                    ]
                  }`}
                >
                  {
                    confidence.riskLevel
                  }
                </span>
              )
            )}
          </div>

          {failed ? (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
              <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                Scan failed
              </p>

              <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                This scan
                could not be
                completed.
                Please try
                scanning this
                creative
                again.
              </p>
            </div>
          ) : processedViolations.length ===
            0 ? (
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm font-medium">
              <span>
                ✓
              </span>

              <span>
                No violations
                detected for
                this
                platform!
              </span>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(
                grouped
              ).map(
                ([
                  type,
                  typeViolations,
                ]) => (
                  <div
                    key={
                      type
                    }
                  >
                    <p className="text-sm font-semibold mb-2">
                      {
                        type
                      }
                    </p>

                    <div className="space-y-2">
                      {typeViolations.map(
                        (
                          violation,
                          index
                        ) => {
                          const location =
                            violation
                              .timestamps
                              ?.length
                              ? `⏱ ${violation.timestamps.join(', ')}`
                              : violation
                                  .frames
                                  ?.length
                              ? `🎞️ Frames: ${violation.frames.join(', ')}`
                              : null;

                          return (
                            <div
                              key={
                                index
                              }
                              className={`bg-muted/30 border border-border ${severityBorderClass(
                                violation.severity
                              )} rounded-lg p-3 text-sm`}
                            >
                              {location && (
                                <div className="text-xs text-muted-foreground mb-1">
                                  {
                                    location
                                  }
                                </div>
                              )}

                              <div className="mb-2">
                                {
                                  violation.reason
                                }
                              </div>

                              {violation.suggestedFix && (
                                <div className="text-xs bg-primary/5 border border-primary/20 rounded-md p-2">
                                  💡{' '}
                                  {
                                    violation.suggestedFix
                                  }

                                  {violation.editingWorkaround && (
                                    <details className="mt-1.5">
                                      <summary className="cursor-pointer text-primary font-medium">
                                        Can't
                                        reshoot?
                                        Try these
                                        editing
                                        fixes
                                        instead
                                      </summary>

                                      <div className="mt-1 text-muted-foreground">
                                        └─{' '}
                                        {
                                          violation.editingWorkaround
                                        }
                                      </div>
                                    </details>
                                  )}
                                </div>
                              )}

                              <div className="text-xs text-muted-foreground mt-1.5 capitalize">
                                Severity:{' '}
                                {violation.severity ||
                                  'medium'}
                              </div>
                            </div>
                          );
                        }
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center mt-6 pt-4 border-t border-border">
            ⚠ This
            analysis
            provides
            guidance only
            and does not
            guarantee ad
            approval.
          </p>
        </div>
      </div>
    </div>
  );
}
