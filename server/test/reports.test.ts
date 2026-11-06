/** PDF and Excel reports, built from a sync against the FAKE Meta world. */
import ExcelJS from 'exceljs';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closeStore, store } from '../src/storage/store.js';
import { seedDevData } from '../src/dev/seedDevData.js';
import { startSync } from '../src/services/syncService.js';
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

async function workbook(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

beforeAll(prepareDb);
beforeEach(async () => {
  await resetDb();
  fake = installFakeGraph(world);
  await connectFakeMeta();
  const { done } = await startSync({ trigger: 'manual', now: NOW });
  await done;
  viewer = (await signedIn(app, 'viewer')).agent;
});
afterEach(() => fake.uninstall());
afterAll(() => closeStore());

describe('Excel report', () => {
  it('has summary, campaigns, findings and manual-check sheets', async () => {
    const auditor = (await signedIn(app, 'auditor')).agent;
    await auditor.put('/api/manual-checks/c1/coupon').set(CSRF).send({ status: 'FAILED', note: 'Code DIWALI10 expired' });

    const res = await binary(viewer, '/api/reports/latest.xlsx');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="deodap-sop-audit-2026-\d\d-\d\d-run\d+\.xlsx"/);
    const wb = await workbook(res.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Campaigns', 'Findings', 'Manual checks']);

    const campaigns = wb.getWorksheet('Campaigns')!;
    expect(campaigns.rowCount).toBe(5); // header + 4
    expect(campaigns.getRow(2).getCell(2).value).toBe('101 | AA | Carousel | Sales | 01.10.2026'); // highest spend first
    expect(campaigns.getRow(2).getCell(1).value).toBe('Good');

    const findings = wb.getWorksheet('Findings')!;
    const texts = findings.getSheetValues().flat().filter((v) => typeof v === 'string') as string[];
    expect(texts).toContain('Manual: Coupon accuracy');
    expect(texts).toContain('Code DIWALI10 expired');
    expect(texts.some((t) => t.includes('Messenger on'))).toBe(true);
  });

  it('applies the tracker filters and sort', async () => {
    const res = await binary(viewer, '/api/reports/latest.xlsx?rating=GOOD&sort=compliance_low');
    const wb = await workbook(res.body as Buffer);
    expect(wb.getWorksheet('Campaigns')!.rowCount).toBe(2);
    const summary = wb.getWorksheet('Summary')!.getSheetValues().flat();
    expect(summary).toContain('Filtered to rating good (1 of 4 campaigns)');
  });

  it('rejects unknown filter values and missing runs', async () => {
    expect((await viewer.get('/api/reports/latest.xlsx?rating=SUPER')).status).toBe(400);
    expect((await viewer.get('/api/reports/99999.pdf')).status).toBe(404);
  });

  it('labels development data in the file name and the sheet', async () => {
    await resetDb();
    await seedDevData();
    viewer = (await signedIn(app, 'viewer')).agent;
    const res = await binary(viewer, '/api/reports/latest.xlsx');
    expect(res.headers['content-disposition']).toContain('-DEV-DATA.xlsx');
    const wb = await workbook(res.body as Buffer);
    expect(String(wb.getWorksheet('Summary')!.getRow(2).getCell(1).value)).toMatch(/^DEVELOPMENT DATA — NOT REAL META RESULTS/);
  });
});

describe('PDF report', () => {
  it('produces a multi-page PDF', async () => {
    const res = await binary(viewer, '/api/reports/latest.pdf?objective=Sales');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const buf = res.body as Buffer;
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('requires sign-in', async () => {
    const { default: request } = await import('supertest');
    expect((await request(app).get('/api/reports/latest.pdf')).status).toBe(401);
  });
});
