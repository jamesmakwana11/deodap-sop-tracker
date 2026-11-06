import type { DashboardResponse } from '@sop/shared';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closeStore, store } from '../src/storage/store.js';
import { seedDevData } from '../src/dev/seedDevData.js';
import { clearDevData } from '../src/dev/clearDevData.js';
import {
  createRun,
  finishRun,
  insertCampaignAudit,
  recordRunAccount,
  upsertAdAccount,
} from '../src/repositories/auditWriter.js';
import { prepareDb, resetDb, signedIn } from './helpers.js';

const app = createApp();
let viewer: TestAgent;

beforeAll(prepareDb);
beforeEach(async () => {
  await resetDb();
  viewer = (await signedIn(app, 'viewer')).agent;
});
afterAll(() => closeStore());

describe('GET /api/health', () => {
  it('reports the database as up', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', storage: 'up' });
  });
});

describe('GET /api/dashboard', () => {
  it('returns an empty dashboard, not invented data, when nothing has synced', async () => {
    const res = await viewer.get('/api/dashboard');
    expect(res.status).toBe(200);
    const body = res.body as DashboardResponse;
    expect(body.run).toBeNull();
    expect(body.campaigns).toEqual([]);
    expect(body.summary.totals.active).toBe(0);
  });

  it('serves development data labelled as development', async () => {
    await seedDevData();
    const body = (await viewer.get('/api/dashboard')).body as DashboardResponse;

    expect(body.run?.source).toBe('development');
    expect(body.campaigns).toHaveLength(10);
    expect(body.campaigns.every((c) => c.name.startsWith('[DEV]'))).toBe(true);
    expect(body.run?.accounts.map((a) => a.name)).toEqual(['DEV Sample Account A', 'DEV Sample Account B']);

    const t = body.summary.totals;
    expect(t.good + t.average + t.bad + t.notRated).toBe(10);
    expect(t.following + t.partlyFollowing + t.notFollowing + t.needsReview).toBe(10);
    expect(t.needsReview).toBe(1);
    const spends = body.campaigns.map((c) => c.spend7d);
    expect(spends).toEqual([...spends].sort((a, b) => b - a));
  });

  it('always prefers a real Meta run over newer development data', async () => {
    {
      const runId = await createRun({ source: 'meta', trigger: 'manual', periodStart: '2026-10-30', periodEnd: '2026-11-05' });
      const accountId = await upsertAdAccount({ metaAccountId: '111', name: 'Real account' });
      await recordRunAccount(runId, accountId, 'succeeded');
      await insertCampaignAudit(runId, accountId, {
        metaCampaignId: '999', name: 'Real campaign', objectiveRaw: 'OUTCOME_SALES', objective: 'Sales',
        effectiveStatus: 'ACTIVE', currency: 'INR', spend7d: 100, mainMetric: null, rating: 'NOT_RATED',
        ratingIndicative: false, checks: [],
      });
      await finishRun(runId, 'succeeded');
    }
    await seedDevData();

    const body = (await viewer.get('/api/dashboard')).body as DashboardResponse;
    expect(body.run?.source).toBe('meta');
    expect(body.campaigns.map((c) => c.name)).toEqual(['Real campaign']);

    await clearDevData();
    expect(store.c.campaignIndex.all()).toHaveLength(1);
  });

  it('ignores runs that are still running or failed', async () => {
    await createRun({ source: 'meta', trigger: 'manual', periodStart: '2026-10-30', periodEnd: '2026-11-05' });
    const body = (await viewer.get('/api/dashboard')).body as DashboardResponse;
    expect(body.run).toBeNull();
  });
});

describe('unknown routes', () => {
  it('return 404 JSON', async () => {
    const res = await viewer.get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
