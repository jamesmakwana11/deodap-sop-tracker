import { describe, expect, it } from 'vitest';
import { computeCompliance, describeFindings } from '../src/compliance.js';
import type { CheckKey, CheckOutcome, CheckResult } from '../src/types.js';

const KEYS: CheckKey[] = [
  'naming', 'buying_type', 'bid_strategy', 'min_budget', 'dynamic_creative',
  'seven_sisters', 'placements', 'frequency', 'creative_complete',
];

function checks(outcomes: CheckOutcome[]): CheckResult[] {
  return outcomes.map((outcome, i) => ({ key: KEYS[i]!, outcome, detail: null }));
}

describe('computeCompliance', () => {
  it('is Following SOP when every evaluable check passes', () => {
    const r = computeCompliance(checks(['PASS', 'PASS', 'NOT_CHECKABLE', 'NOT_APPLICABLE']));
    expect(r).toMatchObject({ passed: 2, failed: 0, percent: 100, status: 'FOLLOWING' });
  });

  it('excludes Not Checkable and Not Applicable from the percentage', () => {
    // 7 pass, 1 fail, 1 N/A → 7/8 = 87.5% (matches the reference "88%")
    const r = computeCompliance(checks(['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'FAIL', 'NOT_APPLICABLE', 'PASS']));
    expect(r.percent).toBe(87.5);
    expect(r.status).toBe('PARTLY_FOLLOWING');
  });

  it('treats exactly 25% failing as Partly Following', () => {
    const r = computeCompliance(checks(['PASS', 'PASS', 'PASS', 'FAIL']));
    expect(r.status).toBe('PARTLY_FOLLOWING');
  });

  it('treats more than 25% failing as Not Following', () => {
    const r = computeCompliance(checks(['PASS', 'PASS', 'FAIL', 'FAIL', 'PASS']));
    expect(r.percent).toBe(60);
    expect(r.status).toBe('NOT_FOLLOWING');
  });

  it('needs review, with no invented score, when nothing is evaluable', () => {
    const r = computeCompliance(checks(['NOT_CHECKABLE', 'NOT_APPLICABLE']));
    expect(r).toMatchObject({ percent: null, status: 'NEEDS_REVIEW' });
    expect(computeCompliance([]).status).toBe('NEEDS_REVIEW');
  });
});

describe('describeFindings', () => {
  it('lists failed checks in SOP column order', () => {
    const findings = describeFindings([
      { key: 'placements', outcome: 'FAIL', detail: 'Placements off' },
      { key: 'naming', outcome: 'FAIL', detail: 'Name has no date' },
      { key: 'min_budget', outcome: 'PASS', detail: 'ok' },
    ]);
    expect(findings).toEqual(['Name has no date', 'Placements off']);
  });
});
