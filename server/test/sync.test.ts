/**
 * End-to-end sync against a FAKE Meta (test double). These records exist only inside the
 * test database and verify the pipeline: Graph reads → SOP checks → ratings → storage.
 */
import type { DashboardResponse, RunListItem } from '@sop/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closeStore, store } from '../src/storage/store.js';
import { putSetting } from '../src/repositories/metaRepository.js';
import { tick } from '../src/services/scheduler.js';
import { SYNC_TIME_SETTING } from '../src/services/scheduleTime.js';
import { startSync } from '../src/services/syncService.js';
import { graphError, installFakeGraph } from './fakeGraph.js';
import { connectFakeMeta, NOW, world } from './fakeMetaWorld.js';
import { CSRF, prepareDb, resetDb, signedIn } from './helpers.js';

const app = createApp();
let fake: ReturnType<typeof installFakeGraph>;

beforeAll(prepareDb);
beforeEach(async () => {
  await resetDb();
  fake = installFakeGraph(world);
});
afterEach(() => fake.uninstall());
afterAll(() => closeStore());

describe('sync', () => {
  it('audits every active campaign and records a partial run when one account fails', async () => {
    await connectFakeMeta();
    const { runId, done } = await startSync({ trigger: 'manual', now: NOW });
    await done;

    const { agent } = await signedIn(app, 'viewer');
    const run = (await agent.get(`/api/runs/${runId}`)).body.run as RunListItem;
    expect(run.status).toBe('partial');
    expect(run.periodStart).toBe('2026-10-30');
    expect(run.periodEnd).toBe('2026-11-05');
    expect(run.accounts.find((a) => a.metaAccountId === '1002')?.error).toMatch(/Meta refused access to ad account 1002: .*assigned to the ad account in Business Settings/);

    const dash = (await agent.get('/api/dashboard')).body as DashboardResponse;
    expect(dash.run?.source).toBe('meta');
    const byId = new Map(dash.campaigns.map((c) => [c.metaCampaignId, c]));

    const c1 = byId.get('c1')!;
    expect(c1).toMatchObject({ rating: 'GOOD', ratingIndicative: false, spend7d: 20000, objective: 'Sales' });
    expect(c1.mainMetric).toEqual({ kind: 'roas', value: 7 });
    expect(c1.compliance.status).toBe('FOLLOWING');

    const c2 = byId.get('c2')!;
    expect(c2.rating).toBe('AVERAGE'); // ₹3,000 / 1,000,000 reached × 1,000 = ₹3.00
    expect(c2.compliance.status).toBe('NOT_FOLLOWING');
    const failed = c2.checks.filter((c) => c.outcome === 'FAIL').map((c) => c.key).sort();
    expect(failed).toEqual(['creative_complete', 'frequency', 'min_budget', 'naming', 'placements']);

    expect(byId.get('c3')).toMatchObject({ rating: 'NOT_RATED' }); // a single Leads campaign cannot be ranked
    expect(byId.get('c4')).toMatchObject({ rating: 'NOT_RATED', spend7d: 0 });
    expect(byId.get('c4')!.checks.find((c) => c.key === 'bid_strategy')?.outcome).toBe('NOT_CHECKABLE');

    const audits = await store.readRunAudits(runId);
    expect(audits.flatMap((a) => a.adSets)).toHaveLength(4);
    const ads = audits.flatMap((a) => a.ads).sort((a, b) => a.name.localeCompare(b.name));
    expect(ads[0]).toMatchObject({ primaryText: 'Shop now', ctaType: 'SHOP_NOW' });

    // A permission error on one account must not disable the token for the others.
    expect(store.c.metaConnections.all()[0]!.status).toBe('active');
  });

  it('marks the connection invalid when Meta says the token expired', async () => {
    fake.uninstall();
    fake = installFakeGraph((r) => (r.path.endsWith('/campaigns') ? graphError(190, 'Session has expired', 400) : world(r)));
    await connectFakeMeta();
    const { runId, done } = await startSync({ trigger: 'manual', now: NOW });
    await done;
    expect(store.c.metaConnections.all()[0]).toMatchObject({ status: 'invalid', lastError: 'Session has expired' });
    expect(store.c.auditRuns.get(runId)!.status).toBe('failed');
  });

  it('refuses a second run while one is in progress', async () => {
    await connectFakeMeta();
    const first = await startSync({ trigger: 'manual', now: NOW });
    await expect(startSync({ trigger: 'manual', now: NOW })).rejects.toThrow(/already running/);
    await first.done;
  });

  it('requires at least one selected account and the auditor role', async () => {
    const { agent: auditor } = await signedIn(app, 'auditor');
    const none = await auditor.post('/api/sync').set(CSRF);
    expect(none.status).toBe(400);
    const { agent: viewer } = await signedIn(app, 'viewer');
    expect((await viewer.post('/api/sync').set(CSRF)).status).toBe(403);
  });

  it('manual refresh via the API returns 202 and the status shows the result', async () => {
    await connectFakeMeta();
    const { agent } = await signedIn(app, 'auditor');
    const res = await agent.post('/api/sync').set(CSRF);
    expect(res.status).toBe(202);
    for (let i = 0; i < 50; i++) {
      const s = (await agent.get('/api/sync/status')).body;
      if (!s.running) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const status = (await agent.get('/api/sync/status')).body;
    expect(status.lastFinished.id).toBe(res.body.runId);
    expect(status.lastFinished.triggeredBy).toMatch(/auditor/);
  });
});

describe('daily scheduler', () => {
  it('runs once per day after the scheduled IST time and catches up after downtime', async () => {
    await connectFakeMeta();
    await putSetting(SYNC_TIME_SETTING, { time: '07:30' }, null);
    expect(await tick(NOW)).toBe('ran'); // 08:30 IST, nothing yet today
    expect(await tick(new Date(NOW.getTime() + 60_000))).toBe('idle');
    expect(store.c.auditRuns.all().map((r) => r.trigger)).toEqual(['scheduled']);
  });

  it('does nothing when the daily sync is switched off', async () => {
    await connectFakeMeta();
    await putSetting(SYNC_TIME_SETTING, { time: null }, null);
    expect(await tick(NOW)).toBe('idle');
  });
});
