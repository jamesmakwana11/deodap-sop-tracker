/**
 * Loads labelled DEVELOPMENT data (source = 'development'). Never use for real reporting.
 * Re-running replaces earlier development runs. Real Meta runs are never touched.
 */
import {
  createRun,
  finishRun,
  insertCampaignAudits,
  recordRunAccount,
  upsertAdAccount,
} from '../repositories/auditWriter.js';
import { DEV_ACCOUNTS, DEV_CAMPAIGNS } from './devFixtures.js';
import { clearDevData } from './clearDevData.js';
import { closeStore, openStore } from '../storage/store.js';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function seedDevData(): Promise<string> {
  await clearDevData();
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 86_400_000);
  const runId = await createRun({
    source: 'development',
    trigger: 'seed',
    periodStart: isoDate(start),
    periodEnd: isoDate(end),
  });

  const accountIds: string[] = [];
  for (const account of DEV_ACCOUNTS) {
    const id = await upsertAdAccount(account);
    accountIds.push(id);
    await recordRunAccount(runId, id, 'succeeded');
  }

  await insertCampaignAudits(
    runId,
    DEV_CAMPAIGNS.map(({ account, ...c }) => ({
      accountId: accountIds[account]!,
      audit: {
        ...c,
        currency: 'INR',
        effectiveStatus: 'ACTIVE',
        rawSnapshot: { devData: true, note: 'Development fixture — not a Meta API response' },
      },
    })),
  );

  await finishRun(runId, 'succeeded');
  return runId;
}

const isEntrypoint = process.argv[1]?.endsWith('seedDevData.ts');
if (isEntrypoint) {
  openStore()
    .then(seedDevData)
    .then((runId) => console.log(`Loaded DEVELOPMENT data as audit run ${runId} (not real Meta results).`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeStore());
}
