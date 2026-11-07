import type { AccountAccessInfo, MetaConnectionInfo, MetaDiscoveryReport } from '@sop/shared';
import { graphVersion, metaAppSecret } from '../meta/appConfig.js';
import { badRequest, HttpError } from '../http/errors.js';
import { GraphClient, MetaApiError } from '../meta/graphClient.js';
import { exchangeCodeForLongLivedToken, requireMetaAppConfig } from '../meta/oauth.js';
import { explainMetaError, isFieldPermissionError, isNoAccessToObject } from '../meta/permissions.js';
import { inspectToken, type TokenInspection } from '../meta/tokenInspector.js';
import type { RawAdAccount } from '../meta/types.js';
import {
  findConnectionSecret,
  listConnections,
  markConnectionInvalid,
  saveAccountAccess,
  saveConnectionCheck,
  setBusinessName,
  upsertConnection,
  upsertDiscoveredAccount,
} from '../repositories/metaRepository.js';
import { decryptSecret, encryptSecret } from '../security/tokenCrypto.js';
import { store } from '../storage/store.js';

/**
 * Connecting Meta: every token is inspected first (validity, type, app, expiry, permissions), then
 * its ad accounts are found and test-read. Only ads_read is needed; extra permissions are accepted.
 * Everything here is a GET; nothing in Meta is changed.
 */

/** Fields readable with ads_read alone. `business{…}` needs business_management, so it is read separately. */
const ACCOUNT_FIELDS = 'id,account_id,name,currency,timezone_name,account_status';
/** Test-reading campaigns and insights takes two calls per account; beyond this, the next sync shows access. */
const MAX_ACCESS_CHECKS = 50;

/**
 * "background" (syncs) waits out Meta rate limits with long back-off; "interactive" (someone is
 * waiting for the page) retries a rate limit once and then reports it.
 */
export type ClientUse = 'background' | 'interactive';

export function clientForToken(token: string, useAppSecretProof = true, use: ClientUse = 'interactive'): GraphClient {
  return new GraphClient({
    accessToken: token,
    appSecret: useAppSecretProof ? metaAppSecret() : undefined,
    version: graphVersion(),
    ...(use === 'interactive' ? { rateLimitRetries: 1 } : {}),
  });
}

/** A Graph client using the stored (decrypted) token of a connection. */
export async function clientForConnection(connectionId: string, use: ClientUse = 'interactive'): Promise<GraphClient> {
  const conn = await findConnectionSecret(connectionId);
  if (!conn) throw new HttpError(409, 'The Meta connection for this account was removed. Reconnect Meta in Settings.');
  if (conn.status === 'invalid') {
    throw new HttpError(409, `The Meta connection needs to be reconnected: ${conn.lastError ?? 'token invalid'}`);
  }
  if (conn.expiresAt && Date.parse(conn.expiresAt) < Date.now()) {
    await markConnectionInvalid(conn.id, 'Access token expired');
    throw new HttpError(409, 'The Meta access token has expired. Reconnect Meta in Settings.');
  }
  // Connections saved before token checks existed have no flag and keep the earlier behaviour.
  return clientForToken(decryptSecret(conn.tokenCiphertext), conn.useAppSecretProof ?? true, use);
}

/** "act_123", "123" or "act 123" → "123". */
export function normaliseAccountId(input: string): string | null {
  const id = input.trim().replace(/^act[_\s-]?/i, '');
  return /^\d{5,20}$/.test(id) ? id : null;
}

export function parseAccountIds(list: string[] | undefined): string[] {
  const ids: string[] = [];
  for (const raw of list ?? []) {
    for (const part of raw.split(/[\s,;]+/).filter(Boolean)) {
      const id = normaliseAccountId(part);
      if (!id) throw badRequest(`"${part}" is not an ad account ID. Use the number shown in Ads Manager, e.g. 1234567890 or act_1234567890.`);
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

const toDiscovered = (a: RawAdAccount, connectionId: string, addedManually = false) => ({
  metaAccountId: a.account_id,
  name: a.name ?? `Ad account ${a.account_id}`,
  currency: a.currency ?? 'UNKNOWN', // never assume rupees
  timezone: a.timezone_name ?? null,
  businessName: null,
  accountStatus: a.account_status ?? null,
  connectionId,
  addedManually,
});

/** Reads one account by ID (manual entry). Returns why when the token cannot see it. */
async function lookupAccount(graph: GraphClient, id: string): Promise<{ account: RawAdAccount } | { error: string }> {
  try {
    return { account: await graph.get<RawAdAccount>(`act_${id}`, { fields: ACCOUNT_FIELDS }) };
  } catch (err) {
    if (err instanceof MetaApiError && err.isTokenInvalid) throw err;
    return { error: explainMetaError(err, { accountId: id }) };
  }
}

/** Test-reads campaigns and insights of one account, so Settings can show exactly what works. */
export async function checkAccountAccess(graph: GraphClient, metaAccountId: string): Promise<AccountAccessInfo> {
  const act = `act_${metaAccountId}`;
  const probe = async (path: string, params: Record<string, string | number>) => {
    try {
      await graph.get(path, params);
      return { state: 'ok' as const, message: null };
    } catch (err) {
      if (err instanceof MetaApiError && err.isTokenInvalid) throw err;
      const denied = isFieldPermissionError(err) || isNoAccessToObject(err);
      return { state: denied ? ('denied' as const) : ('error' as const), message: explainMetaError(err, { accountId: metaAccountId }) };
    }
  };
  const campaigns = await probe(`${act}/campaigns`, { fields: 'id', limit: 1 });
  const insights = await probe(`${act}/insights`, { fields: 'spend', date_preset: 'last_7d', limit: 1 });
  return { checkedAt: new Date().toISOString(), campaigns: campaigns.state, insights: insights.state, message: campaigns.message ?? insights.message };
}

/** Business portfolio names: only with business_management, and never required. */
async function addBusinessNames(graph: GraphClient, scopes: string[], ids: string[]): Promise<MetaDiscoveryReport['businessNames']> {
  if (!scopes.includes('business_management')) return 'not_permitted';
  try {
    const rows = await graph.getAll<{ account_id: string; business?: { name?: string } }>('me/adaccounts', { fields: 'account_id,business{id,name}', limit: 100 });
    const byId = new Map(rows.map((r) => [r.account_id, r.business?.name ?? null]));
    for (const id of ids) if (byId.has(id)) await setBusinessName(id, byId.get(id)!);
    return 'shown';
  } catch (err) {
    if (err instanceof MetaApiError && err.isTokenInvalid) throw err;
    return 'unavailable';
  }
}

async function runChecks(graph: GraphClient, scopes: string[], ids: string[], report: MetaDiscoveryReport) {
  // Selected accounts first, so the ones that matter are always checked.
  const selected = new Set(store.c.adAccounts.filter((a) => a.isActive).map((a) => a.metaAccountId));
  const order = [...ids].sort((a, b) => Number(selected.has(b)) - Number(selected.has(a)));
  const toCheck = order.slice(0, MAX_ACCESS_CHECKS);
  let next = 0;
  const worker = async () => {
    while (next < toCheck.length) {
      const id = toCheck[next++]!;
      const access = await checkAccountAccess(graph, id);
      await saveAccountAccess(id, access);
      report.checked++;
      if (access.campaigns === 'ok') report.readable++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (ids.length > toCheck.length) report.warnings.push(`Access was test-read for ${toCheck.length} of ${ids.length} ad accounts; the rest are checked when they are selected and synced.`);
  report.businessNames = await addBusinessNames(graph, scopes, ids);
}

/** Finds ad accounts (automatically, plus any entered IDs) without saving anything. */
async function findAccounts(graph: GraphClient, manualIds: string[]) {
  let discovered: RawAdAccount[] = [];
  let discoveryError: string | null = null;
  try {
    discovered = await graph.getAll<RawAdAccount>('me/adaccounts', { fields: ACCOUNT_FIELDS, limit: 100 });
  } catch (err) {
    if (err instanceof MetaApiError && err.isTokenInvalid) throw err;
    discoveryError = explainMetaError(err);
  }
  const known = new Set(discovered.map((a) => a.account_id));
  const manual: MetaDiscoveryReport['manual'] = [];
  const manualAccounts: RawAdAccount[] = [];
  for (const id of manualIds) {
    if (known.has(id)) {
      manual.push({ metaAccountId: id, ok: true, name: discovered.find((a) => a.account_id === id)?.name ?? null, message: 'Also found automatically.' });
      continue;
    }
    const r = await lookupAccount(graph, id);
    if ('account' in r) {
      manualAccounts.push(r.account);
      manual.push({ metaAccountId: id, ok: true, name: r.account.name ?? null, message: null });
    } else manual.push({ metaAccountId: id, ok: false, name: null, message: r.error });
  }
  return { discovered, manualAccounts, manual, discoveryError };
}

function noAccountsError(discoveryError: string | null, manual: MetaDiscoveryReport['manual']): HttpError {
  const parts = ['The token is valid, but it cannot see any ad account, so nothing was saved.'];
  if (discoveryError) parts.push(`Automatic discovery failed: ${discoveryError}`);
  else parts.push('Meta lists no ad accounts for it: assign the ad accounts to this person or system user in Meta Business Settings (view-only access is enough).');
  for (const m of manual.filter((x) => !x.ok)) parts.push(`Account ${m.metaAccountId}: ${m.message}`);
  if (!manual.length) parts.push('You can also enter ad account IDs by hand.');
  return badRequest(parts.join(' '));
}

export interface ConnectResult {
  connection: MetaConnectionInfo;
  accountsFound: number;
  report: MetaDiscoveryReport;
}

/** Validates, then saves the connection and its accounts, then test-reads each account. */
async function saveConnection(token: string, inspection: TokenInspection, userId: string, manualIds: string[]): Promise<ConnectResult> {
  const graph = clientForToken(token, inspection.useAppSecretProof);
  const found = await findAccounts(graph, manualIds);
  const accounts = [...found.discovered, ...found.manualAccounts];
  if (accounts.length === 0) throw noAccountsError(found.discoveryError, found.manual);

  const connection = await upsertConnection({
    metaUserId: inspection.metaUserId,
    metaUserName: inspection.metaUserName,
    tokenType: inspection.tokenType,
    tokenCiphertext: encryptSecret(token),
    scopes: inspection.check.granted,
    expiresAt: inspection.expiresAt,
    connectedBy: userId,
    useAppSecretProof: inspection.useAppSecretProof,
    check: inspection.check,
  });
  for (const a of found.discovered) await upsertDiscoveredAccount(toDiscovered(a, connection.id));
  for (const a of found.manualAccounts) await upsertDiscoveredAccount(toDiscovered(a, connection.id, true));

  const report: MetaDiscoveryReport = {
    discovered: found.discovered.length,
    discoveryError: found.discoveryError,
    manual: found.manual,
    checked: 0,
    readable: 0,
    businessNames: 'not_permitted',
    warnings: [...inspection.check.warnings],
  };
  await runChecks(graph, inspection.check.granted, accounts.map((a) => a.account_id), report);
  return { connection, accountsFound: accounts.length, report };
}

/** OAuth callback: exchange the code, keep only the long-lived token, then validate and discover. */
/** `redirectUri` is the one saved with the OAuth state, i.e. exactly what the login dialog received. */
export async function connectWithCode(code: string, userId: string, redirectUri: string): Promise<ConnectResult> {
  const cfg = requireMetaAppConfig();
  encryptSecret('check'); // fail fast if the encryption key is missing
  const { token } = await exchangeCodeForLongLivedToken(cfg, code, redirectUri);
  return saveConnection(token, await inspectToken(token), userId, []);
}

/**
 * Admin pastes a token: a Business system-user token (does not expire) or a user token, from any
 * Meta app. Optional ad account IDs are verified and added when automatic discovery misses them.
 */
export async function connectWithToken(token: string, userId: string, adAccountIds: string[] = []): Promise<ConnectResult> {
  encryptSecret('check');
  const ids = parseAccountIds(adAccountIds);
  const inspection = await inspectToken(token);
  return saveConnection(token, inspection, userId, ids);
}

/** "Check again": re-inspects the stored token, rediscovers accounts and test-reads them. */
export async function recheckConnection(connectionId: string): Promise<{ accountsFound: number; report: MetaDiscoveryReport; connection: MetaConnectionInfo }> {
  const conn = await findConnectionSecret(connectionId);
  if (!conn) throw new HttpError(404, 'Connection not found.');
  const token = decryptSecret(conn.tokenCiphertext);
  let inspection: TokenInspection;
  try {
    inspection = await inspectToken(token);
  } catch (err) {
    await markConnectionInvalid(conn.id, (err as Error).message);
    throw err;
  }
  await store.c.metaConnections.update(conn.id, { useAppSecretProof: inspection.useAppSecretProof, metaUserName: inspection.metaUserName, tokenType: inspection.tokenType });
  await saveConnectionCheck(conn.id, inspection.check, inspection.check.granted, inspection.expiresAt);

  const graph = clientForToken(token, inspection.useAppSecretProof);
  const manualIds = store.c.adAccounts.filter((a) => a.connectionId === conn.id && a.addedManually === true).map((a) => a.metaAccountId);
  const found = await findAccounts(graph, manualIds);
  for (const a of found.discovered) await upsertDiscoveredAccount(toDiscovered(a, conn.id));
  for (const a of found.manualAccounts) await upsertDiscoveredAccount(toDiscovered(a, conn.id, true));
  const report: MetaDiscoveryReport = {
    discovered: found.discovered.length,
    discoveryError: found.discoveryError,
    manual: found.manual,
    checked: 0,
    readable: 0,
    businessNames: 'not_permitted',
    warnings: [...inspection.check.warnings],
  };
  const ids = [...found.discovered, ...found.manualAccounts].map((a) => a.account_id);
  await runChecks(graph, inspection.check.granted, ids, report);
  const connection = (await listConnections()).find((c) => c.id === conn.id)!;
  return { accountsFound: ids.length, report, connection };
}

/** Adds one ad account by ID to an existing connection, after checking the token can read it. */
export async function addAccountById(connectionId: string, input: string): Promise<{ metaAccountId: string; access: AccountAccessInfo }> {
  const id = normaliseAccountId(input);
  if (!id) throw badRequest('Enter the ad account ID shown in Ads Manager, e.g. 1234567890 or act_1234567890.');
  const graph = await clientForConnection(connectionId);
  const r = await lookupAccount(graph, id);
  if ('error' in r) throw badRequest(r.error);
  await upsertDiscoveredAccount(toDiscovered(r.account, connectionId, true));
  const access = await checkAccountAccess(graph, id);
  await saveAccountAccess(id, access);
  const conn = await findConnectionSecret(connectionId);
  await addBusinessNames(graph, conn?.scopes ?? [], [id]);
  return { metaAccountId: id, access };
}

/** Kept for callers that only need a count (older API). */
export async function discoverAccounts(connectionId: string): Promise<number> {
  return (await recheckConnection(connectionId)).accountsFound;
}
