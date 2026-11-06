import { SOP_RULES } from './sopRules.js';
import type { CheckResult, ComplianceResult, SopStatus } from './types.js';

/** More than this share of failing checks means Not Following SOP. */
export const PARTLY_FOLLOWING_MAX_FAIL_SHARE = 0.25;

/**
 * SOP % = passed / (passed + failed) × 100.
 * NOT_CHECKABLE and NOT_APPLICABLE are excluded. With nothing evaluable the
 * campaign is NEEDS_REVIEW rather than receiving an invented score.
 */
export function computeCompliance(checks: readonly CheckResult[]): ComplianceResult {
  let passed = 0;
  let failed = 0;
  let notCheckable = 0;
  let notApplicable = 0;

  for (const c of checks) {
    if (c.outcome === 'PASS') passed++;
    else if (c.outcome === 'FAIL') failed++;
    else if (c.outcome === 'NOT_CHECKABLE') notCheckable++;
    else notApplicable++;
  }

  const evaluated = passed + failed;
  if (evaluated === 0) {
    return { passed, failed, notCheckable, notApplicable, percent: null, status: 'NEEDS_REVIEW' };
  }

  const percent = Math.round((passed / evaluated) * 1000) / 10;
  const failShare = failed / evaluated;
  let status: SopStatus;
  if (failed === 0) status = 'FOLLOWING';
  else if (failShare <= PARTLY_FOLLOWING_MAX_FAIL_SHARE) status = 'PARTLY_FOLLOWING';
  else status = 'NOT_FOLLOWING';

  return { passed, failed, notCheckable, notApplicable, percent, status };
}

/** Findings for failed checks, ordered by the SOP rule list. */
export function describeFindings(checks: readonly CheckResult[]): string[] {
  const order = new Map(SOP_RULES.map((r, i) => [r.key, i]));
  return checks
    .filter((c) => c.outcome === 'FAIL')
    .sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99))
    .map((c) => c.detail ?? `${SOP_RULES.find((r) => r.key === c.key)?.label ?? c.key} fails the SOP`);
}
