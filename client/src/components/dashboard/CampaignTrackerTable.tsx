import { MANUAL_CHECK_ITEMS, SALES_INDICATIVE_SPEND_INR, SOP_RULES, type CampaignAudit } from '@sop/shared';
import { Link } from 'react-router-dom';
import { formatMainMetric, formatPercent, formatRupees } from '../../lib/format';
import { RATING_TONE, SOP_STATUS_TONE } from '../../lib/labels';
import { CheckGlyph, CheckLegend } from './CheckCell';

const TH = 'sticky top-0 z-10 bg-head px-2.5 py-2.5 text-left font-semibold text-navy whitespace-nowrap';
const TD = 'px-2.5 py-2.5 align-top';

/** Campaign-level audit table. Each row opens the campaign's detail page. */
export function CampaignTrackerTable({ campaigns, total }: { campaigns: CampaignAudit[]; total: number }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <CheckLegend />
        <span className="text-[13px] text-muted">
          Showing {campaigns.length} of {total}
        </span>
      </div>
      <p className="mb-3 text-[13px] text-muted">
        <em>Indicative</em> marks a Sales campaign that spent under {formatRupees(SALES_INDICATIVE_SPEND_INR)} in the
        period; read its rating as a first look. Open a campaign for ad sets, ads, previews and manual checks.
      </p>

      <div className="max-h-[680px] overflow-auto rounded-xl border border-line bg-white">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className={TH}>Rating</th>
              <th className={`${TH} min-w-[260px]`}>Campaign</th>
              <th className={TH}>Account</th>
              <th className={TH}>Objective</th>
              <th className={`${TH} text-right`}>Spend, 7 days</th>
              <th className={TH}>Main metric</th>
              <th className={`${TH} text-right`}>SOP %</th>
              <th className={TH}>SOP status</th>
              {SOP_RULES.map((r) => (
                <th key={r.key} className={`${TH} text-center`} title={r.rule}>
                  {r.column}
                </th>
              ))}
              <th className={`${TH} min-w-[260px]`}>What is off</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={9 + SOP_RULES.length} className="px-3 py-8 text-center text-muted">
                  No campaigns match these filters.
                </td>
              </tr>
            )}
            {campaigns.map((c) => {
              const rating = RATING_TONE[c.rating];
              const status = SOP_STATUS_TONE[c.compliance.status];
              const manualDone = c.manual.verified + c.manual.notApplicable;
              return (
                <tr key={c.id} className="border-b border-line last:border-b-0 hover:bg-head/30">
                  <td className={`${TD} font-semibold ${rating.text} ${rating.bg}`} title={c.ratingNote ?? undefined}>
                    {rating.label}
                  </td>
                  <td className={TD}>
                    <Link to={`/campaigns/${c.id}`} className="text-ink hover:text-brand hover:underline">
                      {c.name}
                    </Link>
                    <span className={`mt-0.5 block text-[12px] ${c.manual.failed ? 'text-bad' : 'text-muted'}`}>
                      Manual checks {manualDone}/{MANUAL_CHECK_ITEMS.length}
                      {c.manual.failed ? ` · ${c.manual.failed} failed` : ''}
                    </span>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{c.account.name}</td>
                  <td className={`${TD} whitespace-nowrap`} title={c.objectiveRaw}>
                    {c.objective}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>{formatRupees(c.spend7d)}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`} title={c.ratingNote ?? undefined}>
                    {formatMainMetric(c.mainMetric)}
                    {c.ratingIndicative && <span className="block text-[12px] text-muted">indicative</span>}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>{formatPercent(c.compliance.percent)}</td>
                  <td className={`${TD} font-semibold ${status.text} ${status.bg}`}>{status.label}</td>
                  {SOP_RULES.map((r) => {
                    const check = c.checks.find((x) => x.key === r.key);
                    return (
                      <td key={r.key} className={`${TD} text-center ${check?.outcome === 'FAIL' ? 'bg-bad-bg' : ''}`}>
                        <CheckGlyph check={check} />
                      </td>
                    );
                  })}
                  <td className={`${TD} text-[13px] text-muted`}>
                    {c.whatIsOff.length === 0 ? (
                      '–'
                    ) : (
                      <ul className="space-y-0.5">
                        {c.whatIsOff.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
