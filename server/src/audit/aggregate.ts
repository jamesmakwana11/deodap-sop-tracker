import type { CheckKey, CheckOutcome, CheckResult } from '@sop/shared';

export interface ItemVerdict {
  outcome: CheckOutcome;
  /** Short reason for this one item, e.g. "Audience Network on". */
  reason?: string;
}

/**
 * Combines per-item verdicts (ad sets or ads) into one check result:
 * any FAIL → FAIL; else any NOT_CHECKABLE → NOT_CHECKABLE; else all N/A → N/A; else PASS.
 */
export function aggregate(
  key: CheckKey,
  verdicts: ItemVerdict[],
  noun: { plural: string },
  failPhrase: string,
  emptyDetail: string,
): CheckResult {
  if (verdicts.length === 0) return { key, outcome: 'NOT_CHECKABLE', detail: emptyDetail };

  const fails = verdicts.filter((v) => v.outcome === 'FAIL');
  const unknown = verdicts.filter((v) => v.outcome === 'NOT_CHECKABLE');
  const total = verdicts.length;
  // "1 of 1 ad sets are …", matching the wording of the reference tracker.
  const of = (n: number) => `${n} of ${total} ${noun.plural}`;
  const reasons = (vs: ItemVerdict[]) => {
    const unique = [...new Set(vs.map((v) => v.reason).filter(Boolean))];
    return unique.length ? ` (${unique.join('; ')})` : '';
  };

  if (fails.length) return { key, outcome: 'FAIL', detail: `${of(fails.length)} ${failPhrase}${reasons(fails)}` };
  if (unknown.length) return { key, outcome: 'NOT_CHECKABLE', detail: `${of(unknown.length)} could not be checked${reasons(unknown)}` };
  if (verdicts.every((v) => v.outcome === 'NOT_APPLICABLE')) {
    return { key, outcome: 'NOT_APPLICABLE', detail: reasons(verdicts).replace(/^ \(|\)$/g, '') || null };
  }
  return { key, outcome: 'PASS', detail: null };
}

export const AD_SETS = { plural: 'ad sets' };
export const ADS = { plural: 'active ads' };
