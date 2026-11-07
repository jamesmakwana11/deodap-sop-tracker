/**
 * Campaign counts. A campaign is ACTIVE only when the campaign, every one of its ad sets and every
 * one of its ads have Meta effective_status ACTIVE (and it has started and not ended). One paused,
 * archived, in-review or otherwise inactive ad set or ad excludes the whole campaign.
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

/**
 * Ads Manager's "Active" = Meta's delivery status "active" (the campaign is delivering). The other
 * values follow Meta's delivery sub-statuses for a campaign whose own status is ACTIVE.
 */
export type MetaDelivery = 'DELIVERING' | 'NO_ADS' | 'ENDED' | 'ALL_AD_SETS_OFF' | 'ALL_ADS_OFF' | 'SCHEDULED' | 'UNKNOWN';
export const META_DELIVERY_REASONS = ['NO_ADS', 'ENDED', 'ALL_AD_SETS_OFF', 'ALL_ADS_OFF', 'SCHEDULED', 'UNKNOWN'] as const;
export type NotDeliveringReason = (typeof META_DELIVERY_REASONS)[number];
export const META_DELIVERY_LABEL: Record<MetaDelivery, string> = {
  DELIVERING: 'Delivering (Active in Ads Manager)',
  NO_ADS: 'No ads (none, or only archived)',
  ENDED: 'Completed (end date passed)',
  ALL_AD_SETS_OFF: 'All ad sets off',
  ALL_ADS_OFF: 'All ads off in the active ad sets',
  SCHEDULED: 'Scheduled (not started)',
  UNKNOWN: 'Ad set / ad status not readable',
};

/**
 * Whether Ads Manager shows this campaign (own status ACTIVE) as Active, i.e. delivering, worked out
 * from its ad sets and ads the way Meta's delivery status does (checked against Meta's own delivery
 * status for every Active campaign of the DeoDap account on 7 Nov 2026: 70 of 70 equal). Archived
 * ad sets and ads count as absent, as in Ads Manager.
 */
export function metaDelivery(
  campaign: Timed,
  adSets: (Timed & { id: string; effective_status?: string })[],
  ads: { adset_id?: string; effective_status?: string }[],
  now: Date,
  childrenKnown = true,
): MetaDelivery {
  if (!childrenKnown) return 'UNKNOWN';
  const t = now.getTime();
  const past = (iso?: string) => Boolean(iso) && Date.parse(iso!) <= t;
  const future = (iso?: string) => Boolean(iso) && Date.parse(iso!) > t;
  const liveAds = ads.filter((a) => a.effective_status !== 'ARCHIVED');
  if (liveAds.length === 0) return 'NO_ADS';
  if (past(campaign.stop_time)) return 'ENDED';
  const activeSets = adSets.filter((s) => s.effective_status === 'ACTIVE');
  if (activeSets.length === 0) return 'ALL_AD_SETS_OFF';
  const running = activeSets.filter((s) => !past(s.end_time));
  if (running.length === 0) return 'ENDED';
  const withActiveAd = running.filter((s) => liveAds.some((a) => a.adset_id === s.id && a.effective_status === 'ACTIVE'));
  if (withActiveAd.length === 0) return 'ALL_ADS_OFF';
  if (future(campaign.start_time) || withActiveAd.every((s) => future(s.start_time))) return 'SCHEDULED';
  return 'DELIVERING';
}

/** What Meta returned for the account's campaign list, before any counting. */
export interface RawCampaignListing {
  /** Rows on all pages, as returned. */
  rows: number;
  pages: number;
  uniqueIds: number;
  /** Rows repeating a campaign ID already seen (Meta's cursors can repeat a row). */
  duplicateRows: number;
  /** Rows whose account_id is not this ad account (never expected; dropped if seen). */
  otherAccountRows: number;
  /** By configured `status` (what the advertiser set). */
  byStatus: Record<string, number>;
  /** Campaigns whose `status` differs from `effective_status`. */
  statusDiffers: number;
}

/** Campaigns per Meta effective_status for one ad account, every status, unique campaign IDs. */
export interface MetaCampaignStatusCounts {
  /** Unique campaign IDs Meta returned across the (non-deleted) statuses requested. */
  total: number;
  byEffectiveStatus: Record<string, number>;
  /** Only on audits made before deleted campaigns were dropped from the listing. */
  deletedIncluded?: boolean;
  countedAt: string;
  /** Absent on audits made before the reconciliation was recorded. */
  raw?: RawCampaignListing;
}

export interface AccountCampaignCounts {
  metaAccountId: string;
  name: string;
  /** Every non-deleted campaign, unique campaign IDs. Null when this audit has no status listing for the account. */
  total: number | null;
  /** Campaigns whose own Meta status is ACTIVE, from the status listing. */
  metaActive: number | null;
  paused: number | null;
  archived: number | null;
  other: number | null;
  /** Total minus archived: what Ads Manager lists by default (it hides archived campaigns). */
  notArchived: number | null;
  /** Campaigns with Meta status ACTIVE that were audited. */
  audited: number;
  /** Strictly active: campaign, all ad sets and all ads ACTIVE. */
  active: number;
  /** Audited but not strictly active, by reason. */
  excluded: Record<ExclusionReason, number>;
  /** Meta's ACTIVE count equals the campaigns audited; null when there is no listing to compare. */
  reconciled: boolean | null;
  /** Delivering = Ads Manager's "Active"; null on audits made before it was recorded. */
  delivering: number | null;
  /** Campaign status ACTIVE but not delivering, by Meta delivery reason. */
  notDelivering: Record<NotDeliveringReason, number>;
  /** Raw campaign-list figures from Meta; null when this audit has none. */
  raw: RawCampaignListing | null;
}

export interface CampaignCountsSummary {
  accounts: AccountCampaignCounts[];
  all: AccountCampaignCounts;
  /** False for audits made before the strict check existed: refresh to get Active counts. */
  activeKnown: boolean;
  lastSuccessfulSyncAt: string | null;
}

const emptyNotDelivering = () => Object.fromEntries(META_DELIVERY_REASONS.map((k) => [k, 0])) as Record<NotDeliveringReason, number>;
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
 * Deleted campaigns are never part of current totals: Meta does not list them on the campaigns
 * edge, and audits made before that change have them subtracted here.
 * Counts for ONE audit (never mixed with older snapshots): per selected ad account from Meta's
 * status listing and the strict state of each audited campaign, plus All accounts. Campaigns are
 * counted once per Meta campaign ID; ad sets and ads are never counted as campaigns.
 */
export function buildCampaignCounts(
  accounts: { metaAccountId: string; name: string; status: 'succeeded' | 'failed'; campaignCounts?: MetaCampaignStatusCounts | null }[],
  campaigns: { metaCampaignId: string; account: { metaAccountId: string }; delivery: DeliveryState | null; metaDelivery?: MetaDelivery | null }[],
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
    const notDelivering = emptyNotDelivering();
    let delivering = 0;
    for (const c of mine) {
      if (c.metaDelivery === 'DELIVERING') delivering++;
      else if (c.metaDelivery) notDelivering[c.metaDelivery]++;
    }
    const total = m && g ? m.total - g.deleted : null;
    return {
      metaAccountId: a.metaAccountId,
      name: a.name,
      total,
      metaActive: g?.active ?? null,
      paused: g?.paused ?? null,
      archived: g?.archived ?? null,
      other: g?.other ?? null,
      notArchived: total !== null && g ? total - g.archived : null,
      audited: mine.length,
      active,
      excluded,
      reconciled: g ? g.active === mine.length : null,
      delivering: mine.every((c) => c.metaDelivery) ? delivering : null,
      notDelivering,
      raw: m?.raw ?? null,
    };
  });
  const sum = (k: 'total' | 'metaActive' | 'paused' | 'archived' | 'other' | 'notArchived' | 'delivering') =>
    rows.length && rows.every((r) => r[k] !== null) ? rows.reduce((s, r) => s + r[k]!, 0) : null;
  const excluded = emptyExcluded();
  for (const r of rows) for (const k of EXCLUSION_REASONS) excluded[k] += r.excluded[k];
  const notDelivering = emptyNotDelivering();
  for (const r of rows) for (const k of META_DELIVERY_REASONS) notDelivering[k] += r.notDelivering[k];
  const raws = rows.map((r) => r.raw);
  const rawAll: RawCampaignListing | null =
    rows.length && raws.every(Boolean)
      ? raws.reduce<RawCampaignListing>(
          (t, r) => ({
            rows: t.rows + r!.rows,
            pages: t.pages + r!.pages,
            uniqueIds: t.uniqueIds + r!.uniqueIds,
            duplicateRows: t.duplicateRows + r!.duplicateRows,
            otherAccountRows: t.otherAccountRows + r!.otherAccountRows,
            byStatus: Object.fromEntries([...new Set([...Object.keys(t.byStatus), ...Object.keys(r!.byStatus)])].map((k) => [k, (t.byStatus[k] ?? 0) + (r!.byStatus[k] ?? 0)])),
            statusDiffers: t.statusDiffers + r!.statusDiffers,
          }),
          { rows: 0, pages: 0, uniqueIds: 0, duplicateRows: 0, otherAccountRows: 0, byStatus: {}, statusDiffers: 0 },
        )
      : null;
  const all: AccountCampaignCounts = {
    metaAccountId: 'all',
    name: 'All accounts',
    total: sum('total'),
    metaActive: sum('metaActive'),
    paused: sum('paused'),
    archived: sum('archived'),
    other: sum('other'),
    notArchived: sum('notArchived'),
    audited: rows.reduce((s, r) => s + r.audited, 0),
    active: rows.reduce((s, r) => s + r.active, 0),
    excluded,
    reconciled: rows.length && rows.every((r) => r.reconciled !== null) ? rows.every((r) => r.reconciled) : null,
    delivering: sum('delivering'),
    notDelivering,
    raw: rawAll,
  };
  return { accounts: rows, all, activeKnown: unique.every((c) => deliveryChecked(c.delivery)), lastSuccessfulSyncAt };
}
