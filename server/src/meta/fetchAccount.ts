import { MetaApiError, type GraphClient, type GraphParams } from './graphClient.js';
import { explainMetaError, isFieldPermissionError } from './permissions.js';
import type { MetaCampaignStatusCounts } from '@sop/shared';
import type { CampaignSnapshot, RawAd, RawAdSet, RawCampaign, RawInsight } from './types.js';

/**
 * Graph reads for one ad account. Every call is a GET; nothing in Meta is changed.
 * Every field here is readable with ads_read alone (no business_management).
 *
 * Campaigns and ad sets are required: without them nothing can be audited, so an error there fails
 * the account with an explanation. Ads, creatives and insights are read as far as Meta allows: when
 * a field or edge is refused, the account is still audited with less detail and a note says what is
 * missing — affected checks become NOT CHECKABLE and ratings Not rated, never guessed.
 */

const CAMPAIGN_FIELDS = [
  'id', 'name', 'objective', 'buying_type', 'bid_strategy', 'daily_budget', 'lifetime_budget',
  'effective_status', 'status', 'start_time', 'stop_time', 'created_time', 'smart_promotion_type',
].join(',');

const ADSET_FIELDS = [
  'id', 'name', 'campaign_id', 'effective_status', 'daily_budget', 'lifetime_budget', 'bid_strategy',
  'optimization_goal', 'billing_event', 'is_dynamic_creative', 'frequency_control_specs', 'targeting', 'start_time',
  'end_time',
].join(',');

const CREATIVE_FIELDS = [
  'id', 'name', 'body', 'title', 'call_to_action_type', 'object_story_spec', 'asset_feed_spec',
  'thumbnail_url', 'image_url', 'effective_object_story_id', 'instagram_permalink_url', 'object_type',
].join(',');

const AD_FIELDS = `id,name,adset_id,campaign_id,effective_status,creative{${CREATIVE_FIELDS}}`;
/** Fallbacks when Meta refuses some creative fields: basic creative text, then ads without creatives. */
const AD_FIELDS_BASIC = 'id,name,adset_id,campaign_id,effective_status,creative{id,name,body,title,call_to_action_type,thumbnail_url,image_url,object_type}';
const AD_FIELDS_MINIMAL = 'id,name,adset_id,campaign_id,effective_status';
const INSIGHT_FIELDS = 'campaign_id,spend,reach,impressions,actions,action_values';
const ACTIVE = ['ACTIVE'];

/**
 * effective_status values for the campaigns / adsets / ads COLLECTION edges. DELETED is never
 * requested: Meta refuses it there ("(#100) Requesting for deleted objects is not supported in
 * this endpoint", subcode 1815001), and deleted objects are not part of current data. The Graph
 * client also strips DELETED from any status filter as a safety net.
 */
const ALL_CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES'];
const STATUS_FIELDS = 'id,account_id,name,status,configured_status,effective_status';

/** Ad set and ad statuses (non-deleted) Meta accepts in effective_status filters. */
const ALL_ADSET_STATUSES = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES'];
const INACTIVE_AD_STATUSES = ['PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'CAMPAIGN_PAUSED', 'ARCHIVED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES'];
const CHILD_STATUS_FIELDS = 'id,campaign_id,adset_id,effective_status';
/** Campaign IDs per filtered request. */
const CAMPAIGN_FILTER_CHUNK = 50;

interface RawChild {
  id: string;
  campaign_id: string;
  adset_id?: string;
  effective_status?: string;
}

/** Runs at most `n` of the given tasks at once. */
function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            queue.shift()?.();
          });
      };
      if (active < n) run();
      else queue.push(run);
    });
}

/**
 * Reads an ad set / ad edge for the given campaigns only (Meta `filtering` on campaign.id, in
 * chunks), so old campaigns' history is never downloaded. If Meta rejects the filter, reads the
 * account-wide list and keeps these campaigns' rows.
 */
async function readForCampaigns<T extends { id: string; campaign_id: string }>(
  graph: GraphClient,
  act: string,
  edge: 'adsets' | 'ads',
  params: GraphParams,
  campaignIds: string[],
): Promise<T[]> {
  const out: T[] = [];
  try {
    for (let i = 0; i < campaignIds.length; i += CAMPAIGN_FILTER_CHUNK) {
      const chunk = campaignIds.slice(i, i + CAMPAIGN_FILTER_CHUNK);
      out.push(...(await graph.getAll<T>(`${act}/${edge}`, { ...params, filtering: [{ field: 'campaign.id', operator: 'IN', value: chunk }] })));
    }
    return out;
  } catch (err) {
    const filterRejected = err instanceof MetaApiError && err.code === 100 && /filter/i.test(err.message);
    if (!filterRejected) throw err;
    const wanted = new Set(campaignIds);
    return (await graph.getAll<T>(`${act}/${edge}`, params)).filter((r) => wanted.has(r.campaign_id));
  }
}

/** Meta's cursor paging can repeat a row when data changes mid-read; keep each ID once. */
const uniqueById = <T extends { id: string }>(rows: T[]): T[] => {
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.id) && seen.add(r.id));
};

/**
 * Lists the account's campaigns in every non-deleted status (one light request, all pages) and
 * counts them by Meta effective_status, one per unique campaign ID.
 */
export async function fetchCampaignStatusCounts(graph: GraphClient, metaAccountId: string, now = new Date()): Promise<MetaCampaignStatusCounts> {
  const act = `act_${metaAccountId}`;
  let pages = 0;
  const rows = await graph.getAll<{ id: string; account_id?: string; effective_status?: string; status?: string; configured_status?: string }>(
    `${act}/campaigns`,
    { fields: STATUS_FIELDS, effective_status: ALL_CAMPAIGN_STATUSES, limit: 500 },
    50_000,
    () => pages++,
  );
  const deduped = uniqueById(rows);
  const mine = deduped.filter((r) => !r.account_id || r.account_id === metaAccountId);
  const unique = mine.filter((r) => r.effective_status !== 'DELETED');
  const byEffectiveStatus: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let statusDiffers = 0;
  for (const r of unique) {
    const eff = r.effective_status ?? r.status ?? 'UNKNOWN';
    const set = r.status ?? r.configured_status ?? 'UNKNOWN';
    byEffectiveStatus[eff] = (byEffectiveStatus[eff] ?? 0) + 1;
    byStatus[set] = (byStatus[set] ?? 0) + 1;
    if (set !== eff) statusDiffers++;
  }
  return {
    total: unique.length,
    byEffectiveStatus,
    countedAt: now.toISOString(),
    raw: {
      rows: rows.length,
      pages,
      uniqueIds: deduped.length,
      duplicateRows: rows.length - deduped.length,
      otherAccountRows: deduped.length - mine.length,
      byStatus,
      statusDiffers,
    },
  };
}
const DAY = 86_400_000;

export interface AccountRef {
  metaAccountId: string;
  currency: string;
  timezone: string | null;
}

/** Adds days to a YYYY-MM-DD date. */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Refused for this token (permission or unsupported field), as opposed to an outage or an invalid token. */
const isRefused = (err: unknown) => err instanceof MetaApiError && !err.isTokenInvalid && !err.isTransient && isFieldPermissionError(err);

async function fetchAds(graph: GraphClient, act: string, notes: string[]): Promise<RawAd[]> {
  const attempts = [AD_FIELDS, AD_FIELDS_BASIC, AD_FIELDS_MINIMAL];
  for (let i = 0; ; i++) {
    try {
      const ads = await graph.getAll<RawAd>(`${act}/ads`, { fields: attempts[i], effective_status: ACTIVE, limit: 100 });
      if (i > 0) notes.push(i === 1 ? 'Some creative details (story spec, Instagram link) were not readable; creatives were checked with the basic fields.' : 'Ad creatives were not readable; creative checks are NOT CHECKABLE.');
      return ads;
    } catch (err) {
      if (!isRefused(err) || i === attempts.length - 1) {
        if (isRefused(err)) {
          notes.push(`Ads were not readable: ${explainMetaError(err, { accountId: act.slice(4) })}`);
          return [];
        }
        throw err;
      }
    }
  }
}

/**
 * Reads up to date data for every active campaign of one account. `notes` collects what could
 * not be read (shown with the run), so a partial read is never silent.
 */
export async function fetchAccountSnapshots(
  graph: GraphClient,
  account: AccountRef,
  now = new Date(),
  notes: string[] = [],
  onStep: (step: string) => void = () => {},
): Promise<CampaignSnapshot[]> {
  const act = `act_${account.metaAccountId}`;
  onStep('campaigns');
  const campaigns = uniqueById(
    await graph.getAll<RawCampaign>(`${act}/campaigns`, {
      fields: CAMPAIGN_FIELDS,
      effective_status: ACTIVE,
      limit: 200,
    }),
  );
  if (campaigns.length === 0) return [];
  const ids = campaigns.map((c) => c.id);

  let insightsUnavailable: string | null = null;
  let inactiveAdsKnown = true;
  const adsNotesBefore = notes.length;
  const limit = limiter(2); // at most two requests to this ad account at a time
  onStep('ad sets, ads and insights');
  const [adSetsRaw, adsRaw, inactiveAdsRaw, insights] = await Promise.all([
    // Ad sets of these campaigns in EVERY status: the active ones are audited, all decide whether the campaign is Active.
    limit(() => readForCampaigns<RawAdSet>(graph, act, 'adsets', { fields: ADSET_FIELDS, effective_status: ALL_ADSET_STATUSES, limit: 200 }, ids)),
    limit(() => fetchAds(graph, act, notes)),
    // Ads of these campaigns that are NOT active (light fields): one is enough to exclude the campaign.
    limit(() =>
      readForCampaigns<RawChild>(graph, act, 'ads', { fields: CHILD_STATUS_FIELDS, effective_status: INACTIVE_AD_STATUSES, limit: 500 }, ids).catch((err: unknown) => {
        if (!isRefused(err)) throw err;
        inactiveAdsKnown = false;
        notes.push(`Inactive ads could not be listed, so campaigns of this account cannot be confirmed Active: ${explainMetaError(err, { accountId: account.metaAccountId })}`);
        return [] as RawChild[];
      }),
    ),
    // Account-level insights return one row per campaign that delivered; no row means no spend.
    limit(() =>
      graph.getAll<RawInsight>(`${act}/insights`, { level: 'campaign', date_preset: 'last_7d', fields: INSIGHT_FIELDS, limit: 500 }).catch((err: unknown) => {
        if (!isRefused(err)) throw err;
        insightsUnavailable = explainMetaError(err, { accountId: account.metaAccountId });
        notes.push(`Performance insights were not readable, so campaigns are Not rated: ${insightsUnavailable}`);
        return [] as RawInsight[];
      }),
    ),
  ]);

  const allAdSets = uniqueById(adSetsRaw);
  const adSets = allAdSets.filter((a) => a.effective_status === 'ACTIVE'); // audited, as before
  const ads = uniqueById(adsRaw);
  const inactiveAds = uniqueById(inactiveAdsRaw).filter((a) => a.effective_status !== 'ACTIVE');
  // Ads were refused entirely (not just reduced fields): their status is unknown.
  const adsKnown = !notes.slice(adsNotesBefore).some((n) => n.startsWith('Ads were not readable'));
  const childrenKnown = adsKnown && inactiveAdsKnown;
  const insightByCampaign = new Map(insights.map((i) => [i.campaign_id, i]));
  const snapshots: CampaignSnapshot[] = [];

  if (campaigns.some((c) => c.objective === 'OUTCOME_LEADS' || c.objective === 'LEAD_GENERATION')) onStep('first-14-day insights for Leads');
  for (const campaign of campaigns) {
    let insightsFirst14d: RawInsight | null = null;
    const isLeads = campaign.objective === 'OUTCOME_LEADS' || campaign.objective === 'LEAD_GENERATION';
    if (isLeads && !insightsUnavailable && campaign.start_time && now.getTime() - Date.parse(campaign.start_time) >= 14 * DAY) {
      const since = campaign.start_time.slice(0, 10); // already in the account's time zone
      try {
        const res = await graph.get<{ data: RawInsight[] }>(`${campaign.id}/insights`, {
          fields: 'spend,actions',
          time_range: { since, until: addDays(since, 13) },
        });
        insightsFirst14d = res.data[0] ?? { spend: '0', actions: [] };
      } catch (err) {
        // This campaign is simply Not rated; the rest of the account is still audited.
        console.warn(`First-14-day insights failed for campaign ${campaign.id}:`, (err as Error).message);
      }
    }
    const activeAds = ads.filter((a) => a.campaign_id === campaign.id);
    snapshots.push({
      account,
      campaign,
      adSets: adSets.filter((a) => a.campaign_id === campaign.id),
      ads: activeAds,
      allAdSets: allAdSets.filter((a) => a.campaign_id === campaign.id),
      allAds: [...activeAds.map((a) => ({ id: a.id, adset_id: a.adset_id, effective_status: a.effective_status ?? 'ACTIVE' })), ...inactiveAds.filter((a) => a.campaign_id === campaign.id)],
      childrenKnown,
      insights7d: insightByCampaign.get(campaign.id) ?? null,
      insightsFirst14d,
      insightsUnavailable,
      adsKnown,
    });
  }
  return snapshots;
}
