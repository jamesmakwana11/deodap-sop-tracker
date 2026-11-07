import type { DeliveryState, MetaCampaignStatusCounts } from '@sop/shared';
import {
  computeCompliance,
  type CheckResult,
  type MetricKind,
  type ObjectiveLabel,
  type Rating,
  type RunSource,
  type RunStatus,
  type RunTotals,
} from '@sop/shared';
import type { AuditRunRecord, CampaignAuditRecord } from '../storage/records.js';
import { ensureRulesSaved } from '../services/rulesSnapshot.js';
import { store } from '../storage/store.js';

/** Write path for audit snapshots. Used by the Meta sync and the development seed. */

const now = () => new Date().toISOString();

export interface AdAccountInput {
  metaAccountId: string;
  name: string;
  currency?: string;
  timezone?: string | null;
  isDevData?: boolean;
}

export async function upsertAdAccount(a: AdAccountInput): Promise<string> {
  const fields = { name: a.name, currency: a.currency ?? 'INR', timezone: a.timezone ?? null, updatedAt: now() };
  const existing = store.c.adAccounts.find((x) => x.metaAccountId === a.metaAccountId);
  if (existing) return (await store.c.adAccounts.update(existing.id, fields))!.id;
  const r = await store.c.adAccounts.insert({
    ...fields,
    metaAccountId: a.metaAccountId,
    isActive: false,
    isDevData: a.isDevData ?? false,
    connectionId: null,
    accountStatus: null,
    businessName: null,
    lastSeenAt: null,
    createdAt: now(),
  });
  return r.id;
}

export async function createRun(r: {
  source: RunSource;
  trigger: 'scheduled' | 'manual' | 'seed';
  periodStart: string;
  periodEnd: string;
  triggeredBy?: string | null;
}): Promise<string> {
  const run = await store.c.auditRuns.insert({
    source: r.source,
    trigger: r.trigger,
    status: 'running',
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    startedAt: now(),
    finishedAt: null,
    error: null,
    triggeredBy: r.triggeredBy ?? null,
    accounts: [],
    totals: null,
    rulesVersion: await ensureRulesSaved(),
  });
  return run.id;
}

export async function recordRunAccount(
  runId: string,
  accountId: string,
  status: 'succeeded' | 'failed',
  error: string | null = null,
  notes: string[] = [],
  campaignCounts: MetaCampaignStatusCounts | null = null,
): Promise<void> {
  const run = store.c.auditRuns.get(runId);
  if (!run) return;
  const accounts = run.accounts.filter((a) => a.adAccountId !== accountId);
  accounts.push({ adAccountId: accountId, status, error, ...(notes.length ? { notes } : {}), ...(campaignCounts ? { campaignCounts } : {}) });
  await store.c.auditRuns.update(runId, { accounts });
}

/** Totals per run, following computeCompliance(). Stored once, because a finished run never changes. */
export function computeRunTotals(rows: CampaignAuditRecord[]): RunTotals {
  const t: RunTotals = { campaigns: rows.length, good: 0, average: 0, bad: 0, notRated: 0, following: 0, partlyFollowing: 0, notFollowing: 0, needsReview: 0 };
  for (const r of rows) {
    if (r.rating === 'GOOD') t.good++;
    else if (r.rating === 'AVERAGE') t.average++;
    else if (r.rating === 'BAD') t.bad++;
    else t.notRated++;
    const s = computeCompliance(r.checks).status;
    if (s === 'FOLLOWING') t.following++;
    else if (s === 'PARTLY_FOLLOWING') t.partlyFollowing++;
    else if (s === 'NOT_FOLLOWING') t.notFollowing++;
    else t.needsReview++;
  }
  return t;
}

export async function finishRun(runId: string, status: Exclude<RunStatus, 'running'>, error: string | null = null): Promise<void> {
  const totals = computeRunTotals(await store.readRunAudits(runId));
  await store.c.auditRuns.update(runId, { status, finishedAt: now(), error, totals });
}

export interface CampaignAuditInput {
  metaCampaignId: string;
  name: string;
  objectiveRaw: string;
  objective: ObjectiveLabel;
  effectiveStatus: string | null;
  delivery?: DeliveryState | null;
  currency: string;
  spend7d: number;
  mainMetric: { kind: MetricKind; value: number | null } | null;
  rating: Rating;
  ratingIndicative: boolean;
  checks: CheckResult[];
  rawSnapshot?: unknown;
  ratingNote?: string | null;
  leadsBaselineCpl?: number | null;
  buyingType?: string | null;
  bidStrategy?: string | null;
  dailyBudget?: number | null;
  lifetimeBudget?: number | null;
  startTime?: string | null;
  adSets?: AdSetAuditInput[];
  ads?: AdAuditInput[];
}

export interface AdSetAuditInput {
  metaAdSetId: string;
  name: string;
  effectiveStatus: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  bidStrategy: string | null;
  optimizationGoal: string | null;
  isDynamicCreative: boolean | null;
  publisherPlatforms: string[] | null;
  frequencyCap: string | null;
  locations: string | null;
  excludedLocations: string | null;
  rawSnapshot: unknown;
}

export interface AdAuditInput {
  metaAdSetId: string | null;
  metaAdId: string;
  name: string;
  effectiveStatus: string | null;
  creativeId: string | null;
  primaryText: string | null;
  headline: string | null;
  ctaType: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  permalinkUrl: string | null;
  rawSnapshot: unknown;
}

/** Adds many campaign audits to a run with one write of the run file. Returns their ids. */
export async function insertCampaignAudits(runId: string, items: { accountId: string; audit: CampaignAuditInput }[]): Promise<string[]> {
  const rows = [...(await store.readRunAudits(runId))];
  const ids = await store.c.campaignIds.reserveIds(items.length);
  const adSetIds = await store.c.adSetIds.reserveIds(items.reduce((n, i) => n + (i.audit.adSets?.length ?? 0), 0));
  const adIds = await store.c.adIds.reserveIds(items.reduce((n, i) => n + (i.audit.ads?.length ?? 0), 0));
  const index: { id: string; runId: string; metaCampaignId: string; adIds: string[] }[] = [];
  items.forEach(({ accountId, audit: c }, i) => {
    const id = ids[i]!;
    const adSets = (c.adSets ?? []).map((a) => ({ ...a, id: adSetIds.shift()! }));
    const ads = (c.ads ?? []).map((a) => ({ ...a, id: adIds.shift()! }));
    rows.push({
      id,
      runId,
      adAccountId: accountId,
      metaCampaignId: c.metaCampaignId,
      name: c.name,
      objectiveRaw: c.objectiveRaw,
      objective: c.objective,
      effectiveStatus: c.effectiveStatus,
      delivery: c.delivery ?? null,
      currency: c.currency,
      spend7d: c.spend7d,
      mainMetricKind: c.mainMetric?.kind ?? null,
      mainMetricValue: c.mainMetric?.value ?? null,
      rating: c.rating,
      ratingIndicative: c.ratingIndicative,
      ratingNote: c.ratingNote ?? null,
      // Infinity (no leads) is not valid JSON; store it as unknown.
      leadsBaselineCpl: c.leadsBaselineCpl !== null && c.leadsBaselineCpl !== undefined && Number.isFinite(c.leadsBaselineCpl) ? c.leadsBaselineCpl : null,
      buyingType: c.buyingType ?? null,
      bidStrategy: c.bidStrategy ?? null,
      dailyBudget: c.dailyBudget ?? null,
      lifetimeBudget: c.lifetimeBudget ?? null,
      startTime: c.startTime ?? null,
      rawSnapshot: c.rawSnapshot ?? null,
      createdAt: now(),
      checks: c.checks,
      adSets,
      ads,
    });
    index.push({ id, runId, metaCampaignId: c.metaCampaignId, adIds: ads.map((a) => a.id) });
  });
  await store.c.campaignIndex.insertMany(index);
  await store.writeRunAudits(runId, rows);
  return ids;
}

export async function insertCampaignAudit(runId: string, accountId: string, c: CampaignAuditInput): Promise<string> {
  const [id] = await insertCampaignAudits(runId, [{ accountId, audit: c }]);
  return id!;
}

/** Deletes runs (and their audit files and index entries) matching the predicate. */
export async function deleteRuns(pred: (r: AuditRunRecord) => boolean): Promise<number> {
  const runs = store.c.auditRuns.filter(pred);
  const ids = new Set(runs.map((r) => r.id));
  for (const id of ids) await store.deleteRunAudits(id);
  await store.c.campaignIndex.remove((x) => ids.has(x.runId));
  return store.c.auditRuns.remove((r) => ids.has(r.id));
}
