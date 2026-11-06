import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Durable JSON files: every write goes to a temp file that is then renamed over the
 * target, so a crash mid-write never leaves a half-written file. Writes to the same file
 * are queued in order.
 */

const queues = new Map<string, Promise<void>>();

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${file}: ${(err as Error).message}`);
  }
}

export function writeJson(file: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value);
  const previous = queues.get(file) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, body, 'utf8');
      await rename(tmp, file);
    });
  queues.set(file, next);
  return next;
}

/** Atomic write of binary data (temp file + rename). */
export async function writeBinary(file: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

export function removeFile(file: string): Promise<void> {
  const previous = queues.get(file) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => rm(file, { force: true }));
  queues.set(file, next);
  return next;
}

/** Resolves once every queued write has reached the disk. */
export async function flushWrites(): Promise<void> {
  await Promise.allSettled([...queues.values()]);
}
