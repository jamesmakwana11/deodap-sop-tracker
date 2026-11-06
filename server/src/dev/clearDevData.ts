/** Removes every development run and development account. Real Meta data is untouched. */
import { deleteRuns } from '../repositories/auditWriter.js';
import { closeStore, openStore, store } from '../storage/store.js';

export async function clearDevData(): Promise<void> {
  await deleteRuns((r) => r.source === 'development');
  await store.c.adAccounts.remove((a) => a.isDevData);
}

const isEntrypoint = process.argv[1]?.endsWith('clearDevData.ts');
if (isEntrypoint) {
  openStore()
    .then(clearDevData)
    .then(() => console.log('Development data removed.'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeStore());
}
