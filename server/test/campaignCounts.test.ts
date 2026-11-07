/** Strict Active campaigns (campaign, all ad sets and all ads Active), all-status totals, per account and All accounts. */
import { buildCampaignCounts, deliveryState, type DashboardResponse, type DeliveryState } from '@sop/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { explainMetaError } from '../src/meta/permissions.js';
import { GraphClient, MetaApiError } from '../src/meta/graphClient.js';
import { startSync } from '../src/services/syncService.js';
import { closeStore, store } from '../src/storage/store.js';
import { DELETED_REFUSED, graphError, installFakeGraph } from './fakeGraph.js';
import { connectFakeMeta, NOW, world } from './fakeMetaWorld.js';
import * as real from './fixtures/deodapRealStatus.js';
import { prepareDb, resetDb, signedIn } from './helpers.js';

const tally = (states: DeliveryState[]) => states.reduce<Record<string, number>>((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});

describe('strict Active, on REAL DeoDap data from Meta (7 Nov 2026)', () => {
  const states = real.activeCampaigns.map((c) =>
    deliveryState(
      c,
      [
        ...real.activeAdSets.filter((s) => s.campaign_id === c.id).map((s) => ({ ...s, effective_status: 'ACTIVE' })),
        ...real.inactiveAdSetsOfDelivering.filter((s) => s.campaign_id === c.id),
      ],
      [
        ...real.activeAds.filter((a) => a.campaign_id === c.id).map((a) => ({ ...a, effective_status: 'ACTIVE' })),
        ...real.inactiveAdsOfDelivering.filter((a) => a.campaign_id === c.id),
      ],
      real.RECORDED_AT,
    ),
  );
  const byId = new Map(real.activeCampaigns.map((c, i) => [c.id, states[i]!]));

  it('33 of the 70 campaigns with status Active have every ad set and ad Active', () => {
    expect(new Set(real.activeCampaigns.map((c) => c.id)).size).toBe(70); // unique campaign IDs
    expect(states.filter((s) => s === 'ACTIVE')).toHaveLength(33);
    // Every Active one is among the 45 that Ads Manager showed as delivering.
    expect(real.activeCampaigns.filter((c) => byId.get(c.id) === 'ACTIVE').every((c) => real.deliveringCampaignIds.has(c.id))).toBe(true);
  });

  it('excludes 12 of the 45 delivering ones: 8 with a paused/archived ad set, 4 with a paused, archived, in-process or in-review ad', () => {
    const delivering = [...real.deliveringCampaignIds].map((id) => byId.get(id)!);
    expect(tally(delivering)).toEqual({ ACTIVE: 33, HAS_INACTIVE_AD_SETS: 8, HAS_INACTIVE_ADS: 4 });
    expect(byId.get('52554993552953')).toBe('HAS_INACTIVE_ADS'); // one ad IN_PROCESS
    expect(byId.get('52547111991953')).toBe('HAS_INACTIVE_AD_SETS'); // five paused ad sets (and an ad in review)
  });

  it('builds the DeoDap row and All accounts from it', () => {
    const counts = buildCampaignCounts(
      [{ metaAccountId: real.ACCOUNT_ID, name: 'DeoDap', status: 'succeeded', campaignCounts: { total: 70, byEffectiveStatus: { ACTIVE: 70 }, countedAt: '' } }],
      real.activeCampaigns.map((c, i) => ({ metaCampaignId: c.id, account: { metaAccountId: real.ACCOUNT_ID }, delivery: states[i]! })),
      null,
    );
    expect(counts.accounts[0]).toMatchObject({ audited: 70, metaActive: 70, active: 33, reconciled: true });
    expect(counts.all).toMatchObject({ name: 'All accounts', audited: 70, active: 33 });
    expect(counts.activeKnown).toBe(true);
  });
});

describe('strict rule, every combination', () => {
  const now = new Date('2026-11-07T08:00:00Z');
  const set = (id: string, effective_status = 'ACTIVE', extra = {}) => ({ id, effective_status, ...extra });
  const ad = (adset_id: string, effective_status = 'ACTIVE') => ({ adset_id, effective_status });

  it.each([
    ['all active', [set('s')], [ad('s'), ad('s')], 'ACTIVE'],
    ['one ad set paused', [set('s'), set('t', 'PAUSED')], [ad('s')], 'HAS_INACTIVE_AD_SETS'],
    ['one ad set archived', [set('s'), set('t', 'ARCHIVED')], [ad('s')], 'HAS_INACTIVE_AD_SETS'],
    ['one ad set deleted', [set('s'), set('t', 'DELETED')], [ad('s')], 'HAS_INACTIVE_AD_SETS'],
    ['one ad paused', [set('s')], [ad('s'), ad('s', 'PAUSED')], 'HAS_INACTIVE_ADS'],
    ['one ad deleted', [set('s')], [ad('s'), ad('s', 'DELETED')], 'HAS_INACTIVE_ADS'],
    ['one ad in review', [set('s')], [ad('s'), ad('s', 'PENDING_REVIEW')], 'HAS_INACTIVE_ADS'],
    ['one ad disapproved', [set('s')], [ad('s'), ad('s', 'DISAPPROVED')], 'HAS_INACTIVE_ADS'],
    ['ad set paused, so its ads are ADSET_PAUSED', [set('s'), set('t', 'PAUSED')], [ad('s'), ad('t', 'ADSET_PAUSED')], 'HAS_INACTIVE_AD_SETS'],
    ['no ad sets', [], [], 'NO_ACTIVE_AD_SETS'],
    ['no ads', [set('s')], [], 'NO_ACTIVE_ADS'],
    ['ad set ended', [set('s', 'ACTIVE', { end_time: '2026-11-01T00:00:00Z' })], [ad('s')], 'ENDED'],
    ['not started yet', [set('s', 'ACTIVE', { start_time: '2026-11-09T00:00:00Z' })], [ad('s')], 'SCHEDULED'],
  ])('%s → %s', (_name, adSets, ads, expected) => {
    expect(deliveryState({}, adSets, ads, now)).toBe(expected);
  });

  it('never trusts the campaign status alone: unknown children are not Active', () => {
    expect(deliveryState({}, [set('s')], [ad('s')], now, false)).toBe('UNKNOWN');
    expect(deliveryState({ stop_time: '2026-11-01T00:00:00Z' }, [set('s')], [ad('s')], now)).toBe('ENDED');
  });

  it('counts each campaign ID once, per account and All accounts, never counts deleted ones, and treats older audits as not checked', () => {
    const counts = buildCampaignCounts(
      [
        // An audit stored before deleted campaigns were dropped: its 1 deleted campaign is not counted.
        { metaAccountId: '1', name: 'DeoDap', status: 'succeeded', campaignCounts: { total: 9, byEffectiveStatus: { ACTIVE: 2, PAUSED: 3, ARCHIVED: 2, DELETED: 1, WITH_ISSUES: 1 }, deletedIncluded: true, countedAt: '' } },
        { metaAccountId: '2', name: 'Dabster', status: 'succeeded', campaignCounts: { total: 4, byEffectiveStatus: { ACTIVE: 1, PAUSED: 3 }, countedAt: '' } },
      ],
      [
        { metaCampaignId: 'x', account: { metaAccountId: '1' }, delivery: 'ACTIVE' },
        { metaCampaignId: 'x', account: { metaAccountId: '1' }, delivery: 'ACTIVE' }, // duplicate row
        { metaCampaignId: 'y', account: { metaAccountId: '1' }, delivery: 'HAS_INACTIVE_ADS' },
        { metaCampaignId: 'z', account: { metaAccountId: '2' }, delivery: 'ACTIVE' },
      ],
      '2026-11-07T08:00:00Z',
    );
    expect(counts.accounts.map((r) => [r.name, r.total, r.metaActive, r.paused, r.archived, r.other, r.audited, r.active, r.reconciled])).toEqual([
      ['DeoDap', 8, 2, 3, 2, 1, 2, 1, true],
      ['Dabster', 4, 1, 3, 0, 0, 1, 1, true],
    ]);
    expect(counts.all).toMatchObject({ total: 12, metaActive: 3, paused: 6, archived: 2, other: 1, audited: 3, active: 2, reconciled: true });
    expect(counts.all.excluded.HAS_INACTIVE_ADS).toBe(1);

    // An audit made with the earlier, looser rule: no Active count until the next refresh.
    const older = buildCampaignCounts([{ metaAccountId: '1', name: 'DeoDap', status: 'succeeded' }], [{ metaCampaignId: 'x', account: { metaAccountId: '1' }, delivery: 'DELIVERING' }], null);
    expect(older.activeKnown).toBe(false);
    expect(older.all).toMatchObject({ total: null, active: 0, reconciled: null });
  });
});

describe('sync (FAKE Meta world)', () => {
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

  it('reads ad sets and inactive ads only for the active campaigns, and counts strictly', async () => {
    const { done } = await startSync({ trigger: 'manual', now: NOW });
    await done;
    const adSetReads = fake.requests.filter((r) => r.path === 'act_1001/adsets');
    expect(adSetReads).toHaveLength(1);
    expect(JSON.parse(adSetReads[0]!.params.get('filtering')!)).toEqual([{ field: 'campaign.id', operator: 'IN', value: ['c1', 'c2', 'c3', 'c4'] }]);
    expect(JSON.parse(adSetReads[0]!.params.get('effective_status')!)).toEqual(expect.arrayContaining(['ACTIVE', 'PAUSED', 'ARCHIVED', 'CAMPAIGN_PAUSED']));
    // Meta refuses DELETED on these edges (100/1815001): never asked for, on any campaigns / adsets / ads request.
    const collection = fake.requests.filter((r) => /^act_\d+\/(campaigns|adsets|ads)$/.test(r.path));
    expect(collection.length).toBeGreaterThan(3);
    for (const r of collection) expect(`${r.params.get('effective_status')} ${r.params.get('filtering')}`).not.toContain('DELETED');
    expect(store.c.auditRuns.all()[0]!.accounts.find((a) => a.status === 'succeeded')?.notes ?? []).toEqual([]);

    const { agent } = await signedIn(app, 'viewer');
    const dash = (await agent.get('/api/dashboard')).body as DashboardResponse;
    const state = Object.fromEntries(dash.campaigns.map((c) => [c.metaCampaignId, c.delivery]));
    expect(state).toEqual({ c1: 'ACTIVE', c2: 'HAS_INACTIVE_AD_SETS', c3: 'NO_ACTIVE_ADS', c4: 'HAS_INACTIVE_ADS' });
    const one = dash.counts.accounts.find((a) => a.metaAccountId === '1001')!;
    // Total: 8 campaigns although page 2 repeated one; the deleted campaign, ad sets and ads are not counted.
    expect(one).toMatchObject({ total: 8, metaActive: 4, paused: 2, archived: 1, other: 1, audited: 4, active: 1, reconciled: true });
    expect(one).not.toHaveProperty('deleted');
    // KPIs cover the Active campaign only; ratings and SOP checks are still made for all four.
    expect(dash.summary.totals.active).toBe(1);
    expect(dash.campaigns).toHaveLength(4);
    expect(dash.campaigns.every((c) => c.checks.length === 9)).toBe(true);
    // The paused ad set is not audited (only active ad sets are, as before).
    const detail = (await agent.get(`/api/campaign-audits/${dash.campaigns.find((c) => c.metaCampaignId === 'c2')!.id}`)).body;
    expect(detail.adSets.map((s: { metaAdSetId: string }) => s.metaAdSetId)).toEqual(['s2']);
  });

  it('falls back to reading the whole account when Meta rejects the campaign filter', async () => {
    fake.uninstall();
    fake = installFakeGraph((r) =>
      (r.path === 'act_1001/adsets' || r.path === 'act_1001/ads') && r.params.has('filtering')
        ? graphError(100, '(#100) Filtering field campaign.id with operation in is not supported')
        : world(r),
    );
    const { done } = await startSync({ trigger: 'manual', now: NOW });
    await done;
    const { agent } = await signedIn(app, 'viewer');
    const dash = (await agent.get('/api/dashboard')).body as DashboardResponse;
    expect(Object.fromEntries(dash.campaigns.map((c) => [c.metaCampaignId, c.delivery]))).toEqual({ c1: 'ACTIVE', c2: 'HAS_INACTIVE_AD_SETS', c3: 'NO_ACTIVE_ADS', c4: 'HAS_INACTIVE_ADS' });
  });

  it('never sends DELETED to Meta, even if a status list or paging link contains it', async () => {
    const g = new GraphClient({ accessToken: 'x'.repeat(30), version: 'v26.0', maxRetries: 0 });
    // The fake answers exactly like Meta (100/1815001) whenever DELETED reaches a collection edge.
    expect(await g.getAll('act_1001/campaigns', { fields: 'id,account_id,name,status,configured_status,effective_status', effective_status: ['ACTIVE', 'DELETED'] })).toHaveLength(4);
    await g.get('act_1001/adsets', { filtering: [{ field: 'adset.effective_status', operator: 'IN', value: ['PAUSED', 'DELETED'] }, { field: 'campaign.id', operator: 'IN', value: ['c2'] }] });
    for (const r of fake.requests) expect(r.url).not.toContain('DELETED');
    const sent = JSON.parse(fake.requests.at(-1)!.params.get('filtering')!);
    expect(sent).toEqual([{ field: 'adset.effective_status', operator: 'IN', value: ['PAUSED'] }, { field: 'campaign.id', operator: 'IN', value: ['c2'] }]);
  });

  it('explains the deleted-objects error in plain words', () => {
    const err = new MetaApiError(DELETED_REFUSED.body.error.message, 400, 100, 1815001);
    expect(explainMetaError(err, { accountId: '153787105' })).toMatch(/^Meta does not return deleted campaigns, ad sets or ads.*\(Meta error 100\/1815001\)$/);
  });

});
