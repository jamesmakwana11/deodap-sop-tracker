import type { RunSource, RunStatus } from './types.js';

export interface RunAccountResult {
  name: string;
  metaAccountId: string;
  status: 'succeeded' | 'failed';
  error: string | null;
}

export interface RunTotals {
  campaigns: number;
  good: number;
  average: number;
  bad: number;
  notRated: number;
  following: number;
  partlyFollowing: number;
  notFollowing: number;
  needsReview: number;
}

/** One audit run, as listed in History and shown in the sync status. */
export interface RunListItem {
  id: string;
  source: RunSource;
  trigger: 'scheduled' | 'manual' | 'seed';
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  error: string | null;
  triggeredBy: string | null;
  accounts: RunAccountResult[];
  totals: RunTotals;
}

export interface SyncStatusResponse {
  running: RunListItem | null;
  lastFinished: RunListItem | null;
}
