import { createHash } from 'node:crypto';
import {
  MANUAL_CHECK_ITEMS,
  MIN_DAILY_BUDGET_INR,
  PARTLY_FOLLOWING_MAX_FAIL_SHARE,
  RATING_RULES,
  SALES_INDICATIVE_SPEND_INR,
  SEVEN_SISTERS,
  SOP_RULES,
} from '@sop/shared';
import { store } from '../storage/store.js';

/**
 * The SOP rule set (checks, rating thresholds, manual items) is saved on the server under a
 * version id, and every audit run records the version it was judged with, so history and
 * exports show exactly which rules applied.
 */

export interface RulesSnapshot {
  version: string;
  sopRules: typeof SOP_RULES;
  ratingRules: typeof RATING_RULES;
  manualChecks: typeof MANUAL_CHECK_ITEMS;
  constants: Record<string, unknown>;
}

function build(): RulesSnapshot {
  const body = {
    sopRules: SOP_RULES,
    ratingRules: RATING_RULES,
    manualChecks: MANUAL_CHECK_ITEMS,
    constants: {
      minDailyBudgetInr: MIN_DAILY_BUDGET_INR,
      salesIndicativeSpendInr: SALES_INDICATIVE_SPEND_INR,
      partlyFollowingMaxFailShare: PARTLY_FOLLOWING_MAX_FAIL_SHARE,
      sevenSisters: SEVEN_SISTERS,
    },
  };
  const version = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12);
  return { version, ...body };
}

let cached: RulesSnapshot | null = null;
export function currentRules(): RulesSnapshot {
  return (cached ??= build());
}

/** Saves the current rule set once per version. */
export async function ensureRulesSaved(): Promise<string> {
  const r = currentRules();
  const key = `sop_rules:${r.version}`;
  if (!store.c.settings.get(key)) {
    await store.c.settings.put({ id: key, value: r, updatedAt: new Date().toISOString(), updatedBy: null });
  }
  if ((store.c.settings.get('sop_rules_current')?.value as string | undefined) !== r.version) {
    await store.c.settings.put({ id: 'sop_rules_current', value: r.version, updatedAt: new Date().toISOString(), updatedBy: null });
  }
  return r.version;
}

export function rulesForVersion(version: string | undefined): RulesSnapshot | null {
  if (!version) return null;
  return (store.c.settings.get(`sop_rules:${version}`)?.value as RulesSnapshot | undefined) ?? null;
}
