import type { DashboardTotals } from '@sop/shared';

interface Kpi {
  value: number;
  label: string;
  accent: string;
  valueColor: string;
}

function StatCard({ value, label, accent, valueColor }: Kpi) {
  return (
    <div className={`rounded-xl border border-line border-t-4 bg-white px-4 pb-3.5 pt-3 ${accent}`}>
      <div className={`font-serif text-[34px] font-semibold leading-tight tabular-nums ${valueColor}`}>{value}</div>
      <div className="text-[14px] text-muted">{label}</div>
    </div>
  );
}

export function KpiGrid({ totals }: { totals: DashboardTotals }) {
  const kpis: Kpi[] = [
    { value: totals.active, label: 'Active campaigns', accent: 'border-t-brand', valueColor: 'text-brand' },
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
    <div className={`mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 ${kpis.length > 8 ? '2xl:grid-cols-9' : '2xl:grid-cols-8'}`}>
      {kpis.map((k) => (
        <StatCard key={k.label} {...k} />
      ))}
    </div>
  );
}
