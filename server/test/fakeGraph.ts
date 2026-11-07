/**
 * TEST DOUBLE for the Meta Graph API. Used only by the test suite; the running
 * application always talks to graph.facebook.com.
 */
import { setGraphFetch } from '../src/meta/graphClient.js';

export interface GraphRequest {
  path: string;
  params: URLSearchParams;
  authorization: string | undefined;
  url: string;
}

export type GraphHandler = (req: GraphRequest) => { status?: number; body: unknown; headers?: Record<string, string> } | undefined;

export function installFakeGraph(handler: GraphHandler) {
  const requests: GraphRequest[] = [];
  setGraphFetch(async (url, init) => {
    const u = new URL(url);
    const req: GraphRequest = {
      path: u.pathname.replace(/^\/v\d+\.\d+\//, ''),
      params: u.searchParams,
      authorization: init?.headers?.Authorization,
      url,
    };
    requests.push(req);
    const res = refusesDeleted(req) ?? handler(req) ?? { status: 404, body: { error: { message: `No fake for ${req.path}`, code: 803 } } };
    const status = res.status ?? 200;
    const headers = Object.fromEntries(Object.entries(res.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { ok: status < 400, status, json: async () => res.body, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } };
  });
  return { requests, uninstall: () => setGraphFetch(null) };
}

export const graphError = (code: number, message: string, status = 400) => ({ status, body: { error: { message, code } } });

/**
 * Real Meta behaviour (seen on the DeoDap production refresh, 7 Nov 2026): the campaigns / adsets /
 * ads collection edges refuse any effective_status filter that includes DELETED.
 */
export const DELETED_REFUSED: { status: number; body: { error: { message: string; type: string; code: number; error_subcode: number; fbtrace_id: string } }; headers?: Record<string, string> } = {
  status: 400,
  body: { error: { message: '(#100) Requesting for deleted objects is not supported in this endpoint.', type: 'OAuthException', code: 100, error_subcode: 1815001, fbtrace_id: 'TEST' } },
};
function refusesDeleted(r: GraphRequest): ReturnType<GraphHandler> {
  if (!/^act_\d+\/(campaigns|adsets|ads)$/.test(r.path)) return undefined;
  const asked = `${r.params.get('effective_status') ?? ''} ${r.params.get('filtering') ?? ''}`;
  return asked.includes('DELETED') ? DELETED_REFUSED : undefined;
}
