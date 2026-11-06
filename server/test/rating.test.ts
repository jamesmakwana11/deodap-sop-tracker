/** Unit tests for performance ratings. Insights here are hand-built test inputs. */
import { describe, expect, it } from 'vitest';
import { rankLeads, rateCampaign, type RatingOutcome } from '../src/audit/rating.js';
import type { CampaignSnapshot, RawInsight } from '../src/meta/types.js';

const END = new Date('2026-11-06T00:00:00Z');

function snap(insights7d: RawInsight | null, extra: Partial<CampaignSnapshot> = {}, start = '2026-09-01T00:00:00+0530'): CampaignSnapshot {
  return {
    account: { metaAccountId: '1', currency: 'INR', timezone: null },
    campaign: { id: 'c', name: 'c', start_time: start },
    adSets: [],
    ads: [],
    insights7d,
    insightsFirst14d: null,
    ...extra,
  };
}

const sales = (spend: number, revenue: number) =>
  snap({ spend: String(spend), action_values: [{ action_type: 'omni_purchase', value: String(revenue) }, { action_type: 'purchase', value: '1' }] });

describe('Sales (ROAS)', () => {
  it('applies the 6.0 / 3.5 thresholds using the first matching purchase value', () => {
    expect(rateCampaign(sales(20_000, 120_000), 'Sales', END)).toMatchObject({ rating: 'GOOD', metric: { kind: 'roas', value: 6 } });
    expect(rateCampaign(sales(20_000, 119_800), 'Sales', END).rating).toBe('AVERAGE'); // 5.99
    expect(rateCampaign(sales(20_000, 70_000), 'Sales', END).rating).toBe('AVERAGE'); // 3.5
    expect(rateCampaign(sales(20_000, 69_000), 'Sales', END).rating).toBe('BAD');
  });

  it('marks ratings under ₹15,000 spend as indicative', () => {
    expect(rateCampaign(sales(14_999, 100_000), 'Sales', END)).toMatchObject({ rating: 'GOOD', indicative: true });
    expect(rateCampaign(sales(15_000, 100_000), 'Sales', END).indicative).toBe(false);
  });

  it('rates spend with no purchases as ROAS 0 (Bad)', () => {
    expect(rateCampaign(snap({ spend: '20000' }), 'Sales', END)).toMatchObject({ rating: 'BAD', metric: { value: 0 } });
  });
});

describe('cost-based objectives', () => {
  it.each([
    ['Traffic', { spend: '300', actions: [{ action_type: 'landing_page_view', value: '1000' }] }, 'GOOD', 0.3],
    ['Traffic', { spend: '310', actions: [{ action_type: 'landing_page_view', value: '1000' }] }, 'AVERAGE', 0.31],
    ['Traffic', { spend: '710', actions: [{ action_type: 'landing_page_view', value: '1000' }] }, 'BAD', 0.71],
    ['Awareness', { spend: '2700', reach: '1000000' }, 'GOOD', 2.7],
    ['Awareness', { spend: '3400', reach: '1000000' }, 'AVERAGE', 3.4],
    ['Engagement', { spend: '600', actions: [{ action_type: 'post_engagement', value: '1000' }] }, 'AVERAGE', 0.6],
    ['App Promotion', { spend: '2100', actions: [{ action_type: 'mobile_app_install', value: '1000' }] }, 'BAD', 2.1],
  ] as const)('%s %o → %s', (objective, insight, rating, value) => {
    const r = rateCampaign(snap(insight as RawInsight), objective, END);
    expect(r.rating).toBe(rating);
    expect(r.metric?.value).toBeCloseTo(value);
    expect(r.indicative).toBe(false);
  });

  it('rates spend with zero results as Bad and says why', () => {
    const r = rateCampaign(snap({ spend: '5000', actions: [] }), 'Traffic', END);
    expect(r).toMatchObject({ rating: 'BAD', metric: { kind: 'cost_per_lpv', value: null } });
    expect(r.note).toBe('₹5,000 spent with no landing page views recorded');
  });
});

describe('Not rated', () => {
  it('for zero spend, missing insights and objectives without a metric', () => {
    expect(rateCampaign(snap(null), 'Sales', END)).toMatchObject({ rating: 'NOT_RATED', note: 'No spend in the last 7 days' });
    expect(rateCampaign(snap({ spend: '0' }), 'Traffic', END).rating).toBe('NOT_RATED');
    expect(rateCampaign(snap({ spend: '100' }), 'Other', END).rating).toBe('NOT_RATED');
  });
});

describe('Leads ranking on first-14-day cost per lead', () => {
  const lead = (cplSpend: number, leads: number, start?: string) =>
    rateCampaign(
      snap(
        { spend: '1000', actions: [{ action_type: 'lead', value: '10' }] },
        { insightsFirst14d: { spend: String(cplSpend), actions: leads ? [{ action_type: 'lead', value: String(leads) }] : [] } },
        start,
      ),
      'Leads',
      END,
    );

  it('needs 14 days since launch', () => {
    expect(lead(100, 10, '2026-10-30T00:00:00+0530')).toMatchObject({ rating: 'NOT_RATED', leadsBaselineCpl: null });
  });

  it('does not rank fewer than four campaigns', () => {
    const outcomes = [lead(100, 10), lead(200, 10)];
    rankLeads(outcomes);
    expect(outcomes.every((o) => o.rating === 'NOT_RATED')).toBe(true);
    expect(outcomes[0]!.note).toContain('found 2');
  });

  it('puts the lowest 25% Good, middle 50% Average, highest 25% Bad', () => {
    const four: RatingOutcome[] = [lead(400, 10), lead(100, 10), lead(300, 10), lead(200, 10)];
    rankLeads(four);
    expect(four.map((o) => o.rating)).toEqual(['BAD', 'GOOD', 'AVERAGE', 'AVERAGE']);

    // Percent rank 0, .25, .5, .75, 1 → the 25% / 75% boundaries fall in the middle band.
    const outcomes: RatingOutcome[] = [lead(400, 10), lead(100, 10), lead(300, 10), lead(200, 10), lead(500, 0)];
    rankLeads(outcomes);
    expect(outcomes.map((o) => o.rating)).toEqual(['AVERAGE', 'GOOD', 'AVERAGE', 'AVERAGE', 'BAD']);
    expect(outcomes[1]!.metric).toEqual({ kind: 'cost_per_lead', value: 100 }); // shown metric is the 7-day CPL
    expect(outcomes[4]!.note).toContain('No leads in the first 14 days');
  });
});
