import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { closeStore, store } from '../src/storage/store.js';
import { createUser, CSRF, prepareDb, resetDb, signedIn, TEST_PASSWORD } from './helpers.js';

const app = createApp();

beforeAll(prepareDb);
beforeEach(resetDb);
afterAll(() => closeStore());

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('s3cret-passphrase');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('s3cret-passphrase', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('sign in and sessions', () => {
  it('signs in, reports the user and signs out', async () => {
    const user = await createUser('viewer');
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').set(CSRF).send({ email: user.email.toUpperCase(), password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toMatch(/sop_session=.*HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const stored = store.c.sessions.all()[0]!;
    expect(cookie).not.toContain(stored.id); // only the hash is stored

    expect((await agent.get('/api/auth/me')).body.user.email).toBe(user.email);
    await agent.post('/api/auth/logout').set(CSRF);
    expect((await agent.get('/api/auth/me')).body.user).toBeNull();
  });

  it('gives the same message for an unknown email and a wrong password', async () => {
    const user = await createUser('viewer');
    const a = await request(app).post('/api/auth/login').set(CSRF).send({ email: 'nobody@test.local', password: 'x' });
    const b = await request(app).post('/api/auth/login').set(CSRF).send({ email: user.email, password: 'x' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x' });
    expect(res.status).toBe(403);
  });

  it('blocks deactivated users immediately', async () => {
    const { agent: admin } = await signedIn(app, 'admin');
    const { agent, user } = await signedIn(app, 'viewer');
    expect((await agent.get('/api/dashboard')).status).toBe(200);
    await admin.patch(`/api/users/${user.id}`).set(CSRF).send({ isActive: false });
    expect((await agent.get('/api/dashboard')).status).toBe(401);
  });
});

describe('temporary passwords', () => {
  it('must be changed before anything else', async () => {
    const user = await createUser('auditor', { mustChangePassword: true });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set(CSRF).send({ email: user.email, password: TEST_PASSWORD });
    expect((await agent.get('/api/dashboard')).status).toBe(403);

    const short = await agent.post('/api/auth/password').set(CSRF).send({ currentPassword: TEST_PASSWORD, newPassword: 'short' });
    expect(short.status).toBe(400);

    const ok = await agent
      .post('/api/auth/password')
      .set(CSRF)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-much-longer-password' });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/dashboard')).status).toBe(200);
  });
});

describe('roles', () => {
  it('requires sign-in for the dashboard', async () => {
    expect((await request(app).get('/api/dashboard')).status).toBe(401);
  });

  it('lets only admins manage users', async () => {
    const { agent: viewer } = await signedIn(app, 'viewer');
    const { agent: auditor } = await signedIn(app, 'auditor');
    expect((await viewer.get('/api/users')).status).toBe(403);
    expect((await auditor.get('/api/users')).status).toBe(403);

    const { agent: admin } = await signedIn(app, 'admin');
    const created = await admin.post('/api/users').set(CSRF).send({ email: 'new@test.local', name: 'New', role: 'viewer' });
    expect(created.status).toBe(201);
    expect(created.body.temporaryPassword).toMatch(/^\w{4}-\w{4}-\w{4}-\w{4}$/);
    expect(created.body.user.mustChangePassword).toBe(true);

    const dup = await admin.post('/api/users').set(CSRF).send({ email: 'NEW@test.local', name: 'Dup', role: 'viewer' });
    expect(dup.status).toBe(409);

    const reset = await admin.post(`/api/users/${created.body.user.id}/reset-password`).set(CSRF);
    expect(reset.body.temporaryPassword).not.toBe(created.body.temporaryPassword);
    const login = await request(app).post('/api/auth/login').set(CSRF).send({ email: 'new@test.local', password: reset.body.temporaryPassword });
    expect(login.status).toBe(200);
  });

  it('keeps at least one active admin', async () => {
    const { agent, user } = await signedIn(app, 'admin');
    const res = await agent.patch(`/api/users/${user.id}`).set(CSRF).send({ role: 'viewer' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one active admin/i);
  });
});
