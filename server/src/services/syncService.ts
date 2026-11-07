import type { AdAccountInfo } from '@sop/shared';
import { auditCampaigns } from '../audit/auditCampaign.js';
import { badRequest, conflict } from '../http/errors.js';
import { fetchAccountSnapshots } from '../meta/fetchAccount.js';
import { explainMetaError } from '../meta/permissions.js';
import { MetaApiError } from '../meta/graphClient.js';
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

  const done = executeRun(runId, accounts, now)
    .catch(async (err: Error) => {
      console.error(`Sync run ${runId} crashed`, err);
      await finishRun(runId, 'failed', err.message.slice(0, 500)).catch(() => {});
    })
    .finally(() => {
      running = false;
    });

  return { runId, done };
}

/** Plain-language reason, with what to do (missing permission, account not assigned, expired token…). */
function describeError(err: unknown, metaAccountId: string): string {
  return explainMetaError(err, { accountId: metaAccountId });
}

async function executeRun(runId: string, accounts: AdAccountInfo[], now: Date): Promise<void> {
  const fetched: { account: AdAccountInfo; snapshots: CampaignSnapshot[]; notes: string[] }[] = [];
  const failed: { account: AdAccountInfo; error: string }[] = [];

  for (const account of accounts) {
    try {
      const graph = await clientForConnection(account.connectionId!);
      const notes: string[] = [];
      const snapshots = await fetchAccountSnapshots(
        graph,
        { metaAccountId: account.metaAccountId, currency: account.currency, timezone: account.timezone },
        now,
        notes,
      );
      fetched.push({ account, snapshots, notes });
    } catch (err) {
      if (err instanceof MetaApiError && err.isTokenInvalid) {
        await markConnectionInvalid(account.connectionId!, err.message);
      }
      failed.push({ account, error: describeError(err, account.metaAccountId) });
    }
  }

  // Audit all accounts together so Leads campaigns are ranked across the whole run.
  const all = fetched.flatMap((f) => f.snapshots.map((s) => ({ account: f.account, s })));
  const audits = auditCampaigns(all.map((x) => x.s), new Date(`${istDate(now, -1)}T23:59:59+05:30`));

  await insertCampaignAudits(runId, all.map((x, i) => ({ accountId: x.account.id, audit: audits[i]! })));
  for (const f of fetched) await recordRunAccount(runId, f.account.id, 'succeeded', null, f.notes);
  for (const f of failed) await recordRunAccount(runId, f.account.id, 'failed', f.error);
  const status = failed.length === 0 ? 'succeeded' : fetched.length === 0 ? 'failed' : 'partial';
  const error = failed.length ? failed.map((f) => `${f.account.name}: ${f.error}`).join(' | ').slice(0, 1000) : null;
  await finishRun(runId, status, error);
}

/** At start-up, any run still marked running was cut off by a restart; close it as failed. */
export async function closeInterruptedRuns(): Promise<number> {
  const stuck = store.c.auditRuns.filter((r) => r.status === 'running');
  for (const r of stuck) {
    await finishRun(r.id, 'failed', 'Interrupted (server restarted during the run)');
  }
  return stuck.length;
}
