import {
  RATING_RULES,
  SALES_INDICATIVE_SPEND_INR,
  type MetricKind,
  type ObjectiveLabel,
  type Rating,
  type ThresholdRatingRule,
} from '@sop/shared';
import type { ActionStat, CampaignSnapshot, RawInsight } from '../meta/types.js';

/**
 * Performance rating from the last 7 days of Meta insights, judged on each objective's
 * main metric. Zero spend, missing data and unknown objectives are Not rated —
 * a rating is never invented.
 */

export interface RatingOutcome {
  rating: Rating;
  indicative: boolean;
  metric: { kind: MetricKind; value: number | null } | null;
  note: string | null;
  /** Leads only: cost per lead over the campaign's first 14 days, used for ranking. */
  leadsBaselineCpl: number | null;
}

/** Action types in priority order; the first one Meta reports is used (they overlap, so never summed). */
const ACTIONS = {
  purchaseValue: ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase'],
  landingPageView: ['landing_page_view', 'omni_landing_page_view'],
  postEngagement: ['post_engagement'],
  install: ['mobile_app_install', 'omni_app_install', 'app_install'],
  lead: ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'],
} as const;

export function pickAction(list: ActionStat[] | undefined, types: readonly string[]): number {
  for (const t of types) {
    const hit = list?.find((a) => a.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

const num = (v: string | undefined) => (v ? Number(v) || 0 : 0);
export const spendOf = (i: RawInsight | null) => num(i?.spend);

const RULES = new Map(RATING_RULES.map((r) => [r.objective, r]));
const RESULT_NAME: Record<string, string> = {
  cost_per_lpv: 'landing page views',
  cost_per_1k_reach: 'reach',
  cost_per_engagement: 'post engagements',
  cost_per_install: 'app installs',
  cost_per_lead: 'leads',
};

export function rateThreshold(rule: ThresholdRatingRule, value: number): Rating {
  if (rule.direction === 'higher_is_better') {
    if (value >= rule.good) return 'GOOD';
    return value >= rule.bad ? 'AVERAGE' : 'BAD';
  }
  if (value <= rule.good) return 'GOOD';
  return value <= rule.bad ? 'AVERAGE' : 'BAD';
}

/** cost = spend / results; null when there were no results. */
function costPer(spend: number, results: number, per = 1): number | null {
  return results > 0 ? (spend / results) * per : null;
}

const notRated = (note: string, metric: RatingOutcome['metric'] = null): RatingOutcome => ({
  rating: 'NOT_RATED',
  indicative: false,
  metric,
  note,
  leadsBaselineCpl: null,
});

/** The main metric's value, or null when the cost-per-result has no results to divide by. */
function metricFor(kind: MetricKind, i: RawInsight, spend: number): number | null {
  switch (kind) {
    case 'roas':
      return pickAction(i.action_values, ACTIONS.purchaseValue) / spend;
    case 'cost_per_lpv':
      return costPer(spend, pickAction(i.actions, ACTIONS.landingPageView));
    case 'cost_per_1k_reach':
      return costPer(spend, num(i.reach), 1000);
    case 'cost_per_engagement':
      return costPer(spend, pickAction(i.actions, ACTIONS.postEngagement));
    case 'cost_per_install':
      return costPer(spend, pickAction(i.actions, ACTIONS.install));
    case 'cost_per_lead':
      return costPer(spend, pickAction(i.actions, ACTIONS.lead));
  }
}

const DAY = 86_400_000;
export const LEADS_MIN_CAMPAIGNS = 4;

/** First pass for one campaign. Leads campaigns get their rating from rankLeads(). */
export function rateCampaign(s: CampaignSnapshot, objective: ObjectiveLabel, periodEnd: Date): RatingOutcome {
  const rule = objective === 'Other' ? undefined : RULES.get(objective);
  const spend = spendOf(s.insights7d);
  if (!rule) return notRated('This objective has no main metric in the SOP');
  // Meta refused insights for the account: performance is unknown, not zero.
  if (s.insightsUnavailable) return notRated('Not checkable: Meta did not allow reading performance insights for this ad account');
  if (!s.insights7d || spend <= 0) return notRated('No spend in the last 7 days');
  // Cost targets are in rupees; ROAS is currency-neutral.
  const isInr = s.account.currency === 'INR';
  if (!isInr && rule.metric !== 'roas') {
    return notRated(`Account currency is ${s.account.currency}; the SOP cost targets are in ₹`);
  }

  const value = metricFor(rule.metric, s.insights7d, spend);
  const metric = { kind: rule.metric, value: value === null ? null : Math.round(value * 10_000) / 10_000 };

  if (rule.type === 'percentile') {
    const start = s.campaign.start_time ? new Date(s.campaign.start_time) : null;
    if (!start || periodEnd.getTime() - start.getTime() < 14 * DAY) {
      return notRated('Fewer than 14 days since launch, so there is no 14-day cost-per-lead baseline yet', metric);
    }
    const first = s.insightsFirst14d;
    if (!first || spendOf(first) <= 0) return notRated('No spend in the first 14 days to rank on', metric);
    const leads = pickAction(first.actions, ACTIONS.lead);
    return {
      ...notRated('Waiting for ranking', metric),
      leadsBaselineCpl: leads > 0 ? spendOf(first) / leads : Number.POSITIVE_INFINITY,
    };
  }

  // Spend with zero results: the cost per result does not exist, and the SOP target was not met.
  const rating = value === null ? 'BAD' : rateThreshold(rule, value);
  const note =
    value === null ? `₹${Math.round(spend).toLocaleString('en-IN')} spent with no ${RESULT_NAME[rule.metric]} recorded` : null;
  // The ₹15,000 floor only means something in rupees; elsewhere the rating is marked indicative too.
  const indicative = objective === 'Sales' && (!isInr || spend < SALES_INDICATIVE_SPEND_INR);
  return { rating, indicative, metric, note, leadsBaselineCpl: null };
}

/**
 * Leads: rank the 14-day cost per lead across all Leads campaigns in the run.
 * Lowest 25% Good, middle 50% Average, highest 25% Bad. Needs at least four to rank.
 */
export function rankLeads(outcomes: RatingOutcome[]): void {
  const ranked = outcomes.filter((o) => o.leadsBaselineCpl !== null);
  if (ranked.length === 0) return;
  if (ranked.length < LEADS_MIN_CAMPAIGNS) {
    for (const o of ranked) {
      o.note = `Needs at least ${LEADS_MIN_CAMPAIGNS} Leads campaigns with 14 days of data to rank (found ${ranked.length})`;
    }
    return;
  }
  const sorted = [...ranked].sort((a, b) => a.leadsBaselineCpl! - b.leadsBaselineCpl!);
  const n = sorted.length;
  for (const o of ranked) {
    const position = sorted.findIndex((x) => x.leadsBaselineCpl === o.leadsBaselineCpl); // ties share a rank
    const cpl = o.leadsBaselineCpl!;
    const percentRank = position / (n - 1); // 0 = cheapest, 1 = most expensive
    // No leads at all in 14 days is always Bad, however many campaigns tie on it.
    o.rating = !Number.isFinite(cpl) ? 'BAD' : percentRank < 0.25 ? 'GOOD' : percentRank > 0.75 ? 'BAD' : 'AVERAGE';
    o.note = Number.isFinite(cpl)
      ? `Ranked ${position + 1} of ${n} on first-14-day cost per lead (₹${cpl.toFixed(2)})`
      : `No leads in the first 14 days (${n} Leads campaigns ranked)`;
  }
}
