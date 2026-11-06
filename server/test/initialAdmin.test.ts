/** First admin from INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD at start-up. */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureInitialAdmin } from '../src/auth/initialAdmin.js';
import { verifyPassword } from '../src/auth/password.js';
import { findUserByEmail } from '../src/repositories/userRepository.js';
import { closeStore, openStore, store } from '../src/storage/store.js';
import { createUser, CSRF } from './helpers.js';

const PASSWORD = 'Render-first-admin-42';
const freshStore = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sop-admin-'));
  await openStore(dir);
  return dir;
};
const login = (email: string, password: string) => request(createApp()).post('/api/auth/login').set(CSRF).send({ email, password });

afterAll(() => closeStore());

describe('first admin from environment variables', () => {
  it('creates a hashed admin that can sign in on the existing login page, and keeps it on disk', async () => {
    const dir = await freshStore();
    expect(await ensureInitialAdmin({ email: '  Owner@DeoDap.com ', password: PASSWORD })).toBe('created');

    const user = (await findUserByEmail('owner@deodap.com'))!;
    expect(user).toMatchObject({ email: 'owner@deodap.com', role: 'admin', isActive: true, mustChangePassword: false, name: 'Admin' });
    expect(user.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword(PASSWORD, user.passwordHash)).toBe(true);

    await closeStore();
    const onDisk = await readFile(path.join(dir, 'users.json'), 'utf8');
    expect(onDisk).toContain('owner@deodap.com');
    expect(onDisk).not.toContain(PASSWORD); // never stored in plain text

    const res = await login('owner@deodap.com', PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'admin', mustChangePassword: false });
  });

  it('never overwrites or resets anyone on later starts, even with different values', async () => {
    const dir = await freshStore();
    await ensureInitialAdmin({ email: 'owner@deodap.com', password: PASSWORD, name: 'Owner' });
    const before = (await findUserByEmail('owner@deodap.com'))!;

    // Restart with the same folder and changed variables.
    await closeStore();
    await openStore(dir);
    expect(await ensureInitialAdmin({ email: 'owner@deodap.com', password: 'Another-password-99' })).toBe('users-exist');
    expect(await ensureInitialAdmin({ email: 'someone@deodap.com', password: 'Another-password-99' })).toBe('users-exist');

    const after = (await findUserByEmail('owner@deodap.com'))!;
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.name).toBe('Owner');
    expect(store.c.users.all()).toHaveLength(1);
    expect((await login('owner@deodap.com', PASSWORD)).status).toBe(200);
    expect((await login('owner@deodap.com', 'Another-password-99')).status).toBe(401);
  });

  it('does nothing when any user already exists, admin or not', async () => {
    await freshStore();
    const viewer = await createUser('viewer');
    expect(await ensureInitialAdmin({ email: 'owner@deodap.com', password: PASSWORD })).toBe('users-exist');
    expect(store.c.users.all().map((u) => u.email)).toEqual([viewer.email]);
  });

  it('does nothing when the variables are not set', async () => {
    await freshStore();
    expect(await ensureInitialAdmin({})).toBe('not-configured');
    expect(store.c.users.all()).toHaveLength(0);
  });

  it('rejects incomplete or unsafe values without creating anyone', async () => {
    await freshStore();
    const cases: [Parameters<typeof ensureInitialAdmin>[0], RegExp][] = [
      [{ email: 'owner@deodap.com' }, /Set both/],
      [{ password: PASSWORD }, /Set both/],
      [{ email: 'not-an-email', password: PASSWORD }, /not a valid email/],
      [{ email: 'owner@deodap.com', password: 'short' }, /at least 10 characters/],
      [{ email: 'owner@deodap.com', password: ` ${PASSWORD}` }, /start or end with a space/],
      [{ email: 'owner@deodap.com', password: 'x'.repeat(201) }, /at most 200/],
    ];
    for (const [cfg, message] of cases) await expect(ensureInitialAdmin(cfg)).rejects.toThrow(message);
    expect(store.c.users.all()).toHaveLength(0);
  });
});
