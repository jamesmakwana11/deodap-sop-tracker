import { graphVersion, metaAppSecret } from '../meta/appConfig.js';
import { badRequest, HttpError } from '../http/errors.js';
import { GraphClient, MetaApiError } from '../meta/graphClient.js';
import { debugToken, exchangeCodeForLongLivedToken, metaAppConfig, requireMetaAppConfig } from '../meta/oauth.js';
import type { RawAdAccount } from '../meta/types.js';
import {
  findConnectionSecret,
  markConnectionInvalid,
  upsertConnection,
  upsertDiscoveredAccount,
} from '../repositories/metaRepository.js';
import { decryptSecret, encryptSecret } from '../security/tokenCrypto.js';

export function clientForToken(token: string): GraphClient {
  return new GraphClient({ accessToken: token, appSecret: metaAppSecret(), version: graphVersion() });
}

/** A Graph client using the stored (decrypted) token of a connection. */
export async function clientForConnection(connectionId: string): Promise<GraphClient> {
  const conn = await findConnectionSecret(connectionId);
  if (!conn) throw new HttpError(409, 'The Meta connection for this account was removed. Reconnect Meta in Settings.');
  if (conn.status === 'invalid') {
    throw new HttpError(409, `The Meta connection needs to be reconnected: ${conn.lastError ?? 'token invalid'}`);
  }
  if (conn.expiresAt && Date.parse(conn.expiresAt) < Date.now()) {
    await markConnectionInvalid(conn.id, 'Access token expired');
    throw new HttpError(409, 'The Meta access token has expired. Reconnect Meta in Settings.');
  }
  return clientForToken(decryptSecret(conn.tokenCiphertext));
}

async function saveConnection(token: string, tokenType: 'user' | 'system_user', expiresAt: Date | null, scopes: string[], userId: string) {
  const client = clientForToken(token);
  const me = await client.get<{ id: string; name?: string }>('me', { fields: 'id,name' });
  const connection = await upsertConnection({
    metaUserId: me.id,
    metaUserName: me.name ?? null,
    tokenType,
    tokenCiphertext: encryptSecret(token),
    scopes,
    expiresAt,
    connectedBy: userId,
  });
  const accounts = await discoverAccounts(connection.id, client);
  return { connection, accountsFound: accounts };
}

/** OAuth callback: exchange the code, keep only the long-lived token, then discover ad accounts. */
export async function connectWithCode(code: string, userId: string) {
  const cfg = requireMetaAppConfig();
  encryptSecret('check'); // fail fast if the encryption key is missing
  const { token, expiresAt } = await exchangeCodeForLongLivedToken(cfg, code);
  const info = await debugToken(cfg, token);
  if (!info.isValid) throw badRequest('Meta returned an invalid token.');
  if (!info.scopes.includes('ads_read')) throw badRequest('The ads_read permission was not granted. Connect again and allow it.');
  return saveConnection(token, 'user', info.expiresAt ?? expiresAt, info.scopes, userId);
}

/** Admin pastes a system-user token from Business Manager (does not expire). */
export async function connectWithToken(token: string, userId: string) {
  encryptSecret('check');
  const cfg = metaAppConfig();
  let scopes: string[] = [];
  let expiresAt: Date | null = null;
  let tokenType: 'user' | 'system_user' = 'system_user';
  if (cfg) {
    const info = await debugToken(cfg, token);
    if (!info.isValid) throw badRequest('Meta says this token is not valid for the configured app.');
    if (!info.scopes.includes('ads_read')) throw badRequest('This token does not have the ads_read permission.');
    scopes = info.scopes;
    expiresAt = info.expiresAt;
    tokenType = info.type === 'SYSTEM_USER' ? 'system_user' : 'user';
  }
  try {
    return await saveConnection(token, tokenType, expiresAt, scopes, userId);
  } catch (err) {
    if (err instanceof MetaApiError && err.isAuthError) throw badRequest(`Meta rejected the token: ${err.message}`);
    throw err;
  }
}

/** Lists every ad account the token can read and records them (unselected unless already selected). */
export async function discoverAccounts(connectionId: string, client?: GraphClient): Promise<number> {
  const graph = client ?? (await clientForConnection(connectionId));
  const accounts = await graph.getAll<RawAdAccount>('me/adaccounts', {
    fields: 'id,account_id,name,currency,timezone_name,account_status,business{name}',
    limit: 200,
  });
  for (const a of accounts) {
    await upsertDiscoveredAccount({
      metaAccountId: a.account_id,
      name: a.name ?? `Ad account ${a.account_id}`,
      currency: a.currency ?? 'UNKNOWN', // never assume rupees
      timezone: a.timezone_name ?? null,
      businessName: a.business?.name ?? null,
      accountStatus: a.account_status ?? null,
      connectionId,
    });
  }
  return accounts.length;
}
