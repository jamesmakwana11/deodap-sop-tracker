import { createHash, randomBytes } from 'node:crypto';
import type { AuthUser } from '@sop/shared';
import { env } from '../config/env.js';
import { store } from '../storage/store.js';

export const SESSION_COOKIE = 'sop_session';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string, userAgent: string | undefined): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);
  const now = new Date().toISOString();
  await store.c.sessions.insert({
    id: hashToken(token),
    userId,
    createdAt: now,
    expiresAt: expiresAt.toISOString(),
    lastSeenAt: now,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

/** Returns the session's user if the session is valid and the user is active. */
export async function findSessionUser(token: string): Promise<AuthUser | null> {
  const session = store.c.sessions.get(hashToken(token));
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  const u = store.c.users.get(session.userId);
  if (!u || !u.isActive) return null;
  // Record activity at most once a minute, so reads don't rewrite the file on every request.
  if (Date.now() - Date.parse(session.lastSeenAt) > 60_000) {
    await store.c.sessions.update(session.id, { lastSeenAt: new Date().toISOString() });
  }
  return { id: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword };
}

export async function deleteSession(token: string): Promise<void> {
  const id = hashToken(token);
  await store.c.sessions.remove((s) => s.id === id);
}

/** Signs a user out everywhere, optionally keeping the current session. */
export async function deleteUserSessions(userId: string, exceptToken?: string): Promise<void> {
  const keep = exceptToken ? hashToken(exceptToken) : '';
  await store.c.sessions.remove((s) => s.userId === userId && s.id !== keep);
}

export async function purgeExpiredSessions(): Promise<void> {
  const now = Date.now();
  await store.c.sessions.remove((s) => Date.parse(s.expiresAt) < now);
}
