import { hasRole, type RunListItem, type RunTotals } from '@sop/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ErrorState } from '../components/dashboard/StatusPanels';
import { RecentExports } from '../components/exports/RecentExports';
import { Card } from '../components/ui/Card';
import { Field, Input, Select } from '../components/ui/controls';
import { ExportMenu } from '../components/ui/ExportMenu';
import { Section } from '../components/ui/Section';
import { useApi } from '../hooks/useApi';
import { formatDate, formatIst } from '../lib/format';
import { useSync } from '../sync/SyncContext';

const completed = (r: RunListItem) => r.status === 'succeeded' || r.status === 'partial';
const runLabel = (r: RunListItem) => `#${r.id} · ${formatIst(r.finishedAt ?? r.startedAt)}${r.source === 'development' ? ' · development data' : ''}`;

const COMPARE_ROWS: [string, keyof RunTotals][] = [
  ['Active campaigns', 'campaigns'],
  ['Good', 'good'],
  ['Average', 'average'],
  ['Bad', 'bad'],
  ['Not rated', 'notRated'],
  ['Following SOP', 'following'],
  ['Partly following', 'partlyFollowing'],
  ['Not following', 'notFollowing'],
  ['Needs review', 'needsReview'],
];

/** Pick two completed audits; shows the change in totals and exports campaign-level changes. */
function CompareAudits({ runs }: { runs: RunListItem[] }) {
  const done = runs.filter(completed);
  const [later, setLater] = useState(done[0]?.id ?? '');
  const laterRun = done.find((r) => r.id === later);
  const earlierOptions = done.filter((r) => laterRun && r.id !== laterRun.id && r.startedAt < laterRun.startedAt);
  const defaultEarlier = earlierOptions.find((r) => r.source === laterRun?.source)?.id ?? earlierOptions[0]?.id ?? '';
  const [earlier, setEarlier] = useState(defaultEarlier);
  const earlierRun = earlierOptions.find((r) => r.id === earlier) ?? earlierOptions.find((r) => r.id === defaultEarlier);

  if (done.length < 2) return <p className="text-[14px] text-muted">A comparison needs two completed audits.</p>;
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Earlier audit">
          <Select value={earlierRun?.id ?? ''} onChange={(e) => setEarlier(e.target.value)}>
            {earlierOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {runLabel(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Later audit">
          <Select value={later} onChange={(e) => setLater(e.target.value)}>
            {done.slice(0, -1).map((r) => (
              <option key={r.id} value={r.id}>
                {runLabel(r)}
              </option>
            ))}
          </Select>
        </Field>
        {earlierRun && laterRun && (
          <div className="ml-auto">
            <ExportMenu label="Export comparison" datasets={['comparison']} params={{ runA: earlierRun.id, runB: laterRun.id }} hideScope />
          </div>
        )}
      </div>
      {earlierRun && laterRun && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full max-w-[640px] border-collapse text-[14px]">
            <thead>
              <tr className="bg-head text-left text-navy">
                <th className="px-2.5 py-2 font-semibold">Measure</th>
                <th className="px-2.5 py-2 text-right font-semibold">#{earlierRun.id}</th>
                <th className="px-2.5 py-2 text-right font-semibold">#{laterRun.id}</th>
                <th className="px-2.5 py-2 text-right font-semibold">Change</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map(([label, key]) => {
                const delta = laterRun.totals[key] - earlierRun.totals[key];
                return (
                  <tr key={key} className="border-b border-line">
                    <td className="px-2.5 py-1.5">{label}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{earlierRun.totals[key]}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{laterRun.totals[key]}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{delta > 0 ? `+${delta}` : delta}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[13px] text-muted">The export lists each campaign’s rating and SOP status in both audits, with checks newly failing or fixed.</p>
        </div>
      )}
    </div>
  );
}

const STATUS_CLASS: Record<RunListItem['status'], string> = {
  succeeded: 'text-good',
  partial: 'text-avg',
  failed: 'text-bad',
  running: 'text-brand',
};

/** Stacked bars: share of campaigns Following / Partly / Not following / Needs review per completed run. */
function ComplianceTrend({ runs }: { runs: RunListItem[] }) {
  const points = runs.filter((r) => r.status !== 'running' && r.status !== 'failed' && r.totals.campaigns > 0).slice(0, 30).reverse();
  if (points.length < 2) return <p className="text-[14px] text-muted">The trend appears after two completed audits.</p>;
  const w = 720;
  const h = 160;
  const bw = Math.min(28, (w - 40) / points.length - 4);
  const segments = [
    ['following', 'var(--color-good)', 'Following'],
    ['partlyFollowing', '#e3a400', 'Partly'],
    ['notFollowing', 'var(--color-bad)', 'Not following'],
    ['needsReview', '#94a3b8', 'Needs review'],
  ] as const;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h + 22}`} className="w-full max-w-[720px]" role="img" aria-label="SOP status share across audits">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1="32" x2={w} y1={h - f * h + 2} y2={h - f * h + 2} stroke="var(--color-line)" />
            <text x="0" y={h - f * h + 6} fontSize="10" fill="var(--color-muted)">
              {f * 100}%
            </text>
          </g>
        ))}
        {points.map((r, i) => {
          const x = 40 + (i * (w - 48)) / points.length;
          let y = h + 2;
          return (
            <g key={r.id}>
              <title>
                {formatIst(r.finishedAt ?? r.startedAt)}: {r.totals.following} following, {r.totals.partlyFollowing} partly,{' '}
                {r.totals.notFollowing} not following, {r.totals.needsReview} needs review
              </title>
              {segments.map(([key, color]) => {
                const hh = (r.totals[key] / r.totals.campaigns) * h;
                y -= hh;
                return <rect key={key} x={x} y={y} width={bw} height={hh} fill={color} />;
              })}
              {(i === 0 || i === points.length - 1 || points.length <= 10) && (
                <text x={x + bw / 2} y={h + 16} fontSize="9" textAnchor="middle" fill="var(--color-muted)">
                  {formatDate((r.finishedAt ?? r.startedAt).slice(0, 10)).replace(/ \d{4}$/, '')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-[13px] text-muted">
        {segments.map(([key, color, label]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function HistoryPage() {
  const state = useApi<{ runs: RunListItem[] }>('/runs?limit=120');
  const { user } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Dates are compared on the UTC start date, the same way the export filters them.
  const shownRuns = useMemo(
    () => (state.data?.runs ?? []).filter((r) => (!from || r.startedAt.slice(0, 10) >= from) && (!to || r.startedAt.slice(0, 10) <= to)),
    [state.data, from, to],
  );
  const { finishedVersion } = useSync();
  const { reload } = state;
  useEffect(() => {
    if (finishedVersion > 0) reload();
  }, [finishedVersion, reload]);

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-7">
      <h1 className="font-serif text-3xl font-semibold text-navy">Audit history</h1>
      <p className="mt-1 text-[14px] text-muted">
        Every refresh is kept as its own audit, so you can see how compliance and performance moved and open any past audit
        exactly as it was.
      </p>
      {state.status === 'error' && <ErrorState message={state.error} onRetry={reload} />}
      {state.data && (
        <>
          <Section title="SOP compliance over time">
            <Card>
              <ComplianceTrend runs={state.data.runs} />
            </Card>
          </Section>
          <Section title="All audits">
            <Card>
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <Field label="From">
                  <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="To">
                  <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                </Field>
                {(from || to) && (
                  <button type="button" className="h-9 text-[14px] font-semibold text-brand hover:underline" onClick={() => (setFrom(''), setTo(''))}>
                    Clear dates
                  </button>
                )}
                <span className="self-center text-[13px] text-muted">
                  {shownRuns.length} of {state.data.runs.length} audits
                </span>
                <div className="ml-auto">
                  <ExportMenu label="Export history" datasets={['history']} params={{ from, to }} />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[14px]">
                  <thead>
                    <tr className="bg-head text-left text-navy">
                      {['When', 'Source', 'Status', 'Campaigns', 'Good / Avg / Bad / NR', 'Following / Partly / Not / Review', 'Accounts', ''].map((h) => (
                        <th key={h} className="px-2.5 py-2.5 font-semibold whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shownRuns.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-muted">
                          {state.data.runs.length ? 'No audits in these dates.' : 'No audits yet.'}
                        </td>
                      </tr>
                    )}
                    {shownRuns.map((r) => {
                      const viewable = completed(r);
                      const t = r.totals;
                      return (
                        <tr key={r.id} className="border-b border-line align-top">
                          <td className="px-2.5 py-2.5 whitespace-nowrap">
                            {formatIst(r.startedAt)}
                            <div className="text-[12px] text-muted">
                              #{r.id} · {r.trigger}
                              {r.triggeredBy ? ` by ${r.triggeredBy}` : ''}
                            </div>
                          </td>
                          <td className="px-2.5 py-2.5">
                            {r.source === 'development' ? <span className="font-semibold text-bad">Development data</span> : 'Meta'}
                          </td>
                          <td className={`px-2.5 py-2.5 font-semibold ${STATUS_CLASS[r.status]}`}>
                            {r.status}
                            {r.error && <div className="max-w-[340px] text-[12px] font-normal text-bad">{r.error}</div>}
                          </td>
                          <td className="px-2.5 py-2.5 tabular-nums">{t.campaigns}</td>
                          <td className="px-2.5 py-2.5 tabular-nums whitespace-nowrap">
                            <span className="text-good">{t.good}</span> / <span className="text-avg">{t.average}</span> /{' '}
                            <span className="text-bad">{t.bad}</span> / <span className="text-neutral">{t.notRated}</span>
                          </td>
                          <td className="px-2.5 py-2.5 tabular-nums whitespace-nowrap">
                            <span className="text-good">{t.following}</span> / <span className="text-avg">{t.partlyFollowing}</span> /{' '}
                            <span className="text-bad">{t.notFollowing}</span> / <span className="text-neutral">{t.needsReview}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-[13px]">
                            {r.accounts.map((a) => (
                              <div key={a.metaAccountId} className={a.status === 'failed' ? 'text-bad' : 'text-muted'}>
                                {a.name}
                                {a.status === 'failed' ? ' — failed' : ''}
                                {a.notes.map((n) => (
                                  <div key={n} className="max-w-[340px] text-[12px] text-avg">{n}</div>
                                ))}
                              </div>
                            ))}
                          </td>
                          <td className="px-2.5 py-2.5 whitespace-nowrap">
                            {viewable && (
                              <div className="flex items-center gap-3 text-[14px] font-semibold">
                                <Link to={`/?run=${r.id}`} className="text-brand hover:underline">
                                  View
                                </Link>
                                <ExportMenu
                                  label="Export"
                                  datasets={['dashboard', 'tracker', 'rules', 'failed', 'manual', 'accounts', 'objectives', 'performance', 'creatives', 'adsets']}
                                  params={{ runId: r.id }}
                                  hideScope
                                />
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </Section>
          <Section title="Compare two audits" intro="See how ratings and SOP compliance moved between two audits.">
            <Card>
              <CompareAudits key={state.data.runs.find(completed)?.id ?? 'none'} runs={state.data.runs} />
            </Card>
          </Section>
        </>
      )}
      <Section title="Recent exports" intro={hasRole(user, 'admin') ? 'Files generated by everyone, kept on the server.' : 'Files you generated, kept on the server.'}>
        <Card>
          <RecentExports isAdmin={hasRole(user, 'admin')} />
        </Card>
      </Section>
    </main>
  );
}
