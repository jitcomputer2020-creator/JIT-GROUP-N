/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * JIT GROUP - Persistent Media Storage Engine
 * Uses browser IndexedDB to persistently store uploaded images and videos
 * without relying on temporary blob: URLs that break on refresh.
 */

const DB_NAME = 'jit_media_database';
const DB_VERSION = 1;
const STORE_NAME = 'media_files';

interface StoredMediaRecord {
  id: string;
  dataUrl: string;
  mimeType: string;
  fileName: string;
  size: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error('Failed to open IndexedDB'));
    };
  });

  return dbPromise;
}

/**
 * Converts a browser File to a persistent Base64 Data URL
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert file to base64 string'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}

/**
 * Validates file type and size constraints
 */
export function validateMediaFile(
  file: File,
  options?: {
    maxSizeMb?: number;
    allowedMimeTypes?: string[];
    allowedCategory?: 'image' | 'video' | 'any';
  }
): { valid: boolean; error?: string } {
  const maxMb = options?.maxSizeMb || (file.type.startsWith('video/') ? 50 : 15);
  const maxBytes = maxMb * 1024 * 1024;

  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `File size exceeds the ${maxMb}MB limit (actual: ${(file.size / (1024 * 1024)).toFixed(1)}MB).`,
    };
  }

  if (options?.allowedCategory === 'image' && !file.type.startsWith('image/')) {
    return { valid: false, error: 'Only image files (JPEG, PNG, WEBP, GIF) are allowed.' };
  }

  if (options?.allowedCategory === 'video' && !file.type.startsWith('video/')) {
    return { valid: false, error: 'Only video files (MP4, WEBM, QuickTime) are allowed.' };
  }

  if (options?.allowedMimeTypes && !options.allowedMimeTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.type}. Allowed: ${options.allowedMimeTypes.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Compresses and resizes an image File using an HTML5 Canvas so that the resulting
 * Data URL stays strictly below maxDataUrlLength (safe for Firestore <= 400KB rules).
 */
export async function compressImageFile(
  file: File,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    maxDataUrlLength?: number;
    initialQuality?: number;
  }
): Promise<string> {
  const maxWidth = options?.maxWidth ?? 1024;
  const maxHeight = options?.maxHeight ?? 1024;
  const maxDataUrlLength = options?.maxDataUrlLength ?? 260_000;
  const initialQuality = options?.initialQuality ?? 0.86;

  const rawDataUrl = await fileToDataUrl(file);

  if (typeof document === 'undefined') {
    return rawDataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let targetW = img.naturalWidth || img.width || maxWidth;
        let targetH = img.naturalHeight || img.height || maxHeight;

        const ratio = Math.min(maxWidth / targetW, maxHeight / targetH, 1);
        targetW = Math.max(1, Math.round(targetW * ratio));
        targetH = Math.max(1, Math.round(targetH * ratio));

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }

        const attemptEncode = (w: number, h: number, mime: string, quality: number): string => {
          canvas.width = w;
          canvas.height = h;
          ctx.clearRect(0, 0, w, h);
          if (mime === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
          }
          ctx.drawImage(img, 0, 0, w, h);
          return canvas.toDataURL(mime, quality);
        };

        // Preserve original if it's already small enough and within dimensions
        if (
          rawDataUrl.length <= maxDataUrlLength &&
          (img.naturalWidth || img.width) <= maxWidth &&
          (img.naturalHeight || img.height) <= maxHeight
        ) {
          resolve(rawDataUrl);
          return;
        }

        const qualities = [initialQuality, 0.74, 0.6, 0.48, 0.36];
        let scale = 1;

        for (let scalePass = 0; scalePass < 4; scalePass++) {
          const w = Math.max(64, Math.round(targetW * scale));
          const h = Math.max(64, Math.round(targetH * scale));

          for (const q of qualities) {
            const webpOut = attemptEncode(w, h, 'image/webp', q);
            if (webpOut.startsWith('data:image/webp') && webpOut.length <= maxDataUrlLength) {
              resolve(webpOut);
              return;
            }
            const jpegOut = attemptEncode(w, h, 'image/jpeg', q);
            if (jpegOut.length <= maxDataUrlLength) {
              resolve(jpegOut);
              return;
            }
          }
          scale *= 0.75;
        }

        // Guaranteed small fallback
        resolve(
          attemptEncode(
            Math.max(64, Math.round(targetW * 0.4)),
            Math.max(64, Math.round(targetH * 0.4)),
            'image/jpeg',
            0.35
          )
        );
      } catch {
        resolve(rawDataUrl);
      }
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

/**
 * Persistently saves a compressed profile or cover image to IndexedDB
 * and returns a cloud-ready Data URL guaranteed to fit Firestore limits.
 */
export async function saveCompressedProfileMediaFile(
  file: File,
  mode: 'avatar' | 'cover'
): Promise<{ id: string; dataUrl: string }> {
  const isAvatar = mode === 'avatar';
  const dataUrl = await compressImageFile(file, {
    maxWidth: isAvatar ? 512 : 1280,
    maxHeight: isAvatar ? 512 : 720,
    maxDataUrlLength: isAvatar ? 180_000 : 280_000,
    initialQuality: 0.85,
  });

  const id = `media_${mode}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record: StoredMediaRecord = {
      id,
      dataUrl,
      mimeType: dataUrl.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg',
      fileName: file.name,
      size: dataUrl.length,
      createdAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB write warning, falling back to direct DataURL:', err);
  }

  return { id, dataUrl };
}

/**
 * Persistently saves a file into IndexedDB and returns the permanent Data URL
 */
export async function saveMediaFile(file: File): Promise<{ id: string; dataUrl: string }> {
  const dataUrl = file.type.startsWith('image/') && !file.type.includes('gif')
    ? await compressImageFile(file, { maxWidth: 1280, maxHeight: 1280, maxDataUrlLength: 450_000 })
    : await fileToDataUrl(file);
  const id = `media_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record: StoredMediaRecord = {
      id,
      dataUrl,
      mimeType: file.type,
      fileName: file.name,
      size: file.size,
      createdAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB write warning, falling back to direct DataURL:', err);
  }

  return { id, dataUrl };
}

/**
 * Loads a media record by ID from IndexedDB
 */
export async function getMediaFile(id: string): Promise<string | null> {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const record = req.result as StoredMediaRecord | undefined;
        resolve(record ? record.dataUrl : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
