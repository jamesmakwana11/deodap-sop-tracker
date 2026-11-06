import { describe, expect, it } from 'vitest';
import { computeCompliance, describeFindings } from '../src/compliance.js';
import { buildDashboardSummary } from '../src/summary.js';
import type { CampaignAudit, CheckResult, ObjectiveLabel, Rating } from '../src/types.js';

function campaign(
  id: string,
  account: string,
  objective: ObjectiveLabel,
  rating: Rating,
  checks: CheckResult[],
): CampaignAudit {
  return {
    id,
    metaCampaignId: `c${id}`,
    name: `Campaign ${id}`,
    account: { id: account, metaAccountId: account, name: account },
    objective,
    objectiveRaw: objective,
    spend7d: 1000,
    currency: 'INR',
    mainMetric: null,
    rating,
    ratingIndicative: false,
    ratingNote: null,
    manual: { verified: 0, failed: 0, notApplicable: 0, pending: 7 },
    checks,
    compliance: computeCompliance(checks),
    whatIsOff: describeFindings(checks),
  };
}

const pass = (key: CheckResult['key']): CheckResult => ({ key, outcome: 'PASS', detail: null });
const fail = (key: CheckResult['key']): CheckResult => ({ key, outcome: 'FAIL', detail: `${key} off` });

const data = [
  campaign('1', 'A', 'Sales', 'GOOD', [pass('naming'), fail('placements'), pass('buying_type'), pass('min_budget')]),
  campaign('2', 'A', 'Sales', 'BAD', [pass('naming'), pass('placements'), pass('buying_type'), pass('min_budget')]),
  campaign('3', 'B', 'Awareness', 'NOT_RATED', [fail('naming'), fail('placements'), pass('buying_type')]),
  campaign('4', 'B', 'Other', 'AVERAGE', []),
];

describe('buildDashboardSummary', () => {
  const s = buildDashboardSummary(data);

  it('counts ratings and SOP statuses independently', () => {
    expect(s.totals).toEqual({
      active: 4,
      good: 1,
      average: 1,
      bad: 1,
      notRated: 1,
      following: 1,
      partlyFollowing: 1,
      notFollowing: 1,
      needsReview: 1,
    });
  });

  it('groups by account with average SOP % over evaluable campaigns only', () => {
    const a = s.byAccount.find((r) => r.key === 'A')!;
    expect(a).toMatchObject({ campaigns: 2, good: 1, bad: 1, following: 1, avgSopPercent: 88 }); // (75 + 100) / 2
    const b = s.byAccount.find((r) => r.key === 'B')!;
    expect(b.avgSopPercent).toBe(33); // campaign 4 has no evaluable checks and is excluded
  });

  it('groups by objective', () => {
    expect(s.byObjective.map((r) => [r.key, r.campaigns])).toEqual([
      ['Sales', 2],
      ['Awareness', 1],
      ['Other', 1],
    ]);
  });

  it('ranks rules by fail rate and never counts a missing result as a pass', () => {
    const top = s.ruleFailures[0]!;
    expect(top.key).toBe('placements');
    expect(top).toMatchObject({ pass: 1, fail: 2, notCheckable: 1 });
    expect(top.failRate).toBeCloseTo(2 / 3);

    const freq = s.ruleFailures.find((r) => r.key === 'frequency')!;
    expect(freq).toMatchObject({ pass: 0, fail: 0, notCheckable: 4, failRate: null });
    expect(s.ruleFailures.at(-1)!.failRate).toBeNull();
  });
});
