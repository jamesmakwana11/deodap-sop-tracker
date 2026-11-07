import { buildCampaignCounts, buildDashboardSummary, filterCampaigns, type DashboardResponse } from '@sop/shared';
import { notFoundError } from '../http/errors.js';
import { findCampaignAudits, findCompletedRun, findLatestCompletedRun } from '../repositories/auditRepository.js';
import { listRuns } from '../repositories/runRepository.js';

/** The latest completed run, or a specific one from history. */
export async function getDashboard(runId?: string): Promise<DashboardResponse> {
  const run = runId ? await findCompletedRun(runId) : await findLatestCompletedRun();
  if (runId && !run) throw notFoundError('That audit run does not exist or did not complete.');
  const campaigns = run ? await findCampaignAudits(run.id) : [];
  // Per-account results (with Meta's status counts) of this audit, and the last successful Meta sync.
  const runs = await listRuns(200);
  const accounts = run ? (runs.find((r) => r.id === run.id)?.accounts ?? []) : [];
  const lastOk = runs.find((r) => r.source === 'meta' && (r.status === 'succeeded' || r.status === 'partial'));
  const counts = buildCampaignCounts(accounts, campaigns, lastOk ? (lastOk.finishedAt ?? lastOk.startedAt) : null);
  // KPIs and summaries cover Active campaigns only (campaign, ad sets and ads all Active); the
  // campaigns list keeps every audited one so the tracker can also show all.
  return { run, campaigns, summary: buildDashboardSummary(filterCampaigns(campaigns, {})), counts };
}
