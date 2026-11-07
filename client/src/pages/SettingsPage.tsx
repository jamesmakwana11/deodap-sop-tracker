import { ACCOUNT_STATUS_LABEL, hasRole, type AdAccountInfo, type MetaDiscoveryReport, type MetaStatusResponse } from '@sop/shared';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { ErrorState } from '../components/dashboard/StatusPanels';
import { Card } from '../components/ui/Card';
import { Alert, Button, Field, Input } from '../components/ui/controls';
import { DataStorageCard } from '../components/settings/DataStorageCard';
import { MetaAppForm } from '../components/settings/MetaAppForm';
import { AccessCell, ConnectionRow, DiscoveryReport } from '../components/settings/MetaConnection';
import { Section } from '../components/ui/Section';
import { useApi } from '../hooks/useApi';
import { formatIst } from '../lib/format';
import { useSync } from '../sync/SyncContext';

function AccountsTable({ accounts, admin, onToggle }: { accounts: AdAccountInfo[]; admin: boolean; onToggle: (a: AdAccountInfo) => void }) {
  if (accounts.length === 0) return <p className="text-[14px] text-muted">No ad accounts found yet. Connect Meta first.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="bg-head text-left text-navy">
            {['Audit', 'Ad account', 'Account ID', 'Access', 'Business', 'Currency', 'Time zone', 'Meta status'].map((h) => (
              <th key={h} className="px-2.5 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} className="border-b border-line">
              <td className="px-2.5 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-brand)]"
                  checked={a.selected}
                  disabled={!admin}
                  onChange={() => onToggle(a)}
                  aria-label={`Audit ${a.name}`}
                />
              </td>
              <td className="px-2.5 py-2 font-semibold">
                {a.name}
                {a.addedManually && <div className="text-[12px] font-normal text-muted">added by ID</div>}
              </td>
              <td className="px-2.5 py-2 tabular-nums">{a.metaAccountId}</td>
              <td className="px-2.5 py-2">
                <AccessCell access={a.access} />
              </td>
              <td className="px-2.5 py-2">{a.businessName ?? '–'}</td>
              <td className={`px-2.5 py-2 ${a.currency !== 'INR' ? 'text-avg' : ''}`} title={a.currency !== 'INR' ? 'The ₹800 budget rule is not checkable in other currencies' : undefined}>
                {a.currency}
              </td>
              <td className="px-2.5 py-2">{a.timezone ?? '–'}</td>
              <td className={`px-2.5 py-2 ${a.accountStatus !== 1 ? 'text-bad' : ''}`}>{a.accountStatus ? ACCOUNT_STATUS_LABEL[a.accountStatus] ?? a.accountStatus : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const admin = hasRole(user, 'admin');
  const sync = useSync();
  const [params, setParams] = useSearchParams();
  const state = useApi<MetaStatusResponse>('/meta/status');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(() => {
    if (params.get('meta') === 'connected') {
      const readable = params.get('readable');
      return { tone: 'success', text: `Meta connected. Found ${params.get('accounts') ?? 0} ad accounts${readable !== null ? `; campaigns readable in ${readable}` : ''} — tick the ones to audit.` };
    }
    if (params.get('meta') === 'error') return { tone: 'error', text: params.get('reason') ?? 'The Meta connection did not complete.' };
    return null;
  });
  const [token, setToken] = useState('');
  const [accountIds, setAccountIds] = useState('');
  const [lastReport, setLastReport] = useState<{ report: MetaDiscoveryReport; accountsFound: number } | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const s = state.data;
  const done = (text: string, tone: 'success' | 'error' = 'success') => {
    setMessage({ tone, text });
    if (params.has('meta')) setParams({}, { replace: true });
    state.reload();
  };

  async function connectOAuth() {
    try {
      const { url } = await api<{ url: string }>('/meta/oauth/start');
      window.location.assign(url);
    } catch (e) {
      done((e as Error).message, 'error');
    }
  }

  async function saveToken(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const ids = accountIds.split(/[\s,;]+/).filter(Boolean);
      const r = await api<{ accountsFound: number; report: MetaDiscoveryReport }>('/meta/connections/token', {
        method: 'POST',
        body: { accessToken: token.trim(), ...(ids.length ? { adAccountIds: ids } : {}) },
      });
      setToken('');
      setAccountIds('');
      setLastReport(r);
      done(`Token checked and saved. ${r.accountsFound} ad accounts available — tick the ones to audit.`);
    } catch (err) {
      done((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(a: AdAccountInfo) {
    try {
      await api(`/meta/accounts/${a.id}`, { method: 'PATCH', body: { selected: !a.selected } });
      done(`${a.name} ${a.selected ? 'will no longer be audited' : 'will be audited from the next refresh'}.`);
    } catch (e) {
      done((e as Error).message, 'error');
    }
  }

  async function saveSchedule(value: string | null) {
    try {
      await api('/meta/schedule', { method: 'PUT', body: { timeIst: value } });
      setTime(null);
      done(value ? `Daily refresh set to ${value} IST.` : 'Daily refresh switched off.');
    } catch (e) {
      done((e as Error).message, 'error');
    }
  }

  if (state.status === 'error') {
    return (
      <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-7">
        <ErrorState message={state.error} onRetry={state.reload} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-7">
      <h1 className="font-serif text-3xl font-semibold text-navy">Meta & schedule</h1>
      <p className="mt-1 text-[14px] text-muted">
        The tracker only reads from Meta: <code>ads_read</code> is all it needs (<code>ads_management</code> also works; extra
        permissions are accepted). It never changes campaigns, ad sets or ads.
        {!admin && ' Only admins can change these settings.'}
      </p>
      {message && (
        <div className="mt-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}
      {!s && <p className="mt-6 text-muted">Loading…</p>}
      {s && (
        <>
          <Section title="Meta connection">
            <Card>
              {!s.tokenStorageConfigured && (
                <Alert tone="warn">
                  The server has no TOKEN_ENCRYPTION_KEY, so it cannot store Meta tokens yet. See the setup guide.
                </Alert>
              )}
              {s.connections.length === 0 ? (
                <p className="text-[14px] text-muted">Not connected.</p>
              ) : (
                <ul>
                  {s.connections.map((c) => (
                    <ConnectionRow key={c.id} c={c} admin={admin} onChanged={(t) => done(t)} />
                  ))}
                </ul>
              )}
              {admin && (
                <div className="mt-4 grid gap-5 border-t border-line pt-4 lg:grid-cols-2">
                  <div>
                    <h4 className="font-semibold text-navy">Connect with Facebook login</h4>
                    <p className="mt-1 text-[13px] text-muted">
                      Sign in with a Facebook account that has access to the ad accounts. The token lasts about 60 days; reconnect
                      before it expires.
                    </p>
                    <Button className="mt-3" onClick={() => void connectOAuth()} disabled={!s.oauthConfigured}>
                      Connect Meta
                    </Button>
                    {!s.oauthConfigured && (
                      <p className="mt-2 text-[13px] text-avg">Enter the Meta app details below first.</p>
                    )}
                  </div>
                  <form onSubmit={saveToken}>
                    <h4 className="font-semibold text-navy">Or paste an access token</h4>
                    <p className="mt-1 text-[13px] text-muted">
                      A system-user token (recommended for the daily refresh; it does not expire) or a user token, from any Meta app.
                      It needs <code>ads_read</code> (or <code>ads_management</code>); extra permissions are fine. It is checked —
                      validity, type, expiry, permissions and ad account access — before anything is saved, then encrypted on the
                      server and never shown again.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Input
                        type="password"
                        autoComplete="off"
                        placeholder="Paste access token"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        className="flex-1"
                        disabled={!s.tokenStorageConfigured}
                      />
                      <Button type="submit" disabled={busy || token.trim().length < 20}>
                        {busy ? 'Checking…' : 'Check & save'}
                      </Button>
                    </div>
                    <label className="mt-2 block text-[13px] text-muted">
                      Ad account IDs (optional) — for accounts Meta does not list automatically, e.g. accounts shared from another Business
                      <textarea
                        value={accountIds}
                        onChange={(e) => setAccountIds(e.target.value)}
                        rows={2}
                        placeholder="act_1234567890, 9876543210"
                        className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[14px] text-ink outline-none focus:border-brand"
                        disabled={!s.tokenStorageConfigured}
                      />
                    </label>
                  </form>
                </div>
              )}
              {lastReport && <DiscoveryReport {...lastReport} />}
              <p className="mt-3 text-[12px] text-muted">Graph API {s.graphVersion}</p>
            </Card>
          </Section>

          {admin && (
            <Section title="Meta app" intro="Used for “Connect Meta”. Kept on the server; the App Secret is encrypted and never shown again.">
              <Card>
                <MetaAppForm key={`${s.app.appId}-${s.app.source}`} app={s.app} onSaved={(t) => done(t)} />
              </Card>
            </Section>
          )}

          <Section title="Ad accounts to audit" intro="Only ticked accounts are refreshed. Development sample accounts are never listed here.">
            <Card>
              <AccountsTable accounts={s.accounts} admin={admin} onToggle={(a) => void toggle(a)} />
            </Card>
          </Section>

          <Section title="Daily refresh">
            <Card>
              <p className="text-[14px] text-ink">
                {s.schedule.timeIst
                  ? `Every day at ${s.schedule.timeIst} IST. Next run ${formatIst(s.schedule.nextRunAt!)}.`
                  : 'The daily refresh is off. Use “Refresh now” to update.'}
              </p>
              {sync.status?.lastFinished && (
                <p className="mt-1 text-[13px] text-muted">
                  Last refresh {formatIst(sync.status.lastFinished.finishedAt ?? sync.status.lastFinished.startedAt)} — {sync.status.lastFinished.status}
                  {sync.status.lastFinished.error ? `: ${sync.status.lastFinished.error}` : ''}
                </p>
              )}
              {admin && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Field label="Time (IST, 24-hour)">
                    <Input type="time" value={time ?? s.schedule.timeIst ?? '07:30'} onChange={(e) => setTime(e.target.value)} />
                  </Field>
                  <Button onClick={() => void saveSchedule(time ?? s.schedule.timeIst ?? '07:30')}>Save time</Button>
                  {s.schedule.timeIst && (
                    <Button variant="secondary" onClick={() => void saveSchedule(null)}>
                      Turn off
                    </Button>
                  )}
                </div>
              )}
            </Card>
          </Section>

          {admin && (
            <Section title="Data & backups" intro="Everything the tracker stores — users, Meta settings, audits, manual checks, evidence and exports — lives in one data folder on the server.">
              <DataStorageCard />
            </Section>
          )}
        </>
      )}
    </main>
  );
}
