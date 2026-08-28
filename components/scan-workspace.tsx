'use client';

// components/scan-workspace.tsx
//
// Web app equivalent of the extension's dashboard screen (upload → config
// → progress → results). Same validation rules, same platform taxonomy,
// same queue-aware polling, same error taxonomy, same risk-scoring logic
// as popup.js — just re-expressed as a React component instead of
// direct DOM manipulation, and styled with the app's existing Tailwind/
// shadcn tokens rather than the extension's raw CSS classes.
//
// Scan history is NOT re-implemented here on purpose: every scan already
// gets written server-side to the `scans` table (see helpers.js logScan,
// called from routes/scanVideo.js and routes/scanImage.js) regardless of
// which client made the request. The dashboard's history table just
// needs to query that table — no client-side storage needed here, unlike
// the extension's historyManager.js (which exists only because the
// extension has no server-rendered history view of its own).

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

export interface WorkspaceProfile {
  plan: string;
  scans_remaining: number;
  scans_per_month?: number;
  deep_scan_enabled?: boolean;
  scan_history?: boolean;
  last_notified_at?: string | null;
}

interface PlatformResult {
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

export function ScanWorkspace({
  profile,
  onScanComplete,
}: {
  profile: WorkspaceProfile | null;
  onScanComplete: () => Promise<void> | void;
}) {
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileKind, setFileKind] = useState<'video' | 'image' | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const [platforms, setPlatforms] = useState<string[]>([]);
  const [scanType, setScanType] = useState<ScanType>('regular');
  // Opt-in — audio is only extracted and sent when this is checked.
  // Video scans only; irrelevant for images and reset whenever a new
  // file is chosen via removeFile()/resetForNewScan().
  const [analyzeAudio, setAnalyzeAudio] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressText, setProgressText] = useState('Initializing...');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [results, setResults] = useState<PlatformResult[] | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentJobIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isVideo = fileKind === 'video';
  const canDeepScan = Boolean(profile?.deep_scan_enabled);
  const scansRemaining = profile?.scans_remaining ?? 0;

  const scanCostPerPlatform = isVideo && scanType === 'deep' ? 2 : 1;
  const totalCost = platforms.length > 0 ? platforms.length * scanCostPerPlatform : scanCostPerPlatform;

  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [previewUrl]);

  function startElapsedTimer() {
    const startTime = Date.now();
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
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

  async function handleFile(file: File) {
    setBanner(null);
    setResults(null);

    if (!VALID_TYPES.includes(file.type)) {
      setBanner({
        tone: 'error',
        title: 'Invalid file type',
        message: 'Please upload a valid video (MP4, MOV, WebM) or image (PNG, JPG, GIF) file.',
      });
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setBanner({
        tone: 'error',
        title: 'File too large',
        message: 'Ads are typically under 1 GB. Please compress your video first.',
      });
      return;
    }

    const kind: 'video' | 'image' = file.type.startsWith('video/') ? 'video' : 'image';

    try {
      if (kind === 'video') {
        const objectUrl = URL.createObjectURL(file);
        await new Promise<void>((resolve, reject) => {
          const probe = document.createElement('video');
          const timeout = setTimeout(() => reject(new Error('Video failed to load - file may be corrupt')), 10000);

          probe.addEventListener(
            'loadedmetadata',
            () => {
              clearTimeout(timeout);
              if (!isFinite(probe.duration) || probe.duration <= 0) {
                reject(new Error('Video file is corrupt or has invalid duration'));
                return;
              }
              if (probe.duration > MAX_VIDEO_SECONDS) {
                reject(new Error('VIDEO_TOO_LONG'));
                return;
              }
              if (probe.videoWidth === 0 || probe.videoHeight === 0) {
                reject(new Error('Video file is corrupt or has no video track'));
                return;
              }
              resolve();
            },
            { once: true }
          );

          probe.addEventListener(
            'error',
            () => {
              clearTimeout(timeout);
              reject(new Error('Video file is corrupt or unsupported format'));
            },
            { once: true }
          );

          probe.src = objectUrl;
        });

        setPreviewUrl(objectUrl);
        setFileKind('video');
        setCurrentFile(file);
      } else {
        const dataUrl = await fileToBase64(file);
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          const timeout = setTimeout(() => reject(new Error('Image failed to load - file may be corrupt')), 5000);
          img.onload = () => {
            clearTimeout(timeout);
            if (img.naturalWidth === 0 || img.naturalHeight === 0) {
              reject(new Error('Image file is corrupt or has invalid dimensions'));
              return;
            }
            resolve();
          };
          img.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('Image file is corrupt or unsupported format'));
          };
          img.src = dataUrl;
        });

        setPreviewUrl(dataUrl);
        setFileKind('image');
        setCurrentFile(file);
      }
    } catch (error: any) {
      setPreviewUrl(null);
      setFileKind(null);
      setCurrentFile(null);

      if (error.message === 'VIDEO_TOO_LONG') {
        setBanner({
          tone: 'error',
          title: 'Video too long',
          message: 'Most platforms recommend 15-60 seconds for optimal engagement. Maximum allowed length is 2 minutes.',
        });
      } else {
        setBanner({
          tone: 'error',
          title: 'Corrupt file',
          message:
            "Your content seems to be corrupt or we don't support this file type. Please upload another file or convert this file into a supported format.",
        });
      }
    }
  }

  function removeFile() {
    if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFileKind(null);
    setCurrentFile(null);
    setResults(null);
    setAnalyzeAudio(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function togglePlatform(value: string) {
    setPlatforms((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]));
  }

  function resetForNewScan() {
    removeFile();
    setPlatforms([]);
    setScanType('regular');
    setResults(null);
    setBanner(null);
  }

  function handleCancelAnalysis() {
    abortControllerRef.current?.abort();
    if (currentJobIdRef.current) {
      cancelQueuedScan(currentJobIdRef.current).catch((err) =>
        console.warn('Failed to cancel queued scan server-side:', err)
      );
      currentJobIdRef.current = null;
    }
  }

  async function performAnalysis(signal: AbortSignal) {
    const scanStartTime = Date.now();
    setProgressText('Preparing analysis...');

    let frames: ExtractedFrame[] = [];
    let framesExtractedTime: number | null = null;
    let audio: { data: string; mimeType: string } | null = null;

    if (isVideo && currentFile) {
      setProgressText('Preparing your video...');
      frames = await extractFrames(currentFile, signal, scanType);
      framesExtractedTime = Date.now();
      if (analyzeAudio) {
        setProgressText('Preparing audio track...');
        audio = await extractAudio(currentFile, signal);
      }
    } else if (currentFile) {
      setProgressText('Preparing your image...');
      const imageData = await fileToBase64(currentFile);
      frames = [{ frameNumber: 1, timestamp: '00:00.00', timestampSeconds: 0, data: imageData }];
      framesExtractedTime = Date.now();
    }

    // Upload one thumbnail for this scan session (same first frame across
    // every platform being scanned) rather than once per platform — a
    // scan against 3 platforms shouldn't upload the same image 3 times.
    // Best-effort: a failed upload just means no thumbnail, never blocks
    // the actual scan. Only attempted for paid users (scan_history gate)
    // since free-tier scans never show up in history anyway.
    let thumbnailPath: string | null = null;
    if (profile?.scan_history && frames[0]) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const thumbnailScanId = crypto.randomUUID();
        thumbnailPath = await uploadScanThumbnail(user.id, thumbnailScanId, frames[0].data);
      }
    }

    const framesWaitMs = framesExtractedTime ? framesExtractedTime - scanStartTime : 0;
    const platformList = platforms.join(', ').toUpperCase();
    setProgressText(`Analyzing your content against ${platformList} policies...`);

    const rawResults = await Promise.all(
      platforms.map(async (platform) => {
        const scanId = crypto.randomUUID();
        // Gated the same as thumbnailPath — file names are only ever sent
        // to the server for accounts whose plan includes Scan History,
        // matching what the Privacy Policy now actually says.
        const fileName = profile?.scan_history ? currentFile?.name ?? null : null;
        let response = isVideo
          ? await scanVideo(frames, audio, platform, scanType, null, signal, scanId, thumbnailPath, fileName)
          : await scanImage(frames[0].data, platform, null, signal, scanId, thumbnailPath, fileName);

        let queueEnteredAt: number | null = null;
        let queueWaitMs = 0;
        let jobId: string | null = null;

        while ('queued' in response && response.queued) {
          if (!queueEnteredAt) queueEnteredAt = Date.now();
          jobId = response.jobId;
          currentJobIdRef.current = jobId;
          setProgressText(`You're queued at position ${response.position}. Waiting for your turn...`);

          await waitForQueueTurn(jobId, signal, (position) =>
            setProgressText(`You're queued at position ${position}. Waiting for your turn...`)
          );
          currentJobIdRef.current = null;
          queueWaitMs = Date.now() - (queueEnteredAt as number);

          setProgressText(`Analyzing your content against ${platform.toUpperCase()} policies...`);

          response = isVideo
            ? await scanVideo(frames, audio, platform, scanType, jobId, signal, scanId, thumbnailPath, fileName)
            : await scanImage(frames[0].data, platform, jobId, signal, scanId, thumbnailPath, fileName);
        }

        const completed = response as Extract<typeof response, { success: true }>;

        if (jobId) {
          const totalTimeMs = Date.now() - scanStartTime;
          reportQueueTiming(jobId, { totalTimeMs, queueWaitMs, framesWaitMs });
        }

        return { platform, response: completed };
      })
    );

    // Reflect the latest scan balance immediately — the parent also
    // refetches the full profile in onScanComplete, but this avoids a
    // flash of the stale count while that request is in flight.
    const last = rawResults[rawResults.length - 1]?.response;
    if (last?.scansRemaining !== undefined) {
      // handled by parent via onScanComplete()
    }

    const formatted: PlatformResult[] = rawResults.map(({ response }) => {
      const { riskLevel, riskClass, processedViolations } = calculateConfidenceScore(
        response.result.violations as Violation[]
      );
      return { platform: response.result.platform, riskLevel, riskClass, processedViolations };
    });

    setResults(formatted);
    await onScanComplete();
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

    if (scansRemaining < totalCost) {
      setBanner({
        tone: 'warning',
        title: 'Not enough scans',
        message:
          totalCost > platforms.length
            ? `Deep scan requires ${scanCostPerPlatform} scans per platform. You have ${scansRemaining} remaining. Switch to regular scan or upgrade your plan.`
            : 'You have used all your scans for this month. Upgrade your plan to continue scanning.',
        actionLabel: 'Upgrade plan',
        onAction: () => window.location.assign('/buy-tokens'),
      });
      return;
    }

    setIsAnalyzing(true);
    setResults(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    startElapsedTimer();

    try {
      await performAnalysis(controller.signal);
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        // user cancelled — no banner
      } else {
        const message: string = error?.message || '';
        const isDuplicateScanError =
          message.includes('Scan already in progress') || message.includes('already have a scan in progress');
        const isRateLimitError = message.includes('Rate limit exceeded') || message.includes('Free tier limit');
        const isAccountFlaggedError =
          message.includes('ACCOUNT_FLAGGED') || message.includes('locked pending resolution');
        const isTokenError = message.includes('Insufficient tokens');
        const isAuthError = message.includes('Unauthorized') || message.includes('Not authenticated');
        const isCorruptionError =
          message.includes('corrupt') || message.includes('Failed to load') || message.includes('decode');
        const isParseError = message.includes('parse') || message.includes('JSON');

        if (isDuplicateScanError) {
          setBanner({
            tone: 'error',
            title: 'One scan at a time',
            message: 'You already have a scan in progress. Please wait for it to finish before starting another.',
          });
        } else if (isRateLimitError) {
          setBanner({
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
          setBanner({
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
          setBanner({
            tone: 'error',
            title: 'Session expired',
            message: 'Your session has expired. Please sign out and sign in again.',
          });
        } else if (isTokenError) {
          setBanner({
            tone: 'warning',
            title: 'Out of tokens',
            message: 'You have no tokens remaining. Purchase more to continue scanning.',
            actionLabel: 'Buy tokens',
            onAction: () => window.location.assign('/buy-tokens'),
          });
        } else if (isCorruptionError) {
          setBanner({
            tone: 'error',
            title: 'Corrupt file',
            message:
              "Your content seems to be corrupt or we don't support this file type. Please upload another file or convert this file into a supported format.",
          });
        } else if (isParseError) {
          setBanner({
            tone: 'error',
            title: 'Analysis error',
            message:
              'We returned an invalid response. This may be due to complex content or a temporary issue. Please try again or contact support if this persists.',
          });
        } else {
          setBanner({
            tone: 'error',
            title: 'Analysis failed',
            message: 'Something went wrong. Please try again or contact support.',
          });
        }
      }
    } finally {
      stopElapsedTimer();
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  }

  const analyzeDisabled = !currentFile || platforms.length === 0 || isAnalyzing;

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm">
      <div className="p-6 space-y-6">
        {!isAnalyzing && !results && (
          <>
            {/* Upload */}
            {!currentFile ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFile(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  isDragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
                <p className="font-medium text-foreground">Drop a video or image here, or click to browse</p>
                <p className="text-sm text-muted-foreground mt-1">Supported: MP4, MOV, WebM, PNG, JPG, GIF</p>
                <p className="text-xs text-muted-foreground mt-1">For best results, use videos at 720p or higher.</p>
              </div>
            ) : (
              <div className="border border-border rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium truncate">{currentFile.name}</span>
                  <button onClick={removeFile} className="text-muted-foreground hover:text-foreground text-lg leading-none px-2">
                    ×
                  </button>
                </div>
                {isVideo ? (
                  <video src={previewUrl || undefined} controls className="w-full max-h-72 rounded-lg bg-black" />
                ) : (
                  <img src={previewUrl || undefined} alt="preview" className="w-full max-h-72 object-contain rounded-lg" />
                )}
              </div>
            )}

            {/* Platforms */}
            <div>
              <p className="text-sm font-semibold mb-2">Target Platforms</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PLATFORMS.map((p) => (
                  <label
                    key={p.value}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${
                      platforms.includes(p.value)
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={platforms.includes(p.value)}
                      onChange={() => togglePlatform(p.value)}
                      className="accent-current"
                    />
                    <img src={p.icon} alt="" className="w-4 h-4 object-contain" />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Scan type — video only */}
            {isVideo && (
              <div>
                <p className="text-sm font-semibold mb-2">Scan Type</p>
                <div className="space-y-2">
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer">
                    <input
                      type="radio"
                      name="scanType"
                      checked={scanType === 'regular'}
                      onChange={() => setScanType('regular')}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-medium text-sm">Regular Scan</span>
                      <span className="block text-xs text-muted-foreground">
                        Fast and optimized for standard commercials, "talking head" videos, and VSLs
                      </span>
                    </span>
                  </label>
                  <label
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
                      canDeepScan ? 'border-border' : 'border-border opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <input
                      type="radio"
                      name="scanType"
                      disabled={!canDeepScan}
                      checked={scanType === 'deep'}
                      onChange={() => setScanType('deep')}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-medium text-sm">
                        Deep Scan{' '}
                        {!canDeepScan && (
                          <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            Paid plan required
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Slower, but designed for fast-paced "UGC-style" ads or montages where violations might be
                        hidden in fast cuts
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* Audio analysis — opt-in, video only */}
            {isVideo && (
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border cursor-pointer text-sm w-fit">
                <input
                  type="checkbox"
                  checked={analyzeAudio}
                  onChange={(e) => setAnalyzeAudio(e.target.checked)}
                  className="accent-current"
                />
                <span className="font-medium">Analyze Audio Content</span>
              </label>
            )}

            {/* Cost + banner */}
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                Scan cost: <strong>{totalCost} scan{totalCost === 1 ? '' : 's'}</strong>
              </span>
              <span className="text-muted-foreground">{scansRemaining} remaining</span>
            </div>

            {banner && (
              <div
                className={`p-3 rounded-lg border text-sm ${
                  banner.tone === 'error'
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-400'
                    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-400'
                }`}
              >
                <p className="font-semibold">{banner.title}</p>
                <p className="mt-0.5">{banner.message}</p>
                {banner.actionLabel && banner.onAction && (
                  <button onClick={banner.onAction} className="mt-2 text-xs font-semibold underline underline-offset-2">
                    {banner.actionLabel}
                  </button>
                )}
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={analyzeDisabled}
              className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Analyze Ad
            </button>
          </>
        )}

        {/* Progress */}
        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="flex items-center justify-between w-full mb-6">
              <h3 className="font-bold">Analyzing Your Ad...</h3>
              <button
                onClick={handleCancelAnalysis}
                className="px-3 py-1.5 text-sm rounded-lg border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm font-medium">{progressText}</p>
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

            {results.map((r) => {
              const grouped = groupViolationsByType(r.processedViolations);
              const riskColorClass =
                r.riskClass === 'confidence-low'
                  ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                  : r.riskClass === 'confidence-medium'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';

              return (
                <div key={r.platform} className="border border-border rounded-lg p-4">
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
