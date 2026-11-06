import { metaAppConfig, type MetaAppConfig } from './appConfig.js';
import { HttpError } from '../http/errors.js';
import { GraphClient } from './graphClient.js';

/** Only ads_read is requested: enough to read campaigns, ad sets, ads, creatives and insights. */
export const META_SCOPES = ['ads_read'] as const;

export { metaAppConfig, type MetaAppConfig } from './appConfig.js';

export function requireMetaAppConfig(): MetaAppConfig {
  const cfg = metaAppConfig();
  if (!cfg) throw new HttpError(503, 'Meta is not configured yet. An admin can enter the Meta app details in Meta & schedule.', 'config');
  return cfg;
}

export function buildAuthorizeUrl(cfg: MetaAppConfig, state: string): string {
  const url = new URL(`https://www.facebook.com/${cfg.graphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', cfg.appId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', META_SCOPES.join(','));
  return url.toString();
}

/** App-level client (app access token) for oauth/access_token and debug_token. */
function appClient(cfg: MetaAppConfig): GraphClient {
  return new GraphClient({ accessToken: `${cfg.appId}|${cfg.appSecret}`, version: cfg.graphVersion, maxRetries: 1 });
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/** code → short-lived user token → long-lived (~60 day) user token. */
export async function exchangeCodeForLongLivedToken(cfg: MetaAppConfig, code: string): Promise<{ token: string; expiresAt: Date | null }> {
  const client = appClient(cfg);
  const short = await client.get<TokenResponse>('oauth/access_token', {
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    redirect_uri: cfg.redirectUri,
    code,
  });
  const long = await client.get<TokenResponse>('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    fb_exchange_token: short.access_token,
  });
  return {
    token: long.access_token,
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null,
  };
}

export interface TokenInfo {
  isValid: boolean;
  userId: string | null;
  type: string | null;
  scopes: string[];
  expiresAt: Date | null;
}

export async function debugToken(cfg: MetaAppConfig, token: string): Promise<TokenInfo> {
  const res = await appClient(cfg).get<{
    data: { is_valid: boolean; user_id?: string; type?: string; scopes?: string[]; expires_at?: number; app_id?: string };
  }>('debug_token', { input_token: token });
  const d = res.data;
  if (d.app_id && d.app_id !== cfg.appId) {
    return { isValid: false, userId: null, type: null, scopes: [], expiresAt: null };
  }
  return {
    isValid: d.is_valid,
    userId: d.user_id ?? null,
    type: d.type ?? null,
    scopes: d.scopes ?? [],
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null,
  };
}
