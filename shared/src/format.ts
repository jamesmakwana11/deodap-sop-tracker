import { RATING_RULE_BY_METRIC } from './ratingRules.js';
import type { CampaignAudit, CheckOutcome, Rating, SopStatus } from './types.js';

/** Labels and number formats shared by the UI and the PDF / Excel reports. */

export const RATING_LABEL: Record<Rating, string> = {
  GOOD: 'Good',
  AVERAGE: 'Average',
  BAD: 'Bad',
  NOT_RATED: 'Not rated',
};

export const SOP_STATUS_LABEL: Record<SopStatus, string> = {
  FOLLOWING: 'Following SOP',
  PARTLY_FOLLOWING: 'Partly following',
  NOT_FOLLOWING: 'Not following',
  NEEDS_REVIEW: 'Needs review',
};

export const CHECK_OUTCOME_SYMBOL: Record<CheckOutcome, string> = {
  PASS: '✓',
  FAIL: '✗',
  NOT_CHECKABLE: '?',
  NOT_APPLICABLE: '–',
};

export const CHECK_OUTCOME_LABEL: Record<CheckOutcome, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  NOT_CHECKABLE: 'Not checkable',
  NOT_APPLICABLE: 'Not applicable',
};

/** Meta bid strategies in the words of Ads Manager. */
export const BID_STRATEGY_LABEL: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: 'Highest volume',
  COST_CAP: 'Cost per result goal',
  LOWEST_COST_WITH_BID_CAP: 'Bid cap',
  LOWEST_COST_WITH_MIN_ROAS: 'ROAS goal',
};

const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatRupees(value: number): string {
  return `₹${inr0.format(value)}`;
}

export function formatPercent(value: number | null): string {
  return value === null ? '–' : `${Math.round(value)}%`;
}

/** "ROAS 7.95", "CPI ₹1.62". "–" when there is no value. */
export function formatMainMetric(metric: CampaignAudit['mainMetric']): string {
  if (!metric || metric.value === null) return '–';
  const rule = RATING_RULE_BY_METRIC[metric.kind];
  return metric.kind === 'roas'
    ? `${rule.shortLabel} ${metric.value.toFixed(2)}`
    : `${rule.shortLabel} ₹${inr2.format(metric.value)}`;
}

const istFormatter = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});

/** "6 Nov 2026, 8:09 am IST" */
export function formatIst(iso: string): string {
  return `${istFormatter.format(new Date(iso))} IST`;
}

const dateFormatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2026-10-30" → "30 Oct 2026" */
export function formatDate(isoDate: string): string {
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}

export function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
