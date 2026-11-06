import type { CampaignHistoryPoint } from '@sop/shared';
import { Link } from 'react-router-dom';
import { formatIst, formatMainMetric, formatPercent, formatRupees } from '../../lib/format';
import { RATING_TONE, SOP_STATUS_TONE } from '../../lib/labels';

/** SOP % across audits as a small line, plus the full table. */
function SopTrend({ points }: { points: CampaignHistoryPoint[] }) {
  const values = points.map((p) => p.sopPercent);
  if (values.filter((v) => v !== null).length < 2) return null;
  const w = 320;
  const h = 64;
  const x = (i: number) => (points.length === 1 ? w / 2 : 8 + (i * (w - 16)) / (points.length - 1));
  const y = (v: number) => 6 + ((100 - v) * (h - 12)) / 100;
  const path = values
    .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
    .filter(Boolean)
    .join(' L ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-80" role="img" aria-label="SOP % across audits">
      <line x1="0" x2={w} y1={y(100)} y2={y(100)} stroke="var(--color-line)" />
      <line x1="0" x2={w} y1={y(75)} y2={y(75)} stroke="var(--color-line)" strokeDasharray="3 3" />
      <path d={`M ${path}`} fill="none" stroke="var(--color-brand)" strokeWidth="2" />
      {values.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="var(--color-brand)" />))}
    </svg>
  );
}

export function CampaignHistory({ points, currentId }: { points: CampaignHistoryPoint[]; currentId: string }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <SopTrend points={points} />
        <span>SOP % per audit (dashed line = 75%, the Partly-following floor).</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-head text-left text-navy">
              <th className="px-2.5 py-2 font-semibold">Audit</th>
              <th className="px-2.5 py-2 font-semibold">Rating</th>
              <th className="px-2.5 py-2 text-right font-semibold">Spend, 7 days</th>
              <th className="px-2.5 py-2 font-semibold">Main metric</th>
              <th className="px-2.5 py-2 text-right font-semibold">SOP %</th>
              <th className="px-2.5 py-2 font-semibold">SOP status</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.campaignAuditId} className={`border-b border-line ${p.campaignAuditId === currentId ? 'bg-head/40' : ''}`}>
                <td className="px-2.5 py-2">
                  {p.campaignAuditId === currentId ? (
                    <span className="font-semibold">{formatIst(p.at)} (this audit)</span>
                  ) : (
                    <Link className="text-brand hover:underline" to={`/campaigns/${p.campaignAuditId}`}>
                      {formatIst(p.at)}
                    </Link>
                  )}
                </td>
                <td className={`px-2.5 py-2 font-semibold ${RATING_TONE[p.rating].text}`}>{RATING_TONE[p.rating].label}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{formatRupees(p.spend7d)}</td>
                <td className="px-2.5 py-2 tabular-nums">{formatMainMetric(p.mainMetric)}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{formatPercent(p.sopPercent)}</td>
                <td className={`px-2.5 py-2 font-semibold ${SOP_STATUS_TONE[p.sopStatus].text}`}>{SOP_STATUS_TONE[p.sopStatus].label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
