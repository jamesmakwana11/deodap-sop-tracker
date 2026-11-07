import { filterCampaigns, isSortKey, sortCampaigns, type DashboardResponse } from '@sop/shared';
import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CampaignTrackerTable } from '../components/dashboard/CampaignTrackerTable';
import { DevDataBanner } from '../components/dashboard/DevDataBanner';
import { GroupSummaryTable } from '../components/dashboard/GroupSummaryTable';
import { JudgingRules } from '../components/dashboard/JudgingRules';
import { CampaignCounts } from '../components/dashboard/CampaignCounts';
import { KpiGrid } from '../components/dashboard/KpiGrid';
import { PageHeader } from '../components/dashboard/PageHeader';
import { RuleFailureTable } from '../components/dashboard/RuleFailureTable';
import { ErrorState, LoadingState, NoDataState } from '../components/dashboard/StatusPanels';
import { toSearchParams, TrackerToolbar, type TrackerQuery } from '../components/dashboard/TrackerToolbar';
import { ExportMenu } from '../components/ui/ExportMenu';
import { Section } from '../components/ui/Section';
import { useApi } from '../hooks/useApi';
import { formatIst } from '../lib/format';
import { useSync } from '../sync/SyncContext';

function readQuery(p: URLSearchParams): TrackerQuery {
  const sort = p.get('sort');
  return {
    accountId: p.get('accountId') ?? undefined,
    rating: (p.get('rating') as TrackerQuery['rating']) ?? undefined,
    objective: (p.get('objective') as TrackerQuery['objective']) ?? undefined,
    sopStatus: (p.get('sopStatus') as TrackerQuery['sopStatus']) ?? undefined,
    search: p.get('search') ?? undefined,
    activity: p.get('activity') === 'all' ? 'all' : undefined,
    sort: isSortKey(sort) ? sort : 'spend_desc',
  };
}

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const runParam = params.get('run');
  const query = readQuery(params);
  const { finishedVersion } = useSync();
  const state = useApi<DashboardResponse>(`/dashboard${runParam ? `?runId=${encodeURIComponent(runParam)}` : ''}`);
  const data = state.data;

  // When a Meta refresh finishes, the latest view reloads itself.
  const { reload } = state;
  useEffect(() => {
    if (!runParam && finishedVersion > 0) reload();
  }, [finishedVersion, runParam, reload]);

  const qs = params.toString();
  const shown = useMemo(() => {
    const q = readQuery(new URLSearchParams(qs));
    return data ? sortCampaigns(filterCampaigns(data.campaigns, q), q.sort) : [];
  }, [data, qs]);
  const objectives = useMemo(() => [...new Set(data?.campaigns.map((c) => c.objective) ?? [])], [data]);

  const setQuery = (q: TrackerQuery) => setParams(toSearchParams(q, { run: runParam ?? undefined }), { replace: true });
  // Exports use the audit on screen and the tracker filters as they are set now.
  const exportParams: Record<string, string | undefined> = {
    runId: data?.run?.id,
    ...Object.fromEntries(toSearchParams(query)),
  };

  return (
    <main className="mx-auto max-w-[1880px] px-4 py-6 sm:px-7">
      {data?.run?.source === 'development' && <DevDataBanner />}
      {runParam && data?.run && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-avg/40 bg-avg-bg px-4 py-2.5 text-[14px] text-avg">
          <span>
            Viewing an earlier audit from {formatIst(data.run.finishedAt ?? data.run.startedAt)}. Settings and performance are as
            they were then.
          </span>
          <Link to="/" className="font-semibold underline">
            Back to the latest audit
          </Link>
        </div>
      )}
      <PageHeader
        run={data?.run ?? null}
        action={
          data?.run ? (
            <ExportMenu
              label="Export dashboard"
              datasets={['dashboard', 'tracker', 'rules', 'failed', 'manual', 'accounts', 'objectives', 'performance', 'creatives', 'adsets']}
              params={exportParams}
            />
          ) : null
        }
      />

      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState message={state.error} onRetry={reload} />}
      {data && !data.run && <NoDataState />}

      {data?.run && (
        <>
          <KpiGrid totals={data.summary.totals} counts={data.counts} />
          <p className="mt-4 rounded-full border border-line bg-head/60 px-4 py-1.5 text-[14px] text-ink">
            The SOP has three levels only: Good, Average and Bad. It has no “Best” level, so none is shown.
          </p>

          {data.counts && data.run.source === 'meta' && (
            <Section title="Campaign counts" intro="Per ad account and for all accounts. Active campaigns, ratings and SOP results below count only campaigns whose ad sets and ads are all Active; the tracker can show the rest with “Show”.">
              <CampaignCounts counts={data.counts} />
            </Section>
          )}

          <Section title="Where the account stands">
            <div className="grid gap-4 xl:grid-cols-2">
              <GroupSummaryTable
                title="By account"
                groupHeader="Account"
                rows={data.summary.byAccount}
                action={<ExportMenu datasets={['accounts']} params={exportParams} />}
              />
              <GroupSummaryTable
                title="By objective"
                groupHeader="Objective"
                rows={data.summary.byObjective}
                action={<ExportMenu datasets={['objectives']} params={exportParams} />}
              />
            </div>
          </Section>

          <Section
            title="Which SOP rules break most often"
            intro="One row per automated SOP check, across every active campaign. Fail rate counts only campaigns where the check could be evaluated."
            action={<ExportMenu datasets={['rules', 'failed']} params={exportParams} />}
          >
            <RuleFailureTable rows={data.summary.ruleFailures} />
          </Section>

          <Section title="Campaign tracker">
            <TrackerToolbar
              query={query}
              onChange={setQuery}
              accounts={data.run.accounts.length ? data.run.accounts : [...new Map(data.campaigns.map((c) => [c.account.id, c.account])).values()]}
              objectives={objectives}
              exportParams={exportParams}
            />
            <CampaignTrackerTable campaigns={shown} total={data.campaigns.length} />
          </Section>
        </>
      )}

      <Section
        title="How campaigns are judged"
        intro="Each campaign is rated on the main metric of its own objective, using the SOP’s “Definition of a good campaign”."
      >
        <JudgingRules />
      </Section>
    </main>
  );
}
