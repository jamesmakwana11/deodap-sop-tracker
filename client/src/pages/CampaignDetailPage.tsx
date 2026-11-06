import {
  BID_STRATEGY_LABEL,
  CHECK_OUTCOME_LABEL,
  hasRole,
  RATING_RULE_BY_METRIC,
  SOP_RULES,
  type AdSetDetail,
  type CampaignDetailResponse,
} from '@sop/shared';
import type { ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AdsGallery } from '../components/campaign/AdsGallery';
import { CampaignHistory } from '../components/campaign/CampaignHistory';
import { ManualChecksPanel } from '../components/campaign/ManualChecksPanel';
import { CheckGlyph } from '../components/dashboard/CheckCell';
import { DevDataBanner } from '../components/dashboard/DevDataBanner';
import { ErrorState } from '../components/dashboard/StatusPanels';
import { Card } from '../components/ui/Card';
import { Pill } from '../components/ui/controls';
import { DataTable, type Column } from '../components/ui/DataTable';
import { ExportMenu } from '../components/ui/ExportMenu';
import { Section } from '../components/ui/Section';
import { useApi } from '../hooks/useApi';
import { formatIst, formatMainMetric, formatPercent, formatRupees } from '../lib/format';
import { RATING_TONE, SOP_STATUS_TONE } from '../lib/labels';

const money = (v: number | null) => (v === null ? '–' : formatRupees(v));

const adSetColumns: Column<AdSetDetail>[] = [
  { key: 'name', header: 'Ad set', cell: (a) => <span className="font-semibold">{a.name}</span>, className: 'min-w-[180px]' },
  { key: 'budget', header: 'Daily budget', cell: (a) => (a.dailyBudget !== null ? money(a.dailyBudget) : a.lifetimeBudget !== null ? `${money(a.lifetimeBudget)} lifetime` : '–') },
  { key: 'bid', header: 'Bid strategy', cell: (a) => (a.bidStrategy ? BID_STRATEGY_LABEL[a.bidStrategy] ?? a.bidStrategy : '–') },
  { key: 'goal', header: 'Optimisation', cell: (a) => a.optimizationGoal?.replace(/_/g, ' ').toLowerCase() ?? '–' },
  { key: 'dco', header: 'Dynamic creative', cell: (a) => (a.isDynamicCreative === null ? '?' : a.isDynamicCreative ? <span className="font-semibold text-bad">On</span> : 'Off') },
  { key: 'pp', header: 'Placements', cell: (a) => a.publisherPlatforms?.join(', ') ?? <span className="text-bad">Automatic</span> },
  { key: 'freq', header: 'Frequency cap', cell: (a) => a.frequencyCap ?? '–' },
  { key: 'loc', header: 'Locations', cell: (a) => a.locations ?? '–', className: 'max-w-[220px]' },
  { key: 'ex', header: 'Excluded', cell: (a) => a.excludedLocations ?? '–', className: 'max-w-[260px] text-[13px] text-muted' },
];

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="text-[15px] text-ink">{children}</div>
    </div>
  );
}

export function CampaignDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = useApi<CampaignDetailResponse>(`/campaign-audits/${id}`);
  const d = state.data;

  if (state.status === 'error') {
    return (
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-7">
        <ErrorState message={state.error} onRetry={state.reload} />
      </main>
    );
  }
  if (!d) return <main className="p-10 text-center text-muted">Loading campaign…</main>;

  const a = d.audit;
  const rating = RATING_TONE[a.rating];
  const status = SOP_STATUS_TONE[a.compliance.status];
  const isDev = d.run.source === 'development';
  const exportParams = { runId: d.run.id, campaignId: a.id };

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-7">
      {isDev && <DevDataBanner />}
      <button
        type="button"
        onClick={() => (location.key !== 'default' ? navigate(-1) : navigate('/'))}
        className="text-[14px] font-semibold text-brand hover:underline"
      >
        ← Back
      </button>
      <header className="mt-3 rounded-2xl border border-line bg-hero px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-serif text-2xl font-semibold text-navy sm:text-3xl">{a.name}</h1>
          <ExportMenu label="Export campaign" datasets={['campaign', 'adsets', 'creatives', 'manual']} params={exportParams} />
        </div>
        <p className="mt-1 text-[14px] text-muted">
          {a.account.name} ({a.account.metaAccountId}) · {a.objective} ({a.objectiveRaw}) · Campaign ID {a.metaCampaignId} · Audit of{' '}
          {formatIst(d.run.finishedAt ?? d.run.startedAt)}
        </p>
      </header>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card title="Performance (last 7 days)">
          <div className="flex flex-wrap items-center gap-3">
            <Pill text={rating.text} bg={rating.bg}>
              {rating.label}
            </Pill>
            {a.ratingIndicative && <span className="text-[13px] text-muted">Indicative — Sales spend under ₹15,000</span>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Spend">{formatRupees(a.spend7d)}</Stat>
            <Stat label={a.mainMetric ? RATING_RULE_BY_METRIC[a.mainMetric.kind].metricLabel : 'Main metric'}>{formatMainMetric(a.mainMetric)}</Stat>
            <Stat label="Period">{d.run.periodStart && d.run.periodEnd ? `${d.run.periodStart} → ${d.run.periodEnd}` : '–'}</Stat>
          </div>
          {a.ratingNote && <p className="mt-3 text-[13px] text-muted">{a.ratingNote}</p>}
        </Card>
        <Card title="SOP compliance">
          <div className="flex flex-wrap items-center gap-3">
            <Pill text={status.text} bg={status.bg}>
              {status.label}
            </Pill>
            <span className="text-2xl font-semibold tabular-nums text-ink">{formatPercent(a.compliance.percent)}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Passed">{a.compliance.passed}</Stat>
            <Stat label="Failed">{a.compliance.failed}</Stat>
            <Stat label="Not checkable">{a.compliance.notCheckable}</Stat>
            <Stat label="Not applicable">{a.compliance.notApplicable}</Stat>
          </div>
          <p className="mt-3 text-[13px] text-muted">
            Manual checks: {a.manual.verified} verified, {a.manual.failed} failed, {a.manual.notApplicable} not applicable, {a.manual.pending} pending.
          </p>
        </Card>
      </div>

      <Section title="SOP checks">
        <Card>
          <ul>
            {SOP_RULES.map((r) => {
              const c = a.checks.find((x) => x.key === r.key);
              return (
                <li key={r.key} className={`flex gap-3 border-b border-line py-2.5 last:border-b-0 ${c?.outcome === 'FAIL' ? 'bg-bad-bg/50' : ''}`}>
                  <span className="w-6 text-center text-lg">
                    <CheckGlyph check={c} />
                  </span>
                  <div className="flex-1">
                    <div className="font-semibold text-ink">
                      {r.label} <span className="text-[13px] font-normal text-muted">· {CHECK_OUTCOME_LABEL[c?.outcome ?? 'NOT_CHECKABLE']}</span>
                    </div>
                    <div className="text-[13px] text-muted">{r.rule}</div>
                    {c?.detail && <div className={`mt-0.5 text-[14px] ${c.outcome === 'FAIL' ? 'text-bad' : 'text-ink'}`}>{c.detail}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </Section>

      <Section title="Campaign settings">
        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Status">{d.settings.effectiveStatus ?? '–'}</Stat>
            <Stat label="Buying type">{d.settings.buyingType ?? '–'}</Stat>
            <Stat label="Bid strategy">{d.settings.bidStrategy ? BID_STRATEGY_LABEL[d.settings.bidStrategy] ?? d.settings.bidStrategy : 'Set on ad sets'}</Stat>
            <Stat label="Campaign daily budget">{d.settings.dailyBudget !== null ? money(d.settings.dailyBudget) : 'Set on ad sets'}</Stat>
            <Stat label="Lifetime budget">{money(d.settings.lifetimeBudget)}</Stat>
            <Stat label="Started">{d.settings.startTime ? formatIst(d.settings.startTime) : '–'}</Stat>
          </div>
        </Card>
      </Section>

      <Section title={`Active ad sets (${d.adSets.length})`} action={<ExportMenu datasets={['adsets']} params={exportParams} />}>
        <Card>
          <DataTable columns={adSetColumns} rows={d.adSets} rowKey={(r) => r.id} empty={isDev ? 'Development data has no ad sets.' : 'No active ad sets were returned.'} />
        </Card>
      </Section>

      <Section
        title={`Active ads (${d.ads.length})`}
        intro="Images are the thumbnails Meta returned at audit time. Preview asks Meta for a live render."
        action={<ExportMenu label="Export creative audit" datasets={['creatives']} params={exportParams} />}
      >
        <AdsGallery ads={d.ads} canPreview={!isDev} />
      </Section>

      <Section title="Manual verification" action={<ExportMenu datasets={['manual']} params={exportParams} />}>
        <Card>
          <ManualChecksPanel
            metaCampaignId={a.metaCampaignId}
            checks={d.manualChecks}
            events={d.manualEvents}
            editable={hasRole(user, 'auditor')}
            onChange={(manualChecks, manualEvents) => {
              state.setData({ ...d, manualChecks, manualEvents });
              state.reload(); // refresh the manual summary and "what is off"
            }}
          />
        </Card>
      </Section>

      <Section title="History" action={<ExportMenu label="Export with history" datasets={['campaign']} params={exportParams} />}>
        <Card>
          <CampaignHistory points={d.history} currentId={a.id} />
        </Card>
      </Section>
    </main>
  );
}
