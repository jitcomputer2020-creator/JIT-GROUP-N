/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared media URL validation & placeholder sanitization helpers.
 * Prevents broken 404 requests (e.g., `/sample_post.mp4`) when posts or previews
 * lack a real, playable media URL.
 */

const BLOCKED_PLACEHOLDER_PATTERNS = [
  'sample_post.mp4',
  'sample_video.mp4',
  'sample.mp4',
  'placeholder.mp4',
  'demo_video.mp4',
];

const INVALID_LITERAL_STRINGS = new Set([
  '',
  'null',
  'undefined',
  'none',
  'false',
  'nan',
  '[object object]',
  'about:blank',
]);

export function isPlaceholderOrInvalidMediaString(raw?: unknown): boolean {
  if (typeof raw !== 'string') return true;
  const clean = raw.trim();
  if (!clean) return true;
  const lower = clean.toLowerCase();
  if (INVALID_LITERAL_STRINGS.has(lower)) return true;

  const cleanPath = lower.split('?')[0].split('#')[0];
  for (const blocked of BLOCKED_PLACEHOLDER_PATTERNS) {
    if (
      cleanPath === blocked ||
      cleanPath === `/${blocked}` ||
      cleanPath === `./${blocked}` ||
      cleanPath.endsWith(`/${blocked}`)
    ) {
      return true;
    }
  }
  return false;
}

export function isValidVideoUrl(url?: unknown): url is string {
  if (typeof url !== 'string') return false;
  const clean = url.trim();
  if (isPlaceholderOrInvalidMediaString(clean)) return false;

  const lower = clean.toLowerCase();
  const cleanPath = lower.split('?')[0].split('#')[0];

  if (clean.startsWith('blob:') && clean.length > 'blob:'.length) return true;
  if (clean.startsWith('data:video/')) return true;
  if (clean.startsWith('idb://') && clean.length > 'idb://'.length) return true;
  if (clean.startsWith('fschunk://') && clean.length > 'fschunk://'.length) return true;
  if (cleanPath.startsWith('/api/media/') && cleanPath.length > '/api/media/'.length) return true;

  if (lower.startsWith('https://') || lower.startsWith('http://')) {
    try {
      const parsed = new URL(clean);
      return Boolean(parsed.hostname && parsed.hostname.length > 0);
    } catch {
      return false;
    }
  }

  // Reject bare relative paths (e.g., `/sample_post.mp4`, `sample_post.mp4`, `/assets/*.mp4`)
  return false;
}

export function sanitizeVideoUrl(url?: unknown): string | undefined {
  return isValidVideoUrl(url) ? url.trim() : undefined;
}

export function isValidImageUrl(url?: unknown): url is string {
  if (typeof url !== 'string') return false;
  const clean = url.trim();
  if (isPlaceholderOrInvalidMediaString(clean)) return false;

  const lower = clean.toLowerCase();
  const cleanPath = lower.split('?')[0].split('#')[0];

  // Do not treat video file paths as image URLs
  if (
    cleanPath.endsWith('.mp4') ||
    cleanPath.endsWith('.webm') ||
    cleanPath.endsWith('.mov') ||
    cleanPath.endsWith('.avi') ||
    cleanPath.endsWith('.mkv') ||
    cleanPath.endsWith('.m4v') ||
    cleanPath.endsWith('.ogv')
  ) {
    return false;
  }

  if (clean.startsWith('blob:') && clean.length > 'blob:'.length) return true;
  if (clean.startsWith('data:image/')) return true;
  if (clean.startsWith('idb://') && clean.length > 'idb://'.length) return true;
  if (cleanPath.startsWith('/api/media/') && cleanPath.length > '/api/media/'.length) return true;
  if (cleanPath.startsWith('/assets/') && cleanPath.length > '/assets/'.length) return true;

  if (lower.startsWith('https://') || lower.startsWith('http://')) {
    try {
      const parsed = new URL(clean);
      return Boolean(parsed.hostname && parsed.hostname.length > 0);
    } catch {
      return false;
    }
  }

  return false;
}

export function extractYouTubeVideoId(url?: unknown): string | null {
  if (typeof url !== 'string') return null;
  const clean = url.trim();
  if (!clean) return null;
  try {
    const parsed = new URL(clean);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    let candidate = '';
    if (host === 'youtu.be') {
      candidate = parsed.pathname.split('/').filter(Boolean)[0] || '';
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (parsed.pathname === '/watch') {
        candidate = parsed.searchParams.get('v') || '';
      } else if (parsed.pathname.startsWith('/shorts/')) {
        candidate = parsed.pathname.slice('/shorts/'.length).split('/')[0] || '';
      } else if (parsed.pathname.startsWith('/embed/')) {
        candidate = parsed.pathname.slice('/embed/'.length).split('/')[0] || '';
      }
    }
    return /^[a-zA-Z0-9_-]{6,20}$/.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function getYouTubeThumbnailUrl(url?: unknown): string | undefined {
  const ytId = extractYouTubeVideoId(url);
  return ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : undefined;
}

