import type { ApiErrorBody, AuthResponse } from '@opspilot/shared';

/**
 * The access token lives only in memory (never localStorage). The refresh token is an HttpOnly cookie
 * the page cannot read; the CSRF token cookie is readable and echoed back in a header.
 */
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;
let onTokenChange: ((token: string | null) => void) | null = null;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
  onTokenChange?.(t);
};
export const getAccessToken = () => accessToken;
export const setSessionLostHandler = (fn: (() => void) | null) => (onSessionLost = fn);
export const setTokenChangeHandler = (fn: ((t: string | null) => void) | null) => (onTokenChange = fn);

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
  }
  /** Field-level messages from server validation, keyed by field path. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as Array<{ path?: string; message?: string }>) {
        if (d?.path && d.message && !out[d.path]) out[d.path] = d.message;
      }
    }
    return out;
  }
}

const csrfCookie = () => /(?:^|; )csrf_token=([^;]+)/.exec(document.cookie)?.[1] ?? '';

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON */
  }
  const e = body?.error;
  return new ApiError(
    res.status,
    e?.code ?? 'HTTP_ERROR',
    e?.message ?? (res.status >= 500 ? 'The server had a problem. Try again in a moment.' : `Request failed (${res.status})`),
    e?.details,
    e?.requestId,
  );
}

let refreshing: Promise<AuthResponse | null> | null = null;

/** Single-flight: concurrent 401s share one refresh call. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': csrfCookie() },
      });
      if (res.ok) {
        const data = (await res.json()) as AuthResponse;
        setAccessToken(data.accessToken);
        return data;
      }
      const err = await parseError(res);
      // Another tab refreshed at the same instant: its new cookie is in place, so just try again.
      if (err.code === 'REFRESH_RACE' && attempt === 0) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      return null;
    }
    return null;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  formData?: FormData;
  skipAuth?: boolean;
  raw?: boolean;
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return `/api${path}${s ? `?${s}` : ''}`;
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!opts.skipAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers,
    body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
}

export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(path, opts);
  if (res.status === 401 && !opts.skipAuth) {
    const code = (await res.clone().json().catch(() => null))?.error?.code;
    if (code === 'TOKEN_EXPIRED' || code === 'UNAUTHORIZED' || code === 'INVALID_TOKEN') {
      const session = await refreshSession();
      if (session) res = await send(path, opts);
      else {
        setAccessToken(null);
        onSessionLost?.();
      }
    } else if (code === 'SESSION_REVOKED') {
      setAccessToken(null);
      onSessionLost?.();
    }
  }
  if (!res.ok) throw await parseError(res);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T = void>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
  upload: <T>(path: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<T>(path, { method: 'POST', formData: fd });
  },
};

/** Authenticated file download (CSV export, attachments) — the bearer token can't ride a plain <a href>. */
export async function download(path: string, query?: RequestOptions['query'], fallbackName = 'download') {
  const res = await request<Response>(path, { query, raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name =
    /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ? decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(cd)![1]!) : /filename="([^"]+)"/i.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
