import { describe, expect, it } from 'vitest';
import { computeCompliance } from '../src/compliance.js';
import { filterCampaigns, sortCampaigns } from '../src/filters.js';
import { formatMainMetric } from '../src/format.js';
import type { CampaignAudit, CheckResult, Rating } from '../src/types.js';

function c(id: string, rating: Rating, spend: number, fails: number, account = 'A'): CampaignAudit {
  const checks: CheckResult[] = Array.from({ length: 4 }, (_, i) => ({
    key: (['naming', 'buying_type', 'min_budget', 'placements'] as const)[i]!,
    outcome: i < fails ? 'FAIL' : 'PASS',
    detail: null,
  }));
  return {
    id, metaCampaignId: `m${id}`, name: `Campaign ${id}`, account: { id: account, metaAccountId: account, name: account },
    objective: 'Sales', objectiveRaw: 'OUTCOME_SALES', spend7d: spend, currency: 'INR', mainMetric: null, rating,
    ratingIndicative: false, ratingNote: null, checks, compliance: computeCompliance(checks), whatIsOff: [],
    manual: { verified: 0, failed: 0, notApplicable: 0, pending: 7 },
    delivery: null,
  };
}

const list = [c('1', 'BAD', 500, 0), c('2', 'GOOD', 100, 2, 'B'), c('3', 'NOT_RATED', 0, 1), c('4', 'AVERAGE', 900, 1)];
const ids = (xs: CampaignAudit[]) => xs.map((x) => x.id);

describe('filterCampaigns', () => {
  it('filters by account, rating, SOP status and search', () => {
    expect(ids(filterCampaigns(list, { accountId: 'B' }))).toEqual(['2']);
    expect(ids(filterCampaigns(list, { rating: 'BAD' }))).toEqual(['1']);
    expect(ids(filterCampaigns(list, { sopStatus: 'PARTLY_FOLLOWING' }))).toEqual(['3', '4']);
    expect(ids(filterCampaigns(list, { search: 'campaign 4' }))).toEqual(['4']);
  });
});

describe('sortCampaigns', () => {
  it('sorts by spend, performance and compliance', () => {
    expect(ids(sortCampaigns(list, 'spend_desc'))).toEqual(['4', '1', '2', '3']);
    expect(ids(sortCampaigns(list, 'performance_best'))).toEqual(['2', '4', '1', '3']);
    expect(ids(sortCampaigns(list, 'performance_worst'))).toEqual(['1', '4', '2', '3']);
    expect(ids(sortCampaigns(list, 'compliance_low'))).toEqual(['2', '4', '3', '1']);
    expect(ids(sortCampaigns(list, 'compliance_high'))).toEqual(['1', '4', '3', '2']);
  });
});

describe('formatMainMetric', () => {
  it('formats ROAS and costs', () => {
    expect(formatMainMetric({ kind: 'roas', value: 7.954 })).toBe('ROAS 7.95');
    expect(formatMainMetric({ kind: 'cost_per_install', value: 1.6 })).toBe('CPI ₹1.60');
    expect(formatMainMetric({ kind: 'cost_per_lpv', value: null })).toBe('–');
  });
});
