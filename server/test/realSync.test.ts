/**
 * The complete sync against REAL Meta responses (DeoDap ad account, recorded read-only on
 * 7 Nov 2026 15:40 IST; see fixtures/deodapLive.json), served by a stand-in that behaves like the
 * Graph API on the points that matter: status filters, campaign.id filtering, cursor paging, a rate
 * limit, and the 100/1815001 refusal of DELETED on the campaigns / adsets / ads edges.
 */
import { readFileSync } from 'node:fs';
import { deliveryState, type DashboardResponse } from '@sop/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { findCampaignAudits } from '../src/repositories/auditRepository.js';
import { upsertConnection, upsertDiscoveredAccount } from '../src/repositories/metaRepository.js';
import { encryptSecret } from '../src/security/tokenCrypto.js';
import { startSync } from '../src/services/syncService.js';
import { closeStore, store } from '../src/storage/store.js';
import { installFakeGraph, type GraphRequest } from './fakeGraph.js';
import { createUser, prepareDb, resetDb, signedIn } from './helpers.js';
import { graphWaits } from './setup.js';

interface Row { id: string; effective_status: string; campaign_id?: string; adset_id?: string; start_time?: string; stop_time?: string; end_time?: string }
const live = JSON.parse(readFileSync(new URL('./fixtures/deodapLive.json', import.meta.url), 'utf8')) as {
  recordedAt: string; accountId: string; campaigns: Row[]; adsets: Row[]; ads: Row[]; otherCampaigns: Row[];
};
// Names were left out of the recording; Meta always returns one, so the stand-in adds a placeholder.
const named = (rows: Row[], kind: string) => rows.map((r) => ({ ...r, name: `${kind} ${r.id}` }));
live.campaigns = named(live.campaigns, 'Campaign');
live.otherCampaigns = named(live.otherCampaigns, 'Campaign');
live.adsets = named(live.adsets, 'Ad set');
live.ads = named(live.ads, 'Ad');
const NOW = new Date(live.recordedAt);
const ACT = `act_${live.accountId}`;
const TOKEN = 'DEODAP-STORED-TOKEN-0123456789';

/** Meta-style cursor paging (Meta caps page sizes; 100 here so every list spans several pages). */
function page(r: GraphRequest, rows: unknown[]) {
  const limit = Math.min(Number(r.params.get('limit') ?? 25), 100);
  const after = Number(r.params.get('after') ?? 0);
  const next = after + limit < rows.length ? new URL(r.url) : null;
  next?.searchParams.set('after', String(after + limit));
  return { body: { data: rows.slice(after, after + limit), paging: next ? { cursors: { after: String(after + limit) }, next: next.toString() } : {} } };
}
const statuses = (r: GraphRequest) => JSON.parse(r.params.get('effective_status') ?? '[]') as string[];
function campaignFilter(r: GraphRequest): Set<string> | null {
  const rule = (JSON.parse(r.params.get('filtering') ?? '[]') as { field: string; value: string[] }[]).find((f) => f.field === 'campaign.id');
  return rule ? new Set(rule.value) : null;
}

function realMeta(opts: { rateLimitOnce?: boolean } = {}) {
  let limited = !opts.rateLimitOnce;
  return (r: GraphRequest) => {
    if (r.authorization !== `Bearer ${TOKEN}`) return { status: 400, body: { error: { message: 'Invalid OAuth access token.', code: 190 } } };
    if (r.path === `${ACT}/campaigns`) {
      const wanted = statuses(r);
      return page(r, [...live.campaigns, ...live.otherCampaigns].filter((c) => wanted.includes(c.effective_status)));
    }
    if (r.path === `${ACT}/adsets` || r.path === `${ACT}/ads`) {
      if (r.path === `${ACT}/adsets` && !limited) {
        limited = true;
        return { status: 400, body: { error: { message: 'There have been too many calls to this ad-account. Wait a bit and try again.', code: 80004 } } };
      }
      const wanted = statuses(r);
      const only = campaignFilter(r);
      const rows = (r.path.endsWith('adsets') ? live.adsets : live.ads).filter((x) => wanted.includes(x.effective_status) && (!only || only.has(x.campaign_id!)));
      return page(r, rows);
    }
    if (r.path === `${ACT}/insights`) return { body: { data: [] } };
    return undefined;
  };
}

/** The strict rule worked out directly from the raw Meta rows, independently of the sync. */
function expectedStates() {
  return new Map(
    live.campaigns.map((c) => [
      c.id,
      deliveryState(c, live.adsets.filter((s) => s.campaign_id === c.id), live.ads.filter((a) => a.campaign_id === c.id), NOW),
    ]),
  );
}

const app = createApp();
let fake: ReturnType<typeof installFakeGraph>;
beforeAll(prepareDb);
beforeEach(async () => {
  await resetDb();
  const admin = await createUser('admin');
  const conn = await upsertConnection({ metaUserId: '1', metaUserName: 'DeoDap system user', tokenType: 'system_user', tokenCiphertext: encryptSecret(TOKEN), scopes: ['ads_read'], expiresAt: null, connectedBy: admin.id });
  await upsertDiscoveredAccount({ metaAccountId: live.accountId, name: 'DeoDap', currency: 'INR', timezone: 'Asia/Kolkata', businessName: null, accountStatus: 1, connectionId: conn.id });
  for (const a of store.c.adAccounts.all()) await store.c.adAccounts.update(a.id, { isActive: true });
});
afterEach(() => fake?.uninstall());
afterAll(() => closeStore());

describe('complete sync on real DeoDap Meta responses (7 Nov 2026 15:40 IST)', () => {
  it.each(['manual', 'scheduled'] as const)('%s refresh: never asks for deleted objects, succeeds, and counts strictly', async (trigger) => {
    fake = installFakeGraph(realMeta({ rateLimitOnce: true }));
    const { done } = await startSync({ trigger, now: NOW });
    await done;

    // The request Meta refused in production (100/1815001) is never made.
    const collection = fake.requests.filter((r) => /^act_\d+\/(campaigns|adsets|ads)$/.test(r.path));
    for (const r of collection) expect(r.url).not.toContain('DELETED');
    expect(graphWaits).toEqual([15_000]); // the one rate limit was waited out and retried
    // Few calls: paged lists only, ad sets and ads read for the 70 campaigns in two filtered chunks.
    expect(fake.requests.length).toBeLessThan(30);

    const runs = store.c.auditRuns.all();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'succeeded', error: null, trigger });

    const { agent } = await signedIn(app, 'viewer');
    const dash = (await agent.get('/api/dashboard')).body as DashboardResponse;
    const expected = expectedStates();
    expect(Object.fromEntries(dash.campaigns.map((c) => [c.metaCampaignId, c.delivery]))).toEqual(Object.fromEntries(expected));

    const row = dash.counts.accounts[0]!;
    expect(row).toMatchObject({
      name: 'DeoDap',
      total: 903, // 70 Active + 764 Paused + 69 Archived; deleted campaigns are not current data
      metaActive: 70,
      paused: 764,
      archived: 69,
      other: 0,
      audited: 70,
      active: 35,
      reconciled: true,
    });
    expect(row.excluded).toMatchObject({ HAS_INACTIVE_ADS: 16, HAS_INACTIVE_AD_SETS: 14, NO_ACTIVE_AD_SETS: 3, ENDED: 2, NO_ACTIVE_ADS: 0, SCHEDULED: 0, UNKNOWN: 0 });
    expect(dash.counts.activeKnown).toBe(true);
    expect(dash.summary.totals.active).toBe(35);
    // SOP checks still run for every campaign with status Active.
    expect(dash.campaigns).toHaveLength(70);
    expect(dash.campaigns.every((c) => c.checks.length === 9)).toBe(true);
    // A campaign with paused ad sets (5 of them) is excluded even though the campaign itself is Active.
    expect(expected.get('52547111991953')).toBe('HAS_INACTIVE_AD_SETS');
  });

  it('keeps earlier audits as history; the dashboard counts only the latest', async () => {
    fake = installFakeGraph(realMeta());
    const first = await startSync({ trigger: 'manual', now: NOW });
    await first.done;
    const second = await startSync({ trigger: 'manual', now: new Date(NOW.getTime() + 60_000) });
    await second.done;
    expect(store.c.auditRuns.all().map((r) => r.status)).toEqual(['succeeded', 'succeeded']);
    expect(await findCampaignAudits(first.runId)).toHaveLength(70); // history kept
    const { agent } = await signedIn(app, 'viewer');
    const dash = (await agent.get('/api/dashboard')).body as DashboardResponse;
    expect(dash.run?.id).toBe(second.runId);
    expect(dash.counts.accounts[0]).toMatchObject({ total: 903, audited: 70, active: 35 }); // not doubled
  });
});
