import { BID_STRATEGY_LABEL, MIN_DAILY_BUDGET_INR, SEVEN_SISTERS, type CheckResult, type ObjectiveLabel } from '@sop/shared';
import type { CampaignSnapshot, GeoLocation, RawAd, RawAdSet } from '../meta/types.js';
import { aggregate, ADS, AD_SETS, type ItemVerdict } from './aggregate.js';
import { checkNaming } from './naming.js';

/**
 * The nine automated SOP checks. Each returns PASS, FAIL, NOT_CHECKABLE (Meta does not
 * expose what we need) or NOT_APPLICABLE. Nothing is ever guessed into a PASS.
 */

// ── 1. Placements ──────────────────────────────────────────────────────────
const REQUIRED_PLATFORMS = ['facebook', 'instagram', 'threads'];
const PLATFORM_LABEL: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
  audience_network: 'Audience Network',
  messenger: 'Messenger',
  whatsapp: 'WhatsApp',
};
const label = (p: string) => PLATFORM_LABEL[p] ?? p;

export function placementVerdict(a: RawAdSet): ItemVerdict {
  if (!a.targeting) return { outcome: 'NOT_CHECKABLE', reason: 'targeting not returned' };
  const platforms = a.targeting.publisher_platforms;
  if (!platforms || platforms.length === 0) return { outcome: 'FAIL', reason: 'automatic placements' };
  const extra = platforms.filter((p) => !REQUIRED_PLATFORMS.includes(p));
  const missing = REQUIRED_PLATFORMS.filter((p) => !platforms.includes(p));
  const reasons = [...extra.map((p) => `${label(p)} on`), ...missing.map((p) => `${label(p)} missing`)];
  return reasons.length ? { outcome: 'FAIL', reason: reasons.join(', ') } : { outcome: 'PASS' };
}

export function checkPlacements(s: CampaignSnapshot): CheckResult {
  return aggregate(
    'placements',
    s.adSets.map(placementVerdict),
    AD_SETS,
    'are not exactly Facebook + Instagram + Threads',
    'No active ad sets to check',
  );
}

// ── 3. Bid strategy ────────────────────────────────────────────────────────
const positive = (v: string | undefined) => Number(v) > 0;
const hasCampaignBudget = (s: CampaignSnapshot) => positive(s.campaign.daily_budget) || positive(s.campaign.lifetime_budget);

export function checkBidStrategy(s: CampaignSnapshot, objective: ObjectiveLabel): CheckResult {
  if (objective === 'Other') {
    return { key: 'bid_strategy', outcome: 'NOT_CHECKABLE', detail: 'Objective is not one the SOP defines a bid strategy for' };
  }
  if (!hasCampaignBudget(s)) {
    return { key: 'bid_strategy', outcome: 'NOT_CHECKABLE', detail: 'Budget is set on the ad sets, so the SOP bid check does not apply' };
  }
  const actual = s.campaign.bid_strategy;
  if (!actual) return { key: 'bid_strategy', outcome: 'NOT_CHECKABLE', detail: 'Meta did not return a bid strategy' };
  const expected = objective === 'Sales' ? 'LOWEST_COST_WITHOUT_CAP' : 'COST_CAP';
  if (actual === expected) return { key: 'bid_strategy', outcome: 'PASS', detail: null };
  return {
    key: 'bid_strategy',
    outcome: 'FAIL',
    detail: `Bid strategy is ${BID_STRATEGY_LABEL[actual] ?? actual}; ${objective} needs ${BID_STRATEGY_LABEL[expected]}`,
  };
}

// ── 4. Frequency control (Awareness only) ──────────────────────────────────
export function frequencyVerdict(a: RawAdSet): ItemVerdict {
  const specs = a.frequency_control_specs ?? [];
  if (specs.length === 0) return { outcome: 'FAIL', reason: 'no frequency cap' };
  const ok = specs.some((f) => f.event === 'IMPRESSIONS' && f.interval_days === 7 && (f.max_frequency ?? Infinity) <= 2);
  if (ok) return { outcome: 'PASS' };
  const f = specs[0]!;
  return { outcome: 'FAIL', reason: `cap is ${f.max_frequency ?? '?'} per ${f.interval_days ?? '?'} days` };
}

export function checkFrequency(s: CampaignSnapshot, objective: ObjectiveLabel): CheckResult {
  if (objective !== 'Awareness') return { key: 'frequency', outcome: 'NOT_APPLICABLE', detail: 'Checked on Awareness campaigns only' };
  return aggregate(
    'frequency',
    s.adSets.map(frequencyVerdict),
    AD_SETS,
    'do not cap frequency at 2 impressions in 7 days',
    'No active ad sets to check',
  );
}

// ── 5. Minimum daily budget ────────────────────────────────────────────────
/** Meta returns budgets in the currency's minor unit (paise for INR). */
const toRupees = (minor: string) => Number(minor) / 100;
const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function budgetVerdict(daily: string | undefined, lifetime: string | undefined): ItemVerdict {
  if (daily && Number(daily) > 0) {
    const rupees = toRupees(daily);
    return rupees >= MIN_DAILY_BUDGET_INR ? { outcome: 'PASS' } : { outcome: 'FAIL', reason: `daily budget ${fmt(rupees)}` };
  }
  if (lifetime && Number(lifetime) > 0) return { outcome: 'NOT_CHECKABLE', reason: 'lifetime budget, no daily budget' };
  return { outcome: 'NOT_CHECKABLE', reason: 'no budget returned' };
}

export function checkMinBudget(s: CampaignSnapshot): CheckResult {
  if (s.account.currency !== 'INR') {
    return { key: 'min_budget', outcome: 'NOT_CHECKABLE', detail: `Account currency is ${s.account.currency}; the SOP minimum is in ₹` };
  }
  if (hasCampaignBudget(s)) {
    const v = budgetVerdict(s.campaign.daily_budget, s.campaign.lifetime_budget);
    if (v.outcome === 'PASS') return { key: 'min_budget', outcome: 'PASS', detail: null };
    if (v.outcome === 'FAIL') {
      return { key: 'min_budget', outcome: 'FAIL', detail: `Campaign ${v.reason}; SOP minimum is ${fmt(MIN_DAILY_BUDGET_INR)}` };
    }
    return { key: 'min_budget', outcome: 'NOT_CHECKABLE', detail: `Campaign has a ${v.reason}` };
  }
  return aggregate(
    'min_budget',
    s.adSets.map((a) => budgetVerdict(a.daily_budget, a.lifetime_budget)),
    AD_SETS,
    `have a daily budget under ${fmt(MIN_DAILY_BUDGET_INR)}`,
    'No budget found on the campaign or its active ad sets',
  );
}

// ── 6. Seven Sisters excluded ──────────────────────────────────────────────
const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const SISTERS = new Map(SEVEN_SISTERS.map((n) => [norm(n), n]));
const isSister = (g: GeoLocation | undefined) => Boolean(g && (SISTERS.has(norm(g.name)) || SISTERS.has(norm(g.region))));
const inIndia = (g: GeoLocation) => !g.country || g.country === 'IN';

export function sevenSistersVerdict(a: RawAdSet): ItemVerdict {
  const geo = a.targeting?.geo_locations;
  if (!geo) return { outcome: 'NOT_CHECKABLE', reason: 'location targeting not returned' };

  // Country groups (worldwide, regions of the world) can include India, so they need the exclusions too.
  if (geo.countries?.includes('IN') || (geo.country_groups?.length ?? 0) > 0) {
    const excluded = new Set((a.targeting?.excluded_geo_locations?.regions ?? []).map((r) => norm(r.name)));
    const notExcluded = SEVEN_SISTERS.filter((n) => !excluded.has(norm(n)));
    if (notExcluded.length === 0) return { outcome: 'PASS' };
    return {
      outcome: 'FAIL',
      reason: notExcluded.length === SEVEN_SISTERS.length ? 'none excluded' : `${notExcluded.join(', ')} not excluded`,
    };
  }

  const regions = (geo.regions ?? []).filter(inIndia);
  const cities = (geo.cities ?? []).filter(inIndia);
  const targeted = [...regions, ...cities].filter(isSister);
  if (targeted.length) return { outcome: 'FAIL', reason: `targets ${[...new Set(targeted.map((g) => g.name))].join(', ')}` };
  // Postcodes and radius targeting carry no state, so they cannot be cleared.
  if (geo.zips?.length || geo.custom_locations?.length || geo.places?.length) {
    return { outcome: 'NOT_CHECKABLE', reason: 'postcode or radius targeting' };
  }
  if (regions.length || cities.length) {
    // Only named Indian locations outside the north-east: nothing there to exclude.
    if (cities.some((c) => !c.region)) return { outcome: 'NOT_CHECKABLE', reason: 'city without a state returned' };
    return { outcome: 'PASS' };
  }
  return { outcome: 'NOT_APPLICABLE', reason: 'does not target India' };
}

export function checkSevenSisters(s: CampaignSnapshot): CheckResult {
  return aggregate(
    'seven_sisters',
    s.adSets.map(sevenSistersVerdict),
    AD_SETS,
    'do not exclude all Seven Sisters states',
    'No active ad sets to check',
  );
}

// ── 7. Creative complete ───────────────────────────────────────────────────
export function creativeTextAndCta(ad: RawAd): { text: string | null; cta: string | null; exposed: boolean } {
  const c = ad.creative;
  if (!c) return { text: null, cta: null, exposed: false };
  const oss = c.object_story_spec;
  const afs = c.asset_feed_spec;
  const text =
    c.body ||
    oss?.link_data?.message ||
    oss?.video_data?.message ||
    oss?.template_data?.message ||
    oss?.photo_data?.caption ||
    afs?.bodies?.find((b) => b.text?.trim())?.text ||
    null;
  const ctaRaw =
    c.call_to_action_type ||
    oss?.link_data?.call_to_action?.type ||
    oss?.video_data?.call_to_action?.type ||
    oss?.template_data?.call_to_action?.type ||
    afs?.call_to_action_types?.[0] ||
    null;
  const cta = ctaRaw && ctaRaw !== 'NO_BUTTON' ? ctaRaw : null;
  // A boosted existing post keeps its text in the post, so a CTA alone does not expose the creative.
  const exposed = Boolean(c.body || oss || afs) || (Boolean(c.call_to_action_type) && !c.effective_object_story_id);
  return { text: text?.trim() || null, cta, exposed };
}

export function creativeVerdict(ad: RawAd): ItemVerdict {
  if (!ad.creative) return { outcome: 'NOT_CHECKABLE', reason: 'creative not returned' };
  const { text, cta, exposed } = creativeTextAndCta(ad);
  if (!exposed) {
    return {
      outcome: 'NOT_CHECKABLE',
      reason: ad.creative.effective_object_story_id ? 'uses an existing post' : 'creative details not returned',
    };
  }
  if (text && cta) return { outcome: 'PASS' };
  if (!text && !cta) return { outcome: 'FAIL', reason: 'no primary text or call-to-action' };
  return { outcome: 'FAIL', reason: text ? 'no call-to-action button' : 'no primary text' };
}

export function checkCreativeComplete(s: CampaignSnapshot): CheckResult {
  return aggregate('creative_complete', s.ads.map(creativeVerdict), ADS, 'are incomplete', 'No active ads to check');
}

// ── 8. Buying type ─────────────────────────────────────────────────────────
export function checkBuyingType(s: CampaignSnapshot): CheckResult {
  const bt = s.campaign.buying_type;
  if (!bt) return { key: 'buying_type', outcome: 'NOT_CHECKABLE', detail: 'Meta did not return a buying type' };
  if (bt === 'AUCTION') return { key: 'buying_type', outcome: 'PASS', detail: null };
  const name = bt === 'RESERVED' ? 'Reservation' : bt;
  return { key: 'buying_type', outcome: 'FAIL', detail: `Buying type is ${name}; SOP requires Auction` };
}

// ── 9. Dynamic creative off ────────────────────────────────────────────────
function dynamicVerdict(a: RawAdSet): ItemVerdict {
  if (a.is_dynamic_creative === undefined) return { outcome: 'NOT_CHECKABLE', reason: 'setting not returned' };
  return a.is_dynamic_creative ? { outcome: 'FAIL' } : { outcome: 'PASS' };
}

export function checkDynamicCreative(s: CampaignSnapshot): CheckResult {
  return aggregate('dynamic_creative', s.adSets.map(dynamicVerdict), AD_SETS, 'have dynamic creative switched on', 'No active ad sets to check');
}

// ── All nine ───────────────────────────────────────────────────────────────
export function runSopChecks(s: CampaignSnapshot, objective: ObjectiveLabel): CheckResult[] {
  return [
    checkNaming(s.campaign.name, objective),
    checkBuyingType(s),
    checkBidStrategy(s, objective),
    checkMinBudget(s),
    checkDynamicCreative(s),
    checkSevenSisters(s),
    checkPlacements(s),
    checkFrequency(s, objective),
    checkCreativeComplete(s),
  ];
}
