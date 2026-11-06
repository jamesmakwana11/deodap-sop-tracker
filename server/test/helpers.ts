import path from 'node:path';
import type { Role } from '@sop/shared';
import type { Express } from 'express';
import request from 'supertest';
import { hashPassword } from '../src/auth/password.js';
import { DEFAULT_DATA_DIR, openStore, store } from '../src/storage/store.js';
import { insertUser } from '../src/repositories/userRepository.js';

export const CSRF = { 'x-sop-csrf': '1' } as const;
export const TEST_PASSWORD = 'correct-horse-battery';

export async function prepareDb(): Promise<void> {
  const dir = process.env.DATA_DIR;
  if (!dir || path.resolve(dir) === DEFAULT_DATA_DIR) throw new Error('Refusing to run tests against the real data folder');
  await openStore(dir);
}

/** Deletes every data file in the test folder. */
export async function resetDb(): Promise<void> {
  await store.wipe();
}

let counter = 0;
export async function createUser(role: Role, opts: { mustChangePassword?: boolean } = {}) {
  counter++;
  const email = `${role}${counter}@test.local`;
  const user = await insertUser({
    email,
    name: `${role} ${counter}`,
    role,
    passwordHash: await hashPassword(TEST_PASSWORD),
    mustChangePassword: opts.mustChangePassword ?? false,
  });
  return { ...user, password: TEST_PASSWORD };
}

/** A supertest agent signed in as a new user with the given role. */
export async function signedIn(app: Express, role: Role) {
  const user = await createUser(role);
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(CSRF).send({ email: user.email, password: user.password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user };
}
