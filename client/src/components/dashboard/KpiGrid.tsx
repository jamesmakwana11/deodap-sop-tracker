import type { CampaignCountsSummary, DashboardTotals } from '@sop/shared';

interface Kpi {
  value: number;
  label: string;
  sub?: string;
  accent: string;
  valueColor: string;
}

function StatCard({ value, label, sub, accent, valueColor }: Kpi) {
  return (
    <div className={`rounded-xl border border-line border-t-4 bg-white px-4 pb-3.5 pt-3 ${accent}`}>
      <div className={`font-serif text-[34px] font-semibold leading-tight tabular-nums ${valueColor}`}>{value}</div>
      <div className="text-[14px] text-muted">{label}</div>
      {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

const GRID: Record<number, string> = { 8: '2xl:grid-cols-8', 9: '2xl:grid-cols-9', 10: '2xl:grid-cols-10' };

export function KpiGrid({ totals, counts }: { totals: DashboardTotals; counts?: CampaignCountsSummary }) {
  // Active campaigns = strictly active: the campaign, every ad set and every ad Active (Meta effective_status).
  // totals come from the same strict set, so the rating and SOP tiles add up to it.
  const strict = counts?.activeKnown !== false;
  const total = counts?.all.total ?? null;
  const kpis: Kpi[] = [
    {
      value: totals.active,
      label: 'Active campaigns',
      sub: strict ? undefined : 'Refresh now to check ad sets and ads',
      accent: 'border-t-brand',
      valueColor: 'text-brand',
    },
    ...(total !== null ? [{ value: total, label: 'Total campaigns (all statuses)', accent: 'border-t-navy', valueColor: 'text-navy' }] : []),
    { value: totals.good, label: 'Rated Good', accent: 'border-t-good', valueColor: 'text-good' },
    { value: totals.average, label: 'Rated Average', accent: 'border-t-[#e3a400]', valueColor: 'text-avg' },
    { value: totals.bad, label: 'Rated Bad', accent: 'border-t-bad', valueColor: 'text-bad' },
    { value: totals.notRated, label: 'Not rated', accent: 'border-t-slate-400', valueColor: 'text-neutral' },
    { value: totals.following, label: 'Following SOP', accent: 'border-t-good', valueColor: 'text-good' },
    { value: totals.partlyFollowing, label: 'Partly following SOP', accent: 'border-t-[#e3a400]', valueColor: 'text-avg' },
    { value: totals.notFollowing, label: 'Not following SOP', accent: 'border-t-bad', valueColor: 'text-bad' },
  ];
  if (totals.needsReview > 0) {
    kpis.push({ value: totals.needsReview, label: 'SOP needs review', accent: 'border-t-slate-400', valueColor: 'text-neutral' });
  }

  return (
    <div className={`mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 ${GRID[kpis.length] ?? '2xl:grid-cols-5'}`}>
      {kpis.map((k) => (
        <StatCard key={k.label} {...k} />
      ))}
    </div>
  );
}
