/**
 * DEVELOPMENT DATA — NOT REAL META RESULTS.
 *
 * Hand-written sample records used only to build and test the dashboard before
 * Meta OAuth (Phase 2) exists. Account ids are fake ("dev-…"), every campaign name
 * is prefixed "[DEV]", ratings are typed in rather than calculated, and check
 * outcomes are typed in rather than produced by the SOP validators (Phase 3).
 * The run is stored with source = 'development' and the UI labels it as such.
 */
import { SOP_RULES, type CheckOutcome, type CheckResult } from '@sop/shared';
import type { AdAccountInput, AdAuditInput, AdSetAuditInput, CampaignAuditInput } from '../repositories/auditWriter.js';

export const DEV_ACCOUNTS: readonly AdAccountInput[] = [
  { metaAccountId: 'dev-0000000001', name: 'DEV Sample Account A', isDevData: true },
  { metaAccountId: 'dev-0000000002', name: 'DEV Sample Account B', isDevData: true },
];

const CODE: Record<string, CheckOutcome> = { P: 'PASS', F: 'FAIL', C: 'NOT_CHECKABLE', N: 'NOT_APPLICABLE' };

/**
 * Outcomes in SOP column order: Naming, Buying, Bid, Budget, Dyn. creative,
 * 7 Sisters, Placements, Freq., Creative. Failed checks take a detail line.
 */
function checks(codes: string, details: Partial<Record<CheckResult['key'], string>> = {}): CheckResult[] {
  const letters = codes.replace(/\s+/g, '');
  if (letters.length !== SOP_RULES.length) throw new Error(`Expected ${SOP_RULES.length} codes, got "${codes}"`);
  return SOP_RULES.map((rule, i) => {
    const outcome = CODE[letters[i]!];
    if (!outcome) throw new Error(`Unknown check code "${letters[i]}"`);
    return { key: rule.key, outcome, detail: details[rule.key] ?? null };
  });
}

type Fixture = Omit<CampaignAuditInput, 'currency' | 'effectiveStatus'> & { account: 0 | 1 };

const PLACEMENT_DETAIL = '1 of 1 ad sets are not exactly Facebook + Instagram + Threads (Audience Network on; Threads missing)';

function devAdSet(id: string, name: string, platforms: string[]): AdSetAuditInput {
  return {
    metaAdSetId: id, name, effectiveStatus: 'ACTIVE', dailyBudget: null, lifetimeBudget: null, bidStrategy: null,
    optimizationGoal: 'OFFSITE_CONVERSIONS', isDynamicCreative: false, publisherPlatforms: platforms, frequencyCap: null,
    locations: 'IN', excludedLocations: 'Arunachal Pradesh, Assam, Manipur, Meghalaya, Mizoram, Nagaland, Tripura',
    rawSnapshot: { devData: true },
  };
}

function devAd(id: string, adSetId: string, name: string, text: string | null, cta: string | null): AdAuditInput {
  return {
    metaAdSetId: adSetId, metaAdId: id, name, effectiveStatus: 'ACTIVE', creativeId: null, primaryText: text,
    headline: '[DEV] Sample headline', ctaType: cta, thumbnailUrl: null, imageUrl: null, permalinkUrl: null,
    rawSnapshot: { devData: true },
  };
}

export const DEV_CAMPAIGNS: readonly Fixture[] = [
  {
    account: 0, metaCampaignId: 'dev-c-001', name: '[DEV] 1001 | AA | Carousel | Sales | 01.10.2026',
    objectiveRaw: 'OUTCOME_SALES', objective: 'Sales', spend7d: 182_400,
    mainMetric: { kind: 'roas', value: 7.6 }, rating: 'GOOD', ratingIndicative: false,
    checks: checks('PPPPPP F N P', { placements: PLACEMENT_DETAIL }),
    buyingType: 'AUCTION', bidStrategy: 'LOWEST_COST_WITHOUT_CAP', dailyBudget: 25_000, startTime: '2026-10-01T10:00:00+05:30',
    adSets: [devAdSet('dev-s-001', '[DEV] Broad India 25-45', ['facebook', 'instagram', 'audience_network'])],
    ads: [
      devAd('dev-a-001', 'dev-s-001', '[DEV] Carousel – kitchen set', 'Sample primary text for development.', 'SHOP_NOW'),
      devAd('dev-a-002', 'dev-s-001', '[DEV] Carousel – storage', 'Sample primary text for development.', 'SHOP_NOW'),
    ],
  },
  {
    account: 0, metaCampaignId: 'dev-c-002', name: '[DEV] 1002 | BB | Video | Sales | 14.09.2026',
    objectiveRaw: 'OUTCOME_SALES', objective: 'Sales', spend7d: 96_250,
    mainMetric: { kind: 'roas', value: 4.4 }, rating: 'AVERAGE', ratingIndicative: false,
    checks: checks('PP C PPP F N P', { placements: '2 of 2 ad sets include Audience Network' }),
  },
  {
    account: 0, metaCampaignId: 'dev-c-003', name: '[DEV] Sales Push Catalog',
    objectiveRaw: 'OUTCOME_SALES', objective: 'Sales', spend7d: 41_900,
    mainMetric: { kind: 'roas', value: 2.1 }, rating: 'BAD', ratingIndicative: false,
    checks: checks('FPF PPF F N P', {
      naming: 'Name has no creative format or date',
      bid_strategy: 'Bid strategy is Cost per result goal; Sales needs Highest volume',
      seven_sisters: 'Assam and Tripura are not excluded',
      placements: 'Automatic (Advantage+) placements are on',
    }),
  },
  {
    account: 0, metaCampaignId: 'dev-c-004', name: '[DEV] 1004 | CC | Static | Sales | 30.10.2026',
    objectiveRaw: 'OUTCOME_SALES', objective: 'Sales', spend7d: 6_120,
    mainMetric: { kind: 'roas', value: 1.4 }, rating: 'BAD', ratingIndicative: true,
    checks: checks('PPPPPPP N P'),
  },
  {
    account: 0, metaCampaignId: 'dev-c-005', name: '[DEV] 1005 | DD | Video | Awareness | 20.10.2026',
    objectiveRaw: 'OUTCOME_AWARENESS', objective: 'Awareness', spend7d: 24_800,
    mainMetric: { kind: 'cost_per_1k_reach', value: 3.05 }, rating: 'AVERAGE', ratingIndicative: false,
    checks: checks('PP C F PP F F C', {
      min_budget: 'Daily budget is ₹500; SOP minimum is ₹800',
      placements: 'Messenger placements are on',
      frequency: '1 of 1 ad sets have no frequency cap',
    }),
  },
  {
    account: 0, metaCampaignId: 'dev-c-006', name: '[DEV] 1006 | EE | Carousel | Sales | 02.11.2026',
    objectiveRaw: 'OUTCOME_SALES', objective: 'Sales', spend7d: 0,
    mainMetric: null, rating: 'NOT_RATED', ratingIndicative: false,
    checks: checks('PPPPPPP N P'),
  },
  {
    account: 1, metaCampaignId: 'dev-c-101', name: '[DEV] 2001 | FF | Catalog | Sales | 17.10.2026',
    objectiveRaw: 'OUTCOME_SALES', objective: 'Sales', spend7d: 52_300,
    mainMetric: { kind: 'roas', value: 6.4 }, rating: 'GOOD', ratingIndicative: false,
    checks: checks('PPPPPPP N F', { creative_complete: '1 of 4 active ads has no call-to-action button' }),
  },
  {
    account: 1, metaCampaignId: 'dev-c-102', name: '[DEV] 2002 | GG | Video | App Promotion | 05.10.2026',
    objectiveRaw: 'OUTCOME_APP_PROMOTION', objective: 'App Promotion', spend7d: 18_750,
    mainMetric: { kind: 'cost_per_install', value: 1.62 }, rating: 'AVERAGE', ratingIndicative: false,
    checks: checks('PPPPPCF N C', { placements: 'WhatsApp placements are on' }),
  },
  {
    account: 1, metaCampaignId: 'dev-c-103', name: '[DEV] 2003 | HH | Static | Engagement | 11.10.2026',
    objectiveRaw: 'OUTCOME_ENGAGEMENT', objective: 'Engagement', spend7d: 9_400,
    mainMetric: { kind: 'cost_per_engagement', value: 0.18 }, rating: 'GOOD', ratingIndicative: false,
    checks: checks('PPPPPPP N P'),
  },
  {
    account: 1, metaCampaignId: 'dev-c-104', name: '[DEV] Lead form test',
    objectiveRaw: 'OUTCOME_LEADS', objective: 'Leads', spend7d: 3_200,
    mainMetric: { kind: 'cost_per_lead', value: 42.5 }, rating: 'NOT_RATED', ratingIndicative: false,
    checks: checks('CCCCCCC N C'),
  },
];
