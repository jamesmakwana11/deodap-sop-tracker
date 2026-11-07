import type { Request } from 'express';
import { isProduction } from '../config/env.js';
import { badRequest } from './errors.js';

/**
 * The public address the browser used to reach the app, worked out per request, so the same
 * build works on localhost, on Render (https://<service>.onrender.com) and on any custom domain
 * without configuration.
 *
 * - Host: the browser's Host header. Proxy headers (X-Forwarded-Host, X-Forwarded-Proto) are only
 *   used when Express trusts the proxy (TRUST_PROXY, or automatically on Render), so a client
 *   cannot spoof them on a direct connection.
 * - Protocol: https in production for every non-local host (TLS usually ends at the proxy);
 *   http is kept for localhost.
 * - The host must look like a real host name; anything else is refused.
 */

export const META_CALLBACK_PATH = '/api/meta/oauth/callback';

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST_RE = new RegExp(`^(?:${LABEL}(?:\\.${LABEL})*|\\[[0-9a-f:.]+\\])(?::(\\d{1,5}))?$`, 'i');
const LOOPBACK_RE = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/i;

export const isLoopbackHost = (host: string) => LOOPBACK_RE.test(host);

/** "host[:port]" if it is a syntactically valid host, else null. Lower-cased. */
export function cleanHost(raw: string | undefined): string | null {
  const host = raw?.split(',')[0]?.trim().toLowerCase();
  if (!host || host.length > 260 || !HOST_RE.test(host)) return null;
  const port = HOST_RE.exec(host)?.[1];
  if (port && Number(port) > 65535) return null;
  return host;
}

export function publicOrigin(req: Request, production = isProduction): string {
  const trusted = Boolean(req.app.get('trust proxy'));
  const host = cleanHost((trusted && req.get('x-forwarded-host')) || req.get('host'));
  if (!host) throw badRequest('This request has no valid host name.');
  // req.protocol already reads X-Forwarded-Proto, but only from a trusted proxy.
  let protocol = req.protocol === 'https' ? 'https' : 'http';
  if (production && !isLoopbackHost(host)) protocol = 'https';
  // Drop default ports so the address matches what is registered with Meta.
  const origin = `${protocol}://${host}`;
  return origin.replace(/^https:\/\/(.+):443$/, 'https://$1').replace(/^http:\/\/(.+):80$/, 'http://$1');
}

export const detectedRedirectUri = (req: Request, production = isProduction) => `${publicOrigin(req, production)}${META_CALLBACK_PATH}`;
