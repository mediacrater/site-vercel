// lib/mediacrater/dissector.ts
//
// Direct port of the Chrome extension's utils/dissector.js.
// This file has zero chrome.* dependencies in the original — it's pure
// DOM/Canvas/Web Audio APIs — so behavior here is intentionally identical
// to the extension, frame-for-frame, so scan results don't drift between
// the two clients.

export interface ExtractedFrame {
  frameNumber: number;
  timestamp: string;
  timestampSeconds: number;
  data: string; // base64 JPEG data URL
}

export interface ExtractedAudio {
  data: string; // base64 WAV
  mimeType: string;
}

export type ScanType = 'regular' | 'deep';

// Deep scans use the same frames as Regular scans (a frame every 0.5 s).
// What makes them "deep" is the server turning on the model's thinking mode.
// The old deep interval (0.125 s) produced ~968 frames for a 2-minute video,
// over QwenCloud's limit of 250 images per request.
const SCAN_CONFIG: Record<ScanType, { interval: number }> = {
  regular: { interval: 0.5 },
  deep: { interval: 0.5 },
};

const TARGET_LONG_EDGE = 900;

// Audio is downmixed to mono and resampled to this rate before WAV
// encoding. Speech intelligibility doesn't need the 44.1/48kHz stereo a
// browser decodes source video at — 16kHz mono is the standard rate for
// speech-focused model input and keeps a full 121s clip's base64 payload
// under ~5MB regardless of the source video's original audio format,
// instead of the 25-30MB+ a stereo 44.1kHz WAV would produce at that
// length. This does not change Gemini's token cost (audio tokens are
// billed by duration, not file size) — it exists purely to keep the
// request payload within the same size budget the frame payload already
// respects.
const TARGET_AUDIO_SAMPLE_RATE = 16000;

export async function extractFrames(
  videoFile: File,
  signal: AbortSignal | null | undefined,
  scanType: ScanType = 'regular'
): Promise<ExtractedFrame[]> {
  return extractFramesCanvas(videoFile, signal, scanType);
}

function extractFramesCanvas(
  videoFile: File,
  signal: AbortSignal | null | undefined,
  scanType: ScanType,
  randomize: boolean = true
): Promise<ExtractedFrame[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas 2D context unavailable in this browser'));
      return;
    }

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(videoFile);

    video.addEventListener('loadedmetadata', async () => {
      try {
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          URL.revokeObjectURL(video.src);
          reject(new Error('Invalid video duration'));
          return;
        }

        const longestEdge = Math.max(video.videoWidth, video.videoHeight);
        const scale = longestEdge > TARGET_LONG_EDGE ? TARGET_LONG_EDGE / longestEdge : 1;
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);

        const orientation =
          video.videoWidth > video.videoHeight
            ? 'landscape'
            : video.videoWidth < video.videoHeight
            ? 'portrait'
            : 'square';

        console.log(
          `[${scanType} scan] Source: ${video.videoWidth}×${video.videoHeight} (${orientation}) → Output: ${canvas.width}×${canvas.height}`
        );

        const config = SCAN_CONFIG[scanType] || SCAN_CONFIG.regular;
        const interval = config.interval;
        const frames: ExtractedFrame[] = [];
        const timestamps: number[] = [];

        for (let time = 0; time < duration; time += interval) {
          if (randomize) {
            // Pick a random timestamp within [time, time + interval), bounded by video duration
            const randomOffset = Math.random() * interval;
            const targetTime = Math.min(time + randomOffset, duration - 0.01);
            timestamps.push(targetTime);
          } else {
            timestamps.push(time);
          }
        }

        console.log(`[${scanType} scan] Preparing video with ${duration.toFixed(1)}s duration`);

        let frameNumber = 1;

        for (const time of timestamps) {
          if (signal && signal.aborted) {
            URL.revokeObjectURL(video.src);
            reject(new Error('Operation cancelled'));
            return;
          }

          try {
            await seekToTime(video, time);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.30);

            frames.push({
              frameNumber,
              timestamp: formatTimestamp(time),
              timestampSeconds: time,
              data: dataUrl,
            });

            frameNumber++;
          } catch (error) {
            console.warn(`Failed to extract frame at ${time.toFixed(2)}s:`, error);
          }
        }

        URL.revokeObjectURL(video.src);

        if (frames.length === 0) {
          reject(new Error('Your video could not be processed'));
          return;
        }

        console.log(`Video successfully processed`);
        resolve(frames);
      } catch (err) {
        URL.revokeObjectURL(video.src);
        reject(err);
      }
    });

    video.addEventListener('error', () => {
      URL.revokeObjectURL(video.src);
      const errorMessage = getVideoErrorMessage(video.error);
      reject(new Error(`Failed to load video: ${errorMessage}`));
    });
  });
}

function seekToTime(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Seek timeout at ${time}s`));
    }, 10000);

    const seekedHandler = () => {
      clearTimeout(timeoutId);
      video.removeEventListener('seeked', seekedHandler);
      video.removeEventListener('error', errorHandler);
      requestAnimationFrame(() => resolve());
    };

    const errorHandler = () => {
      clearTimeout(timeoutId);
      video.removeEventListener('seeked', seekedHandler);
      video.removeEventListener('error', errorHandler);
      reject(new Error(`Seek failed at ${time}s`));
    };

    video.addEventListener('seeked', seekedHandler);
    video.addEventListener('error', errorHandler);
    video.currentTime = time;
  });
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);

  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

function getVideoErrorMessage(error: MediaError | null): string {
  if (!error) return 'Unknown error';

  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Video loading was aborted';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'Network error while loading video';
    case MediaError.MEDIA_ERR_DECODE:
      return 'Video format not supported or file is corrupted';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'Video format not supported';
    default:
      return error.message || 'Unknown error';
  }
}

/**
 * Extracts audio from a video file as a base64-encoded WAV blob.
 * Downmixed to mono and resampled to TARGET_AUDIO_SAMPLE_RATE (see
 * comment above) to keep the payload small regardless of source format.
 */
export async function extractAudio(
  videoFile: File,
  signal?: AbortSignal | null
): Promise<ExtractedAudio | null> {
  const arrayBuffer = await videoFile.arrayBuffer();
  if (signal?.aborted) throw new Error('Operation cancelled');

  const OfflineCtor =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;

  const decodeCtx = new OfflineCtor(1, 1, TARGET_AUDIO_SAMPLE_RATE);
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } catch {
    return null;
  }
  if (signal?.aborted) throw new Error('Operation cancelled');

  const monoBuffer =
    decoded.numberOfChannels === 1 && decoded.sampleRate === TARGET_AUDIO_SAMPLE_RATE
      ? decoded
      : await downmixAndResample(decoded, TARGET_AUDIO_SAMPLE_RATE);
  if (signal?.aborted) throw new Error('Operation cancelled');

  console.log(
    `[audio] ${monoBuffer.duration.toFixed(1)}s ${monoBuffer.sampleRate}Hz ${monoBuffer.numberOfChannels}ch`
  );

  const samples = new Float32Array(monoBuffer.length);
  monoBuffer.copyFromChannel(samples, 0);

  const worker = new Worker(
    new URL('./audio-extract.worker.ts', import.meta.url),
    { type: 'module' }
  );

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      worker.terminate();
      reject(new Error('Operation cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (e: MessageEvent<{ data: string }>) => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      resolve({ data: e.data.data, mimeType: 'audio/wav' });
    };
    worker.onerror = (err) => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      reject(err);
    };

    worker.postMessage(
      { sampleRate: TARGET_AUDIO_SAMPLE_RATE, samples },
      [samples.buffer]
    );
  });
}
/**
 * Downmixes to mono and resamples to targetSampleRate using
 * OfflineAudioContext. A mono-channel OfflineAudioContext destination
 * downmixes multi-channel source audio automatically as part of the
 * audio graph's own routing (native, off-main-thread rendering) — no
 * manual per-sample mixing loop is needed or should be added here.
 * A hand-rolled sample loop was tried in an earlier version of this
 * function and caused multi-second main-thread blocking (observed as
 * page freezes in the web app) for longer clips; do not reintroduce it.
 */
async function downmixAndResample(
  audioBuffer: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> {
  const duration = audioBuffer.duration;
  const OfflineCtor =
    (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;

  const offlineCtx = new OfflineCtor(
    1, // mono output — the context automatically downmixes multi-channel input to this
    Math.ceil(duration * targetSampleRate),
    targetSampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  return offlineCtx.startRendering();
}

function audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const numChannels = audioBuffer.numberOfChannels; // always 1 post-downmix
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const samples = audioBuffer.length * numChannels;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, samples * 2, true);

  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return buffer;
}
