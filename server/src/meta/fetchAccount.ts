import { MetaApiError, type GraphClient } from './graphClient.js';
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

/** Every status a campaign can have in Meta (the values Meta accepts for campaign effective_status). */
const ALL_CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED', 'IN_PROCESS', 'WITH_ISSUES'];
const STATUS_FIELDS = 'id,account_id,name,status,configured_status,effective_status';

/** Meta's cursor paging can repeat a row when data changes mid-read; keep each ID once. */
const uniqueById = <T extends { id: string }>(rows: T[]): T[] => {
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.id) && seen.add(r.id));
};

/**
 * Lists the account's campaigns in every status (one light request, all pages) and counts them
 * by Meta effective_status, one per unique campaign ID. If Meta refuses to list deleted
 * campaigns, the count is made without them and says so.
 */
export async function fetchCampaignStatusCounts(graph: GraphClient, metaAccountId: string, now = new Date()): Promise<MetaCampaignStatusCounts> {
  const act = `act_${metaAccountId}`;
  const list = (statuses: string[]) =>
    graph.getAll<{ id: string; account_id?: string; effective_status?: string; status?: string }>(`${act}/campaigns`, {
      fields: STATUS_FIELDS,
      effective_status: statuses,
      limit: 500,
    });
  let deletedIncluded = true;
  let rows;
  try {
    rows = await list(ALL_CAMPAIGN_STATUSES);
  } catch (err) {
    if (!(err instanceof MetaApiError) || err.isTokenInvalid || err.isTransient) throw err;
    deletedIncluded = false;
    rows = await list(ALL_CAMPAIGN_STATUSES.filter((s) => s !== 'DELETED'));
  }
  const byEffectiveStatus: Record<string, number> = {};
  const unique = uniqueById(rows).filter((r) => !r.account_id || r.account_id === metaAccountId);
  for (const r of unique) {
    const s = r.effective_status ?? r.status ?? 'UNKNOWN';
    byEffectiveStatus[s] = (byEffectiveStatus[s] ?? 0) + 1;
  }
  return { total: unique.length, byEffectiveStatus, deletedIncluded, countedAt: now.toISOString() };
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
export async function fetchAccountSnapshots(graph: GraphClient, account: AccountRef, now = new Date(), notes: string[] = []): Promise<CampaignSnapshot[]> {
  const act = `act_${account.metaAccountId}`;
  const campaigns = uniqueById(
    await graph.getAll<RawCampaign>(`${act}/campaigns`, {
      fields: CAMPAIGN_FIELDS,
      effective_status: ACTIVE,
      limit: 200,
    }),
  );
  if (campaigns.length === 0) return [];

  let insightsUnavailable: string | null = null;
  const adsNotesBefore = notes.length;
  const [adSetsRaw, adsRaw, insights] = await Promise.all([
    graph.getAll<RawAdSet>(`${act}/adsets`, { fields: ADSET_FIELDS, effective_status: ACTIVE, limit: 200 }),
    fetchAds(graph, act, notes),
    // Account-level insights return one row per campaign that delivered; no row means no spend.
    graph.getAll<RawInsight>(`${act}/insights`, { level: 'campaign', date_preset: 'last_7d', fields: INSIGHT_FIELDS, limit: 500 }).catch((err: unknown) => {
      if (!isRefused(err)) throw err;
      insightsUnavailable = explainMetaError(err, { accountId: account.metaAccountId });
      notes.push(`Performance insights were not readable, so campaigns are Not rated: ${insightsUnavailable}`);
      return [] as RawInsight[];
    }),
  ]);

  const adSets = uniqueById(adSetsRaw);
  const ads = uniqueById(adsRaw);
  // Ads were refused entirely (not just reduced fields): delivery cannot be worked out.
  const adsKnown = !notes.slice(adsNotesBefore).some((n) => n.startsWith('Ads were not readable'));
  const insightByCampaign = new Map(insights.map((i) => [i.campaign_id, i]));
  const snapshots: CampaignSnapshot[] = [];

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
    snapshots.push({
      account,
      campaign,
      adSets: adSets.filter((a) => a.campaign_id === campaign.id),
      ads: ads.filter((a) => a.campaign_id === campaign.id),
      insights7d: insightByCampaign.get(campaign.id) ?? null,
      insightsFirst14d,
      insightsUnavailable,
      adsKnown,
    });
  }
  return snapshots;
}
