'use client';

// components/scan-workspace.tsx

import { useEffect, useRef, useState } from 'react';
import { extractFrames, extractAudio, type ExtractedFrame, type ScanType } from '@/lib/mediacrater/dissector';
import {
  calculateConfidenceScore,
  groupViolationsByType,
  severityBorderClass,
  type Violation,
} from '@/lib/mediacrater/scoreCalculator';
import {
  scanVideo,
  scanImage,
  cancelQueuedScan,
  reportQueueTiming,
  waitForQueueTurn,
} from '@/lib/mediacrater/scanApi';
import {
  resolveCreativeUrl,
  scanImageUrl,
  scanVideoUrl,
} from '@/lib/mediacrater/scanApiUrl';
import {
  beginBackgroundScan,
  clearBackgroundScanState,
  completeBackgroundScan,
  failBackgroundScan,
  updateBackgroundBatchItem,
  updateBackgroundScanProgress,
  useBackgroundScanState,
  type BackgroundBatchItem,
} from '@/lib/mediacrater/backgroundScanStore';
import { supabase } from '@/lib/mediacrater/supabaseClient';
import { uploadScanThumbnail } from '@/lib/mediacrater/thumbnails';

const PLATFORMS = [
  { value: 'youtube', label: 'YouTube', icon: '/images/platform-icons/youtube.png' },
  { value: 'meta', label: 'Meta (FB/IG)', icon: '/images/platform-icons/meta.png' },
  { value: 'tiktok', label: 'TikTok', icon: '/images/platform-icons/tiktok.png' },
  { value: 'pinterest', label: 'Pinterest', icon: '/images/platform-icons/pinterest.png' },
  { value: 'x', label: 'X (Twitter)', icon: '/images/platform-icons/x.png' },
] as const;

const VALID_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'image/png', 'image/jpeg', 'image/gif'];
const MAX_FILE_BYTES = 1100 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 121;
const MAX_BATCH_FILES = 5;
const BATCH_COOLDOWN_SECONDS = 5;

export interface WorkspaceProfile {
  plan: string;
  scans_remaining: number;
  scans_per_month?: number;
  deep_scan_enabled?: boolean;
  audio_analysis?: boolean;
  scan_history?: boolean;
  last_notified_at?: string | null;
}

type CreativeKind =
  | 'video'
  | 'image'
  | 'video_url'
  | 'image_url';

interface CreativeBase {
  id: string;
  displayName: string;
  previewUrl: string;
  platforms: string[];
}

interface ImageCreative
  extends CreativeBase {
  kind: 'image';
  file: File;
}

interface VideoCreative
  extends CreativeBase {
  kind: 'video';
  file: File;
  scanType: ScanType;
  analyzeAudio: boolean;
}

interface ImageUrlCreative
  extends CreativeBase {
  kind: 'image_url';
  sourceUrl: string;
}

interface VideoUrlCreative
  extends CreativeBase {
  kind: 'video_url';
  sourceUrl: string;
  scanType: ScanType;
  analyzeAudio: boolean;
}

type BatchCreative =
  | ImageCreative
  | VideoCreative
  | ImageUrlCreative
  | VideoUrlCreative;

export interface CompletedScanFeedbackItem {
  creativeId: string;
  fileName: string;
  batchPosition: number | null;
  scanIds: string[];
}

export interface CompletedScanFeedbackTarget {
  isBatch: boolean;
  items: CompletedScanFeedbackItem[];
}

interface PlatformResult {
  creativeId: string;
  fileName: string;
  fileKind: CreativeKind;
  batchPosition: number | null;
  scanId: string;
  platform: string;
  riskLevel: string;
  riskClass: string;
  processedViolations: Violation[];
}

interface Banner {
  tone: 'error' | 'warning';
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

function isVideoCreative(
  creative: BatchCreative
): creative is
  | VideoCreative
  | VideoUrlCreative {
  return (
    creative.kind === 'video' ||
    creative.kind === 'video_url'
  );
}

function isImageCreative(
  creative: BatchCreative
): creative is
  | ImageCreative
  | ImageUrlCreative {
  return (
    creative.kind === 'image' ||
    creative.kind === 'image_url'
  );
}

function orderCreativesForExecution(
  creatives: BatchCreative[]
) {
  return [
    ...creatives.filter(
      isImageCreative
    ),
    ...creatives.filter(
      isVideoCreative
    ),
  ];
}

function buildFeedbackTarget(
  results: PlatformResult[],
  isBatch: boolean
): CompletedScanFeedbackTarget | null {
  const grouped =
    new Map<
      string,
      CompletedScanFeedbackItem
    >();

  for (const result of results) {
    const existing =
      grouped.get(
        result.creativeId
      );

    if (existing) {
      existing.scanIds.push(
        result.scanId
      );

      continue;
    }

    grouped.set(
      result.creativeId,
      {
        creativeId:
          result.creativeId,
        fileName:
          result.fileName,
        batchPosition:
          result.batchPosition,
        scanIds: [
          result.scanId,
        ],
      }
    );
  }

  const items =
    Array.from(
      grouped.values()
    );

  if (items.length === 0) {
    return null;
  }

  return {
    isBatch,
    items,
  };
}

function waitWithAbort(
  ms: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise(
    (resolve, reject) => {
      if (signal.aborted) {
        reject(
          new DOMException(
            'Aborted',
            'AbortError'
          )
        );

        return;
      }

      const onAbort = () => {
        clearTimeout(timeout);

        reject(
          new DOMException(
            'Aborted',
            'AbortError'
          )
        );
      };

      const timeout =
        window.setTimeout(
          () => {
            signal.removeEventListener(
              'abort',
              onAbort
            );

            resolve();
          },
          ms
        );

      signal.addEventListener(
        'abort',
        onAbort,
        { once: true }
      );
    }
  );
}

function shouldStopBatch(
  error: unknown
) {
  const message =
    error instanceof Error
      ? error.message
      : String(error || '');

  return (
    message.includes(
      'Not authenticated'
    ) ||
    message.includes(
      'Unauthorized'
    ) ||
    message.includes(
      'ACCOUNT_FLAGGED'
    ) ||
    message.includes(
      'locked pending resolution'
    ) ||
    message.includes(
      'Insufficient tokens'
    ) ||
    message.includes(
      'Scan limit reached'
    ) ||
    message.includes(
      'Rate limit exceeded'
    ) ||
    message.includes(
      'already have a scan in progress'
    ) ||
    message.includes(
      'Batch scanning is available on paid plans only'
    ) ||
    message.includes(
      'Invalid batch metadata'
    ) ||
    message.includes(
      'Unable to validate scan batch'
    )
  );
}

export function ScanWorkspace({
  profile,
  onScanComplete,
  onResultsChange,
}: {
  profile: WorkspaceProfile | null;
  onScanComplete: () => Promise<void> | void;
  onResultsChange?: (
    target:
      | CompletedScanFeedbackTarget
      | null
  ) => void;
}) {
  const [
    creatives,
    setCreatives,
  ] =
    useState<BatchCreative[]>([]);

  const [
    urlInput,
    setUrlInput,
  ] =
    useState('');

  const [
    resolvingUrl,
    setResolvingUrl,
  ] =
    useState(false);

  const [
    platformCreativeId,
    setPlatformCreativeId,
  ] =
    useState<string | null>(null);

  const [
    videoCreativeId,
    setVideoCreativeId,
  ] =
    useState<string | null>(null);

  const [
    selectedResultCreativeId,
    setSelectedResultCreativeId,
  ] =
    useState<string | null>(null);

  const [isDragOver, setIsDragOver] =
    useState(false);

  const [canCancel, setCanCancel] =
    useState(true);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressText, setProgressText] = useState('Initializing...');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [results, setResults] = useState<PlatformResult[] | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentJobIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const previewUrlsRef =
  useRef<Set<string>>(
    new Set()
  );
  
  const mountedRef = useRef(true);

  const ownsActiveScanRef = useRef(false);

  const backgroundOperationIdRef = useRef<string | null>(null);

  const backgroundScan = useBackgroundScanState();
  
  const canDeepScan =
    Boolean(
      profile?.deep_scan_enabled
    );

  const canAnalyzeAudio =
    Boolean(
      profile?.audio_analysis
    );

  const canBatchScan =
    Boolean(profile) &&
    profile?.plan !== 'free';

  const scansRemaining =
    profile?.scans_remaining ?? 0;

  const videoCreatives =
    creatives.filter(
      (
        creative
      ): creative is
        | VideoCreative
        | VideoUrlCreative =>
        isVideoCreative(creative)
    );

  const platformCreative =
    creatives.find(
      (creative) =>
        creative.id ===
        platformCreativeId
    ) ??
    creatives[0] ??
    null;

  const selectedVideoCreative =
    videoCreatives.find(
      (creative) =>
        creative.id ===
        videoCreativeId
    ) ??
    videoCreatives[0] ??
    null;

  const selectedVideoIsUrl =
  selectedVideoCreative?.kind === 'video_url';
  
  const executionPreview =
    orderCreativesForExecution(
      creatives
    );

  const allCreativesConfigured =
    creatives.length > 0 &&
    creatives.every(
      (creative) =>
        Boolean(creative.platforms[0])
    );

  const totalCost =
    creatives.reduce(
      (
        total,
        creative
      ) => {
        if (!creative.platforms[0]) {
          return total;
        }

        const creativeCost =
          isVideoCreative(creative) &&
          creative.scanType === 'deep'
            ? 2
            : 1;

        return total + creativeCost;
      },
      0
    );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);
  
  useEffect(() => {
    return () => {
      for (
        const url of
        previewUrlsRef.current
      ) {
        URL.revokeObjectURL(
          url
        );
      }

      previewUrlsRef.current.clear();

      if (timerRef.current) {
        clearInterval(
          timerRef.current
        );
      }
    };
  }, []);

  useEffect(() => {
    if (canAnalyzeAudio) {
      return;
    }

    setCreatives(
      (previous) =>
        previous.map(
          (creative) =>
            isVideoCreative(creative)
              ? {
                  ...creative,
                  analyzeAudio:
                    false,
                }
              : creative
        )
    );
  }, [canAnalyzeAudio]);

  useEffect(() => {
  /*
   * The instance that originally started
   * the scan already owns its live local
   * state.
   *
   * This branch is for a fresh Dashboard
   * instance after navigating away and
   * returning.
   */
    if (
      ownsActiveScanRef.current
    ) {
      return;
    }

    if (
      backgroundScan.status ===
        'preparing' ||
      backgroundScan.status ===
        'running'
    ) {
      setResults(null);
      setBanner(null);
      setIsAnalyzing(true);
      setCanCancel(false);

      setProgressText(
        backgroundScan.message ||
          'Scan in progress...'
      );

      onResultsChange?.(
        null
      );

      if (
        backgroundScan.startedAt
      ) {
        const startedAt =
          Date.parse(
            backgroundScan.startedAt
          );

        if (
          Number.isFinite(
            startedAt
          )
        ) {
          startElapsedTimer(
            startedAt
          );
        }
      }

      return;
    }

    if (
      backgroundScan.status ===
        'completed' &&
      backgroundScan.results
    ) {
      stopElapsedTimer();

      setIsAnalyzing(false);
      setCanCancel(false);

      const restoredResults =
        backgroundScan.results as PlatformResult[];

      setResults(
        restoredResults
      );

      setSelectedResultCreativeId(
        backgroundScan.batchItems[0]
          ?.creativeId ??
          restoredResults[0]
            ?.creativeId ??
          null
      );

      onResultsChange?.(
        buildFeedbackTarget(
          restoredResults,
          backgroundScan.batchItems
            .length > 1
        )
      );

      return;
    }

    if (
      backgroundScan.status ===
      'error'
    ) {
      stopElapsedTimer();

      setIsAnalyzing(false);
      setCanCancel(false);
      setResults(null);

      setBanner({
        tone: 'error',

        title:
          backgroundScan.error
            ?.title ||
          'Analysis failed',

        message:
          backgroundScan.error
            ?.message ||
          'Something went wrong. Please try again.',
      });

      onResultsChange?.(
        null
      );
    }
  }, [
    backgroundScan.updatedAt,
  ]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const scanUrl = params.get('scan_url');
    if (scanUrl) {
      setUrlInput(scanUrl);
      handleUrlSubmit(scanUrl);
    // clean the URL so a refresh doesn't re-trigger it
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);
  
  function startElapsedTimer(
    startTime = Date.now()
  ) {
    if (timerRef.current) {
      clearInterval(
        timerRef.current
      );
    }

    setElapsedSeconds(
      Math.max(
        0,
        Math.floor(
          (Date.now() -
            startTime) /
            1000
        )
      )
    );
  
    timerRef.current =
      setInterval(() => {
        setElapsedSeconds(
          Math.max(
            0,
            Math.floor(
              (Date.now() -
                startTime) /
                1000
            )
          )
        );
      }, 1000);
  }

  function publishScanProgress(
    message: string,
    status:
      | 'preparing'
      | 'running' = 'running'
    ) {
      const operationId =
        backgroundOperationIdRef.current;

      if (operationId) {
        updateBackgroundScanProgress(
          operationId,
          message,
          status
        );
      }

    if (mountedRef.current) {
      setProgressText(
        message
      );
    }
  }

  
  
  function stopElapsedTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async function createVideoUrlThumbnail(
    videoUrl: string
  ): Promise<string | null> {
    return new Promise(
      (resolve) => {
        const video =
          document.createElement(
            'video'
          );

        const canvas =
          document.createElement(
            'canvas'
          );

        const timeout =
          window.setTimeout(
            () => {
              cleanup();
              resolve(null);
            },
            8000
          );

        const cleanup = () => {
          window.clearTimeout(
            timeout
          );

          video.removeAttribute(
            'src'
          );

          video.load();
        };

        video.crossOrigin =
          'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.preload =
          'metadata';

        video.addEventListener(
          'loadedmetadata',
          () => {
            if (
              Number.isFinite(
                video.duration
              ) &&
              video.duration > 0
            ) {
              video.currentTime =
                Math.min(
                  0.1,
                  video.duration / 2
                );
            }
          },
          {
            once: true,
          }
        );

        video.addEventListener(
          'seeked',
          () => {
            try {
              const ctx =
                canvas.getContext(
                  '2d'
                );

              if (
                !ctx ||
                !video.videoWidth ||
                !video.videoHeight
              ) {
                cleanup();
                resolve(null);
                return;
              }

              const maxLongEdge =
                180;

              const scale =
                Math.min(
                  1,
                  maxLongEdge /
                    Math.max(
                      video.videoWidth,
                      video.videoHeight
                    )
                );

              canvas.width =
                Math.max(
                  1,
                  Math.round(
                    video.videoWidth *
                      scale
                  )
                );

              canvas.height =
                Math.max(
                  1,
                  Math.round(
                    video.videoHeight *
                      scale
                  )
                );

              ctx.drawImage(
                video,
                0,
                0,
                canvas.width,
                canvas.height
              );

              const dataUrl =
                canvas.toDataURL(
                  'image/jpeg',
                  0.55
                );

              cleanup();
              resolve(dataUrl);
            } catch {
              cleanup();
              resolve(null);
            }
          },
          {
            once: true,
          }
        );

        video.addEventListener(
          'error',
          () => {
            cleanup();
            resolve(null);
          },
          {
            once: true,
          }
        );

        video.src = videoUrl;
      }
    );
  }

  async function prepareCreative(
    file: File
  ): Promise<BatchCreative> {
    if (
      !VALID_TYPES.includes(
        file.type
      )
    ) {
      throw new Error(
        'INVALID_FILE_TYPE'
      );
    }

    if (
      file.size >
      MAX_FILE_BYTES
    ) {
      throw new Error(
        'FILE_TOO_LARGE'
      );
    }

    const kind:
      CreativeKind =
        file.type.startsWith(
          'video/'
        )
          ? 'video'
          : 'image';

    const objectUrl =
      URL.createObjectURL(
        file
      );

    try {
      if (kind === 'video') {
        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            const probe =
              document.createElement(
                'video'
              );

            const timeout =
              window.setTimeout(
                () =>
                  reject(
                    new Error(
                      'CORRUPT_FILE'
                    )
                  ),
                10000
              );

            probe.addEventListener(
              'loadedmetadata',
              () => {
                clearTimeout(
                  timeout
                );

                if (
                  !isFinite(
                    probe.duration
                  ) ||
                  probe.duration <= 0 ||
                  probe.videoWidth ===
                    0 ||
                  probe.videoHeight ===
                    0
                ) {
                  reject(
                    new Error(
                      'CORRUPT_FILE'
                    )
                  );

                  return;
                }

                if (
                  probe.duration >
                  MAX_VIDEO_SECONDS
                ) {
                  reject(
                    new Error(
                      'VIDEO_TOO_LONG'
                    )
                  );

                  return;
                }

                resolve();
              },
              { once: true }
            );

            probe.addEventListener(
              'error',
              () => {
                clearTimeout(
                  timeout
                );

                reject(
                  new Error(
                    'CORRUPT_FILE'
                  )
                );
              },
              { once: true }
            );

            probe.src =
              objectUrl;
          }
        );
      } else {
        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            const image =
              new Image();

            const timeout =
              window.setTimeout(
                () =>
                  reject(
                    new Error(
                      'CORRUPT_FILE'
                    )
                  ),
                5000
              );

            image.onload = () => {
              clearTimeout(
                timeout
              );

              if (
                image.naturalWidth ===
                  0 ||
                image.naturalHeight ===
                  0
              ) {
                reject(
                  new Error(
                    'CORRUPT_FILE'
                  )
                );

                return;
              }

              resolve();
            };

            image.onerror =
              () => {
                clearTimeout(
                  timeout
                );

                reject(
                  new Error(
                    'CORRUPT_FILE'
                  )
                );
              };

            image.src =
              objectUrl;
          }
        );
      }

      previewUrlsRef.current.add(
        objectUrl
      );

      const base = {
        id:
          crypto.randomUUID(),
        displayName:
          file.name,
        file,
        previewUrl:
          objectUrl,
        platforms: [],
      };

      return kind === 'video'
        ? {
            ...base,
            kind: 'video',
            scanType:
              'regular',
            analyzeAudio:
              false,
          }
        : {
            ...base,
            kind: 'image',
          };
    } catch (error) {
      URL.revokeObjectURL(
        objectUrl
      );

      throw error;
    }
  }

  async function handleUrlSubmit(
    providedUrl?: string
  ) {
    const sourceUrl =
      (providedUrl ?? urlInput).trim();

    if (!sourceUrl) {
      return;
    }

    clearBackgroundScanState();
    setBanner(null);
    setResults(null);
    setSelectedResultCreativeId(
      null
    );
    onResultsChange?.(null);

    if (
      !canBatchScan &&
      creatives.length > 0
    ) {
      setBanner({
        tone: 'warning',
        title:
          'Paid plan required',
        message:
          'Batch scanning is available on paid plans. Free accounts can scan one creative at a time.',
        actionLabel:
          'Upgrade plan',
        onAction: () =>
          window.location.assign(
            '/buy-tokens'
          ),
      });

      return;
    }

    const maxFiles =
      canBatchScan
        ? MAX_BATCH_FILES
        : 1;

    if (
      creatives.length + 1 >
      maxFiles
    ) {
      setBanner({
        tone: 'warning',
        title:
          'Batch limit reached',
        message:
          `You can add up to ${maxFiles} creative${maxFiles === 1 ? '' : 's'} at a time.`,
      });

      return;
    }

    setResolvingUrl(true);

    try {
      const resolved =
        await resolveCreativeUrl(
          sourceUrl
        );

      const displayName =
        resolved.fileName ||
        new URL(
          resolved.url
        ).hostname;

      const previewUrl =
        resolved.kind === 'video'
          ? await createVideoUrlThumbnail(
              resolved.url
            )
          : resolved.url;

      const creative:
        BatchCreative =
        resolved.kind === 'video'
          ? {
              id:
                crypto.randomUUID(),
              kind: 'video_url',
              sourceUrl:
                resolved.url,
              displayName,
              previewUrl:
                previewUrl || '',
              platforms: [],
              scanType:
                'regular',
              analyzeAudio:
                false,
            }
          : {
              id:
                crypto.randomUUID(),
              kind: 'image_url',
              sourceUrl:
                resolved.url,
              displayName,
              previewUrl:
                resolved.url,
              platforms: [],
            };

      setCreatives(
        (previous) => [
          ...previous,
          creative,
        ]
      );

      setPlatformCreativeId(
        (previous) =>
          previous ??
          creative.id
      );

      if (
        isVideoCreative(
          creative
        )
      ) {
        setVideoCreativeId(
          (previous) =>
            previous ??
            creative.id
        );
      }

      setUrlInput('');
    } catch (error: any) {
      setBanner({
        tone: 'error',
        title:
          'URL not supported',
        message:
          error?.message ||
          'This URL could not be resolved. Please use a direct image or video URL from a supported source.',
      });
    } finally {
      setResolvingUrl(false);
    }
  }

  async function handleFiles(
    files: File[]
  ) {
    clearBackgroundScanState();
    setBanner(null);
    setResults(null);
    setSelectedResultCreativeId(
      null
    );
    onResultsChange?.(null);

    if (files.length === 0) {
      return;
    }

    const maxFiles =
      canBatchScan
        ? MAX_BATCH_FILES
        : 1;

    if (
      !canBatchScan &&
      (
        files.length > 1 ||
        creatives.length > 0
      )
    ) {
      setBanner({
        tone: 'warning',
        title:
          'Paid plan required',
        message:
          'Batch scanning is available on paid plans. Free accounts can scan one creative at a time.',
        actionLabel:
          'Upgrade plan',
        onAction: () =>
          window.location.assign(
            '/buy-tokens'
          ),
      });

      return;
    }

    if (
      creatives.length +
        files.length >
      maxFiles
    ) {
      setBanner({
        tone: 'warning',
        title:
          'Batch limit reached',
        message:
          `You can upload up to ${maxFiles} creative${maxFiles === 1 ? '' : 's'} at a time.`,
      });

      return;
    }

    const prepared:
      BatchCreative[] = [];

    try {
      for (
        const file of files
      ) {
        prepared.push(
          await prepareCreative(
            file
          )
        );
      }
    } catch (error: any) {
      for (
        const creative of
        prepared
      ) {
        if (
          creative.previewUrl
            .startsWith('blob:')
        ) {
          URL.revokeObjectURL(
            creative.previewUrl
          );

          previewUrlsRef.current.delete(
            creative.previewUrl
          );
        }
      }

      if (
        error?.message ===
        'VIDEO_TOO_LONG'
      ) {
        setBanner({
          tone: 'error',
          title:
            'Video too long',
          message:
            'Most platforms recommend 15-60 seconds for optimal engagement. Maximum allowed length is 2 minutes.',
        });
      } else if (
        error?.message ===
        'FILE_TOO_LARGE'
      ) {
        setBanner({
          tone: 'error',
          title:
            'File too large',
          message:
            'Ads are typically under 1 GB. Please compress your video first.',
        });
      } else if (
        error?.message ===
        'INVALID_FILE_TYPE'
      ) {
        setBanner({
          tone: 'error',
          title:
            'Invalid file type',
          message:
            'Please upload a valid video (MP4, MOV, WebM) or image (PNG, JPG, GIF) file.',
        });
      } else {
        setBanner({
          tone: 'error',
          title:
            'Corrupt file',
          message:
            "Your content seems to be corrupt or we don't support this file type. Please upload another file or convert this file into a supported format.",
        });
      }

      return;
    }

    setCreatives(
      (previous) => [
        ...previous,
        ...prepared,
      ]
    );

    setPlatformCreativeId(
      (previous) =>
        previous ??
        prepared[0]?.id ??
        null
    );

    const firstNewVideo =
      prepared.find(
        (
          creative
        ): creative is VideoCreative =>
          isVideoCreative(creative)
      );

    if (firstNewVideo) {
      setVideoCreativeId(
        (previous) =>
          previous ??
          firstNewVideo.id
      );
    }

    if (
      fileInputRef.current
    ) {
      fileInputRef.current.value =
        '';
    }
  }

  function removeCreative(
    creativeId: string
  ) {
    const creative =
      creatives.find(
        (item) =>
          item.id ===
          creativeId
      );

    if (
      creative?.previewUrl
        .startsWith('blob:')
    ) {
      URL.revokeObjectURL(
        creative.previewUrl
      );

      previewUrlsRef.current.delete(
        creative.previewUrl
      );
    }

    const next =
      creatives.filter(
        (item) =>
          item.id !==
          creativeId
      );

    setCreatives(next);

    setPlatformCreativeId(
      (previous) =>
        previous ===
        creativeId
          ? next[0]?.id ??
            null
          : previous
    );

    const nextVideos =
      next.filter(
        (
          item
        ): item is
          | VideoCreative
          | VideoUrlCreative =>
          isVideoCreative(item)
      );

    setVideoCreativeId(
      (previous) =>
        previous ===
        creativeId
          ? nextVideos[0]
              ?.id ??
            null
          : previous
    );

    clearBackgroundScanState();
    setResults(null);
    setSelectedResultCreativeId(
      null
    );
    onResultsChange?.(null);

    if (
      fileInputRef.current
    ) {
      fileInputRef.current.value =
        '';
    }
  }

  function togglePlatform(
    creativeId: string,
    value: string
  ) {
    setCreatives(
      (previous) =>
        previous.map(
          (creative) =>
            creative.id === creativeId
              ? {
                  ...creative,
                  platforms: [value],
                }
              : creative
        )
    );
  }

  function applyPlatformsToAll() {
    const selectedPlatform =
      platformCreative?.platforms[0];

    if (!selectedPlatform) {
      return;
    }

    setCreatives(
      (previous) =>
        previous.map(
          (creative) => ({
            ...creative,
            platforms: [
              selectedPlatform,
            ],
          })
        )
    );
  }

  function updateSelectedVideo(
    patch: Partial<
      Pick<
        VideoCreative,
        'scanType' |
        'analyzeAudio'
      >
    >
  ) {
    if (
      !selectedVideoCreative
    ) {
      return;
    }

    setCreatives(
      (previous) =>
        previous.map(
          (creative) =>
            creative.id ===
              selectedVideoCreative.id &&
            isVideoCreative(creative)
              ? {
                  ...creative,
                  ...patch,
                }
              : creative
        )
    );
  }

  function applyVideoSettingsToAll() {
    if (
      !selectedVideoCreative
    ) {
      return;
    }

    setCreatives(
      (previous) =>
        previous.map(
          (creative) =>
            isVideoCreative(creative)
              ? {
                  ...creative,
                  scanType:
                    selectedVideoCreative.scanType,
                  analyzeAudio:
                    selectedVideoCreative.analyzeAudio,
                }
              : creative
        )
    );
  }

  function resetForNewScan() {
    for (
      const creative of
      creatives
    ) {
      if (
        creative.previewUrl
          .startsWith('blob:')
      ) {
        URL.revokeObjectURL(
          creative.previewUrl
        );

        previewUrlsRef.current.delete(
          creative.previewUrl
        );
      }
    }

    setCreatives([]);
    setPlatformCreativeId(
      null
    );
    setVideoCreativeId(
      null
    );
    setSelectedResultCreativeId(
      null
    );
    setResults(null);
    setBanner(null);

    clearBackgroundScanState();
    onResultsChange?.(null);

    if (
      fileInputRef.current
    ) {
      fileInputRef.current.value =
        '';
    }
  }
  function handleCancelAnalysis() {
    if (!canCancel) {
      return;
    }

    abortControllerRef.current
      ?.abort();

    if (
      currentJobIdRef.current
    ) {
      cancelQueuedScan(
        currentJobIdRef.current
      ).catch((err) =>
        console.warn(
          'Failed to cancel queued scan:',
          err
        )
      );

      currentJobIdRef.current =
        null;
    }

    clearBackgroundScanState();

    ownsActiveScanRef.current =
      false;

    backgroundOperationIdRef.current =
      null;
  }

  async function runBatchCooldown(
    signal: AbortSignal,
    messagePrefix: string
  ) {
    if (mountedRef.current) {
      setCanCancel(true);
    }

    for (
      let remaining =
        BATCH_COOLDOWN_SECONDS;
      remaining >= 1;
      remaining--
    ) {
      publishScanProgress(
        `${messagePrefix} ${remaining} second${remaining === 1 ? '' : 's'}...`,
        'running'
      );

      await waitWithAbort(
        1000,
        signal
      );
    }
  }
  
  async function performAnalysis(
    signal: AbortSignal,
    userId: string,
    executionCreatives:
      BatchCreative[]
  ) {
    const isBatch =
      executionCreatives.length >
      1;

    let batchId:
      string | null = null;

    if (isBatch) {
      batchId =
        crypto.randomUUID();

      const {
        error: batchError,
      } =
        await supabase
          .from(
            'scan_batches'
          )
          .insert({
            id: batchId,
            user_id: userId,
            total_creatives:
              executionCreatives.length,
          });

      if (batchError) {
        console.error(
          '[CLIENT BATCH] Could not create batch:',
          batchError
        );

        throw new Error(
          'Unable to create scan batch.'
        );
      }
    }

    const allResults:
      PlatformResult[] = [];

    const completedScanIds:
      string[] = [];

    for (
      let creativeIndex = 0;
      creativeIndex <
      executionCreatives.length;
      creativeIndex++
    ) {
      const creative =
        executionCreatives[
          creativeIndex
        ];

      const batchPosition =
        isBatch
          ? creativeIndex + 1
          : null;

      const operationId =
        backgroundOperationIdRef.current;

      if (
        isBatch &&
        operationId
      ) {
        updateBackgroundBatchItem(
          operationId,
          creative.id,
          {
            status:
              'processing',
            error: null,
          }
        );
      }

      const label =
        isBatch
          ? `Creative ${creativeIndex + 1} of ${executionCreatives.length}`
          : 'Your creative';

      publishScanProgress(
        `${label}: preparing ${creative.kind}...`,
        'preparing'
      );

      const creativeStartTime =
        Date.now();

      let frames:
        ExtractedFrame[] = [];

      let framesExtractedTime:
        number | null = null;

      let audio:
        {
          data: string;
          mimeType: string;
        } |
        null = null;

      try {
        if (
          creative.kind ===
          'video'
        ) {
          frames =
            await extractFrames(
              creative.file,
              signal,
              creative.scanType
            );

          framesExtractedTime =
            Date.now();

          if (
            creative.analyzeAudio &&
            canAnalyzeAudio
          ) {
            publishScanProgress(
              `${label}: preparing audio track...`,
              'preparing'
            );

            audio =
              await extractAudio(
                creative.file,
                signal
              );
          }
        } else if (
          creative.kind ===
          'image'
        ) {
          const imageData =
            await fileToBase64(
              creative.file
            );

          frames = [{
            frameNumber: 1,
            timestamp:
              '00:00.00',
            timestampSeconds:
              0,
            data: imageData,
          }];

          framesExtractedTime =
            Date.now();
        } else {
          framesExtractedTime =
            Date.now();
        }

        let thumbnailPath:
          string | null = null;

        if (
          profile?.scan_history &&
          frames[0]
        ) {
          const thumbnailScanId =
            crypto.randomUUID();

          thumbnailPath =
            await uploadScanThumbnail(
              userId,
              thumbnailScanId,
              frames[0].data
            );
        }

        const framesWaitMs =
          framesExtractedTime
            ? framesExtractedTime -
              creativeStartTime
            : 0;

        const batchMeta =
          isBatch &&
          batchId &&
          batchPosition
            ? {
                batchedByClient:
                  true,
                batchId,
                batchPosition,
              }
            : undefined;

        const creativeResults:
          PlatformResult[] = [];

        const creativeScanIds:
          string[] = [];

        let creativeError:
          Error | null = null;

        const selectedPlatforms =
  creative.platforms.slice(
    0,
    1
  );

for (
  let platformIndex = 0;
  platformIndex <
  selectedPlatforms.length;
  platformIndex++
) {
  const platform =
    selectedPlatforms[
      platformIndex
    ];
          const scanId =
            crypto.randomUUID();

          const scanStartTime =
            Date.now();

          const fileName =
            profile?.scan_history
              ? creative.displayName
              : null;

          try {
            publishScanProgress(
              `${label}: analyzing against ${platform.toUpperCase()} policies...`,
              'running'
            );

            if (
              mountedRef.current
            ) {
              setCanCancel(
                false
              );
            }

            let response =
              creative.kind ===
              'video'
                ? await scanVideo(
                    frames,
                    audio,
                    platform,
                    creative.scanType,
                    null,
                    signal,
                    scanId,
                    thumbnailPath,
                    fileName,
                    batchMeta
                  )
                : creative.kind ===
                  'video_url'
                  ? await scanVideoUrl(
                      creative.sourceUrl,
                      platform,
                      creative.scanType,
                      null,
                      signal,
                      scanId,
                      null,
                      fileName,
                      batchMeta,
                      false
                    )
                  : creative.kind ===
                    'image_url'
                    ? await scanImageUrl(
                        creative.sourceUrl,
                        platform,
                        null,
                        signal,
                        scanId,
                        null,
                        fileName,
                        batchMeta
                      )
                : await scanImage(
                    frames[0].data,
                    platform,
                    null,
                    signal,
                    scanId,
                    thumbnailPath,
                    fileName,
                    batchMeta
                  );

            let queueEnteredAt:
              number | null = null;

            let queueWaitMs =
              0;

            let jobId:
              string | null = null;

            while (
              'queued' in
                response &&
              response.queued
            ) {
              if (
                !queueEnteredAt
              ) {
                queueEnteredAt =
                  Date.now();
              }

              jobId =
                response.jobId;

              currentJobIdRef.current =
                jobId;

              if (
                mountedRef.current
              ) {
                setCanCancel(
                  true
                );
              }

              publishScanProgress(
                `${label}: queued at position ${response.position}. Waiting for your turn...`,
                'running'
              );

              await waitForQueueTurn(
                jobId,
                signal,
                (position) =>
                  publishScanProgress(
                    `${label}: queued at position ${position}. Waiting for your turn...`,
                    'running'
                  )
              );

              currentJobIdRef.current =
                null;

              queueWaitMs =
                Date.now() -
                (
                  queueEnteredAt as number
                );

              publishScanProgress(
                `${label}: analyzing against ${platform.toUpperCase()} policies...`,
                'running'
              );

              if (
                mountedRef.current
              ) {
                setCanCancel(
                  false
                );
              }

              response =
                creative.kind ===
                'video'
                  ? await scanVideo(
                      frames,
                      audio,
                      platform,
                      creative.scanType,
                      jobId,
                      signal,
                      scanId,
                      thumbnailPath,
                      fileName,
                      batchMeta
                    )
                  : creative.kind ===
                    'video_url'
                    ? await scanVideoUrl(
                        creative.sourceUrl,
                        platform,
                        creative.scanType,
                        jobId,
                        signal,
                        scanId,
                        null,
                        fileName,
                        batchMeta,
                        false
                      )
                    : creative.kind ===
                      'image_url'
                      ? await scanImageUrl(
                          creative.sourceUrl,
                          platform,
                          jobId,
                          signal,
                          scanId,
                          null,
                          fileName,
                          batchMeta
                        )
                  : await scanImage(
                      frames[0].data,
                      platform,
                      jobId,
                      signal,
                      scanId,
                      thumbnailPath,
                      fileName,
                      batchMeta
                    );
            }

            const completed =
              response as Extract<
                typeof response,
                {
                  success: true;
                }
              >;

            if (jobId) {
              reportQueueTiming(
                jobId,
                {
                  totalTimeMs:
                    Date.now() -
                    scanStartTime,
                  queueWaitMs,
                  framesWaitMs,
                }
              );
            }

            const {
              riskLevel,
              riskClass,
              processedViolations,
            } =
              calculateConfidenceScore(
                completed.result
                  .violations as Violation[]
              );

            creativeResults.push({
              creativeId:
                creative.id,
              fileName:
                creative.displayName,
              fileKind:
                creative.kind,
              batchPosition,
              scanId,
              platform:
                completed.result
                  .platform,
              riskLevel,
              riskClass,
              processedViolations,
            });

            creativeScanIds.push(
              scanId
            );
          } catch (
            error: any
          ) {
            if (
              error?.name ===
                'AbortError' ||
              signal.aborted
            ) {
              throw error;
            }

            if (
              isBatch &&
              shouldStopBatch(
                error
              )
            ) {
              throw error;
            }

            if (!isBatch) {
              throw error;
            }

            if (
              !creativeError
            ) {
              creativeError =
                error instanceof
                  Error
                  ? error
                  : new Error(
                      'Creative scan failed.'
                    );
            }
          }

          if (
            isBatch &&
            platformIndex <
              selectedPlatforms.length -
                1
          ) {
            await runBatchCooldown(
              signal,
              `${label}: next platform scan starting in`
            );
          }
        }

        allResults.push(
          ...creativeResults
        );

        completedScanIds.push(
          ...creativeScanIds
        );

        if (
          isBatch &&
          operationId
        ) {
          updateBackgroundBatchItem(
            operationId,
            creative.id,
            {
              status:
                creativeError
                  ? 'error'
                  : 'success',
              scanIds:
                creativeScanIds,
              error:
                creativeError
                  ? 'One or more scans for this creative could not be completed.'
                  : null,
            }
          );
        }
      } catch (
        error: any
      ) {
        if (
          error?.name ===
            'AbortError' ||
          signal.aborted ||
          shouldStopBatch(
            error
          )
        ) {
          throw error;
        }

        if (!isBatch) {
          throw error;
        }

        if (
          operationId
        ) {
          updateBackgroundBatchItem(
            operationId,
            creative.id,
            {
              status: 'error',
              scanIds: [],
              error:
                'This creative could not be prepared or completed.',
            }
          );
        }
      }

      if (
        isBatch &&
        creativeIndex <
          executionCreatives.length -
            1
      ) {
        const nextCreative =
          executionCreatives[
            creativeIndex + 1
          ];

        if (
          operationId
        ) {
          updateBackgroundBatchItem(
            operationId,
            nextCreative.id,
            {
              status:
                'cooldown',
            }
          );
        }

        await runBatchCooldown(
          signal,
          `Scan ${creativeIndex + 1} of ${executionCreatives.length} complete. Next scan starting in`
        );
      }
    }

    const operationId =
      backgroundOperationIdRef.current;

    if (operationId) {
      completeBackgroundScan(
        operationId,
        allResults,
        completedScanIds
      );
    }

    if (
      mountedRef.current
    ) {
      setResults(
        allResults
      );

      setSelectedResultCreativeId(
        executionCreatives[0]
          ?.id ??
          allResults[0]
            ?.creativeId ??
          null
      );

      onResultsChange?.(
        buildFeedbackTarget(
          allResults,
          isBatch
        )
      );

      await onScanComplete();
    }
  }

  async function handleAnalyze() {
    setBanner(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setBanner({ tone: 'error', title: 'Not logged in', message: 'Please sign in to run a scan.' });
      return;
    }

     if (
      creatives.length > 1 &&
      !canBatchScan
    ) {
      setBanner({
        tone: 'warning',
        title:
          'Paid plan required',
        message:
          'Batch scanning is available on paid plans only.',
        actionLabel:
          'Upgrade plan',
        onAction: () =>
          window.location.assign(
            '/buy-tokens'
          ),
      });

      return;
    }

    if (
      !allCreativesConfigured
    ) {
      setBanner({
        tone: 'warning',
        title:
          'Choose target platforms',
        message:
          'Every creative needs at least one target platform before analysis can start.',
      });

      return;
    }

    if (
      scansRemaining <
      totalCost
    ) {
      setBanner({
        tone: 'warning',
        title:
          'Not enough scans',
        message:
          creatives.length > 1
            ? `This batch requires ${totalCost} scans. You have ${scansRemaining} remaining. Reduce the selected platforms, use Regular Scan where appropriate, or upgrade your plan.`
            : `This scan requires ${totalCost} scan${totalCost === 1 ? '' : 's'}. You have ${scansRemaining} remaining.`,
        actionLabel:
          'Upgrade plan',
        onAction: () =>
          window.location.assign(
            '/buy-tokens'
          ),
      });

      return;
    }

    const executionCreatives =
      orderCreativesForExecution(
        creatives
      );

    const initialBatchItems:
      BackgroundBatchItem[] =
        executionCreatives.length >
        1
          ? executionCreatives.map(
              (
                creative,
                index
              ) => ({
                creativeId:
                  creative.id,
                fileName:
                  creative.displayName,
                fileKind:
                  creative.kind,
                batchPosition:
                  index + 1,
                status:
                  'queued',
                scanIds: [],
                error: null,
              })
            )
          : [];

    const operationId =
      beginBackgroundScan(
        'Preparing analysis...',
        initialBatchItems
      );

    backgroundOperationIdRef.current =
      operationId;

    ownsActiveScanRef.current =
      true;

    setIsAnalyzing(true);
    setResults(null);
    onResultsChange?.(null);
    setCanCancel(true);

    const controller =
      new AbortController();

    abortControllerRef.current =
      controller;

    startElapsedTimer();

    try {
      await performAnalysis(
        controller.signal,
        session.user.id,
        executionCreatives
      );
    } catch (error: any) {
      if (
        error?.name ===
          'AbortError' ||
        controller.signal.aborted
      ) {
        clearBackgroundScanState();

        ownsActiveScanRef.current =
          false;

        backgroundOperationIdRef.current =
          null;

        if (mountedRef.current) {
          setBanner({
            tone: 'error',
            title: 'Analysis cancelled',
            message: '',
          });
        }

        return;
      }

      const message: string = error?.message || '';
      const recordFailure = (
        nextBanner: Banner
      ) => {
        const operationId =
          backgroundOperationIdRef.current;

        if (operationId) {
          failBackgroundScan(
            operationId,
            nextBanner.title,
            nextBanner.message ||
              'Something went wrong. Please try again.'
          );
        }

        if (mountedRef.current) {
          setBanner(
            nextBanner
          );
        }
      };
      const isDuplicateScanError =
        message.includes('Scan already in progress') || message.includes('already have a scan in progress');
      const isRateLimitError = message.includes('Rate limit exceeded') || message.includes('Free tier limit');
      const isAccountFlaggedError =
        message.includes('ACCOUNT_FLAGGED') || message.includes('locked pending resolution');
      const isAudioLockedError =
        message.includes('Audio analysis unavailable') ||
        message.includes('Audio analysis is available on paid plans only');
      const isBatchLockedError =
        message.includes(
          'Batch scanning unavailable'
        ) ||
        message.includes(
          'Batch scanning is available on paid plans only'
        );

      const isBatchMetadataError =
        message.includes(
          'Invalid batch metadata'
        ) ||
        message.includes(
          'Unable to validate scan batch'
        ) ||
        message.includes(
          'Unable to create scan batch'
        );
      const isTokenError = message.includes('Insufficient tokens');
      const isAuthError = message.includes('Unauthorized') || message.includes('Not authenticated');
      const isCorruptionError =
        message.includes('corrupt') || message.includes('Failed to load') || message.includes('decode');
      const isParseError = message.includes('parse') || message.includes('JSON');

      if (isDuplicateScanError) {
        recordFailure({
          tone: 'error',
          title: 'One scan at a time',
          message: 'You already have a scan in progress. Please wait for it to finish before starting another.',
        });
      } else if (isRateLimitError) {
        recordFailure({
          tone: 'warning',
          title: 'Scan limit reached',
          message,
          actionLabel: 'Buy tokens',
          onAction: () => window.location.assign('/buy-tokens'),
        });
      } else if (isAccountFlaggedError) {
        const notifiedDate = profile?.last_notified_at
          ? new Date(profile.last_notified_at).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })
          : null;
        recordFailure({
          tone: 'warning',
          title: 'Action required',
          message: `We've paused scanning on this account pending a policy review. ${
            notifiedDate
              ? `We sent an email to both account emails with further instruction on ${notifiedDate}.`
              : 'Check your email for details.'
          }`,
          actionLabel: 'Upgrade plan',
          onAction: () => window.location.assign('/buy-tokens'),
        });
      } else if (isAuthError) {
        recordFailure({
          tone: 'error',
          title: 'Session expired',
          message: 'Your session has expired. Please sign out and sign in again.',
        });
      } else if (isTokenError) {
        recordFailure({
          tone: 'warning',
          title: 'Out of tokens',
          message: 'You have no tokens remaining. Purchase more to continue scanning.',
          actionLabel: 'Buy tokens',
          onAction: () => window.location.assign('/buy-tokens'),
        });
      } else if (isCorruptionError) {
        recordFailure({
          tone: 'error',
          title: 'Corrupt file',
          message:
            "Your content seems to be corrupt or we don't support this file type. Please upload another file or convert this file into a supported format.",
        });
      } else if (isParseError) {
        recordFailure({
          tone: 'error',
          title: 'Analysis error',
          message:
            'We returned an invalid response. This may be due to complex content or a temporary issue. Please try again or contact support if this persists.',
        });
      } else if (isAudioLockedError) {
        recordFailure({
          tone: 'warning',
          title: 'Paid plan required',
          message: 'Audio analysis is available on paid plans only. Upgrade to analyze spoken claims in your ads.',
          actionLabel: 'Upgrade plan',
          onAction: () => window.location.assign('/buy-tokens'),
        });
      } else if (
        isBatchLockedError
      ) {
        recordFailure({
          tone: 'warning',
          title:
            'Paid plan required',
          message:
            'Batch scanning is available on paid plans only.',
          actionLabel:
            'Upgrade plan',
          onAction: () =>
            window.location.assign(
              '/buy-tokens'
            ),
        });
      } else if (
        isBatchMetadataError
      ) {
        recordFailure({
          tone: 'error',
          title:
            'Batch could not start',
          message:
            'The batch could not be validated. Please start a new batch and try again.',
        });
      } else {
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'Something went wrong. Please try again or contact support.';

        recordFailure({
          tone: 'error',
          title: 'Analysis failed',
          message,
        });
      }
    } finally {
      stopElapsedTimer();

      if (mountedRef.current) {
        setIsAnalyzing(false);
      }

      abortControllerRef.current =
        null;

      ownsActiveScanRef.current =
        false;

      backgroundOperationIdRef.current =
        null;
    }
  }

  const analyzeDisabled =
  creatives.length === 0 ||
  !allCreativesConfigured ||
  isAnalyzing;

const isBatchResult =
  (backgroundScan.batchItems?.length ?? 0) > 1;

const resultCreativeOptions =
  isBatchResult
    ? (backgroundScan.batchItems ?? []).map(
        (item) => ({
          creativeId:
            item.creativeId,
          fileName:
            item.fileName,
          batchPosition:
            item.batchPosition,
          status:
            item.status,
          error:
            item.error,
        })
      )
    : Array.from(
        new Map(
          (
            results ?? []
          ).map(
            (result) => [
              result.creativeId,
              {
                creativeId:
                  result.creativeId,
                fileName:
                  result.fileName,
                batchPosition:
                  result.batchPosition,
                status:
                  'success' as const,
                error:
                  null,
              },
            ]
          )
        ).values()
      );

const activeResultCreativeId =
  selectedResultCreativeId ??
  resultCreativeOptions[0]
    ?.creativeId ??
  results?.[0]
    ?.creativeId ??
  null;

const visibleResults =
  (
    results ?? []
  ).filter(
    (result) =>
      result.creativeId ===
      activeResultCreativeId
  );

const activeResultOption =
  resultCreativeOptions.find(
    (item) =>
      item.creativeId ===
      activeResultCreativeId
  ) ??
  null;
  
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm">
      <div className="p-6 space-y-6">
        {!isAnalyzing && !results && (
          <>
                        {/* Upload */}
            {creatives.length <
              (
                canBatchScan
                  ? MAX_BATCH_FILES
                  : 1
              ) && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() =>
                  setIsDragOver(false)
                }
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);

                  handleFiles(
                    Array.from(
                      e.dataTransfer
                        .files ??
                        []
                    )
                  );
                }}
                onClick={() =>
                  fileInputRef.current
                    ?.click()
                }
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  isDragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/60'
                }`}
              >
                <input
                  ref={
                    fileInputRef
                  }
                  type="file"
                  multiple={
                    canBatchScan
                  }
                  accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/gif"
                  className="hidden"
                  onChange={(e) =>
                    handleFiles(
                      Array.from(
                        e.target
                          .files ??
                          []
                      )
                    )
                  }
                />
                <div
                  className="max-w-3xl mx-auto mb-5"
                  onClick={(event) =>
                    event.stopPropagation()
                  }
                  onPointerDown={(event) =>
                    event.stopPropagation()
                  }
                >
                  <label
                    htmlFor="creative-url"
                    className="block text-sm font-semibold text-foreground mb-2"
                  >
                    Paste a video or image URL
                  </label>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      id="creative-url"
                      type="url"
                      placeholder="https://..."
                      value={urlInput}
                      onChange={(event) =>
                        setUrlInput(
                          event.target.value
                        )
                      }
                      onKeyDown={(event) => {
                        event.stopPropagation();

                        if (
                          event.key ===
                          'Enter'
                        ) {
                          event.preventDefault();
                          handleUrlSubmit();
                        }
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
                    />

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleUrlSubmit();
                      }}
                      disabled={
                        !urlInput ||
                        resolvingUrl
                      }
                      className="rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {resolvingUrl
                        ? 'Checking...'
                        : 'Add URL'}
                    </button>
                  </div>
                </div>

                <p className="font-medium text-foreground">
                  {canBatchScan
                    ? 'Drop up to 5 videos or images here, or click to browse'
                    : 'Drop a video or image here, or click to browse'}
                </p>

                <p className="text-sm text-muted-foreground mt-1">
                  Supported: MP4, MOV, WebM, PNG, JPG, GIF
                </p>

                <p className="text-xs text-muted-foreground mt-1">
                  For best results, use videos at 720p or higher.
                </p>

                {!canBatchScan && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Batch scanning is available on paid plans.
                  </p>
                )}
              </div>
            )}

            {creatives.length >
              0 && (
              <>
                <div className="space-y-2">
                  {creatives.map(
                    (
                      creative
                    ) => {
                      const executionPosition =
                        executionPreview.findIndex(
                          (item) =>
                            item.id ===
                            creative.id
                        ) + 1;

                      return (
                        <div
                          key={
                            creative.id
                          }
                          className="flex items-center gap-3 border border-border rounded-lg p-3"
                        >
                          <div className="w-16 h-12 shrink-0 rounded-md overflow-hidden bg-muted">
                            {creative.kind ===
                            'video' ? (
                              <video
                                src={
                                  creative.previewUrl
                                }
                                muted
                                className="w-full h-full object-cover"
                              />
                            ) : creative.previewUrl ? (
                              <img
                                src={
                                  creative.previewUrl
                                }
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">
                                URL
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {
                                creative
                                  .displayName
                              }
                            </p>

                            <p className="text-xs text-muted-foreground">
                              {isVideoCreative(creative)
                                ? 'Video'
                                : 'Image'}

                              {creatives.length >
                                1 &&
                                ` · Batch position ${executionPosition}`}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              removeCreative(
                                creative.id
                              )
                            }
                            className="text-muted-foreground hover:text-foreground text-lg leading-none px-2"
                            aria-label={`Remove ${creative.displayName}`}
                          >
                            ×
                          </button>
                        </div>
                      );
                    }
                  )}

                  {creatives.length >
                    1 && (
                    <p className="text-xs text-muted-foreground">
                      Images are processed before videos. Batch position follows execution order.
                    </p>
                  )}
                </div>

                {/* Target Platform */}
<div>
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
    <p className="text-sm font-semibold">
      Target Platform
    </p>

    {creatives.length > 1 && (
      <div className="flex items-center gap-2">
        <select
          value={
            platformCreative?.id ?? ''
          }
          onChange={(event) =>
            setPlatformCreativeId(
              event.target.value
            )
          }
          className="max-w-52 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
        >
          {creatives.map(
            (creative) => (
              <option
                key={creative.id}
                value={creative.id}
              >
                {creative.displayName}
              </option>
            )
          )}
        </select>

        <button
          type="button"
          onClick={
            applyPlatformsToAll
          }
          disabled={
            !platformCreative
              ?.platforms[0]
          }
          className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-secondary disabled:opacity-50"
        >
          Apply platform to all
        </button>
      </div>
    )}
  </div>

  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
    {PLATFORMS.map(
      (platform) => {
        const checked =
          platformCreative
            ?.platforms[0] ===
          platform.value;

        return (
          <label
            key={platform.value}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${
              checked
                ? 'border-primary bg-primary/5 text-foreground'
                : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            <input
              type="radio"
              name={`platform-${
                platformCreative?.id ??
                'none'
              }`}
              checked={checked}
              disabled={
                !platformCreative
              }
              onChange={() => {
                if (
                  platformCreative
                ) {
                  togglePlatform(
                    platformCreative.id,
                    platform.value
                  );
                }
              }}
              className="accent-current"
            />

            <img
              src={platform.icon}
              alt=""
              className="w-4 h-4 object-contain"
            />

            {platform.label}
          </label>
        );
      }
    )}
  </div>

  <p className="text-xs text-muted-foreground mt-2">
    Choose one target platform per creative.
  </p>
</div>

                {/* Video-only settings */}
                {videoCreatives.length >
                  0 &&
                  selectedVideoCreative && (
                  <div className="space-y-4">
                    {videoCreatives.length >
                      1 && (
                      <div className="flex items-center gap-2">
                        <select
                          value={
                            selectedVideoCreative.id
                          }
                          onChange={(
                            event
                          ) =>
                            setVideoCreativeId(
                              event
                                .target
                                .value
                            )
                          }
                          className="max-w-52 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                        >
                          {videoCreatives.map(
                            (
                              creative
                            ) => (
                              <option
                                key={
                                  creative.id
                                }
                                value={
                                  creative.id
                                }
                              >
                                {
                                  creative
                                    .displayName
                                }
                              </option>
                            )
                          )}
                        </select>

                        <button
                          type="button"
                          onClick={
                            applyVideoSettingsToAll
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-secondary"
                        >
                          Apply video settings to all
                        </button>
                      </div>
                    )}

                    <div>
                      <p className="text-sm font-semibold mb-2">
                        Scan Type
                      </p>

                      <div className="space-y-2">
                        <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer">
                          <input
                            type="radio"
                            name={`scanType-${selectedVideoCreative.id}`}
                            checked={
                              selectedVideoCreative.scanType ===
                              'regular'
                            }
                            onChange={() =>
                              updateSelectedVideo({
                                scanType:
                                  'regular',
                              })
                            }
                            className="mt-1"
                          />

                          <span>
                            <span className="block font-medium text-sm">
                              Regular Scan
                            </span>

                            <span className="block text-xs text-muted-foreground">
                              Fast and optimized for standard commercials, "talking head" videos, and VSLs
                            </span>
                          </span>
                        </label>

                        <label
                          className={`flex items-start gap-3 p-3 rounded-lg border ${
                            canDeepScan
                              ? 'border-border cursor-pointer'
                              : 'border-border opacity-60 cursor-not-allowed'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`scanType-${selectedVideoCreative.id}`}
                            disabled={
                              !canDeepScan
                            }
                            checked={
                              selectedVideoCreative.scanType ===
                              'deep'
                            }
                            onChange={() =>
                              updateSelectedVideo({
                                scanType:
                                  'deep',
                              })
                            }
                            className="mt-1"
                          />

                          <span>
                            <span className="block font-medium text-sm">
                              Deep Scan

                              {!canDeepScan && (
                                <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                  Paid plan required
                                </span>
                              )}
                            </span>

                            <span className="block text-xs text-muted-foreground">
                              Costs 2 scans and takes longer. We analyze your ad more carefully, step by step, to catch subtler issues a Regular scan can miss.
                            </span>
                          </span>
                        </label>
                      </div>
                    </div>

                    <label
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm w-fit ${
                        canAnalyzeAudio && !selectedVideoIsUrl
                           ? 'border-border cursor-pointer'
                           : 'border-border opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={
                          !canAnalyzeAudio ||
                          selectedVideoIsUrl
                        }
                        checked={
                          canAnalyzeAudio &&
                          !selectedVideoIsUrl &&
                          selectedVideoCreative.analyzeAudio
                        }
                        onChange={(
                          event
                        ) =>
                          updateSelectedVideo({
                            analyzeAudio:
                              event
                                .target
                                .checked,
                          })
                        }
                        className="accent-current"
                      />

                      <span className="font-medium">
                        Analyze Audio Content

                        {!canAnalyzeAudio && (
                          <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            Paid plan required
                          </span>
                        )}
                        {selectedVideoIsUrl && (
                          <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                            File upload only
                          </span>
                        )}
                      </span>
                    </label>
                  </div>
                )}
              </>
            )}

            {banner && (
              <div
                className={`p-3 rounded-lg border text-sm ${
                  banner.tone ===
                  'error'
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-400'
                    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-400'
                }`}
              >
                <p className="font-semibold">
                  {banner.title}
                </p>

                {banner.message && (
                  <p className="mt-0.5">
                    {banner.message}
                  </p>
                )}

                {banner.actionLabel &&
                  banner.onAction && (
                    <button
                      type="button"
                      onClick={
                        banner.onAction
                      }
                      className="mt-2 text-xs font-semibold underline underline-offset-2"
                    >
                      {
                        banner.actionLabel
                      }
                    </button>
                  )}
              </div>
            )}

            {creatives.length > 0 && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    Scan cost:{' '}
                    <strong>
                      {totalCost}{' '}
                      scan
                      {totalCost === 1
                        ? ''
                        : 's'}
                    </strong>
                  </span>

                  <span className="text-muted-foreground">
                    {scansRemaining}{' '}
                    remaining
                  </span>
                </div>

                <button
                  type="button"
                  onClick={
                    handleAnalyze
                  }
                  disabled={
                    analyzeDisabled
                  }
                  id="Philippians 4:13" className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creatives.length > 1
                    ? 'Analyze Batch'
                    : 'Analyze Ad'}
                </button>
              </>
            )}
          </>
        )}

        {/* Progress */}
        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="flex items-center justify-between w-full mb-6">
              <h3 className="font-bold">
                {backgroundScan.batchItems
                 .length > 1
                 ? 'Analyzing Your Batch...'
                 : 'Analyzing Your Ad...'}
              </h3>
              {canCancel && (
                <button
                  onClick={handleCancelAnalysis}
                  className="px-3 py-1.5 text-sm rounded-lg border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm font-medium">{progressText}</p>
            <p className="text-xs text-muted-foreground mt-2 max-w-lg">
              Scan in progress, keep this tab open, do not refresh the page.
              It is safe to leave this page, your
              results will be ready shortly.
            </p>
            {!canCancel && (
              <p className="text-xs text-muted-foreground mt-2">
                Your scan is now running and can no longer be cancelled.
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">Elapsed: {elapsedSeconds}s</p>
          </div>
        )}

        {/* Results */}
        {results && !isAnalyzing && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Analysis Results</h3>
              <button
                onClick={resetForNewScan}
                className="px-3 py-1.5 text-sm rounded-lg border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                New Scan
              </button>
            </div>

            {isBatchResult && (
              <>
                <div className="flex flex-wrap gap-2">
                  {resultCreativeOptions.map(
                    (item) => (
                      <button
                        key={
                          item.creativeId
                        }
                        type="button"
                        onClick={() =>
                          setSelectedResultCreativeId(
                            item.creativeId
                          )
                        }
                        className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                          activeResultCreativeId ===
                          item.creativeId
                            ? 'border-primary bg-primary/5 text-foreground'
                            : 'border-border text-muted-foreground hover:border-primary/50'
                        }`}
                      >
                        #{item.batchPosition}{' '}
                        {item.fileName}{' '}

                        {item.status ===
                        'success'
                          ? '✓'
                          : item.status ===
                            'error'
                          ? '✕'
                          : ''}
                      </button>
                    )
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  {
                    backgroundScan.batchItems.filter(
                      (item) =>
                        item.status ===
                        'success'
                    ).length
                  }{' '}
                  of{' '}
                  {
                    backgroundScan.batchItems.length
                  }{' '}
                  creatives completed without errors.
                </p>
              </>
            )}

            {activeResultOption
              ?.status ===
              'error' && (
              <div className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-400">
                {activeResultOption.error ||
                  'One or more scans for this creative could not be completed.'}
              </div>
            )}
            
            {visibleResults.map((r) => {
              const grouped = groupViolationsByType(r.processedViolations);
              const riskColorClass =
                r.riskClass === 'confidence-low'
                  ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                  : r.riskClass === 'confidence-medium'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
            
              return (
                <div
                  key={`${r.creativeId}:${r.platform}:${r.scanId}`}
                  className="border border-border rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold uppercase text-sm">{r.platform}</span>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${riskColorClass}`}>
                      {r.riskLevel}
                    </span>
                  </div>

                  {r.processedViolations.length === 0 ? (
                    <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm font-medium">
                      <span>✓</span>
                      <span>No violations detected for this platform!</span>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {Object.entries(grouped).map(([type, violations]) => (
                        <div key={type}>
                          <p className="text-sm font-semibold mb-2">{type}</p>
                          <div className="space-y-2">
                            {violations.map((v, idx) => {
                              const location = v.timestamps?.length
                                ? `⏱ ${v.timestamps.join(', ')}`
                                : v.frames?.length
                                ? `🎞️ Frames: ${v.frames.join(', ')}`
                                : null;
                              return (
                                <div key={idx} className={`bg-muted/30 border border-border ${severityBorderClass(v.severity)} rounded-lg p-3 text-sm`}>
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
