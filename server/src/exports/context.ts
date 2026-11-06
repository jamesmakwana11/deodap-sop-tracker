import {
  filterCampaigns,
  formatDate,
  formatIst,
  OBJECTIVES,
  RATINGS,
  SOP_STATUSES,
  sortCampaigns,
  SORT_OPTIONS,
  type AuditRunInfo,
  type AuthUser,
  type CampaignAudit,
  type SortKey,
  type TrackerFilters,
} from '@sop/shared';
import { z } from 'zod';
import { notFoundError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { findCampaignAudits, findCompletedRun, findLatestCompletedRun } from '../repositories/auditRepository.js';
import type { CampaignAuditRecord } from '../storage/records.js';
import { store } from '../storage/store.js';

const id = z.string().regex(/^\d{1,18}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

const Query = z.object({
  runId: z.union([id, z.literal('latest')]).default('latest'),
  scope: z.enum(['filtered', 'all']).default('filtered'),
  accountId: id.optional(),
  rating: z.enum(RATINGS as [string, ...string[]]).optional(),
  objective: z.enum([...OBJECTIVES, 'Other'] as [string, ...string[]]).optional(),
  sopStatus: z.enum(SOP_STATUSES as [string, ...string[]]).optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(Object.keys(SORT_OPTIONS) as [SortKey, ...SortKey[]]).default('spend_desc'),
  campaignId: id.optional(),
  from: date.optional(),
  to: date.optional(),
  runA: id.optional(),
  runB: id.optional(),
});

export type ExportParams = z.infer<typeof Query> & { filters: TrackerFilters };

export function parseExportParams(query: unknown): ExportParams {
  const q = parse(Query, query);
  const filters = { accountId: q.accountId, rating: q.rating, objective: q.objective, sopStatus: q.sopStatus, search: q.search } as TrackerFilters;
  return { ...q, filters };
}

/** The query values worth keeping with a saved report (no empty ones). */
export function paramsForRecord(p: ExportParams): Record<string, string> {
  const keep: Record<string, string> = {};
  for (const k of ['runId', 'scope', 'accountId', 'rating', 'objective', 'sopStatus', 'search', 'sort', 'campaignId', 'from', 'to', 'runA', 'runB'] as const) {
    const v = p[k];
    if (v !== undefined && v !== '') keep[k] = String(v);
  }
  return keep;
}

export interface RunContext {
  run: AuditRunInfo;
  all: CampaignAudit[];
  /** Campaigns after filters (scope "filtered") or all of them (scope "all"), sorted. */
  campaigns: CampaignAudit[];
  scopeText: string;
  records: Map<string, CampaignAuditRecord>;
}

export async function resolveRun(runId: string): Promise<AuditRunInfo> {
  const run = runId === 'latest' ? await findLatestCompletedRun() : await findCompletedRun(runId);
  if (!run) throw notFoundError('No completed audit to export yet.');
  return run;
}

export function describeFilters(f: TrackerFilters, all: CampaignAudit[], shown: number): string {
  const parts: string[] = [];
  if (f.accountId) parts.push(`account ${all.find((c) => c.account.id === f.accountId)?.account.name ?? f.accountId}`);
  if (f.rating) parts.push(`rating ${f.rating.toLowerCase().replace('_', ' ')}`);
  if (f.objective) parts.push(`objective ${f.objective}`);
  if (f.sopStatus) parts.push(`SOP status ${f.sopStatus.toLowerCase().replace(/_/g, ' ')}`);
  if (f.search) parts.push(`name contains “${f.search}”`);
  return parts.length ? `Filtered to ${parts.join(', ')} (${shown} of ${all.length} campaigns)` : `All ${all.length} campaigns`;
}

export async function loadRunContext(p: ExportParams): Promise<RunContext> {
  const run = await resolveRun(p.runId);
  const all = await findCampaignAudits(run.id);
  const records = new Map((await store.readRunAudits(run.id)).map((r) => [r.id, r]));
  let campaigns: CampaignAudit[];
  let scopeText: string;
  if (p.scope === 'filtered' && p.campaignId) {
    campaigns = all.filter((c) => c.id === p.campaignId);
    if (!campaigns.length) throw notFoundError('That campaign is not part of this audit.');
    scopeText = `Campaign: ${campaigns[0]!.name}`;
  } else if (p.scope === 'filtered') {
    campaigns = sortCampaigns(filterCampaigns(all, p.filters), p.sort);
    scopeText = `${describeFilters(p.filters, all, campaigns.length)}, sorted by ${SORT_OPTIONS[p.sort].toLowerCase()}`;
  } else {
    campaigns = sortCampaigns(all, p.sort);
    scopeText = `All ${all.length} campaigns in this audit (filters not applied)`;
  }
  return { run, all, campaigns, scopeText, records };
}

export function runLine(run: AuditRunInfo): string {
  const period = run.periodStart && run.periodEnd ? `${formatDate(run.periodStart)} – ${formatDate(run.periodEnd)}` : '–';
  const accounts = run.accounts.map((a) => `${a.name} (${a.metaAccountId})`).join(', ') || '–';
  return `Audit #${run.id} of ${formatIst(run.finishedAt ?? run.startedAt)} · performance period ${period} · ad accounts: ${accounts}`;
}

export function generatedLine(user: AuthUser): string {
  return `Generated ${formatIst(new Date().toISOString())} by ${user.name}`;
}
