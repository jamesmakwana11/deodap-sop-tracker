import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { EXPORT_DATASETS, type AuthUser, type ExportDatasetId, type ExportFormat, type GeneratedReportInfo } from '@sop/shared';
import { buildExcelReport } from '../reports/excelReport.js';
import { buildPdfReport } from '../reports/pdfReport.js';
import { loadReportData } from '../reports/reportData.js';
import type { GeneratedReportRecord } from '../storage/records.js';
import { store } from '../storage/store.js';
import { writeBinary } from '../storage/jsonFiles.js';
import { istSortable } from './cells.js';
import { parseExportParams, paramsForRecord, type ExportParams } from './context.js';
import { renderCsv } from './csv.js';
import { buildExportDoc } from './datasets.js';
import { renderDocx } from './docx.js';
import { renderPdf } from './pdf.js';
import { renderXlsx } from './xlsx.js';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv; charset=utf-8',
};

export const reportFilePath = (r: Pick<GeneratedReportRecord, 'id' | 'format'>) => store.path('reports', `${r.id}.${r.format}`);
const reportsKeep = () => Number(process.env.REPORTS_KEEP) || 300;

interface Rendered {
  title: string;
  stem: string;
  runId: string | null;
  devData: boolean;
}

/**
 * Builds a report, writes it into data/reports (temp file, then rename) and records it, so
 * the same file can be downloaded again later. Returns the saved record.
 */
export async function generateExport(dataset: ExportDatasetId, format: ExportFormat, query: unknown, user: AuthUser): Promise<GeneratedReportRecord> {
  const p = parseExportParams(query); // invalid parameters fail before waiting for a slot
  await acquireSlot();
  try {
    return await generate(dataset, format, p, user);
  } finally {
    releaseSlot();
  }
}

/** At most EXPORT_CONCURRENCY (default 2) reports are built at once; others wait their turn. */
let active = 0;
const waiting: (() => void)[] = [];
const concurrency = () => Number(process.env.EXPORT_CONCURRENCY) || 2;
function acquireSlot(): Promise<void> {
  if (active < concurrency()) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(() => (active++, resolve())));
}
function releaseSlot(): void {
  active--;
  waiting.shift()?.();
}

async function generate(dataset: ExportDatasetId, format: ExportFormat, p: ExportParams, user: AuthUser): Promise<GeneratedReportRecord> {
  const id = randomBytes(16).toString('hex');
  const final = reportFilePath({ id, format });
  const tmp = `${final}.${process.pid}.tmp`;
  try {
    const r = await render(dataset, format, p, user, tmp);
    await rename(tmp, final);
    const { size } = await stat(final);
    const record: GeneratedReportRecord = {
      id,
      dataset,
      format,
      title: r.title,
      fileName: fileName(r, p, format),
      size,
      sha256: await sha256File(final),
      createdAt: new Date().toISOString(),
      createdBy: user.id,
      scope: p.scope,
      params: paramsForRecord(p),
      runId: r.runId,
      devData: r.devData,
    };
    await store.c.generatedReports.insert(record);
    await pruneReports();
    return record;
  } catch (err) {
    await rm(tmp, { force: true });
    await rm(final, { force: true });
    throw err;
  }
}

async function render(dataset: ExportDatasetId, format: ExportFormat, p: ExportParams, user: AuthUser, file: string): Promise<Rendered> {
  // The dashboard keeps its purpose-built PDF and Excel layouts (KPI tiles, coloured check grid).
  if (dataset === 'dashboard' && (format === 'pdf' || format === 'xlsx')) {
    const query = p.scope === 'all' ? { sort: p.sort } : { ...p.filters, sort: p.sort };
    const data = await loadReportData(p.runId, query, user.name);
    await writeBinary(file, format === 'pdf' ? await buildPdfReport(data) : await buildExcelReport(data));
    const title = EXPORT_DATASETS.dashboard.title + (p.scope === 'all' ? ' — all records' : '');
    return { title, stem: 'dashboard', runId: data.run.id, devData: data.run.source === 'development' };
  }
  const doc = await buildExportDoc(dataset, p, user);
  if (format === 'csv') await writeBinary(file, renderCsv(doc));
  else if (format === 'xlsx') await renderXlsx(doc, file);
  else if (format === 'docx') await renderDocx(doc, file);
  else await renderPdf(doc, file);
  return { title: doc.title, stem: doc.fileStem, runId: doc.runId, devData: doc.devData };
}

function fileName(r: Rendered, p: ExportParams, format: ExportFormat): string {
  const date = istSortable(new Date().toISOString()).slice(0, 10);
  const parts = [`deodap-${r.stem}`, date];
  if (r.runId) parts.push(`audit${r.runId}`);
  if (r.stem === 'campaign' && p.campaignId) parts.push(`c${p.campaignId}`);
  if (p.scope === 'all') parts.push('all');
  if (r.devData) parts.push('DEV-DATA');
  return `${parts.join('-')}.${format}`;
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Keeps the newest REPORTS_KEEP saved reports (default 300); older files are deleted. */
export async function pruneReports(keep = reportsKeep()): Promise<number> {
  const all = [...store.c.generatedReports.all()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const old = all.slice(keep);
  if (!old.length) return 0;
  const ids = new Set(old.map((r) => r.id));
  await store.c.generatedReports.remove((r) => ids.has(r.id));
  await Promise.all(old.map((r) => rm(reportFilePath(r), { force: true })));
  return old.length;
}

/** Admins see every saved report; other users see the ones they generated. */
export function canSeeReport(r: GeneratedReportRecord, user: AuthUser): boolean {
  return user.role === 'admin' || r.createdBy === user.id;
}

export function toReportInfo(r: GeneratedReportRecord): GeneratedReportInfo {
  return {
    id: r.id,
    dataset: r.dataset as ExportDatasetId,
    format: r.format,
    title: r.title,
    fileName: r.fileName,
    size: r.size,
    createdAt: r.createdAt,
    createdBy: r.createdBy ? (store.c.users.get(r.createdBy)?.name ?? 'Removed user') : null,
    scope: r.scope,
    devData: r.devData,
  };
}

export function listReports(user: AuthUser, limit = 50): GeneratedReportInfo[] {
  return store.c.generatedReports
    .filter((r) => canSeeReport(r, user))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map(toReportInfo);
}
