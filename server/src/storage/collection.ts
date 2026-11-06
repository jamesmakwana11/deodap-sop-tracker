import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { writeJson } from './jsonFiles.js';

/**
 * The storage interface the repositories use. JsonCollection implements it on a JSON file;
 * a PostgreSQL implementation (one table per collection) can be added behind the same API.
 */
export interface Collection<T extends { id: string }> {
  all(): readonly T[];
  get(id: string): T | undefined;
  find(pred: (r: T) => boolean): T | undefined;
  filter(pred: (r: T) => boolean): T[];
  /** Assigns the next numeric id unless the record brings its own. */
  insert(row: Omit<T, 'id'> & { id?: string }): Promise<T>;
  /** Inserts or replaces by id. */
  put(row: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T | undefined>;
  remove(pred: (r: T) => boolean): Promise<number>;
  insertMany(rows: (Omit<T, 'id'> & { id?: string })[]): Promise<T[]>;
  reserveIds(count: number): Promise<string[]>;
}

export const COLLECTION_FORMAT = 'sop-tracker-collection';

interface FileShape<T> {
  format?: string;
  version?: number;
  savedAt?: string;
  checksum?: string;
  nextId: number;
  rows: T[];
}

/** A collection file that cannot be read or does not have the expected structure. */
export class IntegrityError extends Error {
  constructor(
    readonly file: string,
    reason: string,
  ) {
    super(`${path.basename(file)} is damaged: ${reason}`);
    this.name = 'IntegrityError';
  }
}

export const checksumOf = (rows: unknown) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');

/** Identifies one version of a file on disk (a rename gives a new inode). */
export function fileStamp(file: string): string {
  try {
    const s = statSync(file);
    return `${s.ino}:${s.size}:${s.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

/**
 * Parses and checks a collection file. Throws IntegrityError for unreadable or malformed data.
 * A checksum mismatch on otherwise valid data means someone edited the file by hand: it is
 * accepted and reported through `warn`.
 */
export function parseCollectionFile<T extends { id: string }>(file: string, text: string, warn: (msg: string) => void): FileShape<T> {
  let data: FileShape<T>;
  try {
    data = JSON.parse(text) as FileShape<T>;
  } catch (err) {
    throw new IntegrityError(file, `not valid JSON (${(err as Error).message})`);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.rows)) throw new IntegrityError(file, 'no "rows" list');
  const ids = new Set<string>();
  let maxNumeric = 0;
  for (const r of data.rows) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string') throw new IntegrityError(file, 'a row has no id');
    if (ids.has(r.id)) throw new IntegrityError(file, `duplicate id ${r.id}`);
    ids.add(r.id);
    if (/^\d+$/.test(r.id)) maxNumeric = Math.max(maxNumeric, Number(r.id));
  }
  // Never hand out an id that already exists, even after a hand edit.
  data.nextId = Math.max(Number.isInteger(data.nextId) ? data.nextId : 1, maxNumeric + 1);
  if (data.checksum && data.checksum !== checksumOf(data.rows)) {
    warn(`${path.basename(file)} was changed outside the app; its contents were checked and accepted.`);
  }
  return data;
}

/**
 * One collection = one JSON file, and the file is the source of truth: before every read or
 * write the collection checks whether the file changed (for example a command-line tool
 * wrote to it while the server runs) and reloads it. Every change is written to disk, with a
 * checksum, before the call resolves.
 */
export class JsonCollection<T extends { id: string }> implements Collection<T> {
  private rows: T[] = [];
  private nextId = 1;
  private stamp = '';
  /** Own writes still in flight; the file on disk may lag the rows until they land. */
  private pending = 0;

  constructor(
    readonly file: string,
    private readonly warn: (msg: string) => void = (m) => console.warn(m),
  ) {}

  /** Reads the file; throws IntegrityError so the store can recover it from a backup. */
  async load(): Promise<void> {
    this.stamp = '';
    this.read(true);
  }

  private read(strict: boolean): void {
    const stamp = fileStamp(this.file);
    if (stamp === this.stamp) return;
    if (stamp === 'missing') {
      this.rows = [];
      this.nextId = 1;
      this.stamp = stamp;
      return;
    }
    try {
      const data = parseCollectionFile<T>(this.file, readFileSync(this.file, 'utf8'), this.warn);
      this.rows = data.rows;
      this.nextId = data.nextId;
    } catch (err) {
      if (strict) throw err;
      // Damaged while running: keep the last good rows; the next save writes them back.
      this.warn(`${(err as Error).message}. Kept the last good copy in memory; it is written back on the next change.`);
    }
    this.stamp = stamp;
  }

  /** Reloads from disk if the file is not the version this collection last read or wrote. */
  private refresh(): void {
    if (this.pending === 0) this.read(false);
  }

  private async save(): Promise<void> {
    this.pending++;
    try {
      await writeJson(this.file, {
        format: COLLECTION_FORMAT,
        version: 2,
        savedAt: new Date().toISOString(),
        checksum: checksumOf(this.rows),
        nextId: this.nextId,
        rows: this.rows,
      });
    } finally {
      this.pending--;
      if (this.pending === 0) this.stamp = fileStamp(this.file);
    }
  }

  all(): readonly T[] {
    this.refresh();
    return this.rows;
  }

  get(id: string): T | undefined {
    return this.all().find((r) => r.id === id);
  }

  find(pred: (r: T) => boolean): T | undefined {
    return this.all().find(pred);
  }

  filter(pred: (r: T) => boolean): T[] {
    return this.all().filter(pred);
  }

  async insert(row: Omit<T, 'id'> & { id?: string }): Promise<T> {
    this.refresh();
    const id = row.id ?? String(this.nextId++);
    const record = { ...row, id } as T;
    this.rows.push(record);
    await this.save();
    return record;
  }

  async put(row: T): Promise<T> {
    this.refresh();
    const i = this.rows.findIndex((r) => r.id === row.id);
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
    await this.save();
    return row;
  }

  async update(id: string, patch: Partial<T>): Promise<T | undefined> {
    this.refresh();
    const i = this.rows.findIndex((r) => r.id === id);
    if (i < 0) return undefined;
    this.rows[i] = { ...this.rows[i]!, ...patch, id };
    await this.save();
    return this.rows[i];
  }

  async remove(pred: (r: T) => boolean): Promise<number> {
    this.refresh();
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !pred(r));
    const removed = before - this.rows.length;
    if (removed) await this.save();
    return removed;
  }

  /** Inserts several rows with one write. */
  async insertMany(rows: (Omit<T, 'id'> & { id?: string })[]): Promise<T[]> {
    this.refresh();
    const records = rows.map((row) => ({ ...row, id: row.id ?? String(this.nextId++) }) as T);
    this.rows.push(...records);
    if (records.length) await this.save();
    return records;
  }

  /** Reserves `count` ids from this collection's sequence with one write. */
  async reserveIds(count: number): Promise<string[]> {
    this.refresh();
    const ids = Array.from({ length: count }, () => String(this.nextId++));
    if (count) await this.save();
    return ids;
  }
}
