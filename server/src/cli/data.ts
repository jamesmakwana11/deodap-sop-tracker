/**
 * Data folder maintenance:
 *   npm run data -- backup             make a backup now
 *   npm run data -- list               list backups
 *   npm run data -- verify [name]      check every data file and a backup (default: the newest)
 *   npm run data -- restore <name>     restore a backup (stop the server first)
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { listBackups, restoreBackup, verifyBackup } from '../storage/backups.js';
import { parseCollectionFile } from '../storage/collection.js';
import { closeStore, DEFAULT_DATA_DIR } from '../storage/store.js';
import { serverIsRunning } from '../storage/serverLock.js';
import { store, openStore } from '../storage/store.js';

const dir = path.resolve(process.env.DATA_DIR || DEFAULT_DATA_DIR);
const [cmd, arg] = process.argv.slice(2);
const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;

async function verifyFolder(): Promise<string[]> {
  const problems: string[] = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.json') || name === 'storage.json') continue;
    try {
      parseCollectionFile(path.join(dir, name), await readFile(path.join(dir, name), 'utf8'), (m) => problems.push(`note: ${m}`));
    } catch (err) {
      problems.push((err as Error).message);
    }
  }
  for (const name of await readdir(path.join(dir, 'audits')).catch(() => [])) {
    try {
      if (!Array.isArray(JSON.parse(await readFile(path.join(dir, 'audits', name), 'utf8')))) problems.push(`audits/${name}: not a list`);
    } catch (err) {
      problems.push(`audits/${name}: ${(err as Error).message}`);
    }
  }
  return problems;
}

async function main() {
  console.log(`Data folder: ${dir}`);
  if (cmd === 'backup') {
    await openStore(dir);
    const b = await store.backup('manual');
    console.log(`Backup ${b.name}: ${Object.keys(b.files).length} files, ${mb(b.totalBytes)}`);
  } else if (cmd === 'list') {
    const all = await listBackups(dir);
    if (!all.length) console.log('No backups yet.');
    for (const b of all) console.log(`${b.name}  ${b.reason.padEnd(14)} ${String(Object.keys(b.files).length).padStart(5)} files  ${mb(b.totalBytes)}`);
  } else if (cmd === 'verify') {
    const problems = await verifyFolder();
    const backups = await listBackups(dir);
    const newest = arg ? backups.find((b) => b.name === arg) : backups[0];
    if (arg && !newest) throw new Error(`No backup named ${arg}. See: npm run data -- list`);
    if (newest) problems.push(...(await verifyBackup(dir, newest.name)).map((p) => `backup ${newest.name}: ${p}`));
    if (problems.some((p) => !p.startsWith('note:'))) {
      problems.forEach((p) => console.log(`  ${p}`));
      process.exitCode = 1;
    } else {
      problems.forEach((p) => console.log(`  ${p}`));
      console.log(`All data files are readable${newest ? ` and backup ${newest.name} matches its checksums` : ''}.`);
    }
  } else if (cmd === 'restore') {
    if (!arg) throw new Error('Name the backup: npm run data -- restore <name>  (see npm run data -- list)');
    if (await serverIsRunning(dir)) throw new Error('Stop the server first; it is using this data folder.');
    const { safetyBackup } = await restoreBackup(dir, arg);
    console.log(`Restored ${arg}. The previous state was saved as backup ${safetyBackup}.`);
  } else {
    console.log('Usage: npm run data -- backup | list | verify | restore <name>');
  }
}

main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closeStore());
