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

const SCAN_CONFIG: Record<ScanType, { interval: number }> = {
  regular: { interval: 0.5 },
  deep: { interval: 0.125 },
};

const TARGET_LONG_EDGE = 900;

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
  scanType: ScanType
): Promise<ExtractedFrame[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Frame extraction unavailable in this browser'));
      return;
    }

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(videoFile);

    video.addEventListener('loadedmetadata', async () => {
      const duration = video.duration;

      // Scale based on the video's longest edge, preserving aspect ratio.
      // Handles landscape, portrait, and square videos without distortion.
      // Never scale up if the video is already smaller.
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
        timestamps.push(time);
      }

      console.log(`[${scanType} scan] Deconstructing video with ${duration.toFixed(1)}s duration`);

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
          const dataUrl = canvas.toDataURL('image/jpeg', 0.15);

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
        reject(new Error('No frames could be extracted from the video'));
        return;
      }

      console.log(`Successfully extracted ${frames.length} frames`);
      resolve(frames);
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
      setTimeout(resolve, 50);
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
 * Currently unused by the scan flow (audio analysis is disabled product-wide,
 * same as the extension) but ported for parity / future use.
 */
export async function extractAudio(videoFile: File): Promise<ExtractedAudio | null> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const arrayBuffer = reader.result as ArrayBuffer;

        const AudioContextCtor =
          window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextCtor();

        let audioBuffer: AudioBuffer;
        try {
          audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        } catch {
          audioCtx.close();
          resolve(null);
          return;
        }

        const wavBuffer = audioBufferToWav(audioBuffer);
        audioCtx.close();

        const uint8 = new Uint8Array(wavBuffer);
        let binary = '';
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const base64 = btoa(binary);

        resolve({ data: base64, mimeType: 'audio/wav' });
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read video file for audio extraction'));
    reader.readAsArrayBuffer(videoFile);
  });
}

function audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const numChannels = Math.min(audioBuffer.numberOfChannels, 2);
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
