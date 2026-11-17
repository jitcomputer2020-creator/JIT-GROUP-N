/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Safe API JSON parsing & Vercel/Serverless backend capability detection.
 * Prevents SyntaxError crashes when SPA fallback rewrites (e.g. Vercel vercel.json)
 * return 200 text/html instead of application/json, and stops invalid wss:// handshakes.
 */

export interface SafeJsonResult<T = any> {
  ok: boolean;
  status: number;
  isJson: boolean;
  data: T | null;
}

export function isJsonContentType(res: Response | null | undefined): boolean {
  if (!res || !res.headers) return false;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  return ct.includes('application/json') || ct.includes('+json');
}

export async function safeParseJsonResponse<T = any>(
  res: Response | null | undefined
): Promise<T | null> {
  if (!res) return null;
  if (!isJsonContentType(res)) {
    return null;
  }
  try {
    const raw = await res.text();
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('<')) {
      return null;
    }
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<SafeJsonResult<T>> {
  if (typeof fetch !== 'function') {
    return { ok: false, status: 0, isJson: false, data: null };
  }
  try {
    const res = await fetch(input, init);
    const isJson = isJsonContentType(res);
    const data = isJson ? await safeParseJsonResponse<T>(res) : null;
    return {
      ok: res.ok && isJson && data !== null,
      status: res.status,
      isJson,
      data,
    };
  } catch {
    return { ok: false, status: 0, isJson: false, data: null };
  }
}

export function isStaticVercelHost(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const host = (window.location?.hostname || '').toLowerCase();
    if (host.endsWith('.vercel.app') || host.endsWith('.vercel.live')) {
      return true;
    }
    const disableWs = (import.meta as any)?.env?.VITE_DISABLE_WS;
    if (disableWs === 'true' || disableWs === '1') {
      return true;
    }
  } catch {
    // Ignore environment access edge cases
  }
  return false;
}

let cachedBackendStatus: boolean | null = null;
let cachedAtMs = 0;
let spaHtmlDetected = false;
let inflightProbe: Promise<boolean> | null = null;

/**
 * Probes /api/health once to check whether a stateful Express/WebSocket server
 * is attached to the current origin. Returns false immediately on Vercel / static
 * SPA deployments where rewrites return HTML for /api/* routes.
 */
export async function detectExpressBackendAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (isStaticVercelHost() || spaHtmlDetected) {
    return false;
  }

  const now = Date.now();
  if (cachedBackendStatus !== null && now - cachedAtMs < 60_000) {
    return cachedBackendStatus;
  }

  if (inflightProbe) {
    return inflightProbe;
  }

  inflightProbe = (async () => {
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? window.setTimeout(() => controller.abort(), 2500) : null;
      const res = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (timer !== null) window.clearTimeout(timer);

      if (!isJsonContentType(res)) {
        // Vercel / static SPA rewrite returned text/html (e.g. index.html)
        spaHtmlDetected = true;
        cachedBackendStatus = false;
        cachedAtMs = Date.now();
        return false;
      }

      const data = await safeParseJsonResponse<{ status?: string }>(res);
      const healthy = Boolean(res.ok && data && data.status === 'ok');
      cachedBackendStatus = healthy;
      cachedAtMs = Date.now();
      return healthy;
    } catch {
      cachedBackendStatus = false;
      cachedAtMs = Date.now();
      return false;
    } finally {
      inflightProbe = null;
    }
  })();

  return inflightProbe;
}

export function resetExpressBackendProbeCache(): void {
  cachedBackendStatus = null;
  cachedAtMs = 0;
  inflightProbe = null;
}
