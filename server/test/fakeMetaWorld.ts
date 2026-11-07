/**
 * A FAKE Meta world for tests only: two ad accounts, one healthy and one without permission.
 * Nothing here is ever shown as a real result; it exists inside the test database.
 */
import { expect } from 'vitest';
import { store } from '../src/storage/store.js';
import { upsertConnection, upsertDiscoveredAccount } from '../src/repositories/metaRepository.js';
import { encryptSecret } from '../src/security/tokenCrypto.js';
import { graphError, type GraphHandler } from './fakeGraph.js';
import { createUser } from './helpers.js';

export const NOW = new Date('2026-11-06T03:00:00Z'); // 08:30 IST

const sisters = ['Arunachal Pradesh', 'Assam', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Tripura'].map((name) => ({ name }));
const goodTargeting = {
  publisher_platforms: ['facebook', 'instagram', 'threads'],
  geo_locations: { countries: ['IN'] },
  excluded_geo_locations: { regions: sisters },
};

/** Every campaign of FAKE account 1001 in every status: 4 ACTIVE (audited), 2 PAUSED, 1 ARCHIVED, 1 DELETED, 1 WITH_ISSUES. */
export const ALL_CAMPAIGNS_1001 = [
  { id: 'c1', account_id: '1001', name: '101 | AA | Carousel | Sales | 01.10.2026', status: 'ACTIVE', configured_status: 'ACTIVE', effective_status: 'ACTIVE' },
  { id: 'c2', account_id: '1001', name: 'Awareness push', status: 'ACTIVE', configured_status: 'ACTIVE', effective_status: 'ACTIVE' },
  { id: 'c3', account_id: '1001', name: 'Leads | Static | 01.09.2026', status: 'ACTIVE', configured_status: 'ACTIVE', effective_status: 'ACTIVE' },
  { id: 'c4', account_id: '1001', name: '104 | Video | Sales | 02.11.2026', status: 'ACTIVE', configured_status: 'ACTIVE', effective_status: 'ACTIVE' },
  { id: 'p1', account_id: '1001', name: 'Paused one', status: 'PAUSED', configured_status: 'PAUSED', effective_status: 'PAUSED' },
  { id: 'p2', account_id: '1001', name: 'Paused two', status: 'PAUSED', configured_status: 'PAUSED', effective_status: 'PAUSED' },
  { id: 'a1', account_id: '1001', name: 'Old archived', status: 'ARCHIVED', configured_status: 'ARCHIVED', effective_status: 'ARCHIVED' },
  { id: 'd1', account_id: '1001', name: 'Deleted one', status: 'DELETED', configured_status: 'DELETED', effective_status: 'DELETED' },
  { id: 'w1', account_id: '1001', name: 'Has issues', status: 'ACTIVE', configured_status: 'ACTIVE', effective_status: 'WITH_ISSUES' },
];

export const world: GraphHandler = (r) => {
  if (r.path === 'act_1002/campaigns') return graphError(200, 'Permissions error: ads_read not granted for this account', 403);
  if (r.path === 'act_1001/campaigns' && (r.params.get('fields') ?? '').includes('configured_status')) {
    // Status listing for the counts: Meta filters by the statuses asked for and pages the result.
    const wanted: string[] = JSON.parse(r.params.get('effective_status')!);
    const rows = ALL_CAMPAIGNS_1001.filter((c) => wanted.includes(c.effective_status));
    const after = Number(r.params.get('after') ?? 0);
    const page = after === 0 ? rows.slice(0, 5) : rows.slice(4); // second page repeats one row, as Meta's cursors can
    const next = after === 0 ? new URL(r.url) : null;
    next?.searchParams.set('after', '5');
    return { body: { data: page, paging: next ? { next: next.toString() } : {} } };
  }
  if (r.path === 'act_1001/campaigns') {
    expect(JSON.parse(r.params.get('effective_status')!)).toEqual(['ACTIVE']);
    return {
      body: {
        data: [
          { id: 'c1', name: '101 | AA | Carousel | Sales | 01.10.2026', objective: 'OUTCOME_SALES', buying_type: 'AUCTION',
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP', daily_budget: '200000', effective_status: 'ACTIVE', start_time: '2026-10-01T10:00:00+0530' },
          { id: 'c2', name: 'Awareness push', objective: 'OUTCOME_AWARENESS', buying_type: 'AUCTION', bid_strategy: 'COST_CAP',
            daily_budget: '50000', effective_status: 'ACTIVE', start_time: '2026-10-15T10:00:00+0530' },
          { id: 'c3', name: 'Leads | Static | 01.09.2026', objective: 'OUTCOME_LEADS', buying_type: 'AUCTION', bid_strategy: 'COST_CAP',
            daily_budget: '100000', effective_status: 'ACTIVE', start_time: '2026-09-01T10:00:00+0530' },
          { id: 'c4', name: '104 | Video | Sales | 02.11.2026', objective: 'OUTCOME_SALES', buying_type: 'AUCTION',
            effective_status: 'ACTIVE', start_time: '2026-11-02T10:00:00+0530' },
        ],
      },
    };
  }
  if (r.path === 'act_1001/adsets') {
    return {
      body: {
        data: [
          { id: 's1', name: 'S1', campaign_id: 'c1', is_dynamic_creative: false, targeting: goodTargeting },
          { id: 's2', name: 'S2', campaign_id: 'c2', is_dynamic_creative: false,
            targeting: { ...goodTargeting, publisher_platforms: ['facebook', 'instagram', 'threads', 'messenger'] } },
          { id: 's3', name: 'S3', campaign_id: 'c3', is_dynamic_creative: true, targeting: goodTargeting },
          { id: 's4', name: 'S4', campaign_id: 'c4', is_dynamic_creative: false, daily_budget: '90000', targeting: goodTargeting },
        ],
      },
    };
  }
  if (r.path === 'act_1001/ads') {
    const creative = { id: 'cr', object_story_spec: { link_data: { message: 'Shop now', call_to_action: { type: 'SHOP_NOW' } } },
      thumbnail_url: 'https://scontent.xx.fbcdn.net/thumb.jpg' };
    return {
      body: {
        data: [
          { id: 'a1', name: 'Ad 1', adset_id: 's1', campaign_id: 'c1', effective_status: 'ACTIVE', creative },
          { id: 'a2', name: 'Ad 2', adset_id: 's2', campaign_id: 'c2', effective_status: 'ACTIVE',
            creative: { id: 'cr2', object_story_spec: { link_data: { message: 'Hi' } } } },
        ],
      },
    };
  }
  if (r.path === 'act_1001/insights') {
    expect(r.params.get('date_preset')).toBe('last_7d');
    return {
      body: {
        data: [
          { campaign_id: 'c1', spend: '20000', action_values: [{ action_type: 'omni_purchase', value: '140000' }] },
          { campaign_id: 'c2', spend: '3000', reach: '1000000' },
          { campaign_id: 'c3', spend: '5000', actions: [{ action_type: 'lead', value: '50' }] },
        ],
      },
    };
  }
  if (r.path === 'c3/insights') {
    expect(JSON.parse(r.params.get('time_range')!)).toEqual({ since: '2026-09-01', until: '2026-09-14' });
    return { body: { data: [{ spend: '4000', actions: [{ action_type: 'lead', value: '40' }] }] } };
  }
  return undefined;
};

export async function connectFakeMeta() {
  const admin = await createUser('admin');
  const conn = await upsertConnection({
    metaUserId: '42', metaUserName: 'Test', tokenType: 'system_user', tokenCiphertext: encryptSecret('FAKE-TOKEN'),
    scopes: ['ads_read'], expiresAt: null, connectedBy: admin.id,
  });
  for (const id of ['1001', '1002']) {
    await upsertDiscoveredAccount({ metaAccountId: id, name: `Account ${id}`, currency: 'INR', timezone: 'Asia/Kolkata',
      businessName: null, accountStatus: 1, connectionId: conn.id });
  }
  for (const a of store.c.adAccounts.all()) await store.c.adAccounts.update(a.id, { isActive: true });
  return conn;
}

