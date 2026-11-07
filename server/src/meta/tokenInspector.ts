import type { TokenCheckInfo } from '@sop/shared';
import { badRequest } from '../http/errors.js';
import { graphVersion, metaAppConfig, metaAppSecret, type MetaAppConfig } from './appConfig.js';
import { GraphClient, MetaApiError } from './graphClient.js';
import { explainMetaError, hasReadPermission } from './permissions.js';

/**
 * Reads what a Meta access token is before it is saved: valid or not, user or system-user,
 * which app issued it, when it expires and which permissions it carries. Extra permissions are
 * fine; only a read permission (ads_read or ads_management) is required.
 *
 * Sources, best first:
 *  1. debug_token with the configured app's access token (tokens of the configured app);
 *  2. debug_token with the token itself (tokens of any app, e.g. Graph API Explorer or a Business app);
 *  3. me/permissions (permissions only; type and expiry unknown).
 */

interface DebugData {
  is_valid?: boolean;
  app_id?: string;
  application?: string;
  type?: string;
  user_id?: string;
  scopes?: string[];
  granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  expires_at?: number;
  data_access_expires_at?: number;
  error?: { message?: string; code?: number; subcode?: number };
}

export interface TokenInspection {
  check: TokenCheckInfo;
  metaUserId: string;
  metaUserName: string | null;
  tokenType: 'user' | 'system_user';
  expiresAt: Date | null;
  /** Send appsecret_proof only for tokens of the configured app (a proof for another app is rejected). */
  useAppSecretProof: boolean;
}

const WEEK = 7 * 86_400_000;
const toDate = (unix: number | undefined) => (unix && unix > 0 ? new Date(unix * 1000) : null);

/** A client for the token itself, with or without the configured app's secret proof. */
export function tokenClient(token: string, withProof: boolean): GraphClient {
  return new GraphClient({ accessToken: token, appSecret: withProof ? metaAppSecret() : undefined, version: graphVersion(), maxRetries: 1 });
}

function appClient(cfg: MetaAppConfig): GraphClient {
  return new GraphClient({ accessToken: `${cfg.appId}|${cfg.appSecret}`, version: cfg.graphVersion, maxRetries: 1 });
}

async function readDebug(token: string, cfg: MetaAppConfig | null): Promise<{ data: DebugData; method: TokenCheckInfo['method'] } | null> {
  if (cfg) {
    try {
      const res = await appClient(cfg).get<{ data: DebugData }>('debug_token', { input_token: token });
      if (res.data) return { data: res.data, method: 'debug_token' };
    } catch (err) {
      // "The App_id in the input_token did not match the Viewing App": a token of another app. Try it on itself.
      if (err instanceof MetaApiError && err.isTransient) throw err;
    }
  }
  try {
    const res = await tokenClient(token, false).get<{ data: DebugData }>('debug_token', { input_token: token });
    if (res.data) return { data: res.data, method: 'self_debug' };
  } catch {
    // some tokens may not inspect themselves; fall back to me/permissions
  }
  return null;
}

/** Calls `me` to learn whether the configured app's secret proof works with this token. */
async function probeProof(token: string, cfg: MetaAppConfig | null): Promise<boolean> {
  if (!cfg) return false;
  try {
    await tokenClient(token, true).get('me', { fields: 'id' });
    return true;
  } catch (err) {
    if (err instanceof MetaApiError && /appsecret_proof/i.test(err.message)) return false;
    throw err;
  }
}

export async function inspectToken(token: string): Promise<TokenInspection> {
  const cfg = metaAppConfig();
  const debug = await readDebug(token, cfg);
  const d = debug?.data;
  const warnings: string[] = [];

  if (d && d.is_valid === false) {
    const why = d.error?.message ? `: ${d.error.message}` : '';
    throw badRequest(`Meta says this token is not valid${why}. Generate a new token and try again.`);
  }
  const type = (d?.type?.toUpperCase() ?? 'UNKNOWN') as TokenCheckInfo['type'];
  if (type === 'PAGE' || type === 'APP') {
    throw badRequest(`This is a ${type === 'PAGE' ? 'Page' : 'app'} access token, which cannot read ad accounts. Use a user token or a Business system-user token with the ads_read permission.`);
  }

  const sameApp = cfg && d?.app_id ? d.app_id === cfg.appId : null;
  let useAppSecretProof: boolean;
  try {
    useAppSecretProof = sameApp === null ? await probeProof(token, cfg) : sameApp;
  } catch (err) {
    throw badRequest(explainMetaError(err));
  }

  // Who the token acts as. Fails for revoked or malformed tokens.
  const client = tokenClient(token, useAppSecretProof);
  let me: { id: string; name?: string };
  try {
    me = await client.get<{ id: string; name?: string }>('me', { fields: 'id,name' });
  } catch (err) {
    throw badRequest(`Meta rejected the token. ${explainMetaError(err)}`);
  }

  let granted = d?.scopes ?? [];
  let declined: string[] = [];
  let method: TokenCheckInfo['method'] = debug?.method ?? 'none';
  if (!d) {
    try {
      const perms = await client.get<{ data: Array<{ permission: string; status: string }> }>('me/permissions');
      granted = perms.data.filter((p) => p.status === 'granted').map((p) => p.permission);
      declined = perms.data.filter((p) => p.status === 'declined').map((p) => p.permission);
      method = 'permissions';
    } catch {
      // System-user tokens may not list permissions this way; reading is tested below instead.
    }
    warnings.push('Meta did not report the token type or expiry for this token. Enter the Meta app details under Meta app to verify them.');
  }

  // With no permission list at all, test reading directly instead of guessing.
  let canReadAds = hasReadPermission(granted);
  if (!granted.length) {
    try {
      await client.get('me/adaccounts', { fields: 'id', limit: 1 });
      canReadAds = true;
      warnings.push('Meta did not list the token\'s permissions; reading ad accounts was tested directly and works.');
    } catch (err) {
      throw badRequest(`This token cannot read ad accounts. ${explainMetaError(err)}`);
    }
  }
  if (!canReadAds) {
    const list = granted.length ? granted.join(', ') : 'none reported';
    throw badRequest(
      `This token does not have the ads_read permission, which is needed to read campaigns (ads_management also works). Permissions on this token: ${list}. Generate a token with ads_read and try again.`,
    );
  }

  const expiresAt = toDate(d?.expires_at);
  const dataAccessExpiresAt = toDate(d?.data_access_expires_at);
  if (expiresAt && expiresAt.getTime() - Date.now() < WEEK) {
    warnings.push(`This token expires on ${expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. The daily refresh stops then; use a long-lived user token or a system-user token (which does not expire).`);
  }
  if (dataAccessExpiresAt && dataAccessExpiresAt.getTime() - Date.now() < WEEK) {
    warnings.push(`Meta's data access for this token ends on ${dataAccessExpiresAt.toISOString().slice(0, 10)}; the person must log in again before then.`);
  }
  if (cfg && sameApp === false) {
    warnings.push(`The token was issued by another Meta app (ID ${d?.app_id}); requests are sent without the configured app's secret proof.`);
  }

  const adsGrant = d?.granular_scopes?.find((g) => g.scope === 'ads_read') ?? d?.granular_scopes?.find((g) => g.scope === 'ads_management');
  const check: TokenCheckInfo = {
    checkedAt: new Date().toISOString(),
    method,
    type,
    appId: d?.app_id ?? null,
    appName: d?.application ?? null,
    sameAppAsConfigured: sameApp,
    expiresAt: expiresAt?.toISOString() ?? null,
    dataAccessExpiresAt: dataAccessExpiresAt?.toISOString() ?? null,
    granted: [...granted].sort(),
    declined: [...declined].sort(),
    granularAdAccounts: adsGrant?.target_ids?.length ? adsGrant.target_ids.map((t) => t.replace(/^act_/, '')) : null,
    canReadAds,
    warnings,
  };
  return {
    check,
    metaUserId: me.id,
    metaUserName: me.name ?? null,
    tokenType: type === 'SYSTEM_USER' ? 'system_user' : 'user',
    expiresAt,
    useAppSecretProof,
  };
}
