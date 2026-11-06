/**
 * Stand-in for the server in the static preview build. It answers /api calls from a snapshot
 * of DEVELOPMENT data (see server/src/cli/exportPreviewSnapshot.ts). Changes live in memory only.
 */
import {
  describeFindings,
  MANUAL_CHECK_ITEMS,
  type AuthUser,
  type CampaignAudit,
  type CampaignDetailResponse,
  type DashboardResponse,
  type ManualCheckState,
  type ManualEvent,
  type ManualStatus,
  type MetaStatusResponse,
  type RunListItem,
  type UserSummary,
} from '@sop/shared';
import snapshot from './snapshot.json';

interface Snapshot {
  dashboard: DashboardResponse;
  details: Record<string, CampaignDetailResponse>;
  runs: RunListItem[];
  meta: MetaStatusResponse;
}
const data = snapshot as unknown as Snapshot;

const NO_META = 'This preview uses development sample data and has no Meta connection.';
const now = () => new Date().toISOString();

const previewUser: AuthUser = { id: '1', email: 'preview@deodap.example', name: 'Preview admin', role: 'admin', mustChangePassword: false };
let signedIn: AuthUser | null = previewUser;
const users: UserSummary[] = [
  { ...previewUser, isActive: true, createdAt: data.dashboard.run?.startedAt ?? now(), lastLoginAt: now() },
];
const manual = new Map<string, { checks: ManualCheckState[]; events: ManualEvent[] }>();

function manualFor(metaCampaignId: string) {
  let m = manual.get(metaCampaignId);
  if (!m) {
    m = {
      checks: MANUAL_CHECK_ITEMS.map((i) => ({ ...i, status: 'PENDING' as ManualStatus, note: null, updatedBy: null, updatedAt: null, attachments: [] })),
      events: [],
    };
    manual.set(metaCampaignId, m);
  }
  return m;
}

/** Applies in-memory manual checks to a campaign row, as the server would. */
function withManual(c: CampaignAudit): CampaignAudit {
  const { checks } = manualFor(c.metaCampaignId);
  const count = (s: ManualStatus) => checks.filter((m) => m.status === s).length;
  return {
    ...c,
    manual: { verified: count('VERIFIED'), failed: count('FAILED'), notApplicable: count('NOT_APPLICABLE'), pending: count('PENDING') },
    whatIsOff: [
      ...describeFindings(c.checks),
      ...checks.filter((m) => m.status === 'FAILED').map((m) => `Manual check failed: ${m.label}${m.note ? ` (${m.note})` : ''}`),
    ],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const error = (status: number, message: string) => json({ error: message }, status);

async function handle(method: string, path: string, body: Record<string, unknown>): Promise<Response> {
  const url = new URL(path, 'http://preview');
  const p = url.pathname.replace(/^\/api/, '');
  let m: RegExpMatchArray | null;

  if (p === '/auth/me') return json({ user: signedIn });
  if (p === '/auth/login' && method === 'POST') return json({ user: (signedIn = previewUser) });
  if (p === '/auth/logout') return json({ ok: (signedIn = null) === null });
  if (p === '/auth/password') return json({ user: previewUser });
  if (!signedIn) return error(401, 'Please sign in.');

  if (p === '/dashboard') {
    const runId = url.searchParams.get('runId');
    if (runId && runId !== data.dashboard.run?.id) return error(404, 'That audit run does not exist or did not complete.');
    return json({ ...data.dashboard, campaigns: data.dashboard.campaigns.map(withManual) });
  }
  if ((m = p.match(/^\/campaign-audits\/(\d+)$/))) {
    const d = data.details[m[1]!];
    if (!d) return error(404, 'Campaign audit not found.');
    const mm = manualFor(d.audit.metaCampaignId);
    return json({ ...d, audit: withManual(d.audit), manualChecks: mm.checks, manualEvents: mm.events });
  }
  if ((m = p.match(/^\/manual-checks\/([^/]+)\/([^/]+)$/)) && method === 'PUT') {
    const mm = manualFor(decodeURIComponent(m[1]!));
    const item = mm.checks.find((c) => c.key === m![2]);
    if (!item) return error(400, 'Unknown manual check.');
    const status = body.status as ManualStatus;
    const note = (typeof body.note === 'string' && body.note.trim()) || null;
    if (status === 'FAILED' && !note) return error(400, 'note: Add a note saying what is wrong.');
    Object.assign(item, status === 'PENDING'
      ? { status, note: null, updatedBy: null, updatedAt: null }
      : { status, note, updatedBy: previewUser.name, updatedAt: now() });
    mm.events.unshift({ key: item.key, status, note, user: previewUser.name, at: now() });
    return json({ manualChecks: mm.checks, manualEvents: mm.events });
  }
  if (p.match(/^\/ads\/\d+\/preview$/)) return error(400, `${NO_META} Live ad previews come from Meta.`);
  if (p === '/runs') return json({ runs: data.runs });
  if ((m = p.match(/^\/runs\/(\d+)$/))) {
    const run = data.runs.find((r) => r.id === m![1]);
    return run ? json({ run }) : error(404, 'Audit run not found.');
  }
  if (p === '/sync/status') return json({ running: null, lastFinished: null });
  if (p === '/sync') return error(400, `${NO_META} Refresh works once Meta is connected in the installed app.`);
  if (p === '/meta/status') {
    return json({
      ...data.meta,
      app: data.meta.app ?? { appId: null, hasAppSecret: false, redirectUri: null, defaultRedirectUri: 'http://localhost:5173/api/meta/oauth/callback', graphVersion: data.meta.graphVersion, source: 'none' },
      encryptionKey: data.meta.encryptionKey ?? 'key-file',
    });
  }
  if (p === '/system/health') return json({ persistence: 'ok' });
  if (p.startsWith('/system/')) return error(400, 'This preview has no server. Data storage and backups are shown in the installed app.');
  if (p === '/exports/history') return json({ reports: [] });
  if (p.startsWith('/meta/')) return error(400, `${NO_META} Connect Meta in the installed app.`);

  if (p === '/users' && method === 'GET') return json({ users });
  if (p === '/users' && method === 'POST') {
    if (users.some((u) => u.email.toLowerCase() === String(body.email).toLowerCase())) return error(409, 'A user with this email already exists.');
    const user: UserSummary = {
      id: String(users.length + 1),
      email: String(body.email),
      name: String(body.name),
      role: body.role as UserSummary['role'],
      mustChangePassword: true,
      isActive: true,
      createdAt: now(),
      lastLoginAt: null,
    };
    users.push(user);
    return json({ user, temporaryPassword: 'Prev-iewO-nlyX-0000' }, 201);
  }
  if ((m = p.match(/^\/users\/(\d+)$/)) && method === 'PATCH') {
    const u = users.find((x) => x.id === m![1]);
    if (!u) return error(404, 'User not found.');
    if (u.id === previewUser.id && (body.role && body.role !== 'admin' || body.isActive === false)) {
      return error(400, 'At least one active admin is required.');
    }
    Object.assign(u, body);
    return json({ user: u });
  }
  if (p.match(/^\/users\/\d+\/reset-password$/)) return json({ temporaryPassword: 'Prev-iewO-nlyX-0000' });

  return error(404, 'Not found');
}

export function installMockApi(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (!path.startsWith('/api/')) return realFetch(input, init);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    await new Promise((r) => setTimeout(r, 120)); // feel like a real request
    return handle((init?.method ?? 'GET').toUpperCase(), path, body);
  };
}
