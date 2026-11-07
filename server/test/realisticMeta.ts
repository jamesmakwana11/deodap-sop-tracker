/**
 * TEST DOUBLE that behaves like the real Graph API on the points that matter for connecting:
 * who a token is, which permissions it has, which ad accounts it is assigned to, pagination, and
 * Meta's real error codes and messages (e.g. "(#100) Requires business_management permission to
 * access the field."). The account data behind it is the FAKE world from fakeMetaWorld.ts;
 * nothing here is ever shown as a real result.
 */
import type { GraphHandler, GraphRequest } from './fakeGraph.js';
import { world } from './fakeMetaWorld.js';

export const APP_ID = 'test-app-id'; // matches META_APP_ID in vitest.config.ts

export interface FakeToken {
  type: 'USER' | 'SYSTEM_USER' | 'PAGE';
  userId: string;
  name: string;
  appId?: string;
  scopes: string[];
  declined?: string[];
  /** Ad accounts assigned to the person / system user. */
  accounts: string[];
  /** Assigned accounts that me/adaccounts does not list (e.g. reached through another Business). */
  hiddenAccounts?: string[];
  /** Accounts whose insights edge Meta refuses. */
  noInsights?: string[];
  /** Accounts whose ads cannot be read with the extended creative fields. */
  limitedCreatives?: string[];
  expiresAt?: number;
  valid?: boolean;
}

const err = (code: number, message: string, status = 400, subcode?: number) => ({
  status,
  body: { error: { message, type: 'OAuthException', code, ...(subcode ? { error_subcode: subcode } : {}), fbtrace_id: 'TEST' } },
});

const NOT_FOUND = (id: string) =>
  err(100, `Unsupported get request. Object with ID '${id}' does not exist, cannot be loaded due to missing permissions, or does not support this operation. Please read the Graph API documentation at https://developers.facebook.com/docs/graph-api`, 400, 33);

/** Extra ad accounts for paging tests: act_2000 … */
const bulkAccount = (i: number) => ({ id: `act_${2000 + i}`, account_id: String(2000 + i), name: `Bulk account ${i}`, currency: 'INR', account_status: 1 });

const ACCOUNT_NAMES: Record<string, string> = { '1001': 'Store One', '100003': 'Store Three (no insights)', '100004': 'Store Four (partner Business)' };

/** Campaign data for the accounts beyond 1001 (which comes from fakeMetaWorld). */
function extraAccountData(act: string, edge: string, r: GraphRequest): unknown | undefined {
  if (act !== '100003' && act !== '100004') return undefined;
  const c = `${act}-c`;
  if (edge === 'campaigns')
    return { data: [{ id: c, name: `${act} | Static | Sales | 01.10.2026`, objective: 'OUTCOME_SALES', buying_type: 'AUCTION', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', daily_budget: '100000', effective_status: 'ACTIVE', start_time: '2026-10-01T10:00:00+0530' }] };
  if (edge === 'adsets') return { data: [{ id: `${act}-s`, name: 'S', campaign_id: c, effective_status: 'ACTIVE', is_dynamic_creative: false, targeting: { publisher_platforms: ['facebook', 'instagram'], geo_locations: { countries: ['IN'] } } }] };
  if (edge === 'ads' && (r.params.get('fields') ?? '').startsWith('id,campaign_id,adset_id')) return { data: [] };
  if (edge === 'ads') return { data: [{ id: `${act}-a`, name: 'A', adset_id: `${act}-s`, campaign_id: c, effective_status: 'ACTIVE', creative: { id: 'cr', body: 'Buy now', title: 'Deal', call_to_action_type: 'SHOP_NOW' } }] };
  if (edge === 'insights') return { data: [{ campaign_id: c, spend: '20000', action_values: [{ action_type: 'omni_purchase', value: '100000' }] }] };
  return undefined;
}

export function realisticMeta(tokens: Record<string, FakeToken>, opts: { bulkAccounts?: number } = {}): GraphHandler {
  return (r: GraphRequest) => {
    const bearer = r.authorization?.replace(/^Bearer /, '') ?? '';
    const fields = (r.params.get('fields') ?? '').split(/[,{}]/).filter(Boolean);

    // App access token "<app id>|<secret>": only debug_token, and only for its own tokens.
    if (bearer.includes('|')) {
      if (r.path !== 'debug_token') return err(100, 'Unsupported request with an app access token.');
      const t = tokens[r.params.get('input_token') ?? ''];
      if (!t) return { body: { data: { is_valid: false, error: { code: 190, message: 'Invalid OAuth access token.' } } } };
      if ((t.appId ?? APP_ID) !== APP_ID) return err(100, 'The App_id in the input_token did not match the Viewing App');
      return { body: { data: debugData(t) } };
    }

    const t = tokens[bearer];
    if (!t) return err(190, 'Invalid OAuth access token - Cannot parse access token', 400);
    if (t.valid === false) return err(190, 'Error validating access token: Session has expired.', 400, 463);
    // appsecret_proof must be made with the secret of the app that issued the token.
    if (r.params.get('appsecret_proof') && (t.appId ?? APP_ID) !== APP_ID) return err(100, 'Invalid appsecret_proof provided in the API argument');

    if (r.path === 'debug_token') return { body: { data: debugData(t) } };
    if (r.path === 'me') return { body: { id: t.userId, name: t.name } };
    if (r.path === 'me/permissions') {
      return { body: { data: [...t.scopes.map((p) => ({ permission: p, status: 'granted' })), ...(t.declined ?? []).map((p) => ({ permission: p, status: 'declined' }))] } };
    }
    if (t.type === 'PAGE') return err(100, 'Tried accessing nonexisting field (adaccounts) on node type (Page)');

    const canRead = t.scopes.includes('ads_read') || t.scopes.includes('ads_management');
    if (r.path === 'me/adaccounts') {
      if (!canRead) return err(200, '(#200) Ad account owner has NOT grant ads_management or ads_read permission', 403);
      // The exact error seen on Render when business{…} is requested without business_management.
      if (fields.includes('business') && !t.scopes.includes('business_management')) {
        return err(100, '(#100) Requires business_management permission to access the field.');
      }
      const listed = t.accounts.filter((a) => !(t.hiddenAccounts ?? []).includes(a));
      const all = [
        ...listed.map((a) => ({ id: `act_${a}`, account_id: a, name: ACCOUNT_NAMES[a] ?? `Account ${a}`, currency: 'INR', timezone_name: 'Asia/Kolkata', account_status: 1, business: { id: '9', name: 'DeoDap Business' } })),
        ...Array.from({ length: opts.bulkAccounts ?? 0 }, (_, i) => bulkAccount(i)),
      ].map((a) => {
        const row: Record<string, unknown> = {};
        for (const f of fields) if (f in a) row[f] = (a as Record<string, unknown>)[f];
        return row;
      });
      return page(r, all);
    }

    const m = /^act_(\d+)(?:\/(\w+))?$/.exec(r.path);
    if (m) {
      const [, id, edge] = m;
      const assigned = t.accounts.includes(id!) || (opts.bulkAccounts && Number(id) >= 2000 && Number(id) < 2000 + opts.bulkAccounts);
      if (!assigned) return NOT_FOUND(`act_${id}`);
      if (!canRead) return err(200, '(#200) Ad account owner has NOT grant ads_management or ads_read permission', 403);
      if (!edge) return { body: { id: `act_${id}`, account_id: id, name: ACCOUNT_NAMES[id!] ?? `Account ${id}`, currency: 'INR', timezone_name: 'Asia/Kolkata', account_status: 1 } };
      if (edge === 'insights' && t.noInsights?.includes(id!)) return err(10, '(#10) Application does not have permission for this action', 403);
      if (edge === 'ads' && t.limitedCreatives?.includes(id!) && fields.includes('instagram_permalink_url')) {
        return err(100, '(#100) Requires pages_read_engagement permission to access the field.');
      }
      if (Number(id) >= 2000 && Number(id) < 100000) return { body: { data: [] } };
      // Access test-reads (no status filter, limit 1) get a minimal answer.
      if (edge === 'campaigns' && !r.params.has('effective_status')) return { body: { data: [{ id: 'probe' }] } };
      if (edge === 'insights' && !r.params.has('level')) return { body: { data: [] } };
      const extra = extraAccountData(id!, edge, r);
      if (extra) return { body: extra };
      return world({ ...r, path: `act_1001/${edge}` }) ?? { body: { data: [] } };
    }
    // Campaign-level insights (Leads first 14 days) from the fake world.
    return world(r);
  };
}

function debugData(t: FakeToken) {
  return {
    app_id: t.appId ?? APP_ID,
    application: 'DeoDap Test App',
    type: t.type,
    user_id: t.userId,
    is_valid: t.valid !== false,
    scopes: t.scopes,
    granular_scopes: t.scopes.includes('ads_read') ? [{ scope: 'ads_read', target_ids: t.accounts.map((a) => `act_${a}`) }] : [],
    expires_at: t.expiresAt ?? 0,
  };
}

/** Meta-style cursor paging: limit per page, paging.next on graph.facebook.com. */
function page(r: GraphRequest, all: unknown[]) {
  const limit = Number(r.params.get('limit') ?? 25);
  const after = Number(r.params.get('after') ?? 0);
  const data = all.slice(after, after + limit);
  const next = after + limit < all.length ? new URL(r.url) : null;
  if (next) next.searchParams.set('after', String(after + limit));
  return { body: { data, paging: { cursors: { before: String(after), after: String(after + limit) }, ...(next ? { next: next.toString() } : {}) } } };
}
