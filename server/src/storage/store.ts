import { randomBytes } from 'node:crypto';
import { constants, readFileSync } from 'node:fs';
import { access, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackup, findRecoverableCopy, listBackups, pruneBackups, type BackupManifest } from './backups.js';
import { fileStamp, IntegrityError, JsonCollection, parseCollectionFile } from './collection.js';
import { flushWrites, readJson, removeFile, writeJson } from './jsonFiles.js';
import type {
  AdAccountRecord,
  AttachmentRecord,
  AuditRunRecord,
  CampaignAuditRecord,
  CampaignIndexRecord,
  GeneratedReportRecord,
  ManualEventRecord,
  ManualVerificationRecord,
  MetaConnectionRecord,
  OAuthStateRecord,
  SessionRecord,
  SettingRecord,
  UserRecord,
} from './records.js';

/**
 * Server-side JSON storage in server/data/ (or DATA_DIR). Layout:
 *   *.json                 one file per collection (users, sessions, settings, audit runs, …)
 *   audits/run-<id>.json   the campaigns of one audit run (written once)
 *   attachments/<id>       manual-check evidence files
 *   reports/<id>.<ext>     exported reports
 *   backups/<name>/        backups with a checksum manifest
 *   secret.key             token encryption key, only when TOKEN_ENCRYPTION_KEY is not set
 * Single server process only.
 */

export const DEFAULT_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const MARKER = 'storage.json';

function makeCollections(dir: string, warn: (m: string) => void) {
  const c = <T extends { id: string }>(name: string) => new JsonCollection<T>(path.join(dir, `${name}.json`), warn);
  return {
    users: c<UserRecord>('users'),
    sessions: c<SessionRecord>('sessions'),
    metaConnections: c<MetaConnectionRecord>('meta-connections'),
    oauthStates: c<OAuthStateRecord>('oauth-states'),
    adAccounts: c<AdAccountRecord>('ad-accounts'),
    settings: c<SettingRecord>('settings'),
    auditRuns: c<AuditRunRecord>('audit-runs'),
    campaignIndex: c<CampaignIndexRecord>('campaign-index'),
    manualChecks: c<ManualVerificationRecord>('manual-checks'),
    manualEvents: c<ManualEventRecord>('manual-check-events'),
    attachments: c<AttachmentRecord>('attachments'),
    generatedReports: c<GeneratedReportRecord>('generated-reports'),
    /** Id sequences for campaign audits, ad sets and ads (rows are unused). */
    campaignIds: c<{ id: string }>('sequence-campaign-audits'),
    adSetIds: c<{ id: string }>('sequence-ad-sets'),
    adIds: c<{ id: string }>('sequence-ads'),
  };
}

type Collections = ReturnType<typeof makeCollections>;

const isRunFile = (text: string) => Array.isArray(JSON.parse(text));

class Store {
  private dir = '';
  private cols: Collections | null = null;
  /** Parsed run files, re-read whenever the file on disk changes. */
  private runCache = new Map<string, { stamp: string; rows: CampaignAuditRecord[] }>();
  /** Problems found since start-up (recoveries, hand edits). Shown to admins. */
  readonly warnings: { at: string; message: string }[] = [];
  createdAt: string | null = null;

  get dataDir(): string {
    return this.dir;
  }

  get c(): Collections {
    if (!this.cols) throw new Error('Storage is not open. Call openStore() at start-up.');
    return this.cols;
  }

  path(...parts: string[]): string {
    return path.join(this.dir, ...parts);
  }

  warn = (message: string): void => {
    console.warn(`[storage] ${message}`);
    this.warnings.push({ at: new Date().toISOString(), message });
    if (this.warnings.length > 50) this.warnings.shift();
  };

  async open(dir: string): Promise<void> {
    for (const sub of ['audits', 'attachments', 'reports']) await mkdir(path.join(dir, sub), { recursive: true });
    this.dir = dir;
    const cols = makeCollections(dir, this.warn);
    for (const col of Object.values(cols)) await this.loadOrRecover(col);
    this.cols = cols;
    this.runCache.clear();
    const marker = await readJson<{ createdAt?: string } | null>(path.join(dir, MARKER), null);
    this.createdAt = marker?.createdAt ?? new Date().toISOString();
    if (!marker) await writeJson(path.join(dir, MARKER), { createdAt: this.createdAt, note: 'DeoDap SOP tracker data folder' });
  }

  /** Loads a collection; a damaged file is restored from the newest backup that has a good copy. */
  private async loadOrRecover(col: JsonCollection<{ id: string }>): Promise<void> {
    try {
      await col.load();
    } catch (err) {
      if (!(err instanceof IntegrityError)) throw err;
      const rel = path.basename(col.file);
      const copy = await findRecoverableCopy(this.dir, rel, (text) => {
        parseCollectionFile(col.file, text, () => {});
        return true;
      });
      if (!copy) {
        throw new Error(
          `${err.message}. No backup has a readable copy, so the server will not start rather than lose data. ` +
            `Restore a backup (npm run data -- restore <name>) or move the damaged file aside to start without it.`,
        );
      }
      await copyFile(col.file, `${col.file}.damaged-${Date.now()}`);
      await copyFile(copy.file, col.file);
      this.warn(`${err.message}. Restored it from backup ${copy.backup}; the damaged file was kept next to it. Changes made after that backup are missing from this file.`);
      await col.load();
    }
  }

  private runFile(runId: string): string {
    return path.join(this.dir, 'audits', `run-${runId}.json`);
  }

  async readRunAudits(runId: string): Promise<CampaignAuditRecord[]> {
    const file = this.runFile(runId);
    const stamp = fileStamp(file);
    const cached = this.runCache.get(runId);
    if (cached && cached.stamp === stamp) return cached.rows;
    let rows: CampaignAuditRecord[];
    try {
      rows = await readJson<CampaignAuditRecord[]>(file, []);
      if (!Array.isArray(rows)) throw new Error('not a list of campaigns');
    } catch (err) {
      const rel = `audits/run-${runId}.json`;
      const copy = await findRecoverableCopy(this.dir, rel, isRunFile);
      if (!copy) throw new Error(`Audit run ${runId} file is damaged and no backup has a readable copy: ${(err as Error).message}`);
      await copyFile(copy.file, file);
      this.warn(`Audit run ${runId} file was damaged and has been restored from backup ${copy.backup}.`);
      rows = JSON.parse(readFileSync(file, 'utf8')) as CampaignAuditRecord[];
    }
    this.runCache.set(runId, { stamp: fileStamp(file), rows });
    return rows;
  }

  async writeRunAudits(runId: string, rows: CampaignAuditRecord[]): Promise<void> {
    await writeJson(this.runFile(runId), rows);
    this.runCache.set(runId, { stamp: fileStamp(this.runFile(runId)), rows });
  }

  async deleteRunAudits(runId: string): Promise<void> {
    this.runCache.delete(runId);
    await removeFile(this.runFile(runId));
  }

  // ── Backups ─────────────────────────────────────────────────────────────

  async backup(reason: string, keep = Number(process.env.BACKUP_KEEP) || 14): Promise<BackupManifest> {
    await flushWrites();
    const manifest = await createBackup(this.dir, reason);
    await pruneBackups(this.dir, keep);
    return manifest;
  }

  listBackups(): Promise<BackupManifest[]> {
    return listBackups(this.dir);
  }

  // ── Encryption key fallback ─────────────────────────────────────────────

  /**
   * The key that encrypts Meta tokens and the App Secret: TOKEN_ENCRYPTION_KEY when set,
   * otherwise a random key generated once into secret.key (owner-only permissions).
   */
  keyFilePath(): string {
    return path.join(this.dir, 'secret.key');
  }

  async ensureKeyFile(): Promise<void> {
    try {
      await access(this.keyFilePath());
    } catch {
      await writeFile(this.keyFilePath(), randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      });
    }
  }

  /** True when the data folder can be written. */
  async healthy(): Promise<boolean> {
    try {
      await access(this.dir, constants.W_OK);
      return Boolean(this.cols);
    } catch {
      return false;
    }
  }

  /** Tests only: delete every data file in the folder and reopen it empty. */
  async wipe(): Promise<void> {
    await flushWrites();
    for (const name of await readdir(this.dir)) await rm(path.join(this.dir, name), { recursive: true, force: true });
    this.warnings.length = 0;
    await this.open(this.dir);
  }
}

export const store = new Store();

export async function openStore(dir = process.env.DATA_DIR || DEFAULT_DATA_DIR): Promise<void> {
  await store.open(path.resolve(dir));
  if (!process.env.TOKEN_ENCRYPTION_KEY) await store.ensureKeyFile();
}

export const closeStore = flushWrites;
