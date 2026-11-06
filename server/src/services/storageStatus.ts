import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { StorageStatus } from '@sop/shared';
import { env, isProduction } from '../config/env.js';
import { store } from '../storage/store.js';

/**
 * Tells admins whether the data folder will survive restarts and redeploys. The server cannot
 * be certain, so it reports what it can see: writability, container volumes, known hosts
 * without persistent disks, and backup freshness.
 */

const DAY = 86_400_000;

function sameDevice(a: string, b: string): boolean {
  try {
    return statSync(a).dev === statSync(b).dev;
  } catch {
    return false;
  }
}

export function insideFolder(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const messages: string[] = [];
  let level: StorageStatus['persistence'] = 'ok';
  const warn = (m: string) => {
    messages.push(m);
    if (level === 'ok') level = 'warning';
  };
  const fail = (m: string) => {
    messages.push(m);
    level = 'error';
  };

  const dir = store.dataDir;
  const writable = await store.healthy();
  if (!writable) fail(`The server cannot write to its data folder (${dir}). Nothing can be saved until this is fixed.`);

  if (env.CLIENT_DIST_DIR && insideFolder(dir, env.CLIENT_DIST_DIR)) {
    fail('The data folder is inside the public web folder. Move it (DATA_DIR) so its files can never be downloaded.');
  }
  if (process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    fail('This host runs the app as short-lived functions with no persistent disk. Data will be lost. Use a server, container with a volume, or a host with a persistent disk.');
  }
  if (process.env.DYNO) {
    warn('This looks like Heroku, whose file system is reset at least once a day. Data in the data folder will be lost. Use a host with a persistent disk.');
  }
  if (isProduction && !env.DATA_DIR) {
    warn(`DATA_DIR is not set, so data is kept in ${dir} inside the app folder. Many hosts replace that folder on every redeploy. Set DATA_DIR to a persistent disk or volume.`);
  }
  const inContainer = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
  if (inContainer && sameDevice(dir, '/')) {
    warn('The app runs in a container but its data folder is not on a mounted volume. Data will be lost when the container is replaced. Mount a volume at the data folder.');
  }

  const backups = await store.listBackups();
  const last = backups[0]?.createdAt ?? null;
  if (!last) messages.push('No backup has been made yet. One is made automatically every day; you can also back up now.');
  else if (Date.now() - Date.parse(last) > 2 * DAY) warn('The last backup is more than two days old.');

  return {
    dataDir: dir,
    configuredPath: Boolean(env.DATA_DIR),
    writable,
    persistence: level,
    messages,
    createdAt: store.createdAt,
    backups: backups.map((b) => ({ name: b.name, createdAt: b.createdAt, reason: b.reason, files: Object.keys(b.files).length, totalBytes: b.totalBytes })),
    lastBackupAt: last,
    recentProblems: [...store.warnings].reverse(),
  };
}

/** Makes the daily backup if the newest one is older than a day. */
export async function dailyBackupIfDue(now = Date.now()): Promise<boolean> {
  const last = (await store.listBackups())[0];
  if (last && now - Date.parse(last.createdAt) < DAY) return false;
  await store.backup('daily');
  return true;
}
