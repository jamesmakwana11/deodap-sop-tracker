import type { MetaCampaignStatusCounts } from './counts.js';
import type { RunSource, RunStatus } from './types.js';

export interface RunAccountResult {
  name: string;
  metaAccountId: string;
  status: 'succeeded' | 'failed';
  error: string | null;
  /** What Meta did not allow reading although the account was audited (e.g. insights). */
  notes: string[];
  /** Campaigns per Meta status for the account (all statuses); absent on older audits. */
  campaignCounts?: MetaCampaignStatusCounts | null;
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

/** Live progress of the running sync (held in memory by the server). */
export interface SyncProgress {
  runId: string;
  /** 1-based number of the ad account being read. */
  accountIndex: number;
  accountCount: number;
  accountName: string | null;
  /** What is being read right now. */
  step: string;
  /** Set while waiting for Meta's rate limit: when the next try happens, and why. */
  waitingUntil: string | null;
  waitingMessage: string | null;
  doneAccounts: string[];
  failedAccounts: { name: string; error: string }[];
}

export interface SyncStatusResponse {
  running: RunListItem | null;
  lastFinished: RunListItem | null;
  progress: SyncProgress | null;
}
