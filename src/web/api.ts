import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Which login this tab is using. One browser can be logged in as agency staff and as a site manager. */
export function currentRole(): 'agency' | 'manager' {
  if (window.location.pathname.startsWith('/client')) return 'manager';
  try {
    return sessionStorage.getItem('sr_as') === 'manager' ? 'manager' : 'agency';
  } catch {
    return 'agency';
  }
}

export function setRole(role: 'agency' | 'manager') {
  try {
    sessionStorage.setItem('sr_as', role);
  } catch {
    /* private mode */
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-SiteRoll-As': currentRole() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth')) window.dispatchEvent(new Event('sr:logged-out'));
    throw new ApiError(data?.error || `Something went wrong (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  put: <T = any>(p: string, b: unknown) => request<T>('PUT', p, b),
  del: <T = any>(p: string) => request<T>('DELETE', p),
};

/** Load JSON from the API. `reload()` fetches again without clearing what's on screen. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api.get<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Refresh when the server says something changed (server-sent events), with a polling fallback. */
export function useLiveRefresh(onChange: () => void, pollMs = 30000) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      // Several changes often arrive together; refresh once.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), 250);
    };
    if ('EventSource' in window) {
      es = new EventSource(`/api/live/stream?as=${currentRole()}`);
      es.addEventListener('change', fire);
    }
    const poll = setInterval(() => cb.current(), pollMs);
    const onVisible = () => document.visibilityState === 'visible' && cb.current();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      es?.close();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollMs]);
}

/** Read an image file, shrink it, and return a JPEG data URL (keeps uploads small). */
export function fileToJpeg(file: File, maxSide = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error("That file couldn't be read as an image"));
    img.src = url;
  });
}
