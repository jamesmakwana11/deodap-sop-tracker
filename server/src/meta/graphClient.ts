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
  headers?: { get(name: string): string | null };
}>;

let fetchImpl: FetchLike = (url, init) => fetch(url, { ...init, method: 'GET' });

/** Tests swap in a fake Graph server. Production always uses global fetch. */
export function setGraphFetch(fn: FetchLike | null): void {
  fetchImpl = fn ?? ((url, init) => fetch(url, { ...init, method: 'GET' }));
}

// ── Waiting (rate limits) ────────────────────────────────────────────────

let sleepImpl = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Tests replace the wait so back-off can be checked without real delays. */
export function setGraphSleep(fn: ((ms: number) => Promise<void>) | null): void {
  sleepImpl = fn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
}

export interface GraphWait {
  ms: number;
  /** "rate_limit": Meta refused with a rate-limit error; "usage": slowing down before Meta's limit. */
  reason: 'rate_limit' | 'usage';
  attempt: number;
  maxAttempts: number;
}
const waitListeners = new Set<(w: GraphWait) => void>();
/** The sync listens to show "waiting for Meta's rate limit" as progress. */
export function onGraphWait(fn: (w: GraphWait) => void): () => void {
  waitListeners.add(fn);
  return () => waitListeners.delete(fn);
}

/** Rate-limit back-off: 15 s, 30 s, 1 min, 2 min, 4 min, 5 min (or Meta's own estimate, if longer). */
export const RATE_LIMIT_RETRIES = 6;
const RATE_LIMIT_BASE_MS = 15_000;
const RATE_LIMIT_MAX_WAIT_MS = 5 * 60_000;

interface Usage {
  /** Highest usage percentage Meta reported for this token / ad account / app. */
  pct: number;
  /** Meta's estimate until access is regained (ms), when given. */
  regainMs: number;
}

/** Reads Meta's usage headers (X-Business-Use-Case-Usage, X-Ad-Account-Usage, X-App-Usage). */
export function usageFromHeaders(headers?: { get(name: string): string | null }): Usage | null {
  if (!headers) return null;
  let pct = 0;
  let regainMs = 0;
  let seen = false;
  const parse = (name: string) => {
    const raw = headers.get(name);
    if (!raw) return null;
    try {
      seen = true;
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  };
  const take = (o: Record<string, unknown>) => {
    for (const k of ['call_count', 'total_cputime', 'total_time', 'acc_id_util_pct']) if (typeof o[k] === 'number') pct = Math.max(pct, o[k] as number);
    if (typeof o.estimated_time_to_regain_access === 'number') regainMs = Math.max(regainMs, (o.estimated_time_to_regain_access as number) * 60_000);
    if (typeof o.reset_time_duration === 'number' && (o.acc_id_util_pct as number) >= 90) regainMs = Math.max(regainMs, (o.reset_time_duration as number) * 1000);
  };
  const buc = parse('x-business-use-case-usage');
  if (buc && typeof buc === 'object') for (const entries of Object.values(buc as Record<string, unknown>)) if (Array.isArray(entries)) entries.forEach((e) => e && typeof e === 'object' && take(e as Record<string, unknown>));
  for (const name of ['x-ad-account-usage', 'x-app-usage']) {
    const o = parse(name);
    if (o && typeof o === 'object') take(o as Record<string, unknown>);
  }
  return seen ? { pct, regainMs } : null;
}

export class MetaApiError extends Error {
  /** Meta's estimate until access is regained, from the usage headers of the failed response (ms). */
  regainMs = 0;

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
  /** Retries after a Meta rate-limit error (default 6, for background syncs; interactive calls use fewer). */
  rateLimitRetries?: number;
}

interface Paged<T> {
  data: T[];
  paging?: { next?: string };
}

export class GraphClient {
  private readonly proof: string | undefined;
  /** Last usage Meta reported to this client; used to slow down before hitting the limit. */
  private usage: Usage | null = null;

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
    const rateLimitRetries = this.opts.rateLimitRetries ?? RATE_LIMIT_RETRIES;
    let rateLimited = 0;
    let otherFailures = 0;
    for (;;) {
      await this.throttle();
      try {
        return await this.once<T>(url.toString());
      } catch (err) {
        if (err instanceof MetaApiError && err.isRateLimit) {
          // Exponential back-off for rate limits, following Meta's own estimate when it is longer.
          rateLimited++;
          if (rateLimited > rateLimitRetries) {
            if (rateLimitRetries > 0) err.message = `${err.message} (still rate limited after ${rateLimitRetries} retries)`;
            throw err;
          }
          const ms = Math.min(Math.max(RATE_LIMIT_BASE_MS * 2 ** (rateLimited - 1), err.regainMs), RATE_LIMIT_MAX_WAIT_MS);
          this.usage = null; // this back-off already covers the usage Meta reported
          await this.wait({ ms, reason: 'rate_limit', attempt: rateLimited, maxAttempts: rateLimitRetries });
          continue;
        }
        const retriable = err instanceof MetaApiError ? err.isTransient : true; // network/timeouts, 5xx
        if (!retriable || otherFailures >= maxRetries) throw err;
        await sleepImpl(Math.min(baseDelay * 2 ** otherFailures, 60_000));
        otherFailures++;
      }
    }
  }

  private async wait(w: GraphWait): Promise<void> {
    for (const fn of waitListeners) fn(w);
    await sleepImpl(w.ms);
  }

  /** Before each call: pause when Meta reports usage near its limit, so fewer calls are refused. */
  private async throttle(): Promise<void> {
    const u = this.usage;
    if (!u || u.pct < 75) return;
    const ms = u.pct >= 90 ? Math.min(Math.max(u.regainMs, 10_000), 60_000) : 2_000;
    this.usage = null; // re-evaluated from the next response
    await this.wait({ ms, reason: 'usage', attempt: 0, maxAttempts: 0 });
  }

  private async once<T>(url: string): Promise<T> {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
      headers: { Authorization: `Bearer ${this.opts.accessToken}` },
    });
    this.usage = usageFromHeaders(res.headers) ?? this.usage;
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string; error_user_msg?: string };
    };
    if (!res.ok || body.error) {
      const e = body.error ?? {};
      const err = new MetaApiError(
        e.error_user_msg || e.message || `Meta API returned HTTP ${res.status}`,
        res.status,
        e.code,
        e.error_subcode,
        e.fbtrace_id,
      );
      err.regainMs = this.usage?.regainMs ?? 0;
      throw err;
    }
    return body as T;
  }
}
