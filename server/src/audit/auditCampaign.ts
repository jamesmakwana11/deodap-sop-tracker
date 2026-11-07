import { deliveryState, metaDelivery } from '@sop/shared';
import type { CampaignSnapshot, GeoLocation, RawAdSet } from '../meta/types.js';
import type { AdAuditInput, AdSetAuditInput, CampaignAuditInput } from '../repositories/auditWriter.js';
import { mapObjective } from './objective.js';
import { rankLeads, rateCampaign, spendOf, type RatingOutcome } from './rating.js';
import { creativeTextAndCta, runSopChecks } from './sopChecks.js';

/** Meta money fields are in minor units (paise). */
const rupees = (minor: string | undefined) => (minor && Number(minor) > 0 ? Number(minor) / 100 : null);

function places(list: { countries?: string[]; regions?: GeoLocation[]; cities?: GeoLocation[] } | undefined): string | null {
  if (!list) return null;
  const parts = [...(list.countries ?? []), ...(list.regions ?? []).map((r) => r.name), ...(list.cities ?? []).map((c) => c.name)];
  const clean = parts.filter(Boolean) as string[];
  return clean.length ? clean.join(', ') : null;
}

function frequencyText(a: RawAdSet): string | null {
  const f = a.frequency_control_specs?.[0];
  return f ? `${f.max_frequency ?? '?'} ${(f.event ?? 'impressions').toLowerCase()} per ${f.interval_days ?? '?'} days` : null;
}

function toAdSetInput(a: RawAdSet): AdSetAuditInput {
  return {
    metaAdSetId: a.id,
    name: a.name,
    effectiveStatus: a.effective_status ?? null,
    dailyBudget: rupees(a.daily_budget),
    lifetimeBudget: rupees(a.lifetime_budget),
    bidStrategy: a.bid_strategy ?? null,
    optimizationGoal: a.optimization_goal ?? null,
    isDynamicCreative: a.is_dynamic_creative ?? null,
    publisherPlatforms: a.targeting?.publisher_platforms ?? null,
    frequencyCap: frequencyText(a),
    locations: places(a.targeting?.geo_locations),
    excludedLocations: places(a.targeting?.excluded_geo_locations),
    rawSnapshot: a,
  };
}

function toAdInputs(s: CampaignSnapshot): AdAuditInput[] {
  return s.ads.map((ad) => {
    const c = ad.creative;
    const { text, cta } = creativeTextAndCta(ad);
    const oss = c?.object_story_spec;
    return {
      metaAdSetId: ad.adset_id ?? null,
      metaAdId: ad.id,
      name: ad.name,
      effectiveStatus: ad.effective_status ?? null,
      creativeId: c?.id ?? null,
      primaryText: text,
      headline: c?.title || oss?.link_data?.name || oss?.video_data?.title || oss?.template_data?.name || null,
      ctaType: cta,
      thumbnailUrl: c?.thumbnail_url ?? null,
      imageUrl: c?.image_url || oss?.link_data?.picture || oss?.video_data?.image_url || null,
      permalinkUrl: c?.instagram_permalink_url ?? null,
      rawSnapshot: ad,
    };
  });
}

/**
 * Audits every campaign of a run. Ratings are computed together because Leads are ranked
 * against each other.
 */
export function auditCampaigns(snapshots: CampaignSnapshot[], periodEnd: Date, now = new Date()): CampaignAuditInput[] {
  const objectives = snapshots.map((s) => mapObjective(s.campaign.objective));
  const ratings: RatingOutcome[] = snapshots.map((s, i) => rateCampaign(s, objectives[i]!, periodEnd));
  rankLeads(ratings.filter((_, i) => objectives[i] === 'Leads'));

  return snapshots.map((s, i) => {
    const r = ratings[i]!;
    return {
      metaCampaignId: s.campaign.id,
      name: s.campaign.name,
      objectiveRaw: s.campaign.objective ?? 'UNKNOWN',
      objective: objectives[i]!,
      effectiveStatus: s.campaign.effective_status ?? null,
      // Active only when the campaign, ALL its ad sets and ALL its ads are ACTIVE. Does not affect rating or SOP checks.
      delivery: deliveryState(
        s.campaign,
        s.allAdSets ?? s.adSets,
        s.allAds ?? s.ads,
        now,
        s.childrenKnown ?? s.adsKnown !== false,
      ),
      // Meta's delivery status (Ads Manager "Active" = DELIVERING), for the count reconciliation only.
      metaDelivery: metaDelivery(s.campaign, s.allAdSets ?? s.adSets, s.allAds ?? s.ads, now, s.childrenKnown ?? s.adsKnown !== false),
      currency: s.account.currency,
      spend7d: spendOf(s.insights7d),
      mainMetric: r.metric,
      rating: r.rating,
      ratingIndicative: r.indicative,
      ratingNote: r.note,
      leadsBaselineCpl: r.leadsBaselineCpl,
      checks: runSopChecks(s, objectives[i]!),
      buyingType: s.campaign.buying_type ?? null,
      bidStrategy: s.campaign.bid_strategy ?? null,
      dailyBudget: rupees(s.campaign.daily_budget),
      lifetimeBudget: rupees(s.campaign.lifetime_budget),
      startTime: s.campaign.start_time ?? null,
      rawSnapshot: { campaign: s.campaign, insights7d: s.insights7d, insightsFirst14d: s.insightsFirst14d },
      adSets: s.adSets.map(toAdSetInput),
      ads: toAdInputs(s),
    };
  });
}
