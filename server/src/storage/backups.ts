import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, link, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Backups of the data folder, kept in <data>/backups/<name>/ with a manifest of SHA-256
 * checksums. Files are always copied from the live data, so damage to a live file can never
 * reach a backup. To save space, a file identical to the one in the previous backup is
 * hard-linked to that backup's copy instead (backups only ever share files with each other).
 */

export const BACKUPS_DIR = 'backups';
const SKIP_TOP_LEVEL = new Set([BACKUPS_DIR, 'server.pid']);

export interface BackupManifest {
  name: string;
  createdAt: string;
  reason: string;
  files: Record<string, { size: number; sha256: string }>;
  totalBytes: number;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Every data file, as paths relative to the data folder (backups and temp files excluded). */
async function listDataFiles(dataDir: string, sub = ''): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(path.join(dataDir, sub), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (!sub && SKIP_TOP_LEVEL.has(e.name)) continue;
    if (e.name.endsWith('.tmp')) continue;
    if (e.isDirectory()) out.push(...(await listDataFiles(dataDir, rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

async function linkOrCopy(from: string, to: string): Promise<void> {
  try {
    await link(from, to);
  } catch {
    await copyFile(from, to);
  }
}

export async function createBackup(dataDir: string, reason: string): Promise<BackupManifest> {
  const createdAt = new Date().toISOString();
  const name = `${createdAt.replace(/[:.]/g, '-')}-${reason.replace(/[^a-z0-9-]/gi, '').slice(0, 30) || 'manual'}`;
  const target = path.join(dataDir, BACKUPS_DIR, name);
  const previous = (await listBackups(dataDir))[0];
  const files: BackupManifest['files'] = {};
  let totalBytes = 0;
  for (const rel of await listDataFiles(dataDir)) {
    const dest = path.join(target, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    try {
      await copyFile(path.join(dataDir, rel), dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue; // replaced while we were listing
      throw err;
    }
    const sha256 = await sha256File(dest);
    const { size } = await stat(dest);
    const same = previous?.files[rel];
    if (same && same.sha256 === sha256 && same.size === size) {
      // Identical to the previous backup's copy: share that copy instead of keeping two.
      const prevFile = path.join(dataDir, BACKUPS_DIR, previous.name, rel);
      await rm(dest);
      await linkOrCopy(prevFile, dest);
    }
    files[rel] = { size, sha256 };
    totalBytes += size;
  }
  const manifest: BackupManifest = { name, createdAt, reason, files, totalBytes };
  await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}

export async function listBackups(dataDir: string): Promise<BackupManifest[]> {
  const dir = path.join(dataDir, BACKUPS_DIR);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: BackupManifest[] = [];
  for (const n of names) {
    try {
      out.push(JSON.parse(await readFile(path.join(dir, n, 'manifest.json'), 'utf8')) as BackupManifest);
    } catch {
      // An unfinished or foreign folder: not a usable backup.
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Keeps the newest `keep` backups. */
export async function pruneBackups(dataDir: string, keep: number): Promise<number> {
  const all = await listBackups(dataDir);
  const old = all.slice(Math.max(keep, 1));
  for (const b of old) await rm(path.join(dataDir, BACKUPS_DIR, b.name), { recursive: true, force: true });
  return old.length;
}

/** Checks every file of a backup against its manifest. Returns the problems found. */
export async function verifyBackup(dataDir: string, name: string): Promise<string[]> {
  const dir = path.join(dataDir, BACKUPS_DIR, name);
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
  const problems: string[] = [];
  for (const [rel, meta] of Object.entries(manifest.files)) {
    try {
      if ((await sha256File(path.join(dir, rel))) !== meta.sha256) problems.push(`${rel}: checksum does not match`);
    } catch {
      problems.push(`${rel}: missing`);
    }
  }
  return problems;
}

/**
 * Replaces the data folder's contents with a backup. A safety backup of the current state is
 * taken first, so a restore can itself be undone.
 */
export async function restoreBackup(dataDir: string, name: string): Promise<{ safetyBackup: string }> {
  const problems = await verifyBackup(dataDir, name);
  if (problems.length) throw new Error(`Backup ${name} failed its integrity check: ${problems.slice(0, 5).join('; ')}`);
  const safety = await createBackup(dataDir, 'before-restore');
  const manifest = (await listBackups(dataDir)).find((b) => b.name === name)!;
  for (const rel of await listDataFiles(dataDir)) await rm(path.join(dataDir, rel), { force: true });
  for (const rel of Object.keys(manifest.files)) {
    await mkdir(path.dirname(path.join(dataDir, rel)), { recursive: true });
    await copyFile(path.join(dataDir, BACKUPS_DIR, name, rel), path.join(dataDir, rel));
  }
  return { safetyBackup: safety.name };
}

/**
 * The newest backup copy of one file that passes `isValid`, for automatic recovery of a damaged file.
 */
export async function findRecoverableCopy(
  dataDir: string,
  rel: string,
  isValid: (text: string) => boolean,
): Promise<{ backup: string; file: string } | null> {
  for (const b of await listBackups(dataDir)) {
    if (!b.files[rel]) continue;
    const file = path.join(dataDir, BACKUPS_DIR, b.name, rel);
    try {
      if (isValid(await readFile(file, 'utf8'))) return { backup: b.name, file };
    } catch {
      // try the next backup
    }
  }
  return null;
}
