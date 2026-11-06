import type { RunListItem, RunTotals } from '@sop/shared';
import type { AuditRunRecord } from '../storage/records.js';
import { store } from '../storage/store.js';

const EMPTY_TOTALS: RunTotals = {
  campaigns: 0, good: 0, average: 0, bad: 0, notRated: 0, following: 0, partlyFollowing: 0, notFollowing: 0, needsReview: 0,
};

function toItem(r: AuditRunRecord): RunListItem {
  return {
    id: r.id,
    source: r.source,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    error: r.error,
    triggeredBy: r.triggeredBy ? (store.c.users.get(r.triggeredBy)?.name ?? null) : null,
    accounts: r.accounts
      .map((a) => {
        const acc = store.c.adAccounts.get(a.adAccountId);
        return { name: acc?.name ?? 'Removed account', metaAccountId: acc?.metaAccountId ?? '', status: a.status, error: a.error };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    totals: r.totals ?? EMPTY_TOTALS,
  };
}

/** Newest first. */
const newestFirst = (a: AuditRunRecord, b: AuditRunRecord) => b.startedAt.localeCompare(a.startedAt) || Number(b.id) - Number(a.id);

export async function listRuns(limit = 60): Promise<RunListItem[]> {
  return [...store.c.auditRuns.all()].sort(newestFirst).slice(0, limit).map(toItem);
}

export async function findRun(id: string): Promise<RunListItem | null> {
  const r = store.c.auditRuns.get(id);
  return r ? toItem(r) : null;
}

export async function findRunningRun(): Promise<RunListItem | null> {
  const r = store.c.auditRuns.filter((x) => x.status === 'running' && x.source === 'meta').sort(newestFirst)[0];
  return r ? toItem(r) : null;
}

export async function findLastFinishedMetaRun(): Promise<RunListItem | null> {
  const r = store.c.auditRuns.filter((x) => x.status !== 'running' && x.source === 'meta').sort(newestFirst)[0];
  return r ? toItem(r) : null;
}
