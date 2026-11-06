import { MANUAL_CHECKS, PERFORMANCE_WINDOW_DAYS, RATING_RULES } from '@sop/shared';
import { joinWithAnd } from '../../lib/format';
import { Card } from '../ui/Card';

/** Static explanation of how ratings and SOP compliance are judged. */
export function JudgingRules() {
  return (
    <>
      <Card title="Rating rule for each objective (main metric)">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-head text-left text-navy">
                <th className="px-2.5 py-2.5 font-semibold">Objective</th>
                <th className="px-2.5 py-2.5 font-semibold">Main metric</th>
                <th className="px-2.5 py-2.5 font-semibold">Good</th>
                <th className="px-2.5 py-2.5 font-semibold">Average</th>
                <th className="px-2.5 py-2.5 font-semibold">Bad</th>
              </tr>
            </thead>
            <tbody>
              {RATING_RULES.map((r) => (
                <tr key={r.objective} className="border-b border-line last:border-b-0">
                  <td className="px-2.5 py-2.5">{r.objective}</td>
                  <td className="px-2.5 py-2.5">{r.metricLabel}</td>
                  <td className="bg-good-bg px-2.5 py-2.5 font-semibold text-good">{r.goodText}</td>
                  <td className="bg-avg-bg px-2.5 py-2.5 font-semibold text-avg">{r.averageText}</td>
                  <td className="bg-bad-bg px-2.5 py-2.5 font-semibold text-bad">{r.badText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 space-y-3 text-[14px] leading-relaxed text-muted">
        <p>
          Performance uses the last {PERFORMANCE_WINDOW_DAYS} days of Meta insights. Campaigns with no spend in that period
          are Not rated, and a campaign without enough data is never given an invented rating.
        </p>
        <p>
          SOP compliance is the share of checkable settings that pass: passed ÷ (passed + failed). All pass is Following
          SOP; a quarter or fewer failing is Partly following; more than a quarter failing is Not following. Settings Meta
          does not expose, and rules that do not apply, are left out of the score. A campaign with nothing checkable is
          marked Needs review.
        </p>
        <p>
          Naming passes a name that carries the objective, the creative format and a date; separators are not enforced.
          Frequency control is read from each ad set, and an ad set with no cap counts as failing.
        </p>
        <p>
          Not checkable from Meta data: {joinWithAnd(MANUAL_CHECKS.map((m, i) => (i === 0 ? m : m.toLowerCase())))}.
          These need a person to verify them and are never marked as passing automatically.
        </p>
      </div>
    </>
  );
}
