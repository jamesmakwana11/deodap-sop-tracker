import { createHmac } from 'node:crypto';

/**
 * Minimal Meta Graph API client. It can only issue GET requests: the tracker is a
 * read-only auditor and must never create, update or delete anything in Meta.
 */

export const GRAPH_BASE_URL = 'https://graph.facebook.com';

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

let fetchImpl: FetchLike = (url, init) => fetch(url, { ...init, method: 'GET' });

/** Tests swap in a fake Graph server. Production always uses global fetch. */
export function setGraphFetch(fn: FetchLike | null): void {
  fetchImpl = fn ?? ((url, init) => fetch(url, { ...init, method: 'GET' }));
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }

  /** Token expired, revoked or missing permission. */
  get isAuthError(): boolean {
    return this.code === 190 || this.code === 102 || this.code === 10 || (this.code !== undefined && this.code >= 200 && this.code < 300);
  }

  /** The token itself is expired or revoked (affects every account), as opposed to a per-account permission. */
  get isTokenInvalid(): boolean {
    return this.code === 190 || this.code === 102;
  }

  get isRateLimit(): boolean {
    return [4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014].includes(this.code ?? -1);
  }

  get isTransient(): boolean {
    return this.isRateLimit || this.status >= 500 || this.code === 1 || this.code === 2;
  }
}

export type GraphParams = Record<string, string | number | boolean | object | undefined>;

export interface GraphClientOptions {
  accessToken: string;
  appSecret?: string;
  version: string;
  maxRetries?: number;
  timeoutMs?: number;
  /** Base delay for backoff; tests set 0. */
  retryDelayMs?: number;
}

interface Paged<T> {
  data: T[];
  paging?: { next?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GraphClient {
  private readonly proof: string | undefined;

  constructor(private readonly opts: GraphClientOptions) {
    this.proof = opts.appSecret
      ? createHmac('sha256', opts.appSecret).update(opts.accessToken).digest('hex')
      : undefined;
  }

  buildUrl(path: string, params: GraphParams = {}): string {
    const url = new URL(`${GRAPH_BASE_URL}/${this.opts.version}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) {
      // Meta treats ?method=POST/DELETE on a GET as a write. This client must never write.
      if (k.toLowerCase() === 'method') throw new Error('The Meta client is read-only');
      if (v === undefined) continue;
      url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    return url.toString();
  }

  async get<T>(path: string, params: GraphParams = {}): Promise<T> {
    return this.request<T>(this.buildUrl(path, params));
  }

  /** Follows paging.next until exhausted (or until maxItems). */
  async getAll<T>(path: string, params: GraphParams = {}, maxItems = 50_000): Promise<T[]> {
    const items: T[] = [];
    let url: string | undefined = this.buildUrl(path, params);
    while (url) {
      const page: Paged<T> = await this.request<Paged<T>>(url);
      items.push(...(page.data ?? []));
      url = page.paging?.next;
      if (url && new URL(url).origin !== GRAPH_BASE_URL) throw new Error('Unexpected paging host from Meta');
      // Never audit a silent subset: stop the account with an error instead.
      if (url && items.length >= maxItems) throw new Error(`More than ${maxItems} items at ${path}; refusing to audit a partial list`);
    }
    return items;
  }

  private async request<T>(rawUrl: string): Promise<T> {
    const url = new URL(rawUrl);
    // The token travels in a header, not the URL, so it never lands in proxy or access logs.
    url.searchParams.delete('access_token');
    url.searchParams.delete('method'); // read-only, including on paging links returned by Meta
    if (this.proof) url.searchParams.set('appsecret_proof', this.proof);

    const maxRetries = this.opts.maxRetries ?? 4;
    const baseDelay = this.opts.retryDelayMs ?? 1000;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(url.toString());
      } catch (err) {
        const retriable = err instanceof MetaApiError ? err.isTransient : true; // network/timeouts
        if (!retriable || attempt >= maxRetries) throw err;
        const delay = Math.min(baseDelay * 2 ** attempt, 60_000) * (err instanceof MetaApiError && err.isRateLimit ? 4 : 1);
        await sleep(delay);
      }
    }
  }

  private async once<T>(url: string): Promise<T> {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
      headers: { Authorization: `Bearer ${this.opts.accessToken}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string; error_user_msg?: string };
    };
    if (!res.ok || body.error) {
      const e = body.error ?? {};
      throw new MetaApiError(
        e.error_user_msg || e.message || `Meta API returned HTTP ${res.status}`,
        res.status,
        e.code,
        e.error_subcode,
        e.fbtrace_id,
      );
    }
    return body as T;
  }
}
