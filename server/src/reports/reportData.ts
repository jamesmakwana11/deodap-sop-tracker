import {
  buildDashboardSummary,
  filterCampaigns,
  MANUAL_CHECK_ITEMS,
  OBJECTIVES,
  RATINGS,
  SOP_STATUSES,
  sortCampaigns,
  SORT_OPTIONS,
  type AuditRunInfo,
  type CampaignAudit,
  type DashboardSummary,
  type ManualStatus,
  type SortKey,
  type TrackerFilters,
} from '@sop/shared';
import { z } from 'zod';
import { store } from '../storage/store.js';
import { notFoundError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { findCampaignAudits, findCompletedRun, findLatestCompletedRun } from '../repositories/auditRepository.js';

export interface ReportData {
  run: AuditRunInfo;
  campaigns: CampaignAudit[];
  /** Summary of the filtered campaigns. */
  summary: DashboardSummary;
  filters: TrackerFilters;
  filterDescription: string;
  sort: SortKey;
  manual: Map<string, Map<string, { status: ManualStatus; note: string | null }>>;
  generatedAt: Date;
  generatedBy: string;
}

const Query = z.object({
  accountId: z.string().regex(/^\d+$/).optional(),
  rating: z.enum(RATINGS as [string, ...string[]]).optional(),
  objective: z.enum([...OBJECTIVES, 'Other'] as [string, ...string[]]).optional(),
  sopStatus: z.enum(SOP_STATUSES as [string, ...string[]]).optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(Object.keys(SORT_OPTIONS) as [SortKey, ...SortKey[]]).default('spend_desc'),
});

export async function loadReportData(runIdParam: string, query: unknown, generatedBy: string): Promise<ReportData> {
  const q = parse(Query, query);
  const run = runIdParam === 'latest' ? await findLatestCompletedRun() : /^\d+$/.test(runIdParam) ? await findCompletedRun(runIdParam) : null;
  if (!run) throw notFoundError('No completed audit run to report on.');

  const all = await findCampaignAudits(run.id);
  const filters = { accountId: q.accountId, rating: q.rating, objective: q.objective, sopStatus: q.sopStatus, search: q.search } as TrackerFilters;
  const campaigns = sortCampaigns(filterCampaigns(all, filters), q.sort);

  const parts: string[] = [];
  if (filters.accountId) parts.push(`account ${all.find((c) => c.account.id === filters.accountId)?.account.name ?? filters.accountId}`);
  if (filters.rating) parts.push(`rating ${filters.rating.toLowerCase().replace('_', ' ')}`);
  if (filters.objective) parts.push(`objective ${filters.objective}`);
  if (filters.sopStatus) parts.push(`SOP status ${filters.sopStatus.toLowerCase().replace('_', ' ')}`);
  if (filters.search) parts.push(`name contains “${filters.search}”`);

  const wanted = new Set(campaigns.map((c) => c.metaCampaignId));
  const rows = store.c.manualChecks.filter((m) => wanted.has(m.metaCampaignId));
  const manual = new Map<string, Map<string, { status: ManualStatus; note: string | null }>>();
  for (const r of rows) {
    if (!manual.has(r.metaCampaignId)) manual.set(r.metaCampaignId, new Map());
    manual.get(r.metaCampaignId)!.set(r.itemKey, { status: r.status, note: r.note });
  }

  return {
    run,
    campaigns,
    summary: buildDashboardSummary(campaigns),
    filters,
    filterDescription: parts.length ? `Filtered to ${parts.join(', ')} (${campaigns.length} of ${all.length} campaigns)` : `All ${all.length} active campaigns`,
    sort: q.sort,
    manual,
    generatedAt: new Date(),
    generatedBy,
  };
}

export function manualStatusOf(data: ReportData, metaCampaignId: string, key: (typeof MANUAL_CHECK_ITEMS)[number]['key']) {
  return data.manual.get(metaCampaignId)?.get(key) ?? { status: 'PENDING' as ManualStatus, note: null };
}

export function reportFileName(data: ReportData, ext: 'xlsx' | 'pdf'): string {
  const date = (data.run.finishedAt ?? data.run.startedAt).slice(0, 10);
  const dev = data.run.source === 'development' ? '-DEV-DATA' : '';
  return `deodap-sop-audit-${date}-run${data.run.id}${dev}.${ext}`;
}
