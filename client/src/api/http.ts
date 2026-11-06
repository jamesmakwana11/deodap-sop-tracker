/** Fetch wrapper: same-origin cookies, the CSRF header on writes, and readable errors. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal: opts.signal,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(method !== 'GET' ? { 'x-sop-csrf': '1' } : {}),
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('Could not reach the tracker server. Check your connection.', 0);
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) unauthorizedHandler?.();
    const fallback = res.status >= 500 ? 'The tracker server is not responding. Try again shortly.' : `Request failed (${res.status}).`;
    throw new ApiError(data?.error ?? fallback, res.status);
  }
  return data as T;
}

/** Name from a Content-Disposition header (RFC 6266 filename* first, then filename). */
export function fileNameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]!);
    } catch {
      // fall through
    }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] ?? fallback;
}

/**
 * Downloads a file from the API with the session cookie and saves it through the browser.
 * Errors from the server come back as readable messages instead of a broken file.
 */
export async function downloadFile(path: string, fallbackName = 'download'): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError('Could not reach the tracker server. Check your connection.', 0);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401) unauthorizedHandler?.();
    throw new ApiError(data?.error ?? `Download failed (${res.status}).`, res.status);
  }
  const blob = await res.blob();
  const name = fileNameFrom(res.headers.get('content-disposition'), fallbackName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}

/** Uploads a file as the raw request body (name in X-File-Name) and returns the JSON reply. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'x-sop-csrf': '1',
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: file,
    });
  } catch {
    throw new ApiError('Could not reach the tracker server. Check your connection.', 0);
  }
  const data = (await res.json().catch(() => null)) as ({ error?: string } & T) | null;
  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    throw new ApiError(data?.error ?? (res.status === 413 ? 'The file is too large.' : `Upload failed (${res.status}).`), res.status);
  }
  return data as T;
}
