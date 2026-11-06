import type { AuthUser, Role, UserSummary } from '@sop/shared';
import type { UserRecord } from '../storage/records.js';
import { store } from '../storage/store.js';

const users = () => store.c.users;
const now = () => new Date().toISOString();

export function toAuthUser(r: UserRecord): AuthUser {
  return { id: r.id, email: r.email, name: r.name, role: r.role, mustChangePassword: r.mustChangePassword };
}

function toSummary(r: UserRecord): UserSummary {
  return { ...toAuthUser(r), isActive: r.isActive, createdAt: r.createdAt, lastLoginAt: r.lastLoginAt };
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const e = email.trim().toLowerCase();
  return users().find((u) => u.email.toLowerCase() === e) ?? null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  return users().get(id) ?? null;
}

export async function listUsers(): Promise<UserSummary[]> {
  return [...users().all()]
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name))
    .map(toSummary);
}

export async function countActiveAdmins(): Promise<number> {
  return users().filter((u) => u.role === 'admin' && u.isActive).length;
}

export async function insertUser(u: {
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  mustChangePassword: boolean;
}): Promise<UserSummary> {
  if (await findUserByEmail(u.email)) throw new Error('A user with this email already exists.');
  const record = await users().insert({
    email: u.email.trim(),
    name: u.name.trim(),
    role: u.role,
    passwordHash: u.passwordHash,
    isActive: true,
    mustChangePassword: u.mustChangePassword,
    createdAt: now(),
    updatedAt: now(),
    lastLoginAt: null,
  });
  return toSummary(record);
}

export async function updateUser(
  id: string,
  patch: { name?: string; role?: Role; isActive?: boolean },
): Promise<UserSummary | null> {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const r = await users().update(id, { ...clean, updatedAt: now() });
  return r ? toSummary(r) : null;
}

export async function setPassword(id: string, passwordHash: string, mustChange: boolean): Promise<void> {
  await users().update(id, { passwordHash, mustChangePassword: mustChange, updatedAt: now() });
}

export async function recordLogin(id: string): Promise<void> {
  await users().update(id, { lastLoginAt: now() });
}
