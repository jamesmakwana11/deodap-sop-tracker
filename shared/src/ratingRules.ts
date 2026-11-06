import type { MetricKind, Objective } from './types.js';

export interface ThresholdRatingRule {
  objective: Exclude<Objective, 'Leads'>;
  type: 'threshold';
  metric: MetricKind;
  metricLabel: string;
  /** Short prefix shown in the tracker, e.g. "ROAS". */
  shortLabel: string;
  direction: 'higher_is_better' | 'lower_is_better';
  /** Good boundary (inclusive). */
  good: number;
  /** Bad boundary: below this (higher_is_better) or above this (lower_is_better) is Bad. */
  bad: number;
  goodText: string;
  averageText: string;
  badText: string;
}

export interface PercentileRatingRule {
  objective: 'Leads';
  type: 'percentile';
  metric: 'cost_per_lead';
  metricLabel: string;
  shortLabel: string;
  /** Ranking uses the first N days of cost-per-lead data. */
  baselineDays: number;
  goodText: string;
  averageText: string;
  badText: string;
}

export type RatingRule = ThresholdRatingRule | PercentileRatingRule;

/** SOP "Definition of a good campaign". Rating calculation itself lands in Phase 4. */
export const RATING_RULES: readonly RatingRule[] = [
  {
    objective: 'Sales',
    type: 'threshold',
    metric: 'roas',
    metricLabel: 'ROAS',
    shortLabel: 'ROAS',
    direction: 'higher_is_better',
    good: 6.0,
    bad: 3.5,
    goodText: '6.0 or more (company target)',
    averageText: '3.5 – 5.99',
    badText: 'Below 3.5',
  },
  {
    objective: 'Traffic',
    type: 'threshold',
    metric: 'cost_per_lpv',
    metricLabel: 'Cost per landing page view',
    shortLabel: 'CPLPV',
    direction: 'lower_is_better',
    good: 0.3,
    bad: 0.7,
    goodText: '₹0.30 or less',
    averageText: '₹0.31 – ₹0.70',
    badText: 'Above ₹0.70',
  },
  {
    objective: 'Awareness',
    type: 'threshold',
    metric: 'cost_per_1k_reach',
    metricLabel: 'Cost per 1,000 people reached',
    shortLabel: 'Cost/1K reach',
    direction: 'lower_is_better',
    good: 2.7,
    bad: 3.4,
    goodText: '₹2.70 or less',
    averageText: '₹2.71 – ₹3.40',
    badText: 'Above ₹3.40',
  },
  {
    objective: 'Engagement',
    type: 'threshold',
    metric: 'cost_per_engagement',
    metricLabel: 'Cost per post engagement',
    shortLabel: 'CPE',
    direction: 'lower_is_better',
    good: 0.2,
    bad: 0.6,
    goodText: '₹0.20 or less',
    averageText: '₹0.21 – ₹0.60',
    badText: 'Above ₹0.60',
  },
  {
    objective: 'App Promotion',
    type: 'threshold',
    metric: 'cost_per_install',
    metricLabel: 'Cost per app install',
    shortLabel: 'CPI',
    direction: 'lower_is_better',
    good: 1.2,
    bad: 2.0,
    goodText: '₹1.20 or less',
    averageText: '₹1.21 – ₹2.00',
    badText: 'Above ₹2.00',
  },
  {
    objective: 'Leads',
    type: 'percentile',
    metric: 'cost_per_lead',
    metricLabel: 'Cost per lead',
    shortLabel: 'CPL',
    baselineDays: 14,
    goodText: 'Lowest 25% of first 14 days',
    averageText: 'Middle 50%',
    badText: 'Highest 25%',
  },
];

export const RATING_RULE_BY_METRIC: Readonly<Record<MetricKind, RatingRule>> = Object.fromEntries(
  RATING_RULES.map((r) => [r.metric, r]),
) as Record<MetricKind, RatingRule>;

/** Sales campaigns spending less than this in 7 days get an Indicative rating. */
export const SALES_INDICATIVE_SPEND_INR = 15_000;
export const PERFORMANCE_WINDOW_DAYS = 7;
