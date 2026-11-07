import { deliveryChecked } from './counts.js';
import type { CampaignAudit, ObjectiveLabel, Rating, SopStatus } from './types.js';

/** Campaign tracker filters and sorting — shared so the screen and the exported reports match. */

export interface TrackerFilters {
  accountId?: string;
  rating?: Rating;
  objective?: ObjectiveLabel;
  sopStatus?: SopStatus;
  search?: string;
  /** Default: only strictly active campaigns. "all": every audited campaign (Meta status Active). */
  activity?: 'all';
}

/**
 * In the default (Active) view: campaigns whose campaign, ad sets and ads are all ACTIVE.
 * Audits from before the strict check have no state yet and stay visible until the next refresh.
 */
export const inActiveView = (c: Pick<CampaignAudit, 'delivery'>): boolean => !deliveryChecked(c.delivery) || c.delivery === 'ACTIVE';

export const SORT_OPTIONS = {
  spend_desc: 'Spend, highest first',
  spend_asc: 'Spend, lowest first',
  performance_best: 'Performance, best first',
  performance_worst: 'Performance, worst first',
  compliance_low: 'SOP %, lowest first',
  compliance_high: 'SOP %, highest first',
} as const;
export type SortKey = keyof typeof SORT_OPTIONS;

const RATING_RANK: Record<Rating, number> = { GOOD: 0, AVERAGE: 1, BAD: 2, NOT_RATED: 3 };

export function filterCampaigns(campaigns: readonly CampaignAudit[], f: TrackerFilters): CampaignAudit[] {
  const q = f.search?.trim().toLowerCase();
  return campaigns.filter(
    (c) =>
      (f.activity === 'all' || inActiveView(c)) &&
      (!f.accountId || c.account.id === f.accountId) &&
      (!f.rating || c.rating === f.rating) &&
      (!f.objective || c.objective === f.objective) &&
      (!f.sopStatus || c.compliance.status === f.sopStatus) &&
      (!q || c.name.toLowerCase().includes(q) || c.metaCampaignId.includes(q)),
  );
}

export function sortCampaigns(campaigns: readonly CampaignAudit[], sort: SortKey): CampaignAudit[] {
  const bySpend = (a: CampaignAudit, b: CampaignAudit) => b.spend7d - a.spend7d;
  const pct = (c: CampaignAudit, empty: number) => c.compliance.percent ?? empty;
  const cmp: Record<SortKey, (a: CampaignAudit, b: CampaignAudit) => number> = {
    spend_desc: bySpend,
    spend_asc: (a, b) => a.spend7d - b.spend7d,
    performance_best: (a, b) => RATING_RANK[a.rating] - RATING_RANK[b.rating] || bySpend(a, b),
    // Worst first: Bad, Average, Good — Not rated stays last because it has no verdict.
    performance_worst: (a, b) =>
      (a.rating === 'NOT_RATED' ? 9 : -RATING_RANK[a.rating]) - (b.rating === 'NOT_RATED' ? 9 : -RATING_RANK[b.rating]) ||
      bySpend(a, b),
    compliance_low: (a, b) => pct(a, 101) - pct(b, 101) || bySpend(a, b),
    compliance_high: (a, b) => pct(b, -1) - pct(a, -1) || bySpend(a, b),
  };
  return [...campaigns].sort(cmp[sort]);
}

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === 'string' && v in SORT_OPTIONS;
}
