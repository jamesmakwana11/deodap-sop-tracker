import { DELIVERY_LABEL, EXCLUSION_REASONS, type AccountCampaignCounts, type CampaignCountsSummary } from '@sop/shared';
import { formatIst, formatRelative } from '../../lib/format';
import { Card } from '../ui/Card';

const n = (v: number | null) => (v === null ? '–' : v.toLocaleString('en-IN'));

function excludedText(r: AccountCampaignCounts): string {
  const parts = EXCLUSION_REASONS.filter((k) => r.excluded[k] > 0).map((k) => `${r.excluded[k]} ${DELIVERY_LABEL[k].toLowerCase()}`);
  return parts.length ? parts.join(', ') : '–';
}

/**
 * Campaign counts per ad account and for all accounts. Active = strictly active (campaign, every
 * ad set and every ad Active); Total = every campaign in all statuses, counted once per campaign ID.
 */
export function CampaignCounts({ counts }: { counts: CampaignCountsSummary }) {
  const rows = [...counts.accounts, ...(counts.accounts.length > 1 ? [counts.all] : [])];
  const head = ['Ad account', 'Total campaigns', 'Active campaigns', 'Campaign status Active (audited)', 'Not counted as Active', 'Paused', 'Archived', 'Other', 'Check'];
  const anyMissing = counts.accounts.some((r) => r.total === null);

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-head text-navy">
              {head.map((h, i) => (
                <th key={h} className={`px-2.5 py-2 font-semibold ${i === 0 || i === 4 || i === 8 ? 'text-left' : 'text-right'}`}>
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
                  <td className="px-2.5 py-2 text-right font-semibold tabular-nums text-good">{counts.activeKnown ? n(r.active) : '–'}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{n(r.audited)}</td>
                  <td className="px-2.5 py-2 text-[13px] text-muted">{counts.activeKnown ? excludedText(r) : 'Refresh now to check'}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{n(r.paused)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{n(r.archived)}</td>
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
                        Meta {n(r.metaActive)} vs audited {r.audited}
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
          <b className="text-ink">Active campaigns</b> = the campaign, every one of its ad sets and every one of its ads have Meta status
          Active (effective_status). A campaign with even one paused, off, archived, in-review or in-process ad set or ad is not
          counted, nor is one that has ended or not started. <b className="text-ink">Campaign status Active</b> = every campaign whose own
          status is Active; all are audited for the SOP and can be shown with “Show: All with campaign status Active”.{' '}
          <b className="text-ink">Total</b> = every campaign in the ad account, counted once per campaign ID, in all statuses (Active,
          Paused, Archived, Other = in process or with issues). Deleted campaigns, ad sets and ads are not current data: Meta does not
          list them and they are not counted; earlier audits keep them in History. Unpublished drafts are not campaigns yet and are not
          counted.
        </p>
        {anyMissing && <p>“–” in Total: this audit has no status count for that account (older audit or Meta refused); refresh to collect it.</p>}
        <p>
          Last successful Meta sync:{' '}
          <b className="text-ink">{counts.lastSuccessfulSyncAt ? `${formatIst(counts.lastSuccessfulSyncAt)} (${formatRelative(counts.lastSuccessfulSyncAt)})` : 'none yet'}</b>
        </p>
      </div>
    </Card>
  );
}
