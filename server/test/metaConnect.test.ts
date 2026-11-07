/**
 * Connecting Meta and syncing, against a Graph double that enforces permissions and account
 * assignment the way Meta does (test/realisticMeta.ts).
 */
import type { CampaignAudit, MetaStatusResponse, RunListItem } from '@sop/shared';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { GraphClient, MetaApiError } from '../src/meta/graphClient.js';
import { explainMetaError } from '../src/meta/permissions.js';
import { startSync } from '../src/services/syncService.js';
import { upsertConnection } from '../src/repositories/metaRepository.js';
import { encryptSecret } from '../src/security/tokenCrypto.js';
import { closeStore, store } from '../src/storage/store.js';
import { installFakeGraph, type GraphRequest } from './fakeGraph.js';
import { NOW } from './fakeMetaWorld.js';
import { CSRF, prepareDb, resetDb, signedIn } from './helpers.js';
import { realisticMeta, type FakeToken } from './realisticMeta.js';

const app = createApp();
let fake: ReturnType<typeof installFakeGraph> | null = null;
let admin: TestAgent;

/** Real tokens are long; the short names here become e.g. "EAAT000…". */
const tk = (name: string) => `EAA${name}${'0'.repeat(30)}`;
const use = (tokens: Record<string, FakeToken>, opts?: Parameters<typeof realisticMeta>[1]) => {
  fake?.uninstall();
  fake = installFakeGraph(realisticMeta(Object.fromEntries(Object.entries(tokens).map(([k, v]) => [tk(k), v])), opts));
  return fake;
};
const connect = (name: string, adAccountIds?: string[]) =>
  admin.post('/api/meta/connections/token').set(CSRF).send({ accessToken: name.length > 20 ? name : tk(name), ...(adAccountIds ? { adAccountIds } : {}) });
const status = async () => (await admin.get('/api/meta/status')).body as MetaStatusResponse;
const fieldsOf = (r: GraphRequest) => r.params.get('fields') ?? '';

const ADS_READ_ONLY: FakeToken = { type: 'USER', userId: '501', name: 'Ads Reader', scopes: ['ads_read', 'public_profile'], accounts: ['1001'], expiresAt: 1_900_000_000 };

beforeAll(prepareDb);
beforeEach(async () => {
  await resetDb();
  admin = (await signedIn(app, 'admin')).agent;
});
afterEach(() => {
  fake?.uninstall();
  fake = null;
});
afterAll(() => closeStore());

describe('the business_management error from Render', () => {
  it('is what Meta returns when account discovery asks for business{…} without that permission', async () => {
    use({ T: ADS_READ_ONLY });
    const g = new GraphClient({ accessToken: tk('T'), version: 'v26.0', maxRetries: 0 });
    const e = await g.get('me/adaccounts', { fields: 'id,account_id,name,business{name}' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MetaApiError);
    expect((e as MetaApiError).message).toBe('(#100) Requires business_management permission to access the field.');
    expect(explainMetaError(e)).toMatch(/optional business_management permission .* Campaign data does not need it/);
  });

  it('no longer happens: an ads_read-only token connects and no request asks for business fields', async () => {
    const f = use({ T: ADS_READ_ONLY });
    const res = await connect('T');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.accountsFound).toBe(1);
    expect(res.body.report).toMatchObject({ discovered: 1, checked: 1, readable: 1, businessNames: 'not_permitted', discoveryError: null });
    expect(f.requests.filter((r) => /business/.test(fieldsOf(r)))).toHaveLength(0);
    expect(f.requests.every((r) => !r.params.has('method'))).toBe(true); // read-only
  });
});

describe('token validation', () => {
  it('accepts a token with extra permissions and shows exactly what it has', async () => {
    use({
      T: { ...ADS_READ_ONLY, type: 'SYSTEM_USER', expiresAt: 0, scopes: ['ads_management', 'ads_read', 'business_management', 'catalog_management', 'pages_show_list', 'read_insights'] },
    });
    const res = await connect('T');
    expect(res.status).toBe(201);
    expect(res.body.connection).toMatchObject({ tokenType: 'system_user', expiresAt: null, status: 'active' });
    expect(res.body.connection.check).toMatchObject({
      method: 'debug_token',
      type: 'SYSTEM_USER',
      appId: 'test-app-id',
      sameAppAsConfigured: true,
      canReadAds: true,
      granted: ['ads_management', 'ads_read', 'business_management', 'catalog_management', 'pages_show_list', 'read_insights'],
      granularAdAccounts: ['1001'],
    });
    // With business_management, the optional Business name is read too.
    expect(res.body.report.businessNames).toBe('shown');
    const s = await status();
    expect(s.accounts[0]).toMatchObject({ metaAccountId: '1001', name: 'Store One', businessName: 'DeoDap Business', access: { campaigns: 'ok', insights: 'ok' } });
    expect(JSON.stringify(s)).not.toContain(tk('T'));
  });

  it('accepts a token from another Meta app (e.g. Graph API Explorer) without the app secret proof', async () => {
    const f = use({ X: { ...ADS_READ_ONLY, appId: '999888777' } });
    const res = await connect('X');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.connection.check).toMatchObject({ method: 'self_debug', appId: '999888777', sameAppAsConfigured: false });
    expect(res.body.connection.check.warnings.join(' ')).toMatch(/another Meta app/);
    // Every request after the check went without appsecret_proof (a proof for another app is rejected).
    const afterCheck = f.requests.filter((r) => r.path.startsWith('act_') || r.path === 'me/adaccounts');
    expect(afterCheck.length).toBeGreaterThan(0);
    expect(afterCheck.every((r) => !r.params.has('appsecret_proof'))).toBe(true);
  });

  it('rejects tokens that cannot work, saying why', async () => {
    use({
      PAGE: { ...ADS_READ_ONLY, type: 'PAGE' },
      NOADS: { ...ADS_READ_ONLY, scopes: ['public_profile', 'pages_show_list'] },
      EXPIRED: { ...ADS_READ_ONLY, valid: false },
    });
    expect((await connect('PAGE')).body.error).toMatch(/Page access token/);
    const noAds = (await connect('NOADS')).body.error;
    expect(noAds).toMatch(/does not have the ads_read permission/);
    expect(noAds).toMatch(/Permissions on this token: .*pages_show_list/); // lists exactly what it has
    expect(noAds).toMatch(/public_profile/);
    expect((await connect('EXPIRED')).body.error).toMatch(/not valid/);
    expect((await connect('garbage-token-0123456789')).body.error).toMatch(/not valid: Invalid OAuth access token/);
    expect(store.c.metaConnections.all()).toHaveLength(0); // nothing saved
  });
});

describe('ad account discovery and manual IDs', () => {
  it('follows pagination for discovery and test-reads at most 50 accounts', async () => {
    const f = use({ T: { ...ADS_READ_ONLY, accounts: ['1001'] } }, { bulkAccounts: 230 });
    const res = await connect('T');
    expect(res.status).toBe(201);
    expect(res.body.accountsFound).toBe(231);
    expect(f.requests.filter((r) => r.path === 'me/adaccounts' && !/business/.test(fieldsOf(r)))).toHaveLength(3); // 100 + 100 + 31
    expect(res.body.report.checked).toBe(50);
    expect(res.body.report.warnings.join(' ')).toMatch(/50 of 231/);
    expect(store.c.adAccounts.all()).toHaveLength(231);
  });

  it('adds accounts that discovery does not list, and explains IDs the token cannot see', async () => {
    use({ T: { ...ADS_READ_ONLY, accounts: ['1001', '100004'], hiddenAccounts: ['100004'] } });
    const res = await connect('T', ['act_100004', '100005']);
    expect(res.status).toBe(201);
    expect(res.body.report.manual).toEqual([
      { metaAccountId: '100004', ok: true, name: 'Store Four (partner Business)', message: null },
      { metaAccountId: '100005', ok: false, name: null, message: expect.stringMatching(/cannot see ad account 100005.*assign the ad account/) },
    ]);
    const s = await status();
    expect(s.accounts.map((a) => [a.metaAccountId, a.addedManually])).toEqual(
      expect.arrayContaining([['1001', false], ['100004', true]]),
    );
    expect(s.accounts.find((a) => a.metaAccountId === '100005')).toBeUndefined();
  });

  it('refuses to save a token that cannot see any ad account, with the reasons', async () => {
    use({ T: { ...ADS_READ_ONLY, accounts: [] } });
    const res = await connect('T', ['100009']);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot see any ad account/);
    expect(res.body.error).toMatch(/Account 100009: .*cannot see ad account 100009/);
    expect(store.c.metaConnections.all()).toHaveLength(0);
  });

  it('adds an account by ID later, and "check again" shows access per account', async () => {
    use({ T: { ...ADS_READ_ONLY, accounts: ['1001', '100003', '100004'], hiddenAccounts: ['100004'], noInsights: ['100003'] } });
    const { connection } = (await connect('T')).body;
    expect((await admin.post(`/api/meta/connections/${connection.id}/accounts`).set(CSRF).send({ adAccountId: '100005' })).body.error).toMatch(/cannot see ad account 100005/);
    const added = await admin.post(`/api/meta/connections/${connection.id}/accounts`).set(CSRF).send({ adAccountId: 'act_100004' });
    expect(added.status).toBe(201);
    expect(added.body.access).toMatchObject({ campaigns: 'ok', insights: 'ok' });

    const again = await admin.post(`/api/meta/connections/${connection.id}/discover`).set(CSRF);
    expect(again.status).toBe(200);
    expect(again.body.accountsFound).toBe(3);
    const s = await status();
    const three = s.accounts.find((a) => a.metaAccountId === '100003')!;
    expect(three.access).toMatchObject({ campaigns: 'ok', insights: 'denied' });
    expect(three.access!.message).toMatch(/refused access/);
  });
});

describe('sync with real permissions', () => {
  async function connectAndSelect(token: FakeToken, ids: string[]) {
    use({ T: token });
    expect((await connect('T')).status).toBe(201);
    for (const a of store.c.adAccounts.all()) if (ids.includes(a.metaAccountId)) await store.c.adAccounts.update(a.id, { isActive: true });
  }

  it('audits every readable account; refused insights or creative fields never fail the account', async () => {
    await connectAndSelect({ ...ADS_READ_ONLY, accounts: ['1001', '100003', '100004'], noInsights: ['100003'], limitedCreatives: ['100004'] }, ['1001', '100003', '100004']);
    const { done } = await startSync({ trigger: 'manual', now: NOW });
    await done;

    const dash = (await admin.get('/api/dashboard')).body as { campaigns: CampaignAudit[] };
    const run = (await admin.get('/api/runs?limit=1')).body.runs[0] as RunListItem;
    expect(run.status).toBe('succeeded');
    // Real campaign data from the connected accounts appears on the dashboard.
    expect(dash.campaigns.map((c) => c.name)).toEqual(expect.arrayContaining(['101 | AA | Carousel | Sales | 01.10.2026', '100003 | Static | Sales | 01.10.2026', '100004 | Static | Sales | 01.10.2026']));
    expect(dash.campaigns).toHaveLength(6);

    const noInsights = dash.campaigns.find((c) => c.metaCampaignId === '100003-c')!;
    expect(noInsights.rating).toBe('NOT_RATED');
    expect(noInsights.ratingNote).toMatch(/Not checkable: Meta did not allow reading performance insights/);
    const notes = Object.fromEntries(run.accounts.map((a) => [a.name, a.notes.join(' ')]));
    expect(notes['Store Three (no insights)']).toMatch(/Performance insights were not readable/);
    expect(notes['Store Four (partner Business)']).toMatch(/basic fields/);
    expect(notes['Store One']).toBe('');
    // Store One rates normally.
    expect(dash.campaigns.find((c) => c.metaCampaignId === 'c1')!.rating).not.toBe('NOT_RATED');
  });

  it('explains an account the token lost access to, and still audits the others', async () => {
    await connectAndSelect({ ...ADS_READ_ONLY, accounts: ['1001', '100003'] }, ['1001', '100003']);
    use({ T: { ...ADS_READ_ONLY, accounts: ['1001'] } }); // access to 100003 removed in Business Settings
    const { done } = await startSync({ trigger: 'manual', now: NOW });
    await done;
    const run = (await admin.get('/api/runs?limit=1')).body.runs[0] as RunListItem;
    expect(run.status).toBe('partial');
    const lost = run.accounts.find((a) => a.metaAccountId === '100003')!;
    expect(lost.status).toBe('failed');
    expect(lost.error).toMatch(/cannot see ad account 100003.*Business Settings/);
  });

  it('keeps working with connections saved before token checks existed', async () => {
    use({ OLD: { ...ADS_READ_ONLY } });
    const u = store.c.users.all()[0]!;
    const conn = await upsertConnection({ metaUserId: '501', metaUserName: 'Old', tokenType: 'user', tokenCiphertext: encryptSecret(tk('OLD')), scopes: ['ads_read'], expiresAt: null, connectedBy: u.id });
    expect(store.c.metaConnections.get(conn.id)!.useAppSecretProof).toBeUndefined();
    await store.c.adAccounts.insert({ metaAccountId: '1001', name: 'Store One', currency: 'INR', timezone: 'Asia/Kolkata', businessName: null, accountStatus: 1, isActive: true, connectionId: conn.id, isDevData: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never);
    const { done } = await startSync({ trigger: 'manual', now: NOW });
    await done;
    expect((await admin.get('/api/runs?limit=1')).body.runs[0].status).toBe('succeeded');
    // The old behaviour (appsecret_proof on) is kept for the old record.
    expect(fake!.requests.filter((r) => r.path.startsWith('act_1001')).every((r) => r.params.has('appsecret_proof'))).toBe(true);
  });
});
