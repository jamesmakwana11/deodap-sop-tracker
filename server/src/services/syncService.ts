import type { AdAccountInfo, MetaCampaignStatusCounts, SyncProgress } from '@sop/shared';
import { auditCampaigns } from '../audit/auditCampaign.js';
import { badRequest, conflict } from '../http/errors.js';
import { fetchAccountSnapshots, fetchCampaignStatusCounts } from '../meta/fetchAccount.js';
import { explainMetaError } from '../meta/permissions.js';
import { MetaApiError, onGraphWait, type GraphWait } from '../meta/graphClient.js';
import type { CampaignSnapshot } from '../meta/types.js';
import { createRun, finishRun, insertCampaignAudits, recordRunAccount } from '../repositories/auditWriter.js';
import { listSelectedAccounts, markConnectionInvalid } from '../repositories/metaRepository.js';
import { store } from '../storage/store.js';
import { clientForConnection } from './metaConnectionService.js';
import { istDate } from './scheduleTime.js';

/**
 * One sync = one audit run: read every selected ad account from Meta, run the SOP checks
 * and ratings, and store the snapshot. Only one run at a time (the JSON store serves a
 * single server process, so an in-process lock is enough).
 */

let running = false;
let progress: SyncProgress | null = null;

/** Progress of the running sync, for the status endpoint (null when idle). */
export const currentProgress = (): SyncProgress | null => progress;
export const isSyncRunning = (): boolean => running;

/** What Meta is waiting for; the client adds the countdown from waitingUntil. */
const waitText = (w: GraphWait, account: string | null) =>
  w.reason === 'rate_limit'
    ? `Meta rate limit${account ? ` on ${account}` : ''}: waiting before retry ${w.attempt} of ${w.maxAttempts}`
    : `Close to Meta's usage limit${account ? ` on ${account}` : ''}: pausing`;

export interface StartedSync {
  runId: string;
  done: Promise<void>;
}

export async function startSync(opts: { trigger: 'scheduled' | 'manual'; userId?: string | null; now?: Date }): Promise<StartedSync> {
  const accounts = await listSelectedAccounts();
  if (accounts.length === 0) throw badRequest('No ad accounts are selected for auditing. An admin can select them in Settings.');

  if (running) throw conflict('A Meta refresh is already running.');
  running = true;

  const now = opts.now ?? new Date();
  let runId: string;
  try {
    runId = await createRun({
      source: 'meta',
      trigger: opts.trigger,
      // Meta's last_7d preset: the 7 full days before today, in the account's time zone.
      periodStart: istDate(now, -7),
      periodEnd: istDate(now, -1),
      triggeredBy: opts.userId ?? null,
    });
  } catch (err) {
    running = false;
    throw err;
  }

  return { runId, done: launch(runId, accounts, now) };
}

/** Runs one sync attempt to its single final record (succeeded, partial or failed). */
function launch(runId: string, accounts: AdAccountInfo[], now: Date): Promise<void> {
  progress = { runId, accountIndex: 0, accountCount: accounts.length, accountName: null, step: 'Starting', waitingUntil: null, waitingMessage: null, doneAccounts: [], failedAccounts: [] };
  const stopListening = onGraphWait((w) => {
    if (!progress) return;
    progress.waitingUntil = new Date(Date.now() + w.ms).toISOString();
    progress.waitingMessage = waitText(w, progress.accountName);
  });
  return executeRun(runId, accounts, now)
    .catch(async (err: Error) => {
      console.error(`Sync run ${runId} crashed`, err);
      await finishRun(runId, 'failed', err.message.slice(0, 500)).catch(() => {});
    })
    .finally(() => {
      stopListening();
      progress = null;
      running = false;
    });
}

/** Plain-language reason, with what to do (missing permission, account not assigned, expired token…). */
function describeError(err: unknown, metaAccountId: string): string {
  return explainMetaError(err, { accountId: metaAccountId });
}

async function executeRun(runId: string, accounts: AdAccountInfo[], now: Date): Promise<void> {
  const fetched: { account: AdAccountInfo; snapshots: CampaignSnapshot[]; notes: string[]; counts: MetaCampaignStatusCounts | null }[] = [];
  const failed: { account: AdAccountInfo; error: string }[] = [];

  const setStep = (step: string) => {
    if (!progress) return;
    progress.step = step;
    progress.waitingUntil = null;
    progress.waitingMessage = null;
  };
  // Accounts one after another (each reads at most two Meta edges at once), to stay within Meta's limits.
  for (const [i, account] of accounts.entries()) {
    if (progress) Object.assign(progress, { accountIndex: i + 1, accountName: account.name });
    try {
      const graph = await clientForConnection(account.connectionId!, 'background');
      const notes: string[] = [];
      const snapshots = await fetchAccountSnapshots(
        graph,
        { metaAccountId: account.metaAccountId, currency: account.currency, timezone: account.timezone },
        now,
        notes,
        (step) => setStep(`Reading ${step}`),
      );
      setStep('Counting campaigns in every status');
      // Campaigns in every status, for counts that match Ads Manager. Never fails the account.
      let counts: MetaCampaignStatusCounts | null = null;
      try {
        counts = await fetchCampaignStatusCounts(graph, account.metaAccountId, now);
        if (!counts.deletedIncluded) notes.push('Meta did not list deleted campaigns, so Total campaigns excludes them.');
        const activeListed = counts.byEffectiveStatus.ACTIVE ?? 0;
        if (activeListed !== snapshots.length) {
          notes.push(`Meta listed ${activeListed} campaigns with status Active in the count but ${snapshots.length} in the audit read; a campaign probably changed status during the refresh.`);
        }
      } catch (err) {
        if (err instanceof MetaApiError && err.isTokenInvalid) throw err;
        notes.push(`Campaign totals by status could not be read: ${describeError(err, account.metaAccountId)}`);
      }
      fetched.push({ account, snapshots, notes, counts });
      progress?.doneAccounts.push(account.name);
    } catch (err) {
      if (err instanceof MetaApiError && err.isTokenInvalid) {
        await markConnectionInvalid(account.connectionId!, err.message);
      }
      const error = describeError(err, account.metaAccountId);
      failed.push({ account, error });
      progress?.failedAccounts.push({ name: account.name, error });
    }
  }
  setStep('Checking campaigns against the SOP and saving');

  // Audit all accounts together so Leads campaigns are ranked across the whole run.
  const all = fetched.flatMap((f) => f.snapshots.map((s) => ({ account: f.account, s })));
  const audits = auditCampaigns(all.map((x) => x.s), new Date(`${istDate(now, -1)}T23:59:59+05:30`), now);

  await insertCampaignAudits(runId, all.map((x, i) => ({ accountId: x.account.id, audit: audits[i]! })));
  for (const f of fetched) await recordRunAccount(runId, f.account.id, 'succeeded', null, f.notes, f.counts);
  for (const f of failed) await recordRunAccount(runId, f.account.id, 'failed', f.error);
  const status = failed.length === 0 ? 'succeeded' : fetched.length === 0 ? 'failed' : 'partial';
  const error = failed.length ? failed.map((f) => `${f.account.name}: ${f.error}`).join(' | ').slice(0, 1000) : null;
  await finishRun(runId, status, error);
}

/**
 * At start-up, a run still marked running was cut off by a restart (e.g. a redeploy). The newest
 * one is started again under the SAME history record, so a restart does not leave a failed or
 * cancelled entry; it is failed only if it was already resumed once, or nothing can be audited.
 */
export async function closeInterruptedRuns(): Promise<number> {
  const stuck = store.c.auditRuns.filter((r) => r.status === 'running').sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  let handled = 0;
  for (const [i, r] of stuck.entries()) {
    handled++;
    const accounts = await listSelectedAccounts();
    if (i > 0 || r.resumedAt || running || accounts.length === 0 || r.source !== 'meta') {
      await finishRun(r.id, 'failed', r.resumedAt ? 'Stopped twice by a server restart. Press Refresh now to try again.' : 'Stopped by a server restart. Press Refresh now to try again.');
      continue;
    }
    // Clear what the cut-off attempt saved, then run it again as the same attempt.
    const now = new Date();
    await store.c.campaignIndex.remove((e) => e.runId === r.id);
    await store.writeRunAudits(r.id, []);
    await store.c.auditRuns.update(r.id, { accounts: [], resumedAt: now.toISOString(), periodStart: istDate(now, -7), periodEnd: istDate(now, -1) });
    running = true;
    console.log(`Resuming sync run ${r.id} after a restart`);
    void launch(r.id, accounts, now);
  }
  return handled;
}
