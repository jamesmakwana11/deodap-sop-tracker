/** Regression tests for issues found in the independent code review. Inputs are hand-built test data. */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { rankLeads, rateCampaign, type RatingOutcome } from '../src/audit/rating.js';
import { checkBidStrategy, checkCreativeComplete, checkMinBudget, checkSevenSisters } from '../src/audit/sopChecks.js';
import { closeStore, store } from '../src/storage/store.js';
import { fetchAccountSnapshots } from '../src/meta/fetchAccount.js';
import { GraphClient } from '../src/meta/graphClient.js';
import type { CampaignSnapshot, RawAdSet } from '../src/meta/types.js';
import { graphError, installFakeGraph } from './fakeGraph.js';
import { createUser, CSRF, prepareDb, resetDb, signedIn, TEST_PASSWORD } from './helpers.js';

const END = new Date('2026-11-06T00:00:00Z');
const sisters = ['Arunachal Pradesh', 'Assam', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Tripura'].map((name) => ({ name }));

function snap(over: Partial<CampaignSnapshot> = {}, currency = 'INR'): CampaignSnapshot {
  return {
    account: { metaAccountId: '1', currency, timezone: null },
    campaign: { id: 'c', name: 'c', start_time: '2026-09-01T00:00:00+0530', daily_budget: '100000', bid_strategy: 'COST_CAP' },
    adSets: [],
    ads: [],
    insights7d: null,
    insightsFirst14d: null,
    ...over,
  };
}
const adSet = (targeting: RawAdSet['targeting'], over: Partial<RawAdSet> = {}): RawAdSet => ({ id: 's', name: 's', campaign_id: 'c', targeting, ...over });

describe('ratings', () => {
  it('rates every Leads campaign with no leads as Bad, even when several tie', () => {
    const lead = (spend: number, leads: number) =>
      rateCampaign(
        snap({ insights7d: { spend: '100' }, insightsFirst14d: { spend: String(spend), actions: leads ? [{ action_type: 'lead', value: String(leads) }] : [] } }),
        'Leads',
        END,
      );
    const outcomes: RatingOutcome[] = [lead(100, 10), lead(200, 10), lead(300, 10), lead(400, 10), lead(500, 10), lead(50, 0), lead(60, 0), lead(70, 0)];
    rankLeads(outcomes);
    expect(outcomes.slice(5).map((o) => o.rating)).toEqual(['BAD', 'BAD', 'BAD']);
  });

  it('does not apply rupee cost targets to other currencies', () => {
    const usd = snap({ insights7d: { spend: '100', actions: [{ action_type: 'landing_page_view', value: '1000' }] } }, 'USD');
    expect(rateCampaign(usd, 'Traffic', END)).toMatchObject({ rating: 'NOT_RATED' });
    const usdSales = snap({ insights7d: { spend: '50000', action_values: [{ action_type: 'omni_purchase', value: '400000' }] } }, 'USD');
    expect(rateCampaign(usdSales, 'Sales', END)).toMatchObject({ rating: 'GOOD', indicative: true });
  });
});

describe('SOP checks', () => {
  it('treats a boosted post with only a CTA as not checkable, not a failure', () => {
    const s = snap({ ads: [{ id: 'a', name: 'a', adset_id: 's', campaign_id: 'c', creative: { id: 'cr', call_to_action_type: 'SHOP_NOW', effective_object_story_id: '1_2' } }] });
    expect(checkCreativeComplete(s).outcome).toBe('NOT_CHECKABLE');
  });

  it('requires the exclusions for country groups and does not pass radius targeting', () => {
    expect(checkSevenSisters(snap({ adSets: [adSet({ geo_locations: { country_groups: ['worldwide'] } })] })).outcome).toBe('FAIL');
    expect(
      checkSevenSisters(snap({ adSets: [adSet({ geo_locations: { country_groups: ['worldwide'] }, excluded_geo_locations: { regions: sisters } })] })).outcome,
    ).toBe('PASS');
    const mixed = adSet({ geo_locations: { regions: [{ name: 'Maharashtra', country: 'IN' }], custom_locations: [{ radius: 20 }] } });
    expect(checkSevenSisters(snap({ adSets: [mixed] })).outcome).toBe('NOT_CHECKABLE');
  });

  it('does not enforce a bid strategy on objectives the SOP does not cover', () => {
    expect(checkBidStrategy(snap(), 'Other').outcome).toBe('NOT_CHECKABLE');
  });

  it('treats a "0" campaign budget as no campaign budget', () => {
    const s = snap({ adSets: [adSet(undefined, { daily_budget: '90000' })] });
    s.campaign.daily_budget = '0';
    expect(checkMinBudget(s).outcome).toBe('PASS'); // read from the ad set
    expect(checkBidStrategy(s, 'Traffic').outcome).toBe('NOT_CHECKABLE');
  });
});

describe('Meta client', () => {
  let fake: ReturnType<typeof installFakeGraph> | undefined;
  afterEach(() => fake?.uninstall());
  const client = () => new GraphClient({ accessToken: 'T', version: 'v26.0', retryDelayMs: 0 });

  it('refuses a method parameter and strips one from paging links', async () => {
    expect(() => client().buildUrl('act_1/campaigns', { method: 'POST' })).toThrow(/read-only/);
    fake = installFakeGraph((r) =>
      r.params.get('after') ? { body: { data: [{ id: 2 }] } } : { body: { data: [{ id: 1 }], paging: { next: 'https://graph.facebook.com/v26.0/x?after=1&method=DELETE' } } },
    );
    await client().getAll('x');
    expect(fake.requests.every((r) => !r.params.has('method'))).toBe(true);
  });

  it('errors instead of silently auditing part of a long list', async () => {
    fake = installFakeGraph(() => ({ body: { data: [{ id: 1 }, { id: 2 }], paging: { next: 'https://graph.facebook.com/v26.0/x?after=n' } } }));
    await expect(client().getAll('x', {}, 3)).rejects.toThrow(/partial list/);
  });

  it('keeps an account when one 14-day insights call fails', async () => {
    fake = installFakeGraph((r) => {
      if (r.path === 'act_1/campaigns')
        return { body: { data: [{ id: 'L1', name: 'Leads | Static | 01.01.2020', objective: 'OUTCOME_LEADS', start_time: '2020-01-01T00:00:00+0530' }, { id: 'S1', name: 'S', objective: 'OUTCOME_SALES' }] } };
      if (r.path === 'L1/insights') return graphError(100, 'Too far in the past');
      return { body: { data: [] } };
    });
    const snaps = await fetchAccountSnapshots(client(), { metaAccountId: '1', currency: 'INR', timezone: null }, END);
    expect(snaps.map((s) => s.campaign.id)).toEqual(['L1', 'S1']);
    expect(snaps[0]!.insightsFirst14d).toBeNull();
  });
});

describe('API hardening', () => {
  const app = createApp();
  beforeAll(prepareDb);
  beforeEach(resetDb);
  afterAll(() => closeStore());

  it('returns 404, not 500, for malformed ids', async () => {
    const { agent } = await signedIn(app, 'admin');
    for (const url of ['/api/runs/abc', '/api/ads/x/preview', '/api/campaign-audits/1e5', '/api/users/abc/reset-password']) {
      const res = url.includes('reset') ? await agent.post(url).set(CSRF) : await agent.get(url);
      expect(res.status, url).toBe(404);
    }
    expect((await agent.patch('/api/meta/accounts/abc').set(CSRF).send({ selected: true })).status).toBe(404);
  });

  it('blocks the OAuth callback for an admin who still has a temporary password', async () => {
    const admin = await createUser('admin', { mustChangePassword: true });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set(CSRF).send({ email: admin.email, password: TEST_PASSWORD });
    const res = await agent.get('/api/meta/oauth/callback?code=x&state=y');
    expect(res.headers.location).toContain('meta=error');
  });
});
