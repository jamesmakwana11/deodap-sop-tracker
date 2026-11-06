/** Campaign detail, history, manual verification and previews — against the FAKE Meta world. */
import type { CampaignDetailResponse, DashboardResponse } from '@sop/shared';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closeStore, store } from '../src/storage/store.js';
import { startSync } from '../src/services/syncService.js';
import { installFakeGraph, type GraphHandler } from './fakeGraph.js';
import { connectFakeMeta, NOW, world } from './fakeMetaWorld.js';
import { CSRF, prepareDb, resetDb, signedIn } from './helpers.js';

const app = createApp();
let fake: ReturnType<typeof installFakeGraph>;
let viewer: TestAgent;
let auditor: TestAgent;

const withPreviews: GraphHandler = (r) => {
  if (r.path === 'a1/previews') {
    expect(r.params.get('ad_format')).toBe('INSTAGRAM_STANDARD');
    return { body: { data: [{ body: '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=AQ&amp;t=AQ" width="540"></iframe>' }] } };
  }
  if (r.path === 'a2/previews') return { body: { data: [{ body: '<iframe src="https://evil.example/x"></iframe>' }] } };
  return world(r);
};

async function sync() {
  const { done } = await startSync({ trigger: 'manual', now: NOW });
  await done;
}

async function campaign(metaId: string, runId?: string) {
  const dash = (await viewer.get(`/api/dashboard${runId ? `?runId=${runId}` : ''}`)).body as DashboardResponse;
  return dash.campaigns.find((c) => c.metaCampaignId === metaId)!;
}

beforeAll(prepareDb);
beforeEach(async () => {
  await resetDb();
  fake = installFakeGraph(withPreviews);
  await connectFakeMeta();
  await sync();
  viewer = (await signedIn(app, 'viewer')).agent;
  auditor = (await signedIn(app, 'auditor')).agent;
});
afterEach(() => fake.uninstall());
afterAll(() => closeStore());

describe('campaign detail', () => {
  it('returns settings, ad sets, ads, manual checks and history', async () => {
    const c1 = await campaign('c1');
    const d = (await viewer.get(`/api/campaign-audits/${c1.id}`)).body as CampaignDetailResponse;
    expect(d.audit.name).toBe('101 | AA | Carousel | Sales | 01.10.2026');
    expect(d.settings).toMatchObject({ buyingType: 'AUCTION', bidStrategy: 'LOWEST_COST_WITHOUT_CAP', dailyBudget: 2000 });
    expect(d.adSets).toHaveLength(1);
    expect(d.adSets[0]!.publisherPlatforms).toEqual(['facebook', 'instagram', 'threads']);
    expect(d.adSets[0]!.excludedLocations).toContain('Tripura');
    expect(d.ads[0]).toMatchObject({ primaryText: 'Shop now', ctaType: 'SHOP_NOW', thumbnailUrl: 'https://scontent.xx.fbcdn.net/thumb.jpg' });
    expect(d.manualChecks).toHaveLength(7);
    expect(d.manualChecks.every((m) => m.status === 'PENDING')).toBe(true); // never auto-passed
    expect(d.history).toHaveLength(1);
  });

  it('builds history across runs and serves older runs on the dashboard', async () => {
    const firstRunId = (await viewer.get('/api/dashboard')).body.run.id;
    await sync();
    const latest = await campaign('c1');
    const d = (await viewer.get(`/api/campaign-audits/${latest.id}`)).body as CampaignDetailResponse;
    expect(d.history.map((h) => h.sopStatus)).toEqual(['FOLLOWING', 'FOLLOWING']);

    const old = (await viewer.get(`/api/dashboard?runId=${firstRunId}`)).body as DashboardResponse;
    expect(old.run?.id).toBe(firstRunId);
    expect((await viewer.get('/api/dashboard?runId=999999')).status).toBe(404);

    const runs = (await viewer.get('/api/runs')).body.runs;
    expect(runs).toHaveLength(2);
    expect(runs[0].totals).toMatchObject({ campaigns: 4, following: 2 });
  });
});

describe('manual verification', () => {
  it('only a person with the auditor role can set it, and a failure needs a note', async () => {
    const put = (agent: TestAgent, key: string, body: object) => agent.put(`/api/manual-checks/c1/${key}`).set(CSRF).send(body);
    expect((await put(viewer, 'stock', { status: 'VERIFIED' })).status).toBe(403);
    expect((await put(auditor, 'stock', { status: 'FAILED' })).status).toBe(400);
    expect((await put(auditor, 'unknown', { status: 'VERIFIED' })).status).toBe(400);

    expect((await put(auditor, 'stock', { status: 'FAILED', note: 'SKU 3038 out of stock' })).status).toBe(200);
    const res = await put(auditor, 'creative_approval', { status: 'VERIFIED' });
    const items = res.body.manualChecks as { key: string; status: string; updatedBy: string | null }[];
    expect(items.find((i) => i.key === 'creative_approval')).toMatchObject({ status: 'VERIFIED' });
    expect(items.find((i) => i.key === 'creative_approval')!.updatedBy).toMatch(/auditor/);
    expect(res.body.manualEvents).toHaveLength(2);

    const c1 = await campaign('c1');
    expect(c1.manual).toEqual({ verified: 1, failed: 1, notApplicable: 0, pending: 5 });
    expect(c1.whatIsOff).toContain('Manual check failed: Stock verification (SKU 3038 out of stock)');
    // Manual results are reported separately; the automated SOP % is unchanged.
    expect(c1.compliance).toMatchObject({ percent: 100, status: 'FOLLOWING' });
  });

  it('resetting to Pending removes the verification but keeps the trail', async () => {
    await auditor.put('/api/manual-checks/c1/sku').set(CSRF).send({ status: 'VERIFIED' });
    const res = await auditor.put('/api/manual-checks/c1/sku').set(CSRF).send({ status: 'PENDING' });
    expect(res.body.manualChecks.find((i: { key: string }) => i.key === 'sku').status).toBe('PENDING');
    expect(res.body.manualEvents.map((e: { status: string }) => e.status)).toEqual(['PENDING', 'VERIFIED']);
  });
});

describe('creative previews', () => {
  it('returns Meta’s preview iframe URL and rejects any other host', async () => {
    const d1 = (await viewer.get(`/api/campaign-audits/${(await campaign('c1')).id}`)).body as CampaignDetailResponse;
    const ok = await viewer.get(`/api/ads/${d1.ads[0]!.id}/preview?format=INSTAGRAM_STANDARD`);
    expect(ok.body.src).toBe('https://www.facebook.com/ads/api/preview_iframe.php?d=AQ&t=AQ');

    const d2 = (await viewer.get(`/api/campaign-audits/${(await campaign('c2')).id}`)).body as CampaignDetailResponse;
    const bad = await viewer.get(`/api/ads/${d2.ads[0]!.id}/preview`);
    expect(bad.status).toBe(400);

    expect((await viewer.get(`/api/ads/${d1.ads[0]!.id}/preview?format=EVIL`)).status).toBe(400);
  });
});
