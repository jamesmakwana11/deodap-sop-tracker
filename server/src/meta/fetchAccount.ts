import type { GraphClient } from './graphClient.js';
import type { CampaignSnapshot, RawAd, RawAdSet, RawCampaign, RawInsight } from './types.js';

/** Graph reads for one ad account. Every call is a GET; nothing in Meta is changed. */

const CAMPAIGN_FIELDS = [
  'id', 'name', 'objective', 'buying_type', 'bid_strategy', 'daily_budget', 'lifetime_budget',
  'effective_status', 'status', 'start_time', 'stop_time', 'created_time', 'smart_promotion_type',
].join(',');

const ADSET_FIELDS = [
  'id', 'name', 'campaign_id', 'effective_status', 'daily_budget', 'lifetime_budget', 'bid_strategy',
  'optimization_goal', 'billing_event', 'is_dynamic_creative', 'frequency_control_specs', 'targeting', 'start_time',
].join(',');

const CREATIVE_FIELDS = [
  'id', 'name', 'body', 'title', 'call_to_action_type', 'object_story_spec', 'asset_feed_spec',
  'thumbnail_url', 'image_url', 'effective_object_story_id', 'instagram_permalink_url', 'object_type',
].join(',');

const AD_FIELDS = `id,name,adset_id,campaign_id,effective_status,creative{${CREATIVE_FIELDS}}`;
const INSIGHT_FIELDS = 'campaign_id,spend,reach,impressions,actions,action_values';
const ACTIVE = ['ACTIVE'];
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

export async function fetchAccountSnapshots(graph: GraphClient, account: AccountRef, now = new Date()): Promise<CampaignSnapshot[]> {
  const act = `act_${account.metaAccountId}`;
  const campaigns = await graph.getAll<RawCampaign>(`${act}/campaigns`, {
    fields: CAMPAIGN_FIELDS,
    effective_status: ACTIVE,
    limit: 200,
  });
  if (campaigns.length === 0) return [];

  const [adSets, ads, insights] = await Promise.all([
    graph.getAll<RawAdSet>(`${act}/adsets`, { fields: ADSET_FIELDS, effective_status: ACTIVE, limit: 200 }),
    graph.getAll<RawAd>(`${act}/ads`, { fields: AD_FIELDS, effective_status: ACTIVE, limit: 100 }),
    // Account-level insights return one row per campaign that delivered; no row means no spend.
    graph.getAll<RawInsight>(`${act}/insights`, { level: 'campaign', date_preset: 'last_7d', fields: INSIGHT_FIELDS, limit: 500 }),
  ]);

  const insightByCampaign = new Map(insights.map((i) => [i.campaign_id, i]));
  const snapshots: CampaignSnapshot[] = [];

  for (const campaign of campaigns) {
    let insightsFirst14d: RawInsight | null = null;
    const isLeads = campaign.objective === 'OUTCOME_LEADS' || campaign.objective === 'LEAD_GENERATION';
    if (isLeads && campaign.start_time && now.getTime() - Date.parse(campaign.start_time) >= 14 * DAY) {
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
    });
  }
  return snapshots;
}
