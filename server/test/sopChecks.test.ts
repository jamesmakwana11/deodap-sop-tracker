/** Unit tests for the nine SOP checks. Snapshots here are hand-built test inputs. */
import { describe, expect, it } from 'vitest';
import { containsDate, checkNaming } from '../src/audit/naming.js';
import { mapObjective } from '../src/audit/objective.js';
import {
  checkBidStrategy,
  checkBuyingType,
  checkCreativeComplete,
  checkDynamicCreative,
  checkFrequency,
  checkMinBudget,
  checkPlacements,
  checkSevenSisters,
  runSopChecks,
} from '../src/audit/sopChecks.js';
import type { CampaignSnapshot, RawAd, RawAdSet } from '../src/meta/types.js';

const ALL_SISTERS = ['Arunachal Pradesh', 'Assam', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Tripura'].map((name) => ({ name }));

function adSet(over: Partial<RawAdSet> = {}): RawAdSet {
  return {
    id: 'as1',
    name: 'Ad set',
    campaign_id: 'c1',
    is_dynamic_creative: false,
    targeting: {
      publisher_platforms: ['facebook', 'instagram', 'threads'],
      geo_locations: { countries: ['IN'] },
      excluded_geo_locations: { regions: ALL_SISTERS },
    },
    ...over,
  };
}

function ad(creative: RawAd['creative']): RawAd {
  return { id: 'ad1', name: 'Ad', adset_id: 'as1', campaign_id: 'c1', creative };
}

const goodAd = ad({ id: 'cr1', object_story_spec: { link_data: { message: 'Buy now', call_to_action: { type: 'SHOP_NOW' } } } });

function snap(over: Partial<CampaignSnapshot> = {}, campaign: Partial<CampaignSnapshot['campaign']> = {}): CampaignSnapshot {
  return {
    account: { metaAccountId: '1', currency: 'INR', timezone: 'Asia/Kolkata' },
    campaign: {
      id: 'c1',
      name: '3038 | NN | Carousel | Sales | 01.01.2026',
      objective: 'OUTCOME_SALES',
      buying_type: 'AUCTION',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      daily_budget: '100000',
      ...campaign,
    },
    adSets: [adSet()],
    ads: [goodAd],
    insights7d: null,
    insightsFirst14d: null,
    ...over,
  };
}

describe('a fully compliant Sales campaign', () => {
  it('passes every applicable check', () => {
    const results = runSopChecks(snap(), 'Sales');
    expect(results.map((r) => [r.key, r.outcome])).toEqual([
      ['naming', 'PASS'],
      ['buying_type', 'PASS'],
      ['bid_strategy', 'PASS'],
      ['min_budget', 'PASS'],
      ['dynamic_creative', 'PASS'],
      ['seven_sisters', 'PASS'],
      ['placements', 'PASS'],
      ['frequency', 'NOT_APPLICABLE'],
      ['creative_complete', 'PASS'],
    ]);
  });
});

describe('naming', () => {
  it.each([
    ['3038 | NN | Carousel | Sales | 01.01.2026', 'Sales'],
    ['6067 | KM | Catalog | Sales | New XML Catalogue | 17.10.2026_DV', 'Sales'],
    ['10037 | KA | Carousel | Sales | 03.11.26', 'Sales'],
    ['MOFU | Sales | Carousel | Bathroom Essentials Under ₹399 - IO Post 26 Oct', 'Sales'],
    ['Awareness_Video_2026-10-05', 'Awareness'],
    ['Lead gen - static - Nov 4', 'Leads'],
  ] as const)('passes "%s"', (name, objective) => {
    expect(checkNaming(name, objective).outcome).toBe('PASS');
  });

  it('lists what is missing', () => {
    expect(checkNaming('Sales Push Catalog', 'Sales')).toMatchObject({ outcome: 'FAIL', detail: 'Name is missing a date' });
    expect(checkNaming('Diwali push', 'Traffic').detail).toBe('Name is missing the objective (Traffic), the creative format and a date');
  });

  it('needs the campaign’s own objective, not any objective', () => {
    expect(checkNaming('Traffic | Video | 01.10.2026', 'Sales').outcome).toBe('FAIL');
  });

  it('does not treat ids or impossible dates as dates', () => {
    expect(containsDate('3038 | 10037')).toBe(false);
    expect(containsDate('45.13.2026')).toBe(false);
    expect(containsDate('salesforce 2026')).toBe(false);
    expect(containsDate('05/10/26')).toBe(true);
  });
});

describe('placements', () => {
  it('fails Audience Network, Messenger, automatic placements and missing Threads', () => {
    const r = checkPlacements(
      snap({
        adSets: [
          adSet({ targeting: { publisher_platforms: ['facebook', 'instagram', 'threads', 'audience_network'] } }),
          adSet({ targeting: { publisher_platforms: ['facebook', 'instagram'] } }),
          adSet({ targeting: { geo_locations: { countries: ['IN'] } } }),
          adSet(),
        ],
      }),
    );
    expect(r.outcome).toBe('FAIL');
    expect(r.detail).toBe(
      '3 of 4 ad sets are not exactly Facebook + Instagram + Threads (Audience Network on; Threads missing; automatic placements)',
    );
  });

  it('is not checkable with no ad sets, never a pass', () => {
    expect(checkPlacements(snap({ adSets: [] })).outcome).toBe('NOT_CHECKABLE');
  });
});

describe('bid strategy', () => {
  it('is not checkable when the budget is on the ad sets', () => {
    expect(checkBidStrategy(snap({}, { daily_budget: undefined }), 'Sales').outcome).toBe('NOT_CHECKABLE');
  });
  it('requires Highest volume for Sales and Cost per result goal elsewhere', () => {
    expect(checkBidStrategy(snap({}, { bid_strategy: 'COST_CAP' }), 'Sales')).toMatchObject({
      outcome: 'FAIL',
      detail: 'Bid strategy is Cost per result goal; Sales needs Highest volume',
    });
    expect(checkBidStrategy(snap({}, { bid_strategy: 'COST_CAP' }), 'Traffic').outcome).toBe('PASS');
    expect(checkBidStrategy(snap(), 'Awareness').outcome).toBe('FAIL');
  });
});

describe('frequency control', () => {
  it('applies to Awareness only', () => {
    expect(checkFrequency(snap(), 'Sales').outcome).toBe('NOT_APPLICABLE');
  });
  it('treats a missing cap as a failure', () => {
    expect(checkFrequency(snap(), 'Awareness')).toMatchObject({ outcome: 'FAIL' });
  });
  it('passes 2 per 7 days and fails looser caps', () => {
    const cap = (max: number, days: number) =>
      snap({ adSets: [adSet({ frequency_control_specs: [{ event: 'IMPRESSIONS', interval_days: days, max_frequency: max }] })] });
    expect(checkFrequency(cap(2, 7), 'Awareness').outcome).toBe('PASS');
    expect(checkFrequency(cap(3, 7), 'Awareness').detail).toContain('cap is 3 per 7 days');
    expect(checkFrequency(cap(2, 1), 'Awareness').outcome).toBe('FAIL');
  });
});

describe('minimum budget', () => {
  it('reads paise and compares with ₹800', () => {
    expect(checkMinBudget(snap({}, { daily_budget: '80000' })).outcome).toBe('PASS');
    expect(checkMinBudget(snap({}, { daily_budget: '50000' }))).toMatchObject({
      outcome: 'FAIL',
      detail: 'Campaign daily budget ₹500; SOP minimum is ₹800',
    });
  });
  it('checks each ad set when the budget is on ad sets', () => {
    const s = snap({ adSets: [adSet({ daily_budget: '90000' }), adSet({ daily_budget: '30000' })] }, { daily_budget: undefined });
    expect(checkMinBudget(s)).toMatchObject({ outcome: 'FAIL', detail: '1 of 2 ad sets have a daily budget under ₹800 (daily budget ₹300)' });
  });
  it('is not checkable for lifetime budgets or non-INR accounts', () => {
    expect(checkMinBudget(snap({}, { daily_budget: undefined, lifetime_budget: '5000000' })).outcome).toBe('NOT_CHECKABLE');
    expect(checkMinBudget(snap({ account: { metaAccountId: '1', currency: 'USD', timezone: null } })).outcome).toBe('NOT_CHECKABLE');
  });
});

describe('Seven Sisters', () => {
  it('fails when India is targeted without all seven exclusions', () => {
    const s = snap({
      adSets: [adSet({ targeting: { geo_locations: { countries: ['IN'] }, excluded_geo_locations: { regions: [{ name: 'Assam' }] } } })],
    });
    expect(checkSevenSisters(s).detail).toBe(
      '1 of 1 ad sets do not exclude all Seven Sisters states (Arunachal Pradesh, Manipur, Meghalaya, Mizoram, Nagaland, Tripura not excluded)',
    );
  });
  it('passes region/city targeting outside the north-east and fails inside it', () => {
    const outside = adSet({ targeting: { geo_locations: { regions: [{ name: 'Gujarat', country: 'IN' }], cities: [{ name: 'Mumbai', region: 'Maharashtra', country: 'IN' }] } } });
    const inside = adSet({ targeting: { geo_locations: { cities: [{ name: 'Guwahati', region: 'Assam', country: 'IN' }] } } });
    expect(checkSevenSisters(snap({ adSets: [outside] })).outcome).toBe('PASS');
    expect(checkSevenSisters(snap({ adSets: [inside] })).detail).toContain('targets Guwahati');
  });
  it('is not applicable outside India and not checkable for radius targeting', () => {
    expect(checkSevenSisters(snap({ adSets: [adSet({ targeting: { geo_locations: { countries: ['AE'] } } })] })).outcome).toBe('NOT_APPLICABLE');
    expect(checkSevenSisters(snap({ adSets: [adSet({ targeting: { geo_locations: { custom_locations: [{}] } } })] })).outcome).toBe('NOT_CHECKABLE');
  });
});

describe('creative complete', () => {
  it('fails an ad with no CTA button', () => {
    const noCta = ad({ id: 'cr2', object_story_spec: { link_data: { message: 'Hi', call_to_action: { type: 'NO_BUTTON' } } } });
    expect(checkCreativeComplete(snap({ ads: [goodAd, noCta] }))).toMatchObject({
      outcome: 'FAIL',
      detail: '1 of 2 active ads are incomplete (no call-to-action button)',
    });
  });
  it('reads text and CTA from video, catalog and flexible (asset feed) creatives', () => {
    const video = ad({ id: 'v', object_story_spec: { video_data: { message: 'Watch', call_to_action: { type: 'SHOP_NOW' } } } });
    const catalog = ad({ id: 't', object_story_spec: { template_data: { message: 'Deals', call_to_action: { type: 'SHOP_NOW' } } } });
    const flexible = ad({ id: 'f', asset_feed_spec: { bodies: [{ text: 'Body' }], call_to_action_types: ['SHOP_NOW'] } });
    expect(checkCreativeComplete(snap({ ads: [video, catalog, flexible] })).outcome).toBe('PASS');
  });
  it('is not checkable for boosted existing posts', () => {
    const post = ad({ id: 'p', effective_object_story_id: '123_456' });
    expect(checkCreativeComplete(snap({ ads: [post] })).detail).toContain('uses an existing post');
  });
});

describe('buying type and dynamic creative', () => {
  it('requires Auction', () => {
    expect(checkBuyingType(snap({}, { buying_type: 'RESERVED' })).detail).toBe('Buying type is Reservation; SOP requires Auction');
    expect(checkBuyingType(snap({}, { buying_type: undefined })).outcome).toBe('NOT_CHECKABLE');
  });
  it('fails any ad set with dynamic creative on', () => {
    const s = snap({ adSets: [adSet(), adSet({ is_dynamic_creative: true })] });
    expect(checkDynamicCreative(s).detail).toBe('1 of 2 ad sets have dynamic creative switched on');
    expect(checkDynamicCreative(snap({ adSets: [adSet({ is_dynamic_creative: undefined })] })).outcome).toBe('NOT_CHECKABLE');
  });
});

describe('objective mapping', () => {
  it('maps current and legacy objectives', () => {
    expect(mapObjective('OUTCOME_SALES')).toBe('Sales');
    expect(mapObjective('LINK_CLICKS')).toBe('Traffic');
    expect(mapObjective('OUTCOME_APP_PROMOTION')).toBe('App Promotion');
    expect(mapObjective('SOMETHING_NEW')).toBe('Other');
  });
});
