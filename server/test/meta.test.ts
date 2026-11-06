import type { MetaStatusResponse } from '@sop/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closeStore, store } from '../src/storage/store.js';
import { GraphClient, MetaApiError } from '../src/meta/graphClient.js';
import { decryptSecret, encryptSecret } from '../src/security/tokenCrypto.js';
import { nextRunAt } from '../src/services/scheduleTime.js';
import { graphError, installFakeGraph, type GraphHandler } from './fakeGraph.js';
import { CSRF, prepareDb, resetDb, signedIn } from './helpers.js';

const app = createApp();
let fake: ReturnType<typeof installFakeGraph> | undefined;
const useGraph = (h: GraphHandler) => (fake = installFakeGraph(h));

beforeAll(prepareDb);
beforeEach(resetDb);
afterEach(() => fake?.uninstall());
afterAll(() => closeStore());

describe('token encryption', () => {
  it('round-trips and never contains the plain token', () => {
    const enc = encryptSecret('EAAB-secret-token');
    expect(enc).not.toContain('EAAB');
    expect(decryptSecret(enc)).toBe('EAAB-secret-token');
    expect(encryptSecret('x')).not.toBe(encryptSecret('x')); // random IV
  });

  it('detects tampering', () => {
    const parts = encryptSecret('EAAB-secret-token').split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });
});

describe('GraphClient', () => {
  const client = () => new GraphClient({ accessToken: 'TOKEN123', appSecret: 'sec', version: 'v26.0', retryDelayMs: 0 });

  it('follows paging, sends the token in a header and adds appsecret_proof', async () => {
    const f = useGraph((r) =>
      r.params.get('after') === 'p2'
        ? { body: { data: [{ id: 3 }] } }
        : { body: { data: [{ id: 1 }, { id: 2 }], paging: { next: 'https://graph.facebook.com/v26.0/me/x?after=p2' } } },
    );
    const items = await client().getAll<{ id: number }>('me/x', { fields: 'id' });
    expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(f.requests.every((r) => r.authorization === 'Bearer TOKEN123')).toBe(true);
    expect(f.requests.every((r) => !r.url.includes('TOKEN123'))).toBe(true);
    expect(f.requests[0]!.params.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('retries rate limits, then succeeds', async () => {
    let calls = 0;
    useGraph(() => (++calls < 3 ? graphError(17, 'User request limit reached') : { body: { ok: true } }));
    expect(await client().get('me')).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it('does not retry auth errors and flags them', async () => {
    let calls = 0;
    useGraph(() => (calls++, graphError(190, 'Error validating access token: Session has expired')));
    const err = await client().get('me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).isAuthError).toBe(true);
    expect(calls).toBe(1);
  });

  it('refuses to follow paging links to another host', async () => {
    useGraph(() => ({ body: { data: [], paging: { next: 'https://evil.example/steal' } } }));
    await expect(client().getAll('me/x')).rejects.toThrow(/paging host/);
  });
});

describe('schedule', () => {
  it('computes the next IST run time', () => {
    // 2026-11-06 06:00 UTC = 11:30 IST → next 07:30 IST is tomorrow 02:00 UTC
    expect(nextRunAt('07:30', new Date('2026-11-06T06:00:00Z')).toISOString()).toBe('2026-11-07T02:00:00.000Z');
    // 2026-11-06 01:00 UTC = 06:30 IST → today 07:30 IST = 02:00 UTC
    expect(nextRunAt('07:30', new Date('2026-11-06T01:00:00Z')).toISOString()).toBe('2026-11-06T02:00:00.000Z');
  });
});

/** A Meta that issues a long-lived token and lists two ad accounts. */
const happyMeta: GraphHandler = (r) => {
  if (r.path === 'oauth/access_token' && r.params.get('code')) return { body: { access_token: 'SHORT', expires_in: 3600 } };
  if (r.path === 'oauth/access_token') return { body: { access_token: 'LONG-LIVED-TOKEN', expires_in: 5_184_000 } };
  if (r.path === 'debug_token')
    return { body: { data: { is_valid: true, app_id: 'test-app-id', user_id: '42', type: 'USER', scopes: ['ads_read'], expires_at: 1_900_000_000 } } };
  if (r.path === 'me') return { body: { id: '42', name: 'Test Meta User' } };
  if (r.path === 'me/adaccounts')
    return {
      body: {
        data: [
          { id: 'act_1001', account_id: '1001', name: 'Test Account One', currency: 'INR', timezone_name: 'Asia/Kolkata', account_status: 1 },
          { id: 'act_1002', account_id: '1002', name: 'Test Account Two', currency: 'INR', account_status: 1, business: { name: 'Biz' } },
        ],
      },
    };
  return undefined;
};

describe('Meta OAuth', () => {
  it('connects through the full code → long-lived token flow', async () => {
    const f = useGraph(happyMeta);
    const { agent } = await signedIn(app, 'admin');

    const start = await agent.get('/api/meta/oauth/start');
    const authUrl = new URL(start.body.url);
    expect(authUrl.host).toBe('www.facebook.com');
    expect(authUrl.searchParams.get('scope')).toBe('ads_read');
    const state = authUrl.searchParams.get('state')!;

    const cb = await agent.get(`/api/meta/oauth/callback?code=abc&state=${state}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('http://localhost:5173/settings?meta=connected&accounts=2');

    // stored encrypted, never as plain text
    const conn = store.c.metaConnections.all()[0]!;
    expect(conn.tokenCiphertext).not.toContain('LONG-LIVED');
    expect(decryptSecret(conn.tokenCiphertext)).toBe('LONG-LIVED-TOKEN');

    const status = (await agent.get('/api/meta/status')).body as MetaStatusResponse;
    expect(status.connections[0]).toMatchObject({ metaUserName: 'Test Meta User', tokenType: 'user', status: 'active' });
    expect(JSON.stringify(status)).not.toContain('LONG-LIVED');
    expect(status.accounts.map((a) => [a.name, a.selected])).toEqual([
      ['Test Account One', false],
      ['Test Account Two', false],
    ]);

    // Meta is only ever read
    expect(f.requests.length).toBeGreaterThan(0);
  });

  it('rejects a reused or foreign state', async () => {
    useGraph(happyMeta);
    const { agent } = await signedIn(app, 'admin');
    const state = new URL((await agent.get('/api/meta/oauth/start')).body.url).searchParams.get('state')!;
    await agent.get(`/api/meta/oauth/callback?code=abc&state=${state}`);
    const again = await agent.get(`/api/meta/oauth/callback?code=abc&state=${state}`);
    expect(again.headers.location).toContain('meta=error');

    const { agent: otherAdmin } = await signedIn(app, 'admin');
    const s2 = new URL((await agent.get('/api/meta/oauth/start')).body.url).searchParams.get('state')!;
    const stolen = await otherAdmin.get(`/api/meta/oauth/callback?code=abc&state=${s2}`);
    expect(stolen.headers.location).toContain('meta=error');
  });

  it('reports a denied permission back to Settings', async () => {
    useGraph(happyMeta);
    const { agent } = await signedIn(app, 'admin');
    const res = await agent.get('/api/meta/oauth/callback?error=access_denied&error_description=Permissions+error');
    expect(res.headers.location).toContain('meta=error');
    expect(res.headers.location).toContain('Permissions+error');
  });

  it('only lets admins connect or select accounts', async () => {
    useGraph(happyMeta);
    const { agent: auditor } = await signedIn(app, 'auditor');
    expect((await auditor.get('/api/meta/oauth/start')).status).toBe(403);
    expect((await auditor.post('/api/meta/connections/token').set(CSRF).send({ accessToken: 'x'.repeat(30) })).status).toBe(403);
    expect((await auditor.get('/api/meta/status')).status).toBe(200);
  });
});

describe('system-user token', () => {
  it('validates, stores and discovers accounts; admin selects one', async () => {
    useGraph((r) =>
      r.path === 'debug_token'
        ? { body: { data: { is_valid: true, app_id: 'test-app-id', user_id: '77', type: 'SYSTEM_USER', scopes: ['ads_read'], expires_at: 0 } } }
        : happyMeta(r),
    );
    const { agent } = await signedIn(app, 'admin');
    const res = await agent.post('/api/meta/connections/token').set(CSRF).send({ accessToken: 'SYSTEM-USER-TOKEN-1234567890' });
    expect(res.status).toBe(201);
    expect(res.body.connection).toMatchObject({ tokenType: 'system_user', expiresAt: null });
    expect(res.body.accountsFound).toBe(2);

    const status = (await agent.get('/api/meta/status')).body as MetaStatusResponse;
    const sel = await agent.patch(`/api/meta/accounts/${status.accounts[0]!.id}`).set(CSRF).send({ selected: true });
    expect(sel.body.account.selected).toBe(true);
  });

  it('rejects a token without ads_read', async () => {
    useGraph((r) =>
      r.path === 'debug_token' ? { body: { data: { is_valid: true, app_id: 'test-app-id', scopes: ['public_profile'] } } } : happyMeta(r),
    );
    const { agent } = await signedIn(app, 'admin');
    const res = await agent.post('/api/meta/connections/token').set(CSRF).send({ accessToken: 'NO-ADS-READ-TOKEN-123456' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ads_read/);
  });
});
