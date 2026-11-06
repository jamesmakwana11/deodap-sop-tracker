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

export type GraphHandler = (req: GraphRequest) => { status?: number; body: unknown } | undefined;

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
    const res = handler(req) ?? { status: 404, body: { error: { message: `No fake for ${req.path}`, code: 803 } } };
    const status = res.status ?? 200;
    return { ok: status < 400, status, json: async () => res.body };
  });
  return { requests, uninstall: () => setGraphFetch(null) };
}

export const graphError = (code: number, message: string, status = 400) => ({ status, body: { error: { message, code } } });
