import { buildDashboardSummary, type DashboardResponse } from '@sop/shared';
import { notFoundError } from '../http/errors.js';
import { findCampaignAudits, findCompletedRun, findLatestCompletedRun } from '../repositories/auditRepository.js';

/** The latest completed run, or a specific one from history. */
export async function getDashboard(runId?: string): Promise<DashboardResponse> {
  const run = runId ? await findCompletedRun(runId) : await findLatestCompletedRun();
  if (runId && !run) throw notFoundError('That audit run does not exist or did not complete.');
  const campaigns = run ? await findCampaignAudits(run.id) : [];
  return { run, campaigns, summary: buildDashboardSummary(campaigns) };
}
