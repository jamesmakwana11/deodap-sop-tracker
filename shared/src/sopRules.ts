import { MANUAL_CHECK_ITEMS } from './manual.js';
import type { CheckKey } from './types.js';

export interface SopRuleDefinition {
  key: CheckKey;
  /** Column header in the campaign tracker. */
  column: string;
  /** Name in the rule-failure table. */
  label: string;
  /** Rule text as written in the SOP. */
  rule: string;
}

/**
 * The nine automated SOP checks, in tracker column order.
 * The validators that produce PASS / FAIL / NOT_CHECKABLE are implemented in Phase 3.
 */
export const SOP_RULES: readonly SopRuleDefinition[] = [
  {
    key: 'naming',
    column: 'Naming',
    label: 'Naming',
    rule: 'Campaign name carries the objective, the creative format and a date. Separators are not enforced.',
  },
  {
    key: 'buying_type',
    column: 'Buying',
    label: 'Buying type',
    rule: 'Buying type is Auction.',
  },
  {
    key: 'bid_strategy',
    column: 'Bid',
    label: 'Bid strategy',
    rule: 'Highest volume for Sales; Cost per result goal for every other objective. Not checkable when the budget sits on the ad set.',
  },
  {
    key: 'min_budget',
    column: 'Budget',
    label: 'Min budget',
    rule: 'Daily budget of ₹800 or more.',
  },
  {
    key: 'dynamic_creative',
    column: 'Dyn. creative',
    label: 'Dynamic creative off',
    rule: 'Dynamic creative is switched off on every active ad set.',
  },
  {
    key: 'seven_sisters',
    column: '7 Sisters',
    label: 'Seven Sisters excluded',
    rule: 'Arunachal Pradesh, Assam, Manipur, Meghalaya, Mizoram, Nagaland and Tripura are all excluded from the location list.',
  },
  {
    key: 'placements',
    column: 'Placements',
    label: 'Placements',
    rule: 'Placements are exactly Facebook, Instagram and Threads (no Audience Network, Messenger, WhatsApp or automatic placements).',
  },
  {
    key: 'frequency',
    column: 'Freq.',
    label: 'Frequency control',
    rule: 'A cap of 2 impressions in 7 days. Checked on Awareness campaigns only; an ad set with no cap fails.',
  },
  {
    key: 'creative_complete',
    column: 'Creative',
    label: 'Creative complete',
    rule: 'Every active ad runs a creative with primary text and a call-to-action button.',
  },
];

export const SOP_RULE_BY_KEY: Readonly<Record<CheckKey, SopRuleDefinition>> = Object.fromEntries(
  SOP_RULES.map((r) => [r.key, r]),
) as Record<CheckKey, SopRuleDefinition>;

/** Labels of the SOP items Meta data cannot verify (see MANUAL_CHECK_ITEMS). */
export const MANUAL_CHECKS: readonly string[] = MANUAL_CHECK_ITEMS.map((i) => i.label);

export const SEVEN_SISTERS = [
  'Arunachal Pradesh',
  'Assam',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Tripura',
] as const;

export const MIN_DAILY_BUDGET_INR = 800;
