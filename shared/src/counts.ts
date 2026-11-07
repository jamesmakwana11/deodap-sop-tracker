/**
 * Campaign counts that reconcile with Meta Ads Manager.
 *
 * Meta's campaign `effective_status` ACTIVE only means the campaign itself is switched on. Ads
 * Manager's "Active" means it is actually delivering: switched on AND it has an active ad in an
 * active ad set that has not ended. A campaign can be ACTIVE in Meta yet show as "Ad sets
 * inactive", "Ads inactive", "Completed" or "Scheduled" in Ads Manager. The tracker audits every
 * campaign with Meta status ACTIVE (unchanged), and counts delivering ones separately.
 */

export type DeliveryState = 'DELIVERING' | 'NO_ACTIVE_ADS' | 'NO_ACTIVE_AD_SETS' | 'ENDED' | 'SCHEDULED' | 'UNKNOWN';

export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  DELIVERING: 'Delivering',
  NO_ACTIVE_ADS: 'No active ads',
  NO_ACTIVE_AD_SETS: 'No active ad sets',
  ENDED: 'Ended',
  SCHEDULED: 'Scheduled',
  UNKNOWN: 'Delivery unknown',
};

interface Timed {
  start_time?: string;
  stop_time?: string;
  end_time?: string;
}

/**
 * Delivery of one campaign from what the sync read: the campaign (Meta status ACTIVE), its ad
 * sets with effective_status ACTIVE and its ads with effective_status ACTIVE. `adsKnown` is false
 * when Meta did not let the ads be read.
 */
export function deliveryState(
  campaign: Timed,
  activeAdSets: (Timed & { id: string })[],
  activeAds: { adset_id?: string }[],
  now: Date,
  adsKnown = true,
): DeliveryState {
  const t = now.getTime();
  const past = (iso?: string) => Boolean(iso) && Date.parse(iso!) <= t;
  const future = (iso?: string) => Boolean(iso) && Date.parse(iso!) > t;
  if (past(campaign.stop_time)) return 'ENDED';
  if (activeAdSets.length === 0) return 'NO_ACTIVE_AD_SETS';
  const running = activeAdSets.filter((s) => !past(s.end_time));
  if (running.length === 0) return 'ENDED';
  if (!adsKnown) return 'UNKNOWN';
  const runningIds = new Set(running.map((s) => s.id));
  const ads = activeAds.filter((a) => a.adset_id && runningIds.has(a.adset_id));
  if (ads.length === 0) return 'NO_ACTIVE_ADS';
  const setsWithAds = running.filter((s) => ads.some((a) => a.adset_id === s.id));
  if (future(campaign.start_time) || setsWithAds.every((s) => future(s.start_time))) return 'SCHEDULED';
  return 'DELIVERING';
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
  /** Null when this audit has no status listing for the account (older audits, or refused). */
  total: number | null;
  active: number | null;
  paused: number | null;
  archived: number | null;
  deleted: number | null;
  other: number | null;
  /** Campaigns with Meta status ACTIVE that the tracker audited. */
  audited: number;
  /** Of the audited: delivering, i.e. what Ads Manager calls Active. */
  delivering: number;
  notDelivering: Record<Exclude<DeliveryState, 'DELIVERING'>, number>;
  /** Meta's ACTIVE count equals the campaigns audited; null when there is no listing to compare. */
  reconciled: boolean | null;
  deletedIncluded: boolean | null;
}

export interface CampaignCountsSummary {
  accounts: AccountCampaignCounts[];
  all: AccountCampaignCounts;
  /** Older audits did not record per-campaign delivery. */
  deliveryKnown: boolean;
  lastSuccessfulSyncAt: string | null;
}

const NOT_DELIVERING_KEYS = ['NO_ACTIVE_ADS', 'NO_ACTIVE_AD_SETS', 'ENDED', 'SCHEDULED', 'UNKNOWN'] as const;
const emptyNotDelivering = () => Object.fromEntries(NOT_DELIVERING_KEYS.map((k) => [k, 0])) as AccountCampaignCounts['notDelivering'];

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
 * Builds the counts for one audit: per ad account from Meta's status listing (all statuses) and
 * the audited campaigns' delivery, plus an All accounts row. Campaigns are counted by unique Meta ID.
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
    const notDelivering = emptyNotDelivering();
    let delivering = 0;
    for (const c of mine) {
      const d = c.delivery ?? 'UNKNOWN';
      if (d === 'DELIVERING') delivering++;
      else notDelivering[d]++;
    }
    const m = a.campaignCounts ?? null;
    const g = m ? groupStatusCounts(m.byEffectiveStatus) : null;
    return {
      metaAccountId: a.metaAccountId,
      name: a.name,
      total: m?.total ?? null,
      active: g?.active ?? null,
      paused: g?.paused ?? null,
      archived: g?.archived ?? null,
      deleted: g?.deleted ?? null,
      other: g?.other ?? null,
      audited: mine.length,
      delivering,
      notDelivering,
      reconciled: g ? g.active === mine.length : null,
      deletedIncluded: m?.deletedIncluded ?? null,
    };
  });
  const sum = (k: 'total' | 'active' | 'paused' | 'archived' | 'deleted' | 'other') =>
    rows.length && rows.every((r) => r[k] !== null) ? rows.reduce((s, r) => s + r[k]!, 0) : null;
  const notDelivering = emptyNotDelivering();
  for (const r of rows) for (const k of NOT_DELIVERING_KEYS) notDelivering[k] += r.notDelivering[k];
  const all: AccountCampaignCounts = {
    metaAccountId: 'all',
    name: 'All accounts',
    total: sum('total'),
    active: sum('active'),
    paused: sum('paused'),
    archived: sum('archived'),
    deleted: sum('deleted'),
    other: sum('other'),
    audited: rows.reduce((s, r) => s + r.audited, 0),
    delivering: rows.reduce((s, r) => s + r.delivering, 0),
    notDelivering,
    reconciled: rows.length && rows.every((r) => r.reconciled !== null) ? rows.every((r) => r.reconciled) : null,
    deletedIncluded: rows.length && rows.every((r) => r.deletedIncluded !== null) ? rows.every((r) => r.deletedIncluded) : null,
  };
  return { accounts: rows, all, deliveryKnown: unique.every((c) => c.delivery !== null), lastSuccessfulSyncAt };
}
