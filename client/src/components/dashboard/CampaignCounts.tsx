import { DELIVERY_LABEL, type AccountCampaignCounts, type CampaignCountsSummary, type DeliveryState } from '@sop/shared';
import { formatIst, formatRelative } from '../../lib/format';
import { Card } from '../ui/Card';

const n = (v: number | null) => (v === null ? '–' : v.toLocaleString('en-IN'));
const NOT_DELIVERING: Exclude<DeliveryState, 'DELIVERING'>[] = ['NO_ACTIVE_ADS', 'NO_ACTIVE_AD_SETS', 'ENDED', 'SCHEDULED', 'UNKNOWN'];

function notDeliveringText(r: AccountCampaignCounts): string {
  const parts = NOT_DELIVERING.filter((k) => r.notDelivering[k] > 0).map((k) => `${r.notDelivering[k]} ${DELIVERY_LABEL[k].toLowerCase()}`);
  return parts.length ? parts.join(', ') : '–';
}

/**
 * Campaign counts per ad account and for all accounts, from the same Meta ad accounts and
 * statuses as Ads Manager. "Active in Ads Manager" = delivering; "Meta status Active" = what the
 * tracker audits.
 */
export function CampaignCounts({ counts }: { counts: CampaignCountsSummary }) {
  const rows = [...counts.accounts, ...(counts.accounts.length > 1 ? [counts.all] : [])];
  const head = ['Ad account', 'Total campaigns', 'Active in Ads Manager', 'Meta status Active (audited)', 'Status Active, not delivering', 'Paused', 'Archived', 'Deleted', 'Other', 'Check'];
  const anyMissing = counts.accounts.some((r) => r.total === null);
  const deletedMissing = counts.accounts.some((r) => r.deletedIncluded === false);

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-head text-navy">
              {head.map((h, i) => (
                <th key={h} className={`px-2.5 py-2 font-semibold ${i === 0 || i === 4 || i === 9 ? 'text-left' : 'text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const all = r.metaAccountId === 'all';
              return (
                <tr key={r.metaAccountId} className={`border-b border-line ${all ? 'bg-head/40 font-semibold' : ''}`}>
                  <td className="px-2.5 py-2">
                    {r.name}
                    {!all && <span className="block text-[12px] font-normal text-muted">{r.metaAccountId}</span>}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{n(r.total)}</td>
                  <td className="px-2.5 py-2 text-right font-semibold tabular-nums text-good">{counts.deliveryKnown ? n(r.delivering) : '–'}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{n(r.audited)}</td>
                  <td className="px-2.5 py-2 text-[13px] text-muted">{counts.deliveryKnown ? notDeliveringText(r) : 'Refresh to see'}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{n(r.paused)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{n(r.archived)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{r.deletedIncluded === false ? 'not listed' : n(r.deleted)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{n(r.other)}</td>
                  <td className="px-2.5 py-2 text-[13px]">
                    {r.reconciled === null ? (
                      <span className="text-muted">No count</span>
                    ) : r.reconciled ? (
                      <span className="text-good" title="Meta's count of campaigns with status Active equals the campaigns audited">
                        ✓ Matches Meta
                      </span>
                    ) : (
                      <span className="text-avg" title="A campaign changed status during the refresh; refresh again">
                        Meta {n(r.active)} vs audited {r.audited}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 space-y-1 text-[13px] text-muted">
        <p>
          <b className="text-ink">Active in Ads Manager</b> = delivering: Meta status Active with at least one active ad in an active ad set
          that has not ended. <b className="text-ink">Meta status Active</b> also includes campaigns whose ad sets or ads are off, that have
          ended or are scheduled; all of these are audited for the SOP. <b className="text-ink">Total</b> = every campaign in the ad account,
          counted once per campaign ID, in all statuses (Active, Paused, Archived, Deleted, Other = in process or with issues).
        </p>
        {anyMissing && <p>“–” in Total: this audit has no status count for that account (older audit or Meta refused); refresh to collect it.</p>}
        {deletedMissing && <p>Meta did not list deleted campaigns for one account, so its Total excludes them.</p>}
        <p>
          Last successful Meta sync:{' '}
          <b className="text-ink">{counts.lastSuccessfulSyncAt ? `${formatIst(counts.lastSuccessfulSyncAt)} (${formatRelative(counts.lastSuccessfulSyncAt)})` : 'none yet'}</b>
        </p>
      </div>
    </Card>
  );
}
