import { createHash } from 'node:crypto';
import type { AccountAccessInfo, AdAccountInfo, MetaConnectionInfo, TokenCheckInfo } from '@sop/shared';
import type { AdAccountRecord, MetaConnectionRecord } from '../storage/records.js';
import { store } from '../storage/store.js';

const now = () => new Date().toISOString();

function toConnectionInfo(r: MetaConnectionRecord): MetaConnectionInfo {
  return {
    id: r.id,
    metaUserId: r.metaUserId,
    metaUserName: r.metaUserName,
    tokenType: r.tokenType,
    scopes: r.scopes,
    expiresAt: r.expiresAt,
    status: r.status,
    lastError: r.lastError,
    createdAt: r.createdAt,
    check: r.check ?? null,
  };
}

export async function listConnections(): Promise<MetaConnectionInfo[]> {
  return [...store.c.metaConnections.all()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(toConnectionInfo);
}

/** Includes the encrypted token. Never send this record to the client. */
export async function findConnectionSecret(id: string): Promise<MetaConnectionRecord | null> {
  return store.c.metaConnections.get(id) ?? null;
}

export async function upsertConnection(c: {
  metaUserId: string;
  metaUserName: string | null;
  tokenType: 'user' | 'system_user';
  tokenCiphertext: string;
  scopes: string[];
  expiresAt: Date | null;
  connectedBy: string;
  useAppSecretProof?: boolean;
  check?: TokenCheckInfo | null;
}): Promise<MetaConnectionInfo> {
  const fields = {
    ...(c.useAppSecretProof !== undefined && { useAppSecretProof: c.useAppSecretProof }),
    ...(c.check !== undefined && { check: c.check }),
    metaUserId: c.metaUserId,
    metaUserName: c.metaUserName,
    tokenType: c.tokenType,
    tokenCiphertext: c.tokenCiphertext,
    scopes: c.scopes,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    connectedBy: c.connectedBy,
    status: 'active' as const,
    lastError: null,
    updatedAt: now(),
  };
  const existing = store.c.metaConnections.find((x) => x.metaUserId === c.metaUserId);
  const record = existing
    ? await store.c.metaConnections.update(existing.id, fields)
    : await store.c.metaConnections.insert({ ...fields, createdAt: now() });
  return toConnectionInfo(record!);
}

export async function markConnectionInvalid(id: string, error: string): Promise<void> {
  await store.c.metaConnections.update(id, { status: 'invalid', lastError: error.slice(0, 500), updatedAt: now() });
}

/** Forgets the token. Accounts that used it keep their history but lose the connection. */
export async function deleteConnection(id: string): Promise<boolean> {
  const removed = await store.c.metaConnections.remove((c) => c.id === id);
  if (!removed) return false;
  for (const a of store.c.adAccounts.filter((x) => x.connectionId === id)) {
    await store.c.adAccounts.update(a.id, { connectionId: null });
  }
  return true;
}

// ── OAuth state ─────────────────────────────────────────────────────────────

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export async function saveOAuthState(state: string, userId: string, redirectUri: string): Promise<void> {
  const t = Date.now();
  await store.c.oauthStates.remove((s) => Date.parse(s.expiresAt) < t);
  await store.c.oauthStates.insert({ id: hash(state), userId, redirectUri, expiresAt: new Date(t + 10 * 60_000).toISOString() });
}

/**
 * One-time use: for an unexpired state created by this user, removes it and returns the redirect
 * URI saved with it ('' for a state saved before redirect URIs were stored); otherwise null.
 */
export async function consumeOAuthState(state: string, userId: string): Promise<string | null> {
  const id = hash(state);
  const t = Date.now();
  const found = store.c.oauthStates.find((s) => s.id === id && s.userId === userId && Date.parse(s.expiresAt) > t);
  if (!found) return null;
  const removed = await store.c.oauthStates.remove((s) => s.id === id);
  return removed > 0 ? (found.redirectUri ?? '') : null;
}

// ── Ad accounts ─────────────────────────────────────────────────────────────

export function toAccountInfo(r: AdAccountRecord): AdAccountInfo {
  return {
    id: r.id,
    metaAccountId: r.metaAccountId,
    name: r.name,
    currency: r.currency,
    timezone: r.timezone,
    businessName: r.businessName,
    accountStatus: r.accountStatus,
    selected: r.isActive,
    connectionId: r.connectionId,
    isDevData: r.isDevData,
    addedManually: r.addedManually ?? false,
    access: r.access ?? null,
  };
}

const byName = (a: AdAccountRecord, b: AdAccountRecord) => a.name.localeCompare(b.name);

export async function listAccounts(): Promise<AdAccountInfo[]> {
  return store.c.adAccounts
    .filter((a) => !a.isDevData)
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || byName(a, b))
    .map(toAccountInfo);
}

export async function listSelectedAccounts(): Promise<AdAccountInfo[]> {
  return store.c.adAccounts
    .filter((a) => a.isActive && !a.isDevData && a.connectionId !== null)
    .sort(byName)
    .map(toAccountInfo);
}

/** Records accounts a connection can see. Existing selection is preserved; new ones start unselected. */
export async function upsertDiscoveredAccount(a: {
  metaAccountId: string;
  name: string;
  currency: string;
  timezone: string | null;
  businessName: string | null;
  accountStatus: number | null;
  connectionId: string;
  addedManually?: boolean;
}): Promise<void> {
  // An account found automatically keeps its "added manually" flag only if it was entered by hand before.
  const { addedManually, ...rest } = a;
  const fields = { ...rest, ...(addedManually && { addedManually: true }), lastSeenAt: now(), updatedAt: now() };
  const existing = store.c.adAccounts.find((x) => x.metaAccountId === a.metaAccountId);
  // Without business_management the name is unknown, not empty: keep one found earlier.
  if (existing) await store.c.adAccounts.update(existing.id, { ...fields, businessName: fields.businessName ?? existing.businessName });
  else await store.c.adAccounts.insert({ ...fields, isActive: false, isDevData: false, createdAt: now() });
}

export async function setAccountSelected(id: string, selected: boolean): Promise<AdAccountInfo | null> {
  const existing = store.c.adAccounts.get(id);
  if (!existing || existing.isDevData) return null;
  const r = await store.c.adAccounts.update(id, { isActive: selected, updatedAt: now() });
  return r ? toAccountInfo(r) : null;
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function getSetting<T>(key: string): Promise<T | null> {
  return (store.c.settings.get(key)?.value as T | undefined) ?? null;
}

export async function putSetting(key: string, value: unknown, userId: string | null): Promise<void> {
  await store.c.settings.put({ id: key, value, updatedAt: now(), updatedBy: userId });
}

/** Updates what a connection's token can do (after a check), and clears an earlier error. */
export async function saveConnectionCheck(id: string, check: TokenCheckInfo, scopes: string[], expiresAt: Date | null): Promise<void> {
  await store.c.metaConnections.update(id, { check, scopes, expiresAt: expiresAt?.toISOString() ?? null, status: 'active', lastError: null, updatedAt: now() });
}

export async function saveAccountAccess(metaAccountId: string, access: AccountAccessInfo): Promise<void> {
  const a = store.c.adAccounts.find((x) => x.metaAccountId === metaAccountId);
  if (a) await store.c.adAccounts.update(a.id, { access, updatedAt: now() });
}

export async function setBusinessName(metaAccountId: string, businessName: string | null): Promise<void> {
  const a = store.c.adAccounts.find((x) => x.metaAccountId === metaAccountId);
  if (a && a.businessName !== businessName) await store.c.adAccounts.update(a.id, { businessName, updatedAt: now() });
}
