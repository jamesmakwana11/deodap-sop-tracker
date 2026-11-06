/** Shapes of the Meta Graph API objects this tracker reads. Every field is optional because Meta omits unset fields. */

export interface RawAdAccount {
  id: string; // "act_123"
  account_id: string; // "123"
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
  business?: { id: string; name?: string };
}

export interface RawCampaign {
  id: string;
  name: string;
  objective?: string;
  buying_type?: string;
  bid_strategy?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  effective_status?: string;
  status?: string;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  smart_promotion_type?: string;
}

export interface GeoLocation {
  key?: string;
  name?: string;
  region?: string;
  region_id?: number | string;
  country?: string;
}

export interface RawTargeting {
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  messenger_positions?: string[];
  audience_network_positions?: string[];
  threads_positions?: string[];
  geo_locations?: {
    countries?: string[];
    country_groups?: string[];
    regions?: GeoLocation[];
    cities?: GeoLocation[];
    zips?: GeoLocation[];
    custom_locations?: unknown[];
    places?: unknown[];
    location_types?: string[];
  };
  excluded_geo_locations?: {
    countries?: string[];
    regions?: GeoLocation[];
    cities?: GeoLocation[];
    zips?: GeoLocation[];
  };
  excluded_custom_audiences?: Array<{ id: string; name?: string }>;
  custom_audiences?: Array<{ id: string; name?: string }>;
}

export interface FrequencyControlSpec {
  event?: string;
  interval_days?: number;
  max_frequency?: number;
}

export interface RawAdSet {
  id: string;
  name: string;
  campaign_id: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  optimization_goal?: string;
  billing_event?: string;
  is_dynamic_creative?: boolean;
  frequency_control_specs?: FrequencyControlSpec[];
  targeting?: RawTargeting;
  start_time?: string;
}

interface CallToAction {
  type?: string;
}

export interface ObjectStorySpec {
  link_data?: { message?: string; name?: string; call_to_action?: CallToAction; picture?: string; child_attachments?: unknown[] };
  video_data?: { message?: string; title?: string; call_to_action?: CallToAction; image_url?: string };
  photo_data?: { caption?: string; url?: string };
  template_data?: { message?: string; name?: string; call_to_action?: CallToAction };
}

export interface AssetFeedSpec {
  bodies?: Array<{ text?: string }>;
  titles?: Array<{ text?: string }>;
  call_to_action_types?: string[];
}

export interface RawCreative {
  id: string;
  name?: string;
  body?: string;
  title?: string;
  call_to_action_type?: string;
  object_story_spec?: ObjectStorySpec;
  asset_feed_spec?: AssetFeedSpec;
  thumbnail_url?: string;
  image_url?: string;
  effective_object_story_id?: string;
  instagram_permalink_url?: string;
  object_type?: string;
}

export interface RawAd {
  id: string;
  name: string;
  adset_id: string;
  campaign_id: string;
  effective_status?: string;
  creative?: RawCreative;
}

export interface ActionStat {
  action_type: string;
  value: string;
}

export interface RawInsight {
  campaign_id?: string;
  spend?: string;
  reach?: string;
  impressions?: string;
  actions?: ActionStat[];
  action_values?: ActionStat[];
  date_start?: string;
  date_stop?: string;
}

/** Everything the rules and rating need about one campaign. */
export interface CampaignSnapshot {
  account: { metaAccountId: string; currency: string; timezone: string | null };
  campaign: RawCampaign;
  adSets: RawAdSet[];
  ads: RawAd[];
  insights7d: RawInsight | null;
  /** Insights for the campaign's first 14 days (Leads only). */
  insightsFirst14d: RawInsight | null;
}
