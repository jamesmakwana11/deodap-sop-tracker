/** Sync reliability: Meta rate limits, usage throttling, no overlapping runs, progress, one record per attempt, restarts. */
import type { DashboardResponse, SyncStatusResponse } from '@sop/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { GraphClient, setGraphSleep } from '../src/meta/graphClient.js';
import { upsertConnection, upsertDiscoveredAccount } from '../src/repositories/metaRepository.js';
import { encryptSecret } from '../src/security/tokenCrypto.js';
import { closeInterruptedRuns, startSync } from '../src/services/syncService.js';
import { closeStore, store } from '../src/storage/store.js';
import { graphError, installFakeGraph, type GraphHandler } from './fakeGraph.js';
import { connectFakeMeta, NOW, world } from './fakeMetaWorld.js';
import { createUser, CSRF, prepareDb, resetDb, signedIn } from './helpers.js';
import { realisticMeta } from './realisticMeta.js';
import { graphWaits } from './setup.js';

const app = createApp();
let fake: ReturnType<typeof installFakeGraph> | undefined;
const useGraph = (h: GraphHandler) => (fake = installFakeGraph(h));

beforeAll(prepareDb);
beforeEach(resetDb);
afterEach(() => {
  fake?.uninstall();
  fake = undefined;
});
afterAll(() => closeStore());

const RATE_LIMIT = graphError(80004, 'There have been too many calls to this ad-account. Wait a bit and try again.');
const usageHeader = (callCount: number, regainMinutes = 0) => ({
  'x-business-use-case-usage': JSON.stringify({ '1001': [{ type: 'ads_management', call_count: callCount, total_cputime: 5, total_time: 5, estimated_time_to_regain_access: regainMinutes }] }),
});
/** The fake world with only account 1001 selected (1002 is refused by design in that world). */
async function onlyAccount1001() {
  await connectFakeMeta();
  const second = store.c.adAccounts.all().find((a) => a.metaAccountId === '1002')!;
  await store.c.adAccounts.update(second.id, { isActive: false });
}
const isAuditRead = (r: { path: string; params: URLSearchParams }) => r.path === 'act_1001/campaigns' && !(r.params.get('fields') ?? '').includes('configured_status');
const runs = () => store.c.auditRuns.all();

describe('Meta rate limits', () => {
  it('backs off exponentially (honouring Meta’s regain estimate), then completes as one successful run', async () => {
    await onlyAccount1001();
    let refused = 0;
    useGraph((r) => {
      if (isAuditRead(r) && refused < 2) {
        refused++;
        return { ...RATE_LIMIT, headers: refused === 1 ? usageHeader(100, 1) : {} };
      }
      return world(r);
    });
    const { done } = await startSync({ trigger: 'manual', now: NOW });
    await done;
    // 1st wait: Meta said 1 minute (longer than the 15 s base); 2nd: 15 s · 2.
    expect(graphWaits).toEqual([60_000, 30_000]);
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({ status: 'succeeded', error: null });
  });

  it('gives up after 6 retries, names the account, and never reports the run as successful', async () => {
    await connectFakeMeta();
    const acct = store.c.adAccounts.all().find((a) => a.metaAccountId === '1002')!;
    await store.c.adAccounts.update(acct.id, { name: 'Dabster' });
    useGraph((r) => (r.path.startsWith('act_1002') ? RATE_LIMIT : world(r)));
    const { done } = await startSync({ trigger: 'manual', now: NOW });
    await done;
    expect(graphWaits).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 300_000]);
    expect(runs()).toHaveLength(1);
    const run = runs()[0]!;
    expect(run.status).toBe('partial');
    expect(run.error).toMatch(/^Dabster: .*rate limit|^Dabster: .*too many calls/i);
    const one = store.c.adAccounts.all().find((a) => a.metaAccountId === '1001')!;
    expect(run.accounts.find((a) => a.adAccountId === acct.id)).toMatchObject({ status: 'failed' });
    expect(run.accounts.find((a) => a.adAccountId === one.id)).toMatchObject({ status: 'succeeded' });

    const { agent } = await signedIn(app, 'viewer');
    const status = (await agent.get('/api/sync/status')).body as SyncStatusResponse;
    expect(status.lastFinished).toMatchObject({ status: 'partial' });
  });

  it('fails the run (not partial, not succeeded) when every account is rate limited', async () => {
    await onlyAccount1001();
    useGraph((r) => (r.path.startsWith('act_1001') ? RATE_LIMIT : world(r)));
    const { done } = await startSync({ trigger: 'manual', now: NOW });
    await done;
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({ status: 'failed' });
    expect(runs()[0]!.error).toMatch(/still rate limited after 6 retries/);
  });

  it('slows down before Meta’s limit using the usage headers', async () => {
    let n = 0;
    useGraph(() => {
      n++;
      if (n === 1) return { body: { ok: 1 }, headers: usageHeader(80) };
      if (n === 2) return { body: { ok: 2 }, headers: usageHeader(95, 2) };
      return { body: { ok: 3 } };
    });
    const g = new GraphClient({ accessToken: 'x'.repeat(30), version: 'v26.0' });
    await g.get('a');
    expect(graphWaits).toEqual([]);
    await g.get('b'); // 80 % → short pause
    expect(graphWaits).toEqual([2_000]);
    await g.get('c'); // 95 % with 2 min to regain → capped 60 s pause
    expect(graphWaits).toEqual([2_000, 60_000]);
  });
});

describe('one sync at a time, one record per attempt', () => {
  it('refuses a second refresh while one runs, shows progress, and keeps a single record', async () => {
    await onlyAccount1001();
    // Hold the run inside a rate-limit wait so it is observably in progress.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let signalWaiting!: () => void;
    const waiting = new Promise<void>((r) => (signalWaiting = r));
    setGraphSleep(async () => {
      signalWaiting();
      await held;
    });
    let refused = false;
    useGraph((r) => (isAuditRead(r) && !refused ? ((refused = true), RATE_LIMIT) : world(r)));

    const { agent } = await signedIn(app, 'admin');
    expect((await agent.post('/api/sync').set(CSRF)).status).toBe(202);
    await waiting;

    const second = await agent.post('/api/sync').set(CSRF);
    expect(second.status).toBe(409);
    expect(second.body.error ?? second.body.message).toMatch(/already running/i);

    const status = (await agent.get('/api/sync/status')).body as SyncStatusResponse;
    expect(status.running).not.toBeNull();
    expect(status.progress).toMatchObject({ accountIndex: 1, accountCount: 1, accountName: 'Account 1001' });
    expect(Date.parse(status.progress!.waitingUntil!) - Date.now()).toBeGreaterThan(10_000); // the 15 s wait, for the countdown
    expect(status.progress!.waitingMessage).toBe('Meta rate limit on Account 1001: waiting before retry 1 of 6');
    expect(runs()).toHaveLength(1);

    release();
    for (let i = 0; i < 100 && runs()[0]!.status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    const after = (await agent.get('/api/sync/status')).body as SyncStatusResponse;
    expect(after.running).toBeNull();
    expect(after.progress).toBeNull();
    expect(after.lastFinished).toMatchObject({ status: 'succeeded' });
    expect(runs()).toHaveLength(1);
    // Refresh is possible again once the run finished.
    const third = await startSync({ trigger: 'manual', now: NOW });
    await third.done;
    expect(runs().map((r) => r.status).sort()).toEqual(['succeeded', 'succeeded']);
  });

  it('resumes a run cut off by a restart under the same record; a second cut-off fails it', async () => {
    await onlyAccount1001();
    useGraph(world);
    const { runId, done } = await startSync({ trigger: 'manual', now: NOW });
    await done;
    // Simulate a restart mid-run: the record is still "running" with partial data.
    await store.c.auditRuns.update(runId, { status: 'running', finishedAt: null });
    expect(await closeInterruptedRuns()).toBe(1);
    for (let i = 0; i < 100 && store.c.auditRuns.get(runId)!.status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(runs()).toHaveLength(1);
    expect(store.c.auditRuns.get(runId)).toMatchObject({ status: 'succeeded' });
    expect(store.c.auditRuns.get(runId)!.resumedAt).toBeTruthy();
    expect(store.c.campaignIndex.filter((e) => e.runId === runId)).toHaveLength(4); // not doubled

    await store.c.auditRuns.update(runId, { status: 'running', finishedAt: null });
    await closeInterruptedRuns();
    expect(runs()).toHaveLength(1);
    expect(store.c.auditRuns.get(runId)).toMatchObject({ status: 'failed', error: expect.stringMatching(/Stopped twice by a server restart/) });
  });
});

describe('several accounts', () => {
  it('adds up strict Active campaigns across the selected accounts', async () => {
    const token = 'MULTI-ACCOUNT-TOKEN-0123456789';
    useGraph(realisticMeta({ [token]: { type: 'SYSTEM_USER', userId: '7', name: 'Auditor', scopes: ['ads_read'], accounts: ['1001', '100003'] } }));
    const admin = await createUser('admin');
    const conn = await upsertConnection({ metaUserId: '7', metaUserName: 'Auditor', tokenType: 'system_user', tokenCiphertext: encryptSecret(token), scopes: ['ads_read'], expiresAt: null, connectedBy: admin.id });
    for (const [id, name] of [['1001', 'DeoDap'], ['100003', 'Dabster']]) {
      await upsertDiscoveredAccount({ metaAccountId: id!, name: name!, currency: 'INR', timezone: 'Asia/Kolkata', businessName: null, accountStatus: 1, connectionId: conn.id });
    }
    for (const a of store.c.adAccounts.all()) await store.c.adAccounts.update(a.id, { isActive: true });

    const { done } = await startSync({ trigger: 'manual', now: NOW });
    await done;
    expect(runs()[0]).toMatchObject({ status: 'succeeded' });
    const { agent } = await signedIn(app, 'viewer');
    const dash = (await agent.get('/api/dashboard')).body as DashboardResponse;
    const rows = Object.fromEntries(dash.counts.accounts.map((a) => [a.name, a]));
    expect(rows.DeoDap).toMatchObject({ total: 9, metaActive: 4, active: 1 });
    expect(rows.Dabster).toMatchObject({ total: 1, metaActive: 1, active: 1 });
    expect(dash.counts.all).toMatchObject({ name: 'All accounts', total: 10, metaActive: 5, audited: 5, active: 2 });
    expect(dash.counts.activeKnown).toBe(true);
    expect(dash.summary.totals.active).toBe(2);
  });
});

describe('interactive calls', () => {
  it('retry a rate limit only once, so nobody waits minutes for a page', async () => {
    let calls = 0;
    useGraph(() => (calls++, RATE_LIMIT));
    const g = new GraphClient({ accessToken: 'x'.repeat(30), version: 'v26.0', rateLimitRetries: 1 });
    await expect(g.get('me')).rejects.toThrow(/still rate limited after 1 retries/);
    expect(calls).toBe(2);
    expect(graphWaits).toEqual([15_000]);
  });
});
