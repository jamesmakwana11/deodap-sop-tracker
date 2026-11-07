/** Campaign counts: delivery vs Meta status, all statuses, unique IDs, per account and all accounts. */
import { buildCampaignCounts, deliveryState, type DashboardResponse, type DeliveryState } from '@sop/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { fetchCampaignStatusCounts } from '../src/meta/fetchAccount.js';
import { GraphClient } from '../src/meta/graphClient.js';
import { startSync } from '../src/services/syncService.js';
import { closeStore } from '../src/storage/store.js';
import { graphError, installFakeGraph } from './fakeGraph.js';
import { connectFakeMeta, NOW, world } from './fakeMetaWorld.js';
import * as real from './fixtures/deodapRealStatus.js';
import { prepareDb, resetDb, signedIn } from './helpers.js';

const tally = (states: DeliveryState[]) => states.reduce<Record<string, number>>((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});

describe('delivery, on REAL DeoDap data from Meta (7 Nov 2026 13:56 IST)', () => {
  const states = real.activeCampaigns.map((c) =>
    deliveryState(
      c,
      real.activeAdSets.filter((s) => s.campaign_id === c.id),
      real.activeAds.filter((a) => a.campaign_id === c.id),
      real.RECORDED_AT,
    ),
  );

  it('70 campaigns with Meta status Active, of which 45 deliver — the number Ads Manager showed', () => {
    expect(real.activeCampaigns).toHaveLength(70);
    expect(new Set(real.activeCampaigns.map((c) => c.id)).size).toBe(70); // unique IDs
    expect(tally(states)).toEqual({ DELIVERING: 45, NO_ACTIVE_ADS: 17, NO_ACTIVE_AD_SETS: 6, ENDED: 2 });
  });

  it('marks the two ended campaigns: one by campaign stop time, one whose only ad set ended', () => {
    const ended = real.activeCampaigns.filter((_, i) => states[i] === 'ENDED').map((c) => c.id);
    expect(ended.sort()).toEqual(['52546646652153', '52553851323353']);
  });

  it('builds the account and All accounts rows from it', () => {
    const counts = buildCampaignCounts(
      [{ metaAccountId: real.ACCOUNT_ID, name: 'DeoDap', status: 'succeeded', campaignCounts: { total: 70, byEffectiveStatus: { ACTIVE: 70 }, deletedIncluded: true, countedAt: '' } }],
      real.activeCampaigns.map((c, i) => ({ metaCampaignId: c.id, account: { metaAccountId: real.ACCOUNT_ID }, delivery: states[i]! })),
      null,
    );
    expect(counts.accounts[0]).toMatchObject({ audited: 70, active: 70, delivering: 45, reconciled: true, notDelivering: { NO_ACTIVE_ADS: 17, NO_ACTIVE_AD_SETS: 6, ENDED: 2, SCHEDULED: 0, UNKNOWN: 0 } });
    expect(counts.all).toMatchObject({ name: 'All accounts', audited: 70, delivering: 45 });
  });
});

describe('delivery rules', () => {
  const now = new Date('2026-11-07T08:00:00Z');
  it('covers scheduled, unknown and delivering', () => {
    const set = { id: 's', start_time: '2026-11-07T00:00:00Z' };
    expect(deliveryState({}, [set], [{ adset_id: 's' }], now)).toBe('DELIVERING');
    expect(deliveryState({ start_time: '2026-11-10T00:00:00Z' }, [set], [{ adset_id: 's' }], now)).toBe('SCHEDULED');
    expect(deliveryState({}, [{ id: 's', start_time: '2026-11-09T00:00:00Z' }], [{ adset_id: 's' }], now)).toBe('SCHEDULED');
    expect(deliveryState({}, [set], [], now, false)).toBe('UNKNOWN');
    // An active ad under an ended ad set does not deliver.
    expect(deliveryState({}, [{ id: 's', end_time: '2026-11-01T00:00:00Z' }, { id: 't' }], [{ adset_id: 's' }], now)).toBe('NO_ACTIVE_ADS');
  });

  it('counts each campaign ID once and sums All accounts only when every account was counted', () => {
    const counts = buildCampaignCounts(
      [
        { metaAccountId: '1', name: 'DeoDap', status: 'succeeded', campaignCounts: { total: 9, byEffectiveStatus: { ACTIVE: 2, PAUSED: 3, ARCHIVED: 2, DELETED: 1, WITH_ISSUES: 1 }, deletedIncluded: true, countedAt: '' } },
        { metaAccountId: '2', name: 'Dabster', status: 'succeeded', campaignCounts: { total: 4, byEffectiveStatus: { ACTIVE: 1, PAUSED: 3 }, deletedIncluded: true, countedAt: '' } },
      ],
      [
        { metaCampaignId: 'x', account: { metaAccountId: '1' }, delivery: 'DELIVERING' },
        { metaCampaignId: 'x', account: { metaAccountId: '1' }, delivery: 'DELIVERING' }, // duplicate row
        { metaCampaignId: 'y', account: { metaAccountId: '1' }, delivery: 'NO_ACTIVE_ADS' },
        { metaCampaignId: 'z', account: { metaAccountId: '2' }, delivery: 'DELIVERING' },
      ],
      '2026-11-07T08:00:00Z',
    );
    expect(counts.accounts.map((r) => [r.name, r.total, r.active, r.paused, r.archived, r.deleted, r.other, r.audited, r.delivering, r.reconciled])).toEqual([
      ['DeoDap', 9, 2, 3, 2, 1, 1, 2, 1, true],
      ['Dabster', 4, 1, 3, 0, 0, 0, 1, 1, true],
    ]);
    expect(counts.all).toMatchObject({ total: 13, active: 3, paused: 6, archived: 2, deleted: 1, other: 1, audited: 3, delivering: 2, reconciled: true });
    expect(counts.lastSuccessfulSyncAt).toBe('2026-11-07T08:00:00Z');

    const older = buildCampaignCounts([{ metaAccountId: '1', name: 'DeoDap', status: 'succeeded' }], [{ metaCampaignId: 'x', account: { metaAccountId: '1' }, delivery: null }], null);
    expect(older.all).toMatchObject({ total: null, active: null, reconciled: null });
    expect(older.deliveryKnown).toBe(false);
  });
});

describe('sync records the counts (FAKE Meta world)', () => {
  const app = createApp();
  let fake: ReturnType<typeof installFakeGraph>;
  beforeAll(prepareDb);
  beforeEach(async () => {
    await resetDb();
    fake = installFakeGraph(world);
    await connectFakeMeta();
  });
  afterEach(() => fake.uninstall());
  afterAll(() => closeStore());

  it('lists every status in one paged request, counts unique IDs, and reconciles with the audit', async () => {
    const { done } = await startSync({ trigger: 'manual', now: NOW });
    await done;
    const listing = fake.requests.filter((r) => r.path === 'act_1001/campaigns' && (r.params.get('fields') ?? '').includes('configured_status'));
    expect(listing).toHaveLength(2); // two pages
    expect(listing[0]!.params.get('fields')).toBe('id,account_id,name,status,configured_status,effective_status');
    expect(JSON.parse(listing[0]!.params.get('effective_status')!)).toEqual(['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED', 'IN_PROCESS', 'WITH_ISSUES']);

    const { agent } = await signedIn(app, 'viewer');
    const dash = (await agent.get('/api/dashboard')).body as DashboardResponse;
    const one = dash.counts.accounts.find((a) => a.metaAccountId === '1001')!;
    // 9 campaigns although page 2 repeated one; 4 ACTIVE = the 4 audited.
    expect(one).toMatchObject({ total: 9, active: 4, paused: 2, archived: 1, deleted: 1, other: 1, audited: 4, reconciled: true, deletedIncluded: true });
    expect(one.delivering + Object.values(one.notDelivering).reduce((a, b) => a + b, 0)).toBe(4);
    expect(dash.campaigns.every((c) => c.delivery !== null)).toBe(true);
    // The account Meta refused has no counts, so All accounts has no total rather than a wrong one.
    expect(dash.counts.accounts.find((a) => a.metaAccountId === '1002')).toMatchObject({ total: null, audited: 0 });
    expect(dash.counts.all.total).toBeNull();
    expect(dash.counts.all.audited).toBe(4);
    expect(dash.counts.lastSuccessfulSyncAt).toBe(dash.run!.finishedAt);
    // Ratings and SOP results are unchanged: still one audit per campaign with Meta status Active.
    expect(dash.campaigns).toHaveLength(4);
    expect(dash.summary.totals.active).toBe(4);
  });

  it('counts without deleted campaigns when Meta refuses to list them, and says so', async () => {
    fake.uninstall();
    fake = installFakeGraph((r) => {
      if (r.path === 'act_1001/campaigns' && (r.params.get('effective_status') ?? '').includes('DELETED')) {
        return graphError(100, '(#100) Filtering field effective_status with operation in and value DELETED is not supported');
      }
      return world(r);
    });
    const g = new GraphClient({ accessToken: 'x'.repeat(30), version: 'v26.0', maxRetries: 0 });
    const counts = await fetchCampaignStatusCounts(g, '1001', NOW);
    expect(counts).toMatchObject({ total: 8, deletedIncluded: false, byEffectiveStatus: { ACTIVE: 4, PAUSED: 2, ARCHIVED: 1, WITH_ISSUES: 1 } });
  });
});
