import {
  BID_STRATEGY_LABEL,
  buildCampaignCounts,
  buildDashboardSummary,
  CHECK_OUTCOME_LABEL,
  computeRuleFailures,
  EXPORT_DATASETS,
  filterCampaigns,
  formatDate,
  formatMainMetric,
  MANUAL_CHECK_ITEMS,
  RATING_LABEL,
  SOP_RULES,
  SOP_STATUS_LABEL,
  type AuditRunInfo,
  type AuthUser,
  type CampaignAudit,
  type CheckOutcome,
  type ExportDatasetId,
  type GroupSummaryRow,
  type ManualStatus,
} from '@sop/shared';
import { creativeVerdict, frequencyVerdict, placementVerdict, sevenSistersVerdict } from '../audit/sopChecks.js';
import type { ItemVerdict } from '../audit/aggregate.js';
import { badRequest, notFoundError } from '../http/errors.js';
import type { RawAd, RawAdSet } from '../meta/types.js';
import { findCampaignAudits, findCompletedRun } from '../repositories/auditRepository.js';
import { listRuns } from '../repositories/runRepository.js';
import { getCampaignDetail } from '../services/campaignDetailService.js';
import { currentRules, rulesForVersion } from '../services/rulesSnapshot.js';
import { store } from '../storage/store.js';
import { describeFilters, generatedLine, loadRunContext, resolveRun, runLine, type ExportParams, type RunContext } from './context.js';
import { facts, table, type Cell, type ExportColumn, type ExportDoc, type ExportSection, type ExportTable } from './types.js';

/**
 * Each report area builds a format-neutral ExportDoc from stored audit data. Nothing here
 * reads tokens, secrets or password hashes, and nothing is invented: a value the audit did
 * not record is left empty.
 */

const DEV_WARNING = 'DEVELOPMENT DATA — sample records for testing, not real Meta results.';
const MANUAL_STATUS_LABEL: Record<ManualStatus, string> = { PENDING: 'Pending', VERIFIED: 'Verified', FAILED: 'Failed', NOT_APPLICABLE: 'Not applicable' };
const MANUAL_LABEL = new Map<string, string>(MANUAL_CHECK_ITEMS.map((i) => [i.key, i.label]));
const userName = (id: string | null | undefined) => (id ? (store.c.users.get(id)?.name ?? 'Removed user') : null);
const outcome = (c: CampaignAudit, key: string): string => {
  const o = c.checks.find((x) => x.key === key)?.outcome;
  return o ? CHECK_OUTCOME_LABEL[o] : CHECK_OUTCOME_LABEL.NOT_CHECKABLE;
};
const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? null : v ? 'Yes' : 'No');
const bid = (v: string | null) => (v ? (BID_STRATEGY_LABEL[v] ?? v) : null);
const isDev = (run: AuditRunInfo) => run.source === 'development';

// ── Shared column sets ─────────────────────────────────────────────────────

const C = {
  account: { key: 'account', header: 'Ad account', width: 18 },
  campaign: { key: 'campaign', header: 'Campaign', width: 34 },
  campaignId: { key: 'campaignId', header: 'Meta campaign ID', width: 18 },
  objective: { key: 'objective', header: 'Objective', width: 12 },
  spend: { key: 'spend', header: 'Spend (7 days)', type: 'money', width: 12 },
  metric: { key: 'metric', header: 'Main metric', width: 14 },
  metricValue: { key: 'metricValue', header: 'Metric value', type: 'number', width: 10 },
  rating: { key: 'rating', header: 'Rating', width: 10 },
  ratingNote: { key: 'ratingNote', header: 'Rating note', width: 26 },
  sopPercent: { key: 'sopPercent', header: 'SOP %', type: 'percent', width: 8 },
  sopStatus: { key: 'sopStatus', header: 'SOP status', width: 14 },
} satisfies Record<string, ExportColumn>;

const checkColumns: ExportColumn[] = SOP_RULES.map((r) => ({ key: `check_${r.key}`, header: r.column, width: 10 }));

function campaignCells(c: CampaignAudit): Record<string, Cell> {
  return {
    account: c.account.name,
    campaign: c.name,
    campaignId: c.metaCampaignId,
    objective: c.objective,
    spend: c.spend7d,
    metric: formatMainMetric(c.mainMetric) === '–' ? null : formatMainMetric(c.mainMetric),
    metricValue: c.mainMetric?.value ?? null,
    rating: RATING_LABEL[c.rating] + (c.ratingIndicative ? ' (indicative)' : ''),
    ratingNote: c.ratingNote,
    sopPercent: c.compliance.percent,
    sopStatus: SOP_STATUS_LABEL[c.compliance.status],
  };
}

function trackerTable(title: string, campaigns: CampaignAudit[]): ExportTable {
  const columns: ExportColumn[] = [
    C.account, C.campaign, C.campaignId, C.objective, C.spend, C.metric, C.rating, C.sopPercent, C.sopStatus,
    ...checkColumns,
    { key: 'whatIsOff', header: 'What is off', width: 40 },
    { key: 'manual', header: 'Manual checks', width: 18 },
  ];
  const rows = campaigns.map((c) => ({
    ...campaignCells(c),
    ...Object.fromEntries(SOP_RULES.map((r) => [`check_${r.key}`, outcome(c, r.key)])),
    whatIsOff: c.whatIsOff.join('; ') || null,
    manual: `${c.manual.verified} verified, ${c.manual.failed} failed, ${c.manual.pending} pending`,
  }));
  return table(title, columns, rows, campaigns.length ? undefined : 'No campaigns match.');
}

function groupTable(title: string, firstHeader: string, groups: GroupSummaryRow[]): ExportTable {
  return table(
    title,
    [
      { key: 'label', header: firstHeader, width: 22 },
      { key: 'campaigns', header: 'Campaigns', type: 'number', width: 9 },
      { key: 'good', header: 'Good', type: 'number', width: 7 },
      { key: 'average', header: 'Average', type: 'number', width: 7 },
      { key: 'bad', header: 'Bad', type: 'number', width: 7 },
      { key: 'notRated', header: 'Not rated', type: 'number', width: 8 },
      { key: 'following', header: 'Following SOP', type: 'number', width: 10 },
      { key: 'avgSopPercent', header: 'Average SOP %', type: 'percent', width: 10 },
    ],
    groups.map((g) => ({ ...g })),
  );
}

function ruleFailureTable(campaigns: CampaignAudit[]): ExportTable {
  return table(
    'Results per SOP rule',
    [
      { key: 'label', header: 'Rule', width: 20 },
      { key: 'rule', header: 'Requirement', width: 50 },
      { key: 'pass', header: 'Pass', type: 'number', width: 7 },
      { key: 'fail', header: 'Fail', type: 'number', width: 7 },
      { key: 'notCheckable', header: 'Not checkable', type: 'number', width: 9 },
      { key: 'notApplicable', header: 'Not applicable', type: 'number', width: 9 },
      { key: 'failRate', header: 'Fail rate', type: 'percent', width: 8 },
    ],
    computeRuleFailures(campaigns).map((r) => ({ ...r, failRate: r.failRate === null ? null : Math.round(r.failRate * 100) })),
  );
}

/** Campaign counts per ad account and All accounts for a run (all statuses, unique IDs). */
async function countsTable(run: AuditRunInfo, all: CampaignAudit[]): Promise<ExportTable> {
  const accounts = (await listRuns(200)).find((r) => r.id === run.id)?.accounts ?? [];
  const c = buildCampaignCounts(accounts, all, null);
  const rows = [...c.accounts, ...(c.accounts.length > 1 ? [c.all] : [])];
  return table(
    'Campaign counts',
    [
      { key: 'name', header: 'Ad account', width: 20 },
      { key: 'id', header: 'Account ID', width: 16 },
      { key: 'total', header: 'Total campaigns (all statuses, excl. deleted)', type: 'number', width: 11 },
      { key: 'active', header: 'Active campaigns', type: 'number', width: 11 },
      { key: 'audited', header: 'Campaign status Active (audited)', type: 'number', width: 11 },
      { key: 'paused', header: 'Paused', type: 'number', width: 8 },
      { key: 'archived', header: 'Archived', type: 'number', width: 8 },
      { key: 'other', header: 'Other', type: 'number', width: 8 },
      { key: 'check', header: 'Matches Meta', width: 10 },
    ],
    rows.map((r) => ({
      name: r.name,
      id: r.metaAccountId === 'all' ? null : r.metaAccountId,
      total: r.total,
      active: c.activeKnown ? r.active : null,
      audited: r.audited,
      paused: r.paused,
      archived: r.archived,
      other: r.other,
      check: r.reconciled === null ? null : r.reconciled ? 'Yes' : 'No',
    })),
    'Counts are for the whole audit (filters not applied). Active = the campaign, all its ad sets and all its ads have Meta status Active (started, not ended). Total counts each campaign ID once, in every status except deleted (Meta does not list deleted campaigns).',
  );
}

function totalsFacts(campaigns: CampaignAudit[]): ExportTable {
  const t = buildDashboardSummary(campaigns).totals;
  return facts('Totals', [
    ['Campaigns in this report', t.active],
    ['Good', t.good],
    ['Average', t.average],
    ['Bad', t.bad],
    ['Not rated', t.notRated],
    ['Following SOP', t.following],
    ['Partly following', t.partlyFollowing],
    ['Not following', t.notFollowing],
    ['Needs review', t.needsReview],
  ]);
}

function ratingRulesTable(rules = currentRules().ratingRules): ExportTable {
  return table(
    'Rating rules',
    [
      { key: 'objective', header: 'Objective', width: 14 },
      { key: 'metric', header: 'Main metric', width: 26 },
      { key: 'good', header: 'Good', width: 22 },
      { key: 'average', header: 'Average', width: 18 },
      { key: 'bad', header: 'Bad', width: 18 },
    ],
    rules.map((r) => ({ objective: r.objective, metric: r.metricLabel, good: r.goodText, average: r.averageText, bad: r.badText })),
    'Sales campaigns under ₹15,000 spend in 7 days get an indicative rating. Leads are ranked on the first 14 days of cost per lead.',
  );
}

// ── Manual verification data (read in one pass) ────────────────────────────

interface ManualRow {
  status: ManualStatus;
  note: string | null;
  by: string | null;
  at: string | null;
  evidence: string[];
}

function manualIndex(metaCampaignIds: Set<string>): Map<string, Map<string, ManualRow>> {
  const out = new Map<string, Map<string, ManualRow>>();
  const slot = (id: string, key: string): ManualRow => {
    let m = out.get(id);
    if (!m) out.set(id, (m = new Map()));
    let r = m.get(key);
    if (!r) m.set(key, (r = { status: 'PENDING', note: null, by: null, at: null, evidence: [] }));
    return r;
  };
  for (const m of store.c.manualChecks.filter((x) => metaCampaignIds.has(x.metaCampaignId))) {
    Object.assign(slot(m.metaCampaignId, m.itemKey), { status: m.status, note: m.note, by: userName(m.updatedBy), at: m.updatedAt });
  }
  for (const a of store.c.attachments.filter((x) => metaCampaignIds.has(x.metaCampaignId))) {
    slot(a.metaCampaignId, a.itemKey).evidence.push(a.fileName);
  }
  return out;
}

const manualOf = (idx: Map<string, Map<string, ManualRow>>, id: string, key: string): ManualRow =>
  idx.get(id)?.get(key) ?? { status: 'PENDING', note: null, by: null, at: null, evidence: [] };

function manualEventsTable(metaCampaignIds: Set<string>, nameOf: Map<string, string>, limit = 5000): ExportTable {
  const events = store.c.manualEvents
    .filter((e) => metaCampaignIds.has(e.metaCampaignId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || Number(b.id) - Number(a.id));
  return table(
    'Manual check change log',
    [
      { key: 'campaign', header: 'Campaign', width: 30 },
      { key: 'check', header: 'Check', width: 20 },
      { key: 'status', header: 'Set to', width: 12 },
      { key: 'note', header: 'Note', width: 36 },
      { key: 'by', header: 'By', width: 14 },
      { key: 'at', header: 'When', type: 'datetime', width: 16 },
    ],
    events.slice(0, limit).map((e) => ({
      campaign: nameOf.get(e.metaCampaignId) ?? e.metaCampaignId,
      check: MANUAL_LABEL.get(e.itemKey) ?? e.itemKey,
      status: MANUAL_STATUS_LABEL[e.status],
      note: e.note,
      by: userName(e.userId),
      at: e.createdAt,
    })),
    events.length > limit ? `Showing the latest ${limit} of ${events.length} changes.` : events.length ? undefined : 'No manual checks have been recorded yet.',
  );
}

// ── Per-item verdicts from the stored Meta responses ───────────────────────

const isDevFixture = (raw: unknown) => Boolean(raw && typeof raw === 'object' && (raw as { devData?: unknown }).devData);
function verdictCells(raw: unknown, fn: (x: never) => ItemVerdict): { outcome: string; reason: string | null } {
  if (isDevFixture(raw)) return { outcome: CHECK_OUTCOME_LABEL.NOT_CHECKABLE, reason: 'development fixture' };
  if (!raw || typeof raw !== 'object') return { outcome: CHECK_OUTCOME_LABEL.NOT_CHECKABLE, reason: 'Meta response not stored' };
  const v = fn(raw as never);
  return { outcome: CHECK_OUTCOME_LABEL[v.outcome as CheckOutcome], reason: v.reason ?? null };
}

// ── Builders ───────────────────────────────────────────────────────────────

type Builder = (p: ExportParams, user: AuthUser) => Promise<Omit<ExportDoc, 'fileStem' | 'title'> & { title?: string }>;

async function runDoc(p: ExportParams, user: AuthUser, extra: string[] = []): Promise<{ ctx: RunContext; meta: string[]; devData: boolean }> {
  const ctx = await loadRunContext(p);
  const devData = isDev(ctx.run);
  const rulesVersion = store.c.auditRuns.get(ctx.run.id)?.rulesVersion;
  const meta = [
    ...(devData ? [DEV_WARNING] : []),
    runLine(ctx.run),
    ctx.scopeText,
    ...extra,
    ...(rulesVersion ? [`SOP rule set version ${rulesVersion}`] : []),
    generatedLine(user),
  ];
  return { ctx, meta, devData };
}

const builders: Record<ExportDatasetId, Builder> = {
  async dashboard(p, user) {
    const { ctx, meta, devData } = await runDoc(p, user);
    const s = buildDashboardSummary(ctx.campaigns);
    const campaigns = trackerTable('Campaigns', ctx.campaigns);
    return {
      meta,
      devData,
      runId: ctx.run.id,
      sections: [
        totalsFacts(ctx.campaigns),
        await countsTable(ctx.run, ctx.all),
        groupTable('By ad account', 'Ad account', s.byAccount),
        groupTable('By objective', 'Objective', s.byObjective),
        ruleFailureTable(ctx.campaigns),
        campaigns,
      ],
      primary: campaigns,
    };
  },

  async tracker(p, user) {
    const { ctx, meta, devData } = await runDoc(p, user);
    const t = trackerTable('Campaign tracker', ctx.campaigns);
    return {
      meta,
      devData,
      runId: ctx.run.id,
      sections: [t, { kind: 'text', title: 'Check results', text: 'Pass = meets the SOP. Fail = does not. Not checkable = Meta does not expose the field, so it was not guessed. Not applicable = the rule does not apply to this campaign.' }],
      primary: t,
    };
  },

  async campaign(p, user) {
    if (!p.campaignId) throw badRequest('Choose a campaign to export.');
    const d = await getCampaignDetail(p.campaignId);
    const a = d.audit;
    const devData = isDev(d.run);
    const checks = table(
      'SOP checks',
      [
        { key: 'rule', header: 'Rule', width: 20 },
        { key: 'outcome', header: 'Result', width: 12 },
        { key: 'detail', header: 'Finding', width: 46 },
        { key: 'requirement', header: 'Requirement', width: 50 },
      ],
      SOP_RULES.map((r) => {
        const c = a.checks.find((x) => x.key === r.key);
        return { rule: r.label, outcome: CHECK_OUTCOME_LABEL[c?.outcome ?? 'NOT_CHECKABLE'], detail: c?.detail ?? null, requirement: r.rule };
      }),
    );
    const sections: ExportSection[] = [
      facts('Overview', [
        ['Campaign', a.name],
        ['Meta campaign ID', a.metaCampaignId],
        ['Ad account', `${a.account.name} (${a.account.metaAccountId})`],
        ['Objective', a.objective === 'Other' ? `Other (${a.objectiveRaw})` : a.objective],
        ['Spend (7 days)', a.spend7d],
        ['Currency', a.currency],
        ['Main metric', formatMainMetric(a.mainMetric)],
        ['Rating', RATING_LABEL[a.rating] + (a.ratingIndicative ? ' (indicative)' : '')],
        ['Rating note', a.ratingNote],
        ['SOP %', a.compliance.percent === null ? null : `${a.compliance.percent}%`],
        ['SOP status', SOP_STATUS_LABEL[a.compliance.status]],
        ['Checks', `${a.compliance.passed} pass, ${a.compliance.failed} fail, ${a.compliance.notCheckable} not checkable, ${a.compliance.notApplicable} not applicable`],
        ['What is off', a.whatIsOff.join('; ') || 'Nothing'],
      ]),
      checks,
      facts('Campaign settings', [
        ['Buying type', d.settings.buyingType],
        ['Bid strategy', bid(d.settings.bidStrategy)],
        ['Daily budget (₹)', d.settings.dailyBudget],
        ['Lifetime budget (₹)', d.settings.lifetimeBudget],
        ['Start time', d.settings.startTime],
        ['Delivery status', d.settings.effectiveStatus],
      ]),
      table(
        'Active ad sets',
        [
          { key: 'name', header: 'Ad set', width: 28 },
          { key: 'id', header: 'Ad set ID', width: 18 },
          { key: 'status', header: 'Status', width: 10 },
          { key: 'daily', header: 'Daily budget', type: 'money', width: 10 },
          { key: 'bid', header: 'Bid strategy', width: 16 },
          { key: 'placements', header: 'Placements', width: 22 },
          { key: 'frequency', header: 'Frequency cap', width: 16 },
          { key: 'dynamic', header: 'Dynamic creative', width: 9 },
          { key: 'excluded', header: 'Excluded locations', width: 30 },
        ],
        d.adSets.map((s) => ({
          name: s.name,
          id: s.metaAdSetId,
          status: s.effectiveStatus,
          daily: s.dailyBudget,
          bid: bid(s.bidStrategy),
          placements: s.publisherPlatforms?.join(', ') ?? null,
          frequency: s.frequencyCap,
          dynamic: yesNo(s.isDynamicCreative),
          excluded: s.excludedLocations,
        })),
        d.adSets.length ? undefined : 'No active ad sets.',
      ),
      table(
        'Active ads',
        [
          { key: 'name', header: 'Ad', width: 26 },
          { key: 'id', header: 'Ad ID', width: 18 },
          { key: 'text', header: 'Primary text', width: 40 },
          { key: 'headline', header: 'Headline', width: 22 },
          { key: 'cta', header: 'Call to action', width: 14 },
          { key: 'link', header: 'Post link', width: 30 },
        ],
        d.ads.map((x) => ({ name: x.name, id: x.metaAdId, text: x.primaryText, headline: x.headline, cta: x.ctaType, link: x.permalinkUrl })),
        d.ads.length ? undefined : 'No active ads.',
      ),
      table(
        'Manual checks',
        [
          { key: 'check', header: 'Check', width: 22 },
          { key: 'status', header: 'Status', width: 12 },
          { key: 'note', header: 'Note', width: 36 },
          { key: 'by', header: 'By', width: 14 },
          { key: 'at', header: 'When', type: 'datetime', width: 16 },
          { key: 'evidence', header: 'Evidence files', width: 26 },
        ],
        d.manualChecks.map((m) => ({
          check: m.label,
          status: MANUAL_STATUS_LABEL[m.status],
          note: m.note,
          by: m.updatedBy,
          at: m.updatedAt,
          evidence: m.attachments.map((f) => f.fileName).join(', ') || null,
        })),
        'Manual checks are set by a person. They are never passed automatically and do not count toward the SOP %.',
      ),
      table(
        'History',
        [
          { key: 'run', header: 'Audit #', width: 8 },
          { key: 'at', header: 'Audited', type: 'datetime', width: 16 },
          { key: 'rating', header: 'Rating', width: 10 },
          { key: 'metric', header: 'Main metric', width: 14 },
          { key: 'spend', header: 'Spend (7 days)', type: 'money', width: 12 },
          { key: 'sopPercent', header: 'SOP %', type: 'percent', width: 8 },
          { key: 'sopStatus', header: 'SOP status', width: 14 },
        ],
        [...d.history].reverse().map((h) => ({
          run: h.runId,
          at: h.at,
          rating: RATING_LABEL[h.rating],
          metric: formatMainMetric(h.mainMetric) === '–' ? null : formatMainMetric(h.mainMetric),
          spend: h.spend7d,
          sopPercent: h.sopPercent,
          sopStatus: SOP_STATUS_LABEL[h.sopStatus],
        })),
      ),
    ];
    return {
      title: `Campaign detail — ${a.name}`,
      meta: [...(devData ? [DEV_WARNING] : []), runLine(d.run), `Campaign: ${a.name} (${a.metaCampaignId})`, generatedLine(user)],
      devData,
      runId: d.run.id,
      sections,
      // The CSV names the campaign on every row, so files from several campaigns can be combined.
      primary: table(checks.title, [C.campaign, C.campaignId, ...checks.columns], checks.rows.map((r) => ({ campaign: a.name, campaignId: a.metaCampaignId, ...r }))),
    };
  },

  async adsets(p, user) {
    const { ctx, meta, devData } = await runDoc(p, user);
    const rows: Record<string, Cell>[] = [];
    for (const c of ctx.campaigns) {
      const rec = ctx.records.get(c.id);
      for (const s of [...(rec?.adSets ?? [])].sort((x, y) => x.name.localeCompare(y.name))) {
        const placement = verdictCells(s.rawSnapshot, (a: RawAdSet) => placementVerdict(a));
        const sisters = verdictCells(s.rawSnapshot, (a: RawAdSet) => sevenSistersVerdict(a));
        const freq = c.objective === 'Awareness' ? verdictCells(s.rawSnapshot, (a: RawAdSet) => frequencyVerdict(a)) : { outcome: CHECK_OUTCOME_LABEL.NOT_APPLICABLE, reason: 'Awareness campaigns only' };
        rows.push({
          account: c.account.name,
          campaign: c.name,
          adSet: s.name,
          adSetId: s.metaAdSetId,
          status: s.effectiveStatus,
          daily: s.dailyBudget,
          lifetime: s.lifetimeBudget,
          bid: bid(s.bidStrategy),
          goal: s.optimizationGoal,
          placements: s.publisherPlatforms?.join(', ') ?? null,
          placementCheck: placement.reason ? `${placement.outcome}: ${placement.reason}` : placement.outcome,
          frequency: s.frequencyCap,
          frequencyCheck: freq.reason ? `${freq.outcome}: ${freq.reason}` : freq.outcome,
          dynamic: yesNo(s.isDynamicCreative),
          locations: s.locations,
          excluded: s.excludedLocations,
          sistersCheck: sisters.reason ? `${sisters.outcome}: ${sisters.reason}` : sisters.outcome,
        });
      }
    }
    const t = table(
      'Ad set details',
      [
        C.account, C.campaign,
        { key: 'adSet', header: 'Ad set', width: 28 },
        { key: 'adSetId', header: 'Ad set ID', width: 18 },
        { key: 'status', header: 'Status', width: 10 },
        { key: 'daily', header: 'Daily budget', type: 'money', width: 10 },
        { key: 'lifetime', header: 'Lifetime budget', type: 'money', width: 10 },
        { key: 'bid', header: 'Bid strategy', width: 16 },
        { key: 'goal', header: 'Optimisation goal', width: 16 },
        { key: 'placements', header: 'Placements', width: 22 },
        { key: 'placementCheck', header: 'Placement check', width: 22 },
        { key: 'frequency', header: 'Frequency cap', width: 16 },
        { key: 'frequencyCheck', header: 'Frequency check', width: 20 },
        { key: 'dynamic', header: 'Dynamic creative', width: 9 },
        { key: 'locations', header: 'Locations', width: 26 },
        { key: 'excluded', header: 'Excluded locations', width: 30 },
        { key: 'sistersCheck', header: 'Seven Sisters check', width: 22 },
      ],
      rows,
      rows.length ? undefined : 'No active ad sets in the selected campaigns.',
    );
    return { meta, devData, runId: ctx.run.id, sections: [t], primary: t };
  },

  async creatives(p, user) {
    const { ctx, meta, devData } = await runDoc(p, user);
    const rows: Record<string, Cell>[] = [];
    for (const c of ctx.campaigns) {
      const rec = ctx.records.get(c.id);
      for (const ad of [...(rec?.ads ?? [])].sort((x, y) => x.name.localeCompare(y.name))) {
        const v = verdictCells(ad.rawSnapshot, (raw: RawAd) => creativeVerdict(raw));
        rows.push({
          account: c.account.name,
          campaign: c.name,
          ad: ad.name,
          adId: ad.metaAdId,
          status: ad.effectiveStatus,
          creativeId: ad.creativeId,
          text: ad.primaryText,
          headline: ad.headline,
          cta: ad.ctaType,
          check: v.outcome,
          reason: v.reason,
          link: ad.permalinkUrl,
        });
      }
    }
    const t = table(
      'Creative audit',
      [
        C.account, C.campaign,
        { key: 'ad', header: 'Ad', width: 26 },
        { key: 'adId', header: 'Ad ID', width: 18 },
        { key: 'status', header: 'Status', width: 10 },
        { key: 'creativeId', header: 'Creative ID', width: 18 },
        { key: 'text', header: 'Primary text', width: 44 },
        { key: 'headline', header: 'Headline', width: 22 },
        { key: 'cta', header: 'Call to action', width: 14 },
        { key: 'check', header: 'Creative complete', width: 12 },
        { key: 'reason', header: 'Reason', width: 24 },
        { key: 'link', header: 'Post link', width: 30 },
      ],
      rows,
      rows.length ? undefined : 'No active ads in the selected campaigns.',
    );
    return {
      meta,
      devData,
      runId: ctx.run.id,
      sections: [t, { kind: 'text', title: 'Note', text: 'Copy, SKU, coupon and creative approval are confirmed by a person under Manual verification; they are never marked as passed automatically.' }],
      primary: t,
    };
  },

  async rules(p, user) {
    const { ctx, meta, devData } = await runDoc(p, user);
    const snapshot = rulesForVersion(store.c.auditRuns.get(ctx.run.id)?.rulesVersion) ?? currentRules();
    const catalogue = table(
      'SOP rule set',
      [
        { key: 'n', header: '#', type: 'number', width: 4 },
        { key: 'label', header: 'Rule', width: 20 },
        { key: 'rule', header: 'Requirement', width: 70 },
        { key: 'how', header: 'Checked', width: 14 },
      ],
      [
        ...snapshot.sopRules.map((r, i) => ({ n: i + 1, label: r.label, rule: r.rule, how: 'Automatically' })),
        ...snapshot.manualChecks.map((m, i) => ({ n: snapshot.sopRules.length + i + 1, label: m.label, rule: m.help, how: 'By a person' })),
      ],
    );
    const matrix = table(
      'Compliance per campaign',
      [C.account, C.campaign, C.campaignId, C.objective, ...checkColumns, C.sopPercent, C.sopStatus],
      ctx.campaigns.map((c) => ({ ...campaignCells(c), ...Object.fromEntries(SOP_RULES.map((r) => [`check_${r.key}`, outcome(c, r.key)])) })),
      ctx.campaigns.length ? undefined : 'No campaigns match.',
    );
    return {
      meta,
      devData,
      runId: ctx.run.id,
      sections: [
        catalogue,
        ratingRulesTable(snapshot.ratingRules),
        ruleFailureTable(ctx.campaigns),
        { kind: 'text', title: 'How the SOP % works', text: 'SOP % = passed ÷ (passed + failed) of the nine automated checks. Not checkable and not applicable results are left out, and manual checks never count as passes. Following SOP = no failures; Partly following = up to 25% failed; Not following = more; Needs review = nothing could be checked.' },
        matrix,
      ],
      primary: matrix,
    };
  },

  async failed(p, user) {
    const { ctx, meta, devData } = await runDoc(p, user);
    const ids = new Set(ctx.campaigns.map((c) => c.metaCampaignId));
    const manual = manualIndex(ids);
    const rows: Record<string, Cell>[] = [];
    for (const c of ctx.campaigns) {
      for (const r of SOP_RULES) {
        const check = c.checks.find((x) => x.key === r.key);
        if (check?.outcome === 'FAIL') {
          rows.push({ account: c.account.name, campaign: c.name, campaignId: c.metaCampaignId, objective: c.objective, type: 'Automated', rule: r.label, finding: check.detail, by: null, at: ctx.run.finishedAt });
        }
      }
      for (const item of MANUAL_CHECK_ITEMS) {
        const m = manualOf(manual, c.metaCampaignId, item.key);
        if (m.status === 'FAILED') {
          rows.push({ account: c.account.name, campaign: c.name, campaignId: c.metaCampaignId, objective: c.objective, type: 'Manual', rule: item.label, finding: m.note, by: m.by, at: m.at });
        }
      }
    }
    const t = table(
      'Failed checks',
      [
        C.account, C.campaign, C.campaignId, C.objective,
        { key: 'type', header: 'Check type', width: 10 },
        { key: 'rule', header: 'Rule', width: 20 },
        { key: 'finding', header: 'Finding', width: 50 },
        { key: 'by', header: 'Recorded by', width: 14 },
        { key: 'at', header: 'Recorded', type: 'datetime', width: 16 },
      ],
      rows,
      rows.length ? `${rows.length} failed checks.` : 'No failed checks in the selected campaigns.',
    );
    return { meta, devData, runId: ctx.run.id, sections: [t, ruleFailureTable(ctx.campaigns)], primary: t };
  },

  async manual(p, user) {
    const { ctx, meta, devData } = await runDoc(p, user);
    const ids = new Set(ctx.campaigns.map((c) => c.metaCampaignId));
    const idx = manualIndex(ids);
    const rows: Record<string, Cell>[] = [];
    for (const c of ctx.campaigns) {
      for (const item of MANUAL_CHECK_ITEMS) {
        const m = manualOf(idx, c.metaCampaignId, item.key);
        rows.push({
          account: c.account.name,
          campaign: c.name,
          campaignId: c.metaCampaignId,
          check: item.label,
          status: MANUAL_STATUS_LABEL[m.status],
          note: m.note,
          by: m.by,
          at: m.at,
          evidence: m.evidence.join(', ') || null,
        });
      }
    }
    const t = table(
      'Manual verification',
      [
        C.account, C.campaign, C.campaignId,
        { key: 'check', header: 'Check', width: 22 },
        { key: 'status', header: 'Status', width: 12 },
        { key: 'note', header: 'Note', width: 36 },
        { key: 'by', header: 'By', width: 14 },
        { key: 'at', header: 'When', type: 'datetime', width: 16 },
        { key: 'evidence', header: 'Evidence files', width: 26 },
      ],
      rows,
      'Pending means nobody has confirmed the item yet. Manual checks are never passed automatically.',
    );
    const nameOf = new Map(ctx.campaigns.map((c) => [c.metaCampaignId, c.name]));
    return { meta, devData, runId: ctx.run.id, sections: [t, manualEventsTable(ids, nameOf)], primary: t };
  },

  async accounts(p, user) {
    const { ctx, meta, devData } = await runDoc(p, user);
    const s = buildDashboardSummary(ctx.campaigns);
    const summary = groupTable('Summary by ad account', 'Ad account', s.byAccount);
    const perGroup = s.byAccount.map((g) =>
      performanceTable(`${g.label}`, ctx.campaigns.filter((c) => c.account.id === g.key), false),
    );
    return { meta, devData, runId: ctx.run.id, sections: [summary, await countsTable(ctx.run, ctx.all), ...perGroup], primary: summary };
  },

  async objectives(p, user) {
    const { ctx, meta, devData } = await runDoc(p, user);
    const s = buildDashboardSummary(ctx.campaigns);
    const summary = groupTable('Summary by objective', 'Objective', s.byObjective);
    const perGroup = s.byObjective.map((g) => performanceTable(g.label, ctx.campaigns.filter((c) => c.objective === g.key), true));
    return { meta, devData, runId: ctx.run.id, sections: [summary, ...perGroup, ratingRulesTable()], primary: summary };
  },

  async performance(p, user) {
    const { ctx, meta, devData } = await runDoc(p, user);
    const t = performanceTable('Campaign performance', ctx.campaigns, true);
    const s = buildDashboardSummary(ctx.campaigns);
    return {
      meta,
      devData,
      runId: ctx.run.id,
      sections: [totalsFacts(ctx.campaigns), groupTable('Ratings by objective', 'Objective', s.byObjective), t, ratingRulesTable()],
      primary: t,
    };
  },

  async history(p, user) {
    const all = await listRuns(100_000);
    const from = p.scope === 'filtered' ? p.from : undefined;
    const to = p.scope === 'filtered' ? p.to : undefined;
    if (from && to && from > to) throw badRequest('The start date is after the end date.');
    const runs = all.filter((r) => (!from || r.startedAt.slice(0, 10) >= from) && (!to || r.startedAt.slice(0, 10) <= to));
    const devData = runs.some((r) => r.source === 'development');
    const t = table(
      'Audit runs',
      [
        { key: 'id', header: 'Audit #', width: 7 },
        { key: 'source', header: 'Data', width: 11 },
        { key: 'trigger', header: 'Started by', width: 10 },
        { key: 'status', header: 'Status', width: 9 },
        { key: 'startedAt', header: 'Started', type: 'datetime', width: 16 },
        { key: 'finishedAt', header: 'Finished', type: 'datetime', width: 16 },
        { key: 'period', header: 'Performance period', width: 20 },
        { key: 'triggeredBy', header: 'User', width: 12 },
        { key: 'campaigns', header: 'Campaigns', type: 'number', width: 8 },
        { key: 'good', header: 'Good', type: 'number', width: 6 },
        { key: 'average', header: 'Average', type: 'number', width: 6 },
        { key: 'bad', header: 'Bad', type: 'number', width: 6 },
        { key: 'notRated', header: 'Not rated', type: 'number', width: 6 },
        { key: 'following', header: 'Following', type: 'number', width: 7 },
        { key: 'partly', header: 'Partly', type: 'number', width: 6 },
        { key: 'notFollowing', header: 'Not following', type: 'number', width: 7 },
        { key: 'needsReview', header: 'Needs review', type: 'number', width: 7 },
        { key: 'error', header: 'Error', width: 26 },
      ],
      runs.map((r) => ({
        id: r.id,
        source: r.source === 'development' ? 'Development' : 'Meta',
        trigger: r.trigger === 'scheduled' ? 'Schedule' : r.trigger === 'manual' ? 'Refresh' : 'Seed',
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        period: r.periodStart && r.periodEnd ? `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` : null,
        triggeredBy: r.triggeredBy,
        campaigns: r.totals.campaigns,
        good: r.totals.good,
        average: r.totals.average,
        bad: r.totals.bad,
        notRated: r.totals.notRated,
        following: r.totals.following,
        partly: r.totals.partlyFollowing,
        notFollowing: r.totals.notFollowing,
        needsReview: r.totals.needsReview,
        error: r.error,
      })),
      runs.length ? undefined : 'No audits in this date range.',
    );
    const accounts = table(
      'Ad account results per audit',
      [
        { key: 'id', header: 'Audit #', width: 7 },
        { key: 'startedAt', header: 'Started', type: 'datetime', width: 16 },
        { key: 'account', header: 'Ad account', width: 22 },
        { key: 'metaAccountId', header: 'Account ID', width: 18 },
        { key: 'status', header: 'Result', width: 10 },
        { key: 'error', header: 'Error', width: 40 },
        { key: 'notes', header: 'Not readable', width: 40 },
      ],
      runs.flatMap((r) =>
        r.accounts.map((a) => ({ id: r.id, startedAt: r.startedAt, account: a.name, metaAccountId: a.metaAccountId, status: a.status, error: a.error, notes: a.notes.join(' ') || null })),
      ),
    );
    const range = p.scope === 'all' ? 'All audits (date range not applied)' : from || to ? `Audits started ${from ? `from ${formatDate(from)}` : ''}${from && to ? ' ' : ''}${to ? `to ${formatDate(to)}` : ''} (dates in UTC)` : 'All audits';
    return {
      meta: [...(devData ? ['Includes DEVELOPMENT DATA runs (marked “Development”) — not real Meta results.'] : []), `${range} · ${runs.length} of ${all.length} audits`, generatedLine(user)],
      devData,
      runId: null,
      sections: [t, accounts],
      primary: t,
    };
  },

  async comparison(p, user) {
    let runB: AuditRunInfo | null = await resolveRun(p.runB ?? p.runId);
    let runA: AuditRunInfo | null;
    if (p.runA) {
      runA = await findCompletedRun(p.runA);
      if (!runA) throw notFoundError('The earlier audit did not complete.');
    } else {
      const earlier = (await listRuns(100_000)).filter(
        (r) => r.source === runB!.source && (r.status === 'succeeded' || r.status === 'partial') && r.startedAt < runB!.startedAt,
      );
      runA = earlier[0] ? await findCompletedRun(earlier[0].id) : null;
      if (!runA) throw notFoundError('There is no earlier completed audit to compare with yet.');
    }
    if (runA.id === runB.id) throw badRequest('Choose two different audits to compare.');
    if (runA.startedAt > runB.startedAt) [runA, runB] = [runB, runA];
    const [allA, allB] = [await findCampaignAudits(runA.id), await findCampaignAudits(runB.id)];
    const [listA, listB] = p.scope === 'filtered' ? [filterCampaigns(allA, p.filters), filterCampaigns(allB, p.filters)] : [allA, allB];
    const mapA = new Map(listA.map((c) => [c.metaCampaignId, c]));
    const mapB = new Map(listB.map((c) => [c.metaCampaignId, c]));
    const ids = [...new Set([...mapB.keys(), ...mapA.keys()])];

    const rows = ids.map((id) => {
      const a = mapA.get(id);
      const b = mapB.get(id);
      const ref = (b ?? a)!;
      const failing = (c?: CampaignAudit) => new Set(c?.checks.filter((x) => x.outcome === 'FAIL').map((x) => x.key) ?? []);
      const [fa, fb] = [failing(a), failing(b)];
      const label = (k: string) => SOP_RULES.find((r) => r.key === k)?.label ?? k;
      let change = 'Unchanged';
      if (!a) change = 'New in later audit';
      else if (!b) change = 'Not in later audit';
      else if (a.rating !== b.rating || a.compliance.status !== b.compliance.status || a.compliance.percent !== b.compliance.percent) change = 'Changed';
      return {
        account: ref.account.name,
        campaign: ref.name,
        campaignId: id,
        objective: ref.objective,
        change,
        ratingA: a ? RATING_LABEL[a.rating] : null,
        ratingB: b ? RATING_LABEL[b.rating] : null,
        sopA: a?.compliance.percent ?? null,
        sopB: b?.compliance.percent ?? null,
        statusA: a ? SOP_STATUS_LABEL[a.compliance.status] : null,
        statusB: b ? SOP_STATUS_LABEL[b.compliance.status] : null,
        spendA: a?.spend7d ?? null,
        spendB: b?.spend7d ?? null,
        newFails: a && b ? [...fb].filter((k) => !fa.has(k)).map(label).join(', ') || null : null,
        fixed: a && b ? [...fa].filter((k) => !fb.has(k)).map(label).join(', ') || null : null,
      };
    });
    const order: Record<string, number> = { Changed: 0, 'New in later audit': 1, 'Not in later audit': 2, Unchanged: 3 };
    rows.sort((x, y) => order[x.change]! - order[y.change]! || x.campaign.localeCompare(y.campaign));

    const ta = buildDashboardSummary(listA).totals;
    const tb = buildDashboardSummary(listB).totals;
    const metricRows: [string, keyof typeof ta][] = [
      ['Active campaigns', 'active'], ['Good', 'good'], ['Average', 'average'], ['Bad', 'bad'], ['Not rated', 'notRated'],
      ['Following SOP', 'following'], ['Partly following', 'partlyFollowing'], ['Not following', 'notFollowing'], ['Needs review', 'needsReview'],
    ];
    const avg = (l: CampaignAudit[]) => {
      const v = l.map((c) => c.compliance.percent).filter((x): x is number => x !== null);
      return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
    };
    const spend = (l: CampaignAudit[]) => Math.round(l.reduce((s, c) => s + c.spend7d, 0));
    const aLabel = `Audit #${runA.id}`;
    const bLabel = `Audit #${runB.id}`;
    const totals = table(
      'Totals',
      [
        { key: 'metric', header: 'Measure', width: 22 },
        { key: 'a', header: `${aLabel} (earlier)`, type: 'number', width: 14 },
        { key: 'b', header: `${bLabel} (later)`, type: 'number', width: 14 },
        { key: 'delta', header: 'Change', type: 'number', width: 10 },
      ],
      [
        ...metricRows.map(([label, k]) => ({ metric: label, a: ta[k], b: tb[k], delta: tb[k] - ta[k] })),
        { metric: 'Average SOP %', a: avg(listA), b: avg(listB), delta: avg(listA) !== null && avg(listB) !== null ? avg(listB)! - avg(listA)! : null },
        { metric: 'Spend in 7 days (₹)', a: spend(listA), b: spend(listB), delta: spend(listB) - spend(listA) },
      ],
    );
    const changes = table(
      'Campaign changes',
      [
        C.account, C.campaign, C.campaignId, C.objective,
        { key: 'change', header: 'Change', width: 14 },
        { key: 'ratingA', header: 'Rating before', width: 10 },
        { key: 'ratingB', header: 'Rating after', width: 10 },
        { key: 'sopA', header: 'SOP % before', type: 'percent', width: 8 },
        { key: 'sopB', header: 'SOP % after', type: 'percent', width: 8 },
        { key: 'statusA', header: 'SOP status before', width: 14 },
        { key: 'statusB', header: 'SOP status after', width: 14 },
        { key: 'spendA', header: 'Spend before', type: 'money', width: 11 },
        { key: 'spendB', header: 'Spend after', type: 'money', width: 11 },
        { key: 'newFails', header: 'Newly failing', width: 22 },
        { key: 'fixed', header: 'Fixed', width: 22 },
      ],
      rows,
      rows.length ? undefined : 'No campaigns match.',
    );
    const devData = isDev(runA) || isDev(runB);
    const filtersText = p.scope === 'all' ? 'All campaigns (filters not applied)' : describeFilters(p.filters, allB, listB.length).replace(/campaigns\)$/, 'campaigns in the later audit)');
    return {
      meta: [
        ...(devData ? [DEV_WARNING] : []),
        `Earlier: ${runLine(runA)}`,
        `Later: ${runLine(runB)}`,
        filtersText,
        generatedLine(user),
      ],
      devData,
      runId: runB.id,
      sections: [totals, changes],
      primary: changes,
    };
  },
};

function performanceTable(title: string, campaigns: CampaignAudit[], withAccount: boolean): ExportTable {
  return table(
    title,
    [...(withAccount ? [C.account] : []), C.campaign, C.campaignId, C.objective, C.spend, C.metric, C.metricValue, C.rating, C.ratingNote, C.sopPercent, C.sopStatus],
    campaigns.map(campaignCells),
    campaigns.length ? undefined : 'No campaigns.',
  );
}

const STEMS: Record<ExportDatasetId, string> = {
  dashboard: 'dashboard',
  tracker: 'campaign-tracker',
  campaign: 'campaign',
  adsets: 'ad-sets',
  creatives: 'creative-audit',
  rules: 'sop-compliance',
  failed: 'failed-checks',
  manual: 'manual-verification',
  accounts: 'account-report',
  objectives: 'objective-report',
  performance: 'performance-report',
  history: 'audit-history',
  comparison: 'audit-comparison',
};

export async function buildExportDoc(dataset: ExportDatasetId, p: ExportParams, user: AuthUser): Promise<ExportDoc> {
  const built = await builders[dataset](p, user);
  const info = EXPORT_DATASETS[dataset];
  return {
    ...built,
    title: built.title ?? (p.scope === 'all' ? `${info.title} — all records` : info.title),
    fileStem: STEMS[dataset],
  };
}

export const isDatasetId = (v: string): v is ExportDatasetId => Object.hasOwn(EXPORT_DATASETS, v);
