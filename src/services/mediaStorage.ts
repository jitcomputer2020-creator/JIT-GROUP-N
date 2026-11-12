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
 * Persistently saves a file into IndexedDB and returns the permanent Data URL
 */
export async function saveMediaFile(file: File): Promise<{ id: string; dataUrl: string }> {
  const dataUrl = await fileToDataUrl(file);
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
