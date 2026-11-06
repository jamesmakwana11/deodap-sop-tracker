import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** server.pid in the data folder marks that a server is using it (restore refuses to run then). */

const file = (dir: string) => path.join(dir, 'server.pid');

export async function claimServerLock(dir: string): Promise<void> {
  if (await serverIsRunning(dir)) {
    throw new Error(`Another server process is already using ${dir}. Run one server per data folder.`);
  }
  await writeFile(file(dir), String(process.pid));
}

export async function releaseServerLock(dir: string): Promise<void> {
  const pid = await readFile(file(dir), 'utf8').catch(() => '');
  if (pid.trim() === String(process.pid)) await rm(file(dir), { force: true });
}

export async function serverIsRunning(dir: string): Promise<boolean> {
  const pid = Number((await readFile(file(dir), 'utf8').catch(() => '')).trim());
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // stale file from a crash
  }
}
