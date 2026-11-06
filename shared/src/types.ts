import type { ManualCheckState, ManualEvent, ManualSummary } from './manual.js';

/**
 * Domain types shared by the server and the client.
 * Performance (rating) and SOP compliance are deliberately independent.
 */

export const OBJECTIVES = [
  'Sales',
  'Traffic',
  'Awareness',
  'Engagement',
  'App Promotion',
  'Leads',
] as const;
export type Objective = (typeof OBJECTIVES)[number];
/** Meta objectives that do not map to an SOP objective are grouped as Other. */
export type ObjectiveLabel = Objective | 'Other';

export type Rating = 'GOOD' | 'AVERAGE' | 'BAD' | 'NOT_RATED';
export const RATINGS: readonly Rating[] = ['GOOD', 'AVERAGE', 'BAD', 'NOT_RATED'];

/** NOT_CHECKABLE = Meta does not expose the field. NOT_APPLICABLE = rule does not apply. */
export type CheckOutcome = 'PASS' | 'FAIL' | 'NOT_CHECKABLE' | 'NOT_APPLICABLE';

export type SopStatus = 'FOLLOWING' | 'PARTLY_FOLLOWING' | 'NOT_FOLLOWING' | 'NEEDS_REVIEW';
export const SOP_STATUSES: readonly SopStatus[] = [
  'FOLLOWING',
  'PARTLY_FOLLOWING',
  'NOT_FOLLOWING',
  'NEEDS_REVIEW',
];

export type CheckKey =
  | 'placements'
  | 'naming'
  | 'bid_strategy'
  | 'frequency'
  | 'min_budget'
  | 'seven_sisters'
  | 'creative_complete'
  | 'buying_type'
  | 'dynamic_creative';

export interface CheckResult {
  key: CheckKey;
  outcome: CheckOutcome;
  /** Human-readable finding, e.g. "1 of 1 ad sets include Audience Network". */
  detail: string | null;
}

export interface ComplianceResult {
  passed: number;
  failed: number;
  notCheckable: number;
  notApplicable: number;
  /** null when no check could be evaluated. */
  percent: number | null;
  status: SopStatus;
}

export type MetricKind = 'roas' | 'cost_per_lpv' | 'cost_per_1k_reach' | 'cost_per_engagement' | 'cost_per_install' | 'cost_per_lead';

export interface AccountRef {
  id: string;
  metaAccountId: string;
  name: string;
}

export interface CampaignAudit {
  id: string;
  metaCampaignId: string;
  name: string;
  account: AccountRef;
  objective: ObjectiveLabel;
  objectiveRaw: string;
  spend7d: number;
  currency: string;
  mainMetric: { kind: MetricKind; value: number | null } | null;
  rating: Rating;
  /** Sales campaigns under the spend floor: rating is a first look only. */
  ratingIndicative: boolean;
  /** Why the rating is what it is, when that needs saying (Not rated, no results, Leads rank). */
  ratingNote: string | null;
  checks: CheckResult[];
  compliance: ComplianceResult;
  /** Failed-check findings in SOP rule order, then manual checks a person marked as failed. */
  whatIsOff: string[];
  /** Manual verification progress. Never counted as passes in the SOP %. */
  manual: ManualSummary;
}

export type RunSource = 'meta' | 'development';
export type RunStatus = 'running' | 'succeeded' | 'partial' | 'failed';

export interface AuditRunInfo {
  id: string;
  source: RunSource;
  status: RunStatus;
  trigger: 'scheduled' | 'manual' | 'seed';
  startedAt: string;
  finishedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  accounts: AccountRef[];
}

export interface GroupSummaryRow {
  key: string;
  label: string;
  campaigns: number;
  good: number;
  average: number;
  bad: number;
  notRated: number;
  following: number;
  /** Mean SOP % across campaigns with an evaluable score. */
  avgSopPercent: number | null;
}

export interface RuleFailureRow {
  key: CheckKey;
  label: string;
  rule: string;
  pass: number;
  fail: number;
  notCheckable: number;
  notApplicable: number;
  /** fail / (pass + fail); null when nothing was evaluable. */
  failRate: number | null;
}

export interface DashboardTotals {
  active: number;
  good: number;
  average: number;
  bad: number;
  notRated: number;
  following: number;
  partlyFollowing: number;
  notFollowing: number;
  needsReview: number;
}

export interface DashboardSummary {
  totals: DashboardTotals;
  byAccount: GroupSummaryRow[];
  byObjective: GroupSummaryRow[];
  ruleFailures: RuleFailureRow[];
}

export interface DashboardResponse {
  run: AuditRunInfo | null;
  campaigns: CampaignAudit[];
  summary: DashboardSummary;
}

export interface AdSetDetail {
  id: string;
  metaAdSetId: string;
  name: string;
  effectiveStatus: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  bidStrategy: string | null;
  optimizationGoal: string | null;
  isDynamicCreative: boolean | null;
  publisherPlatforms: string[] | null;
  frequencyCap: string | null;
  locations: string | null;
  excludedLocations: string | null;
}

export interface AdDetail {
  id: string;
  metaAdId: string;
  metaAdSetId: string | null;
  name: string;
  effectiveStatus: string | null;
  creativeId: string | null;
  primaryText: string | null;
  headline: string | null;
  ctaType: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  permalinkUrl: string | null;
}

export interface CampaignHistoryPoint {
  campaignAuditId: string;
  runId: string;
  at: string;
  rating: Rating;
  spend7d: number;
  mainMetric: CampaignAudit['mainMetric'];
  sopPercent: number | null;
  sopStatus: SopStatus;
}

export interface CampaignDetailResponse {
  audit: CampaignAudit;
  run: AuditRunInfo;
  settings: {
    buyingType: string | null;
    bidStrategy: string | null;
    dailyBudget: number | null;
    lifetimeBudget: number | null;
    startTime: string | null;
    effectiveStatus: string | null;
  };
  adSets: AdSetDetail[];
  ads: AdDetail[];
  manualChecks: ManualCheckState[];
  manualEvents: ManualEvent[];
  history: CampaignHistoryPoint[];
}
