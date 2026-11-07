import {
  META_OPTIONAL_PERMISSIONS,
  META_READ_PERMISSIONS,
  type AccountAccessInfo,
  type MetaConnectionInfo,
  type MetaDiscoveryReport,
  type TokenCheckInfo,
} from '@sop/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/http';
import { formatIst, formatRelative } from '../../lib/format';
import { Alert, Button, Input } from '../ui/controls';

const DAY = 86_400_000;
const READ = new Set<string>(META_READ_PERMISSIONS);

const TYPE_LABEL: Record<TokenCheckInfo['type'], string> = {
  USER: 'User token',
  SYSTEM_USER: 'System-user token',
  PAGE: 'Page token',
  APP: 'App token',
  UNKNOWN: 'Type not reported',
};
const METHOD_LABEL: Record<TokenCheckInfo['method'], string> = {
  debug_token: 'checked with the configured Meta app',
  self_debug: 'checked by the token itself',
  permissions: 'permissions read from Meta; type and expiry not reported',
  none: 'Meta reported no details',
};

/** Granted permissions, marked as needed (one read permission), optional, or extra (accepted, unused). */
function Permissions({ check }: { check: TokenCheckInfo }) {
  const chip = (p: string) => {
    const kind = READ.has(p) ? 'read' : META_OPTIONAL_PERMISSIONS[p] ? 'optional' : 'extra';
    const cls =
      kind === 'read' ? 'bg-good-bg text-good ring-good/30' : kind === 'optional' ? 'bg-head text-navy ring-line' : 'bg-white text-muted ring-line';
    const title = kind === 'read' ? 'Reads campaigns, ad sets, ads, creatives and insights' : kind === 'optional' ? META_OPTIONAL_PERMISSIONS[p] : 'Not used by the tracker; accepted';
    return (
      <span key={p} title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold ring-1 ${cls}`}>
        {kind === 'read' && '✓ '}
        {p}
      </span>
    );
  };
  const optionalMissing = Object.keys(META_OPTIONAL_PERMISSIONS).filter((p) => !check.granted.includes(p));
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1.5">{check.granted.length ? check.granted.map(chip) : <span className="text-[13px] text-muted">Not reported by Meta</span>}</div>
      <p className="mt-1.5 text-[12px] text-muted">
        <span className="font-semibold text-good">✓</span> needed to read ad data (one is enough) · blue: optional · grey: not used, accepted.
        {optionalMissing.map((p) => ` Optional ${p} is not granted — it only ${META_OPTIONAL_PERMISSIONS[p]!.charAt(0).toLowerCase()}${META_OPTIONAL_PERMISSIONS[p]!.slice(1).replace(/\.$/, '')}; campaign data is unaffected.`)}
      </p>
      {check.declined.length > 0 && <p className="mt-1 text-[12px] text-avg">Declined: {check.declined.join(', ')}</p>}
      {check.granularAdAccounts && (
        <p className="mt-1 text-[12px] text-muted">ads_read is limited to {check.granularAdAccounts.length} ad account{check.granularAdAccounts.length === 1 ? '' : 's'}: {check.granularAdAccounts.join(', ')}</p>
      )}
    </div>
  );
}

/** What a connect or "check again" found: discovery, manual IDs, readable accounts, warnings. */
export function DiscoveryReport({ report, accountsFound }: { report: MetaDiscoveryReport; accountsFound: number }) {
  return (
    <div className="mt-2 rounded-lg border border-line bg-head/30 p-3 text-[13px]">
      <p>
        <b>{accountsFound}</b> ad account{accountsFound === 1 ? '' : 's'} available: {report.discovered} found automatically
        {report.manual.length ? `, ${report.manual.filter((m) => m.ok).length} of ${report.manual.length} entered by ID` : ''}.{' '}
        {report.checked > 0 && (
          <>
            Campaigns readable in <b>{report.readable}</b> of {report.checked} test-read.
          </>
        )}
      </p>
      {report.discoveryError && <p className="mt-1 text-avg">Automatic discovery failed: {report.discoveryError}</p>}
      {report.manual.filter((m) => !m.ok).map((m) => (
        <p key={m.metaAccountId} className="mt-1 text-bad">
          {m.metaAccountId}: {m.message}
        </p>
      ))}
      {report.businessNames === 'not_permitted' && <p className="mt-1 text-muted">Business names are not shown (needs the optional business_management permission).</p>}
      {report.warnings.map((w) => (
        <p key={w} className="mt-1 text-avg">
          {w}
        </p>
      ))}
    </div>
  );
}

export function ConnectionRow({ c, admin, onChanged }: { c: MetaConnectionInfo; admin: boolean; onChanged: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ report: MetaDiscoveryReport; accountsFound: number } | null>(null);
  const [accountId, setAccountId] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const expiresSoon = c.expiresAt && new Date(c.expiresAt).getTime() - Date.now() < 7 * DAY;
  const check = c.check;

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addAccount(e: FormEvent) {
    e.preventDefault();
    await act(async () => {
      const r = await api<{ metaAccountId: string; access: AccountAccessInfo }>(`/meta/connections/${c.id}/accounts`, { method: 'POST', body: { adAccountId: accountId } });
      setAccountId('');
      return `Ad account ${r.metaAccountId} added${r.access.campaigns === 'ok' ? '' : ` — ${r.access.message ?? 'its campaigns are not readable yet'}`}. Tick it below to audit it.`;
    });
  }

  return (
    <li className="border-b border-line py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-ink">
            {c.metaUserName ?? 'Meta user'}{' '}
            <span className="text-[13px] font-normal text-muted">
              ({check ? TYPE_LABEL[check.type] : c.tokenType === 'system_user' ? 'System-user token' : 'User token'}, ID {c.metaUserId})
            </span>
          </div>
          <div className={`text-[13px] ${c.status === 'invalid' || expiresSoon ? 'font-semibold text-bad' : 'text-muted'}`}>
            {c.status === 'invalid'
              ? `Needs reconnecting: ${c.lastError ?? 'token no longer valid'}`
              : c.expiresAt
                ? `Token expires ${formatRelative(c.expiresAt)} (${formatIst(c.expiresAt)})${expiresSoon ? ' — reconnect soon' : ''}`
                : check?.method === 'debug_token' || check?.method === 'self_debug'
                  ? 'Token does not expire'
                  : 'Expiry not reported by Meta'}
          </div>
          {check ? (
            <>
              <div className="text-[13px] text-muted">
                {check.appName ?? 'Meta app'}
                {check.appId ? ` (${check.appId})` : ''}
                {check.sameAppAsConfigured === false ? ' — not the configured app' : ''} · {METHOD_LABEL[check.method]} {formatRelative(check.checkedAt)}
                {check.dataAccessExpiresAt ? ` · data access until ${formatIst(check.dataAccessExpiresAt)}` : ''}
              </div>
              <Permissions check={check} />
              {check.warnings.map((w) => (
                <p key={w} className="mt-1 text-[12px] text-avg">
                  {w}
                </p>
              ))}
            </>
          ) : (
            <div className="text-[13px] text-muted">
              Permissions: {c.scopes.length ? c.scopes.join(', ') : 'not reported'} · Connected {formatIst(c.createdAt)} · Use “Check again” for the full token check.
            </div>
          )}
        </div>
        {admin && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const r = await api<{ accountsFound: number; report: MetaDiscoveryReport }>(`/meta/connections/${c.id}/discover`, { method: 'POST' });
                  setReport(r);
                  return `Checked again: ${r.accountsFound} ad accounts, campaigns readable in ${r.report.readable} of ${r.report.checked}.`;
                })
              }
            >
              {busy ? 'Checking…' : 'Check again'}
            </Button>
            {confirmRemove ? (
              <>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api(`/meta/connections/${c.id}`, { method: 'DELETE' });
                      return 'Connection removed. Its stored token was deleted; past audits are kept.';
                    })
                  }
                >
                  Remove token
                </Button>
                <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button variant="danger" disabled={busy} onClick={() => setConfirmRemove(true)}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
      {report && <DiscoveryReport {...report} />}
      {admin && c.status === 'active' && (
        <form onSubmit={(e) => void addAccount(e)} className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="Ad account ID, e.g. act_1234567890"
            aria-label="Ad account ID to add"
            className="w-[280px] max-w-full"
          />
          <Button type="submit" variant="secondary" disabled={busy || accountId.trim().length < 5}>
            Add ad account by ID
          </Button>
          <span className="text-[12px] text-muted">For accounts Meta does not list automatically.</span>
        </form>
      )}
      {error && (
        <div className="mt-2">
          <Alert>{error}</Alert>
        </div>
      )}
    </li>
  );
}

/** Whether campaigns and insights of an ad account could be read with its connection's token. */
export function AccessCell({ access }: { access: AccountAccessInfo | null }) {
  if (!access) return <span className="text-[13px] text-muted">Not checked yet</span>;
  const mark = (s: AccountAccessInfo['campaigns'], label: string) => (
    <span className={s === 'ok' ? 'text-good' : s === 'denied' ? 'text-bad' : 'text-avg'}>
      {s === 'ok' ? '✓' : '✗'} {label}
    </span>
  );
  return (
    <div className="text-[13px]">
      <div className="flex gap-3 whitespace-nowrap font-semibold">
        {mark(access.campaigns, 'Campaigns')}
        {mark(access.insights, 'Insights')}
      </div>
      {access.message && <div className="mt-0.5 max-w-[360px] text-[12px] text-muted">{access.message}</div>}
    </div>
  );
}
