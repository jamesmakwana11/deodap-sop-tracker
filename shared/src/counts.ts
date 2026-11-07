/**
 * Campaign counts. A campaign is ACTIVE only when the campaign, every one of its ad sets and every
 * one of its ads have Meta effective_status ACTIVE (and it has started and not ended). One paused,
 * archived, deleted, in-review or otherwise inactive ad set or ad excludes the whole campaign.
 * Every campaign with Meta status ACTIVE is still audited for the SOP and rated as before; this
 * only decides which ones count and show as Active.
 */

export type DeliveryState =
  | 'ACTIVE'
  | 'HAS_INACTIVE_AD_SETS'
  | 'HAS_INACTIVE_ADS'
  | 'NO_ACTIVE_AD_SETS'
  | 'NO_ACTIVE_ADS'
  | 'ENDED'
  | 'SCHEDULED'
  | 'UNKNOWN'
  /** Recorded by an earlier version with a looser rule; treated as not yet checked. */
  | 'DELIVERING';

export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  ACTIVE: 'Active',
  HAS_INACTIVE_AD_SETS: 'Some ad sets not active',
  HAS_INACTIVE_ADS: 'Some ads not active',
  NO_ACTIVE_AD_SETS: 'No ad sets',
  NO_ACTIVE_ADS: 'No ads',
  ENDED: 'Ended',
  SCHEDULED: 'Scheduled',
  UNKNOWN: 'Ad set / ad status not readable',
  DELIVERING: 'Not checked yet (refresh)',
};

/** Reasons a campaign with Meta status ACTIVE is not counted as Active. */
export const EXCLUSION_REASONS = ['HAS_INACTIVE_AD_SETS', 'HAS_INACTIVE_ADS', 'NO_ACTIVE_AD_SETS', 'NO_ACTIVE_ADS', 'ENDED', 'SCHEDULED', 'UNKNOWN'] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

/** True when this campaign's state was worked out with the strict rule (not missing or from an older version). */
export const deliveryChecked = (d: DeliveryState | null | undefined): d is Exclude<DeliveryState, 'DELIVERING'> => Boolean(d) && d !== 'DELIVERING';

interface Timed {
  start_time?: string;
  stop_time?: string;
  end_time?: string;
}

/**
 * Strict state of one campaign (whose own effective_status is ACTIVE) from ALL its ad sets and
 * ALL its ads in every status. `childrenKnown` is false when Meta did not let them be read.
 */
export function deliveryState(
  campaign: Timed,
  adSets: (Timed & { id: string; effective_status?: string })[],
  ads: { adset_id?: string; effective_status?: string }[],
  now: Date,
  childrenKnown = true,
): Exclude<DeliveryState, 'DELIVERING'> {
  const t = now.getTime();
  const past = (iso?: string) => Boolean(iso) && Date.parse(iso!) <= t;
  const future = (iso?: string) => Boolean(iso) && Date.parse(iso!) > t;
  if (past(campaign.stop_time)) return 'ENDED';
  if (!childrenKnown) return 'UNKNOWN';
  if (adSets.length === 0) return 'NO_ACTIVE_AD_SETS';
  if (adSets.some((s) => s.effective_status !== 'ACTIVE')) return 'HAS_INACTIVE_AD_SETS';
  if (adSets.some((s) => past(s.end_time))) return 'ENDED';
  if (ads.length === 0) return 'NO_ACTIVE_ADS';
  if (ads.some((a) => a.effective_status !== 'ACTIVE')) return 'HAS_INACTIVE_ADS';
  if (future(campaign.start_time) || adSets.every((s) => future(s.start_time))) return 'SCHEDULED';
  return 'ACTIVE';
}

/** Campaigns per Meta effective_status for one ad account, every status, unique campaign IDs. */
export interface MetaCampaignStatusCounts {
  /** Unique campaign IDs Meta returned across all statuses requested. */
  total: number;
  byEffectiveStatus: Record<string, number>;
  /** False when Meta refused to list deleted campaigns (then Total excludes them). */
  deletedIncluded: boolean;
  countedAt: string;
}

export interface AccountCampaignCounts {
  metaAccountId: string;
  name: string;
  /** All statuses, unique campaign IDs. Null when this audit has no status listing for the account. */
  total: number | null;
  /** Campaigns whose own Meta status is ACTIVE, from the status listing. */
  metaActive: number | null;
  paused: number | null;
  archived: number | null;
  deleted: number | null;
  other: number | null;
  /** Campaigns with Meta status ACTIVE that were audited. */
  audited: number;
  /** Strictly active: campaign, all ad sets and all ads ACTIVE. */
  active: number;
  /** Audited but not strictly active, by reason. */
  excluded: Record<ExclusionReason, number>;
  /** Meta's ACTIVE count equals the campaigns audited; null when there is no listing to compare. */
  reconciled: boolean | null;
  deletedIncluded: boolean | null;
}

export interface CampaignCountsSummary {
  accounts: AccountCampaignCounts[];
  all: AccountCampaignCounts;
  /** False for audits made before the strict check existed: refresh to get Active counts. */
  activeKnown: boolean;
  lastSuccessfulSyncAt: string | null;
}

const emptyExcluded = () => Object.fromEntries(EXCLUSION_REASONS.map((k) => [k, 0])) as Record<ExclusionReason, number>;

export function groupStatusCounts(byEffectiveStatus: Record<string, number>) {
  const g = { active: 0, paused: 0, archived: 0, deleted: 0, other: 0 };
  for (const [status, n] of Object.entries(byEffectiveStatus)) {
    if (status === 'ACTIVE') g.active += n;
    else if (status === 'PAUSED') g.paused += n;
    else if (status === 'ARCHIVED') g.archived += n;
    else if (status === 'DELETED') g.deleted += n;
    else g.other += n;
  }
  return g;
}

/**
 * Counts for ONE audit (never mixed with older snapshots): per selected ad account from Meta's
 * status listing and the strict state of each audited campaign, plus All accounts. Campaigns are
 * counted once per Meta campaign ID; ad sets and ads are never counted as campaigns.
 */
export function buildCampaignCounts(
  accounts: { metaAccountId: string; name: string; status: 'succeeded' | 'failed'; campaignCounts?: MetaCampaignStatusCounts | null }[],
  campaigns: { metaCampaignId: string; account: { metaAccountId: string }; delivery: DeliveryState | null }[],
  lastSuccessfulSyncAt: string | null,
): CampaignCountsSummary {
  const seen = new Set<string>();
  const unique = campaigns.filter((c) => !seen.has(c.metaCampaignId) && seen.add(c.metaCampaignId));
  const rows = accounts.map((a): AccountCampaignCounts => {
    const mine = unique.filter((c) => c.account.metaAccountId === a.metaAccountId);
    const excluded = emptyExcluded();
    let active = 0;
    for (const c of mine) {
      if (c.delivery === 'ACTIVE') active++;
      else if (deliveryChecked(c.delivery)) excluded[c.delivery]++;
      else excluded.UNKNOWN++;
    }
    const m = a.campaignCounts ?? null;
    const g = m ? groupStatusCounts(m.byEffectiveStatus) : null;
    return {
      metaAccountId: a.metaAccountId,
      name: a.name,
      total: m?.total ?? null,
      metaActive: g?.active ?? null,
      paused: g?.paused ?? null,
      archived: g?.archived ?? null,
      deleted: g?.deleted ?? null,
      other: g?.other ?? null,
      audited: mine.length,
      active,
      excluded,
      reconciled: g ? g.active === mine.length : null,
      deletedIncluded: m?.deletedIncluded ?? null,
    };
  });
  const sum = (k: 'total' | 'metaActive' | 'paused' | 'archived' | 'deleted' | 'other') =>
    rows.length && rows.every((r) => r[k] !== null) ? rows.reduce((s, r) => s + r[k]!, 0) : null;
  const excluded = emptyExcluded();
  for (const r of rows) for (const k of EXCLUSION_REASONS) excluded[k] += r.excluded[k];
  const all: AccountCampaignCounts = {
    metaAccountId: 'all',
    name: 'All accounts',
    total: sum('total'),
    metaActive: sum('metaActive'),
    paused: sum('paused'),
    archived: sum('archived'),
    deleted: sum('deleted'),
    other: sum('other'),
    audited: rows.reduce((s, r) => s + r.audited, 0),
    active: rows.reduce((s, r) => s + r.active, 0),
    excluded,
    reconciled: rows.length && rows.every((r) => r.reconciled !== null) ? rows.every((r) => r.reconciled) : null,
    deletedIncluded: rows.length && rows.every((r) => r.deletedIncluded !== null) ? rows.every((r) => r.deletedIncluded) : null,
  };
  return { accounts: rows, all, activeKnown: unique.every((c) => deliveryChecked(c.delivery)), lastSuccessfulSyncAt };
}
