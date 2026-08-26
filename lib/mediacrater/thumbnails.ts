// lib/mediacrater/thumbnails.ts
//
// compressThumbnail() is a direct port of the extension's
// utils/historyManager.js compressThumbnail() — same 200px max width,
// same 0.55 JPEG quality — so thumbnails look and behave identically
// regardless of which client generated them. uploadThumbnail() is new:
// instead of writing to chrome.storage.local, it uploads to the
// scan-thumbnails Storage bucket under {user_id}/{scan_id}.jpg.

import { supabase } from './supabaseClient';

export async function compressThumbnail(dataUrl: string, maxWidth = 200): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(maxWidth / img.width, maxWidth / img.height, 1);
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.55));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Compresses and uploads a thumbnail for a scan that hasn't been created
 * yet — scanId is client-generated (crypto.randomUUID()) and gets passed
 * to the scan endpoint so the resulting `scans` row adopts this same ID,
 * linking the two without a race condition.
 *
 * Returns the storage path (e.g. "userId/scanId.jpg") to send along with
 * the scan request, or null if compression/upload failed — thumbnails
 * are a nice-to-have, never worth blocking or failing a scan over.
 */
export async function uploadScanThumbnail(
  userId: string,
  scanId: string,
  firstFrameDataUrl: string
): Promise<string | null> {
  try {
    const compressed = await compressThumbnail(firstFrameDataUrl);
    if (!compressed) return null;

    const blob = dataUrlToBlob(compressed);
    const path = `${userId}/${scanId}.jpg`;

    const { error } = await supabase.storage.from('scan-thumbnails').upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    });

    if (error) {
      console.warn('Thumbnail upload failed (non-fatal):', error.message);
      return null;
    }

    return path;
  } catch (err) {
    console.warn('Thumbnail upload threw (non-fatal):', err);
    return null;
  }
}

/**
 * Resolves a stored thumbnail path into a short-lived signed URL for
 * <img src>. Bucket is private, so this is required — there's no
 * permanent public URL for these.
 */
export async function getThumbnailSignedUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from('scan-thumbnails').createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
