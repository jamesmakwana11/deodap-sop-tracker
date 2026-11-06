/** Exports of every report area in PDF, Excel, Word and CSV, built from syncs against the FAKE Meta world. */
import { EXPORT_DATASETS, EXPORT_FORMATS, type ExportDatasetId } from '@sop/shared';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seedDevData } from '../src/dev/seedDevData.js';
import { pruneReports } from '../src/exports/exportService.js';
import { startSync } from '../src/services/syncService.js';
import { closeStore, store } from '../src/storage/store.js';
import { installFakeGraph } from './fakeGraph.js';
import { connectFakeMeta, NOW, world } from './fakeMetaWorld.js';
import { CSRF, prepareDb, resetDb, signedIn } from './helpers.js';

const app = createApp();
let fake: ReturnType<typeof installFakeGraph>;
let viewer: TestAgent;

const binary = (agent: TestAgent, url: string) =>
  agent.get(url).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

/** All readable text of a file: CSV as is, Excel and Word from their XML parts. */
async function textOf(format: string, buf: Buffer): Promise<string> {
  if (format === 'csv') return buf.toString('utf8');
  if (format === 'pdf') return buf.toString('latin1');
  const zip = await JSZip.loadAsync(buf);
  const parts = await Promise.all(Object.values(zip.files).filter((f) => f.name.endsWith('.xml')).map((f) => f.async('string')));
  return parts.join('\n');
}

const csvRows = (buf: Buffer) => buf.toString('utf8').replace(/^﻿/, '').trimEnd().split('\r\n');

async function sync(at = NOW) {
  const { done } = await startSync({ trigger: 'manual', now: at });
  await done;
}

beforeAll(prepareDb);
beforeEach(async () => {
  await resetDb();
  fake = installFakeGraph(world);
  await connectFakeMeta();
  await sync();
  viewer = (await signedIn(app, 'viewer')).agent;
});
afterEach(() => fake.uninstall());
afterAll(() => closeStore());

describe('export catalogue', () => {
  it('lists every report area and format, and needs a signed-in user', async () => {
    const res = await viewer.get('/api/exports');
    expect(res.status).toBe(200);
    expect(res.body.formats).toEqual(['pdf', 'xlsx', 'docx', 'csv']);
    expect(res.body.datasets).toHaveLength(13);
    expect((await request(app).get('/api/exports/tracker.csv')).status).toBe(401);
  });
});

describe('every report in every format', () => {
  it('downloads 13 reports × 4 formats with real data and no credentials', async () => {
    await sync(new Date(NOW.getTime() + 86_400_000)); // a second audit, so the comparison has two
    const auditor = (await signedIn(app, 'auditor')).agent;
    await auditor.put('/api/manual-checks/c1/coupon').set(CSRF).send({ status: 'FAILED', note: 'Code DIWALI10 expired' });
    await auditor
      .post('/api/manual-checks/c1/coupon/attachments')
      .set(CSRF)
      .set('Content-Type', 'image/png')
      .set('X-File-Name', 'coupon-proof.png')
      .send(Buffer.from('png-bytes'));
    const dash = await viewer.get('/api/dashboard');
    const c1 = dash.body.campaigns.find((c: { metaCampaignId: string }) => c.metaCampaignId === 'c1');

    const magic: Record<string, (b: Buffer) => boolean> = {
      pdf: (b) => b.subarray(0, 5).toString() === '%PDF-',
      xlsx: (b) => b.subarray(0, 2).toString() === 'PK',
      docx: (b) => b.subarray(0, 2).toString() === 'PK',
      csv: (b) => b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf,
    };
    const types: Record<string, RegExp> = {
      pdf: /application\/pdf/,
      xlsx: /spreadsheetml/,
      docx: /wordprocessingml/,
      csv: /text\/csv/,
    };

    for (const dataset of Object.keys(EXPORT_DATASETS) as ExportDatasetId[]) {
      for (const format of EXPORT_FORMATS) {
        const q = dataset === 'campaign' ? `?campaignId=${c1.id}` : '';
        const res = await binary(viewer, `/api/exports/${dataset}.${format}${q}`);
        expect(res.status, `${dataset}.${format}: ${res.status} ${(res.body as Buffer).toString().slice(0, 200)}`).toBe(200);
        const buf = res.body as Buffer;
        expect(res.headers['content-type']).toMatch(types[format]!);
        expect(res.headers['content-disposition']).toMatch(new RegExp(`attachment; filename="deodap-[a-z-]+-\\d{4}-\\d\\d-\\d\\d.*\\.${format}"`));
        expect(res.headers['x-report-id']).toMatch(/^[0-9a-f]{32}$/);
        expect(magic[format]!(buf), `${dataset}.${format} file type`).toBe(true);
        expect(buf.length, `${dataset}.${format} size`).toBeGreaterThan(format === "csv" ? 60 : 1000);
        if (format === "csv") expect(csvRows(buf).length, `${dataset}.csv rows`).toBeGreaterThan(1);

        const text = await textOf(format, buf);
        for (const secret of ['FAKE-TOKEN', 'test-app-secret', 'scrypt', 'tokenCiphertext', 'passwordHash']) {
          expect(text.includes(secret), `${dataset}.${format} must not contain ${secret}`).toBe(false);
        }
        if (format !== 'pdf' && dataset !== 'history') {
          // Real campaign names from the (fake) Meta sync appear in the report.
          const summaryCsv = format === 'csv' && (dataset === 'accounts' || dataset === 'objectives');
          const expected = dataset === 'campaign' ? c1.name : summaryCsv ? (dataset === 'accounts' ? 'Account 1001' : 'Sales') : 'Carousel';
          expect(text, `${dataset}.${format}`).toContain(expected);
        }
      }
    }
    expect(store.c.generatedReports.all()).toHaveLength(13 * 4);
  });

  it('puts manual checks, evidence names and failed checks in the reports', async () => {
    const auditor = (await signedIn(app, 'auditor')).agent;
    await auditor.put('/api/manual-checks/c1/coupon').set(CSRF).send({ status: 'FAILED', note: 'Code DIWALI10 expired' });
    await auditor
      .post('/api/manual-checks/c1/coupon/attachments')
      .set(CSRF)
      .set('Content-Type', 'image/png')
      .set('X-File-Name', 'coupon-proof.png')
      .send(Buffer.from('png-bytes'));

    const manual = (await binary(viewer, '/api/exports/manual.csv')).body as Buffer;
    const line = csvRows(manual).find((l) => l.includes('Coupon accuracy') && l.includes('DIWALI10'));
    expect(line).toMatch(/Failed/);
    expect(line).toContain('coupon-proof.png');
    // Nothing else was marked: every other manual item is Pending, never passed automatically.
    expect(csvRows(manual).filter((l) => l.includes(',Verified,'))).toHaveLength(0);

    const failed = csvRows((await binary(viewer, '/api/exports/failed.csv')).body as Buffer);
    expect(failed[0]).toContain('Check type');
    expect(failed.some((l) => l.includes(',Manual,Coupon accuracy,'))).toBe(true);
    expect(failed.some((l) => l.includes(',Automated,'))).toBe(true);
  });
});

describe('filters and scope', () => {
  it('exports the selected filters, or every record with scope=all', async () => {
    const all = csvRows((await binary(viewer, '/api/exports/tracker.csv?scope=all')).body as Buffer);
    const good = csvRows((await binary(viewer, '/api/exports/tracker.csv?rating=GOOD')).body as Buffer);
    const ignored = csvRows((await binary(viewer, '/api/exports/tracker.csv?rating=GOOD&scope=all')).body as Buffer);
    expect(all.length - 1).toBe(4);
    expect(good.length - 1).toBeGreaterThan(0);
    expect(good.length).toBeLessThan(all.length);
    expect(good.slice(1).every((l) => l.includes(',Good'))).toBe(true);
    expect(ignored).toEqual(all);
  });

  it('builds Word and Excel reports with the filters described and a sheet per table', async () => {
    const res = await binary(viewer, '/api/exports/rules.xlsx?objective=Sales');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['About', 'SOP rule set', 'Rating rules', 'Results per SOP rule', 'Compliance per campaign']);
    const about = wb.getWorksheet('About')!.getColumn(1).values.filter(Boolean).join('\n');
    expect(about).toMatch(/Filtered to objective Sales/);
    expect(wb.getWorksheet('Compliance per campaign')!.getRow(1).getCell(1).value).toBe('Ad account');

    const docx = await textOf('docx', (await binary(viewer, '/api/exports/accounts.docx?scope=all')).body as Buffer);
    expect(docx).toContain('Account-wise report — all records');
    expect(docx).toContain('filters not applied');
  });

  it('limits audit history to the date range', async () => {
    const inRange = csvRows((await binary(viewer, `/api/exports/history.csv?from=${NOW.toISOString().slice(0, 10)}`)).body as Buffer);
    const future = csvRows((await binary(viewer, '/api/exports/history.csv?from=2030-01-01')).body as Buffer);
    expect(inRange.length - 1).toBe(1);
    expect(future.length - 1).toBe(0);
    expect((await viewer.get('/api/exports/history.csv?from=2026-12-01&to=2026-11-01')).status).toBe(400);
  });

  it('compares the two latest audits and explains when there is only one', async () => {
    expect((await viewer.get('/api/exports/comparison.csv')).status).toBe(404);
    await sync(new Date(NOW.getTime() + 86_400_000));
    const rows = csvRows((await binary(viewer, '/api/exports/comparison.csv')).body as Buffer);
    expect(rows[0]).toContain('Rating before');
    expect(rows.length - 1).toBe(4);
  });

  it('rejects unknown reports, formats and bad parameters', async () => {
    expect((await viewer.get('/api/exports/secrets.csv')).status).toBe(404);
    expect((await viewer.get('/api/exports/tracker.exe')).status).toBe(400);
    expect((await viewer.get('/api/exports/campaign.pdf')).status).toBe(400);
    expect((await viewer.get('/api/exports/tracker.csv?rating=AMAZING')).status).toBe(400);
    expect((await viewer.get('/api/exports/tracker.csv?runId=../../etc')).status).toBe(400);
  });
});

describe('saved reports', () => {
  it('keeps each generated file on the server for the person who made it (and admins)', async () => {
    const first = await binary(viewer, '/api/exports/performance.xlsx');
    const id = first.headers['x-report-id'];
    const again = await binary(viewer, `/api/exports/files/${id}`);
    expect(again.status).toBe(200);
    expect(Buffer.compare(again.body as Buffer, first.body as Buffer)).toBe(0);
    expect(again.headers['content-disposition']).toBe(first.headers['content-disposition']);

    const list = await viewer.get('/api/exports/history');
    expect(list.body.reports[0]).toMatchObject({ id, dataset: 'performance', format: 'xlsx', scope: 'filtered', devData: false });

    const other = (await signedIn(app, 'viewer')).agent;
    expect((await other.get(`/api/exports/files/${id}`)).status).toBe(404);
    expect((await other.get('/api/exports/history')).body.reports).toHaveLength(0);
    const admin = (await signedIn(app, 'admin')).agent;
    expect((await binary(admin, `/api/exports/files/${id}`)).status).toBe(200);
    expect((await viewer.get('/api/exports/files/not-an-id')).status).toBe(404);
  });

  it('prunes the oldest saved reports', async () => {
    for (let i = 0; i < 3; i++) await binary(viewer, '/api/exports/tracker.csv');
    expect(await pruneReports(1)).toBe(2);
    expect(store.c.generatedReports.all()).toHaveLength(1);
  });
});

describe('development data', () => {
  it('labels development data in the file name, the report and every CSV row', async () => {
    await resetDb();
    await seedDevData();
    const agent = (await signedIn(app, 'viewer')).agent;
    const res = await binary(agent, '/api/exports/tracker.csv');
    expect(res.headers['content-disposition']).toMatch(/-DEV-DATA\.csv"/);
    const rows = csvRows(res.body as Buffer);
    expect(rows[0]!.startsWith('Data,')).toBe(true);
    expect(rows.slice(1).every((l) => l.startsWith('DEVELOPMENT DATA,'))).toBe(true);
    const docx = await textOf('docx', (await binary(agent, '/api/exports/tracker.docx')).body as Buffer);
    expect(docx).toContain('DEVELOPMENT DATA');
  });
});
