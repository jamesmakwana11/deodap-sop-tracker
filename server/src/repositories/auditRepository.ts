import {
  computeCompliance,
  describeFindings,
  MANUAL_CHECK_ITEMS,
  type AccountRef,
  type AuditRunInfo,
  type CampaignAudit,
  type ManualSummary,
} from '@sop/shared';
import type { AuditRunRecord, CampaignAuditRecord } from '../storage/records.js';
import { store } from '../storage/store.js';

function toRunInfo(run: AuditRunRecord): AuditRunInfo {
  const accounts: AccountRef[] = run.accounts
    .filter((a) => a.status === 'succeeded')
    .map((a) => store.c.adAccounts.get(a.adAccountId))
    .filter((a) => a !== undefined)
    .map((a) => ({ id: a.id, metaAccountId: a.metaAccountId, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: run.id,
    source: run.source,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    accounts,
  };
}

const completed = (r: AuditRunRecord) => r.status === 'succeeded' || r.status === 'partial';

/**
 * The run the dashboard shows by default: the latest completed run, with real Meta runs
 * always preferred over development fixtures so test data never hides live results.
 */
export async function findLatestCompletedRun(): Promise<AuditRunInfo | null> {
  const runs = store.c.auditRuns.filter(completed).sort(
    (a, b) =>
      Number(b.source === 'meta') - Number(a.source === 'meta') ||
      (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '') ||
      Number(b.id) - Number(a.id),
  );
  return runs[0] ? toRunInfo(runs[0]) : null;
}

/** A specific completed run (for history). */
export async function findCompletedRun(runId: string): Promise<AuditRunInfo | null> {
  const run = store.c.auditRuns.get(runId);
  return run && completed(run) ? toRunInfo(run) : null;
}

/** A stored campaign audit with what it is displayed with. */
export interface CampaignRow {
  record: CampaignAuditRecord;
  account: AccountRef;
  manual: { key: string; status: string; note: string | null }[];
}

function toRow(record: CampaignAuditRecord): CampaignRow {
  const a = store.c.adAccounts.get(record.adAccountId);
  return {
    record,
    account: { id: record.adAccountId, metaAccountId: a?.metaAccountId ?? '', name: a?.name ?? 'Removed account' },
    manual: store.c.manualChecks
      .filter((m) => m.metaCampaignId === record.metaCampaignId)
      .map((m) => ({ key: m.itemKey, status: m.status, note: m.note })),
  };
}

export async function findCampaignAudits(runId: string): Promise<CampaignAudit[]> {
  const rows = [...(await store.readRunAudits(runId))].sort((a, b) => b.spend7d - a.spend7d || a.name.localeCompare(b.name));
  return rows.map((r) => toCampaignAudit(toRow(r)));
}

export async function findCampaignAuditRow(id: string): Promise<CampaignRow | null> {
  const entry = store.c.campaignIndex.get(id);
  if (!entry) return null;
  const record = (await store.readRunAudits(entry.runId)).find((r) => r.id === id);
  return record ? toRow(record) : null;
}

const MANUAL_LABEL = new Map<string, string>(MANUAL_CHECK_ITEMS.map((i) => [i.key, i.label]));

export function toCampaignAudit({ record: r, account, manual: manualRows }: CampaignRow): CampaignAudit {
  const manual: ManualSummary = { verified: 0, failed: 0, notApplicable: 0, pending: 0 };
  for (const m of manualRows) {
    if (m.status === 'VERIFIED') manual.verified++;
    else if (m.status === 'FAILED') manual.failed++;
    else if (m.status === 'NOT_APPLICABLE') manual.notApplicable++;
  }
  manual.pending = MANUAL_CHECK_ITEMS.length - manual.verified - manual.failed - manual.notApplicable;
  const manualFindings = manualRows
    .filter((m) => m.status === 'FAILED')
    .map((m) => `Manual check failed: ${MANUAL_LABEL.get(m.key) ?? m.key}${m.note ? ` (${m.note})` : ''}`);

  return {
    id: r.id,
    metaCampaignId: r.metaCampaignId,
    name: r.name,
    account,
    objective: r.objective,
    objectiveRaw: r.objectiveRaw,
    spend7d: r.spend7d,
    currency: r.currency,
    mainMetric: r.mainMetricKind ? { kind: r.mainMetricKind, value: r.mainMetricValue } : null,
    rating: r.rating,
    ratingIndicative: r.ratingIndicative,
    ratingNote: r.ratingNote,
    checks: r.checks,
    compliance: computeCompliance(r.checks),
    whatIsOff: [...describeFindings(r.checks), ...manualFindings],
    delivery: r.delivery ?? null,
    manual,
  };
}
