import { META_DELIVERY_LABEL, META_DELIVERY_REASONS, type AccountCampaignCounts, type CampaignCountsSummary } from '@sop/shared';
import { Card } from '../ui/Card';

const n = (v: number | null | undefined) => (v === null || v === undefined ? '–' : v.toLocaleString('en-IN'));

interface Line {
  label: string;
  value: (r: AccountCampaignCounts) => number | null | undefined;
  note?: string;
  strong?: boolean;
  indent?: boolean;
}
interface Group {
  title: string;
  lines: Line[];
}

/**
 * Account-wise reconciliation: what Meta's API returned for the campaign list, and how each
 * dashboard number is made from it, so any difference from Ads Manager can be traced.
 */
export function CountReconciliation({ counts }: { counts: CampaignCountsSummary }) {
  const cols = [...counts.accounts, ...(counts.accounts.length > 1 ? [counts.all] : [])];
  if (!cols.some((r) => r.raw)) {
    return (
      <Card>
        <p className="text-[14px] text-muted">The reconciliation is recorded from the next Meta refresh on.</p>
      </Card>
    );
  }
  const other = (r: AccountCampaignCounts) => (r.raw ? Object.entries(r.raw.byStatus).filter(([k]) => !['ACTIVE', 'PAUSED', 'ARCHIVED'].includes(k)).reduce((s, [, v]) => s + v, 0) : null);
  const groups: Group[] = [
    {
      title: 'Raw Meta API: campaign list (every status except deleted, all pages)',
      lines: [
        { label: 'Pages read', value: (r) => r.raw?.pages },
        { label: 'Rows returned', value: (r) => r.raw?.rows },
        { label: 'Duplicate rows removed (same campaign ID twice)', value: (r) => r.raw?.duplicateRows },
        { label: 'Rows from another ad account removed', value: (r) => r.raw?.otherAccountRows },
        { label: 'Unique campaigns', value: (r) => r.total, strong: true },
        { label: 'status (set by advertiser): Active', value: (r) => r.raw?.byStatus.ACTIVE ?? 0, indent: true },
        { label: 'status: Paused', value: (r) => r.raw?.byStatus.PAUSED ?? 0, indent: true },
        { label: 'status: Archived', value: (r) => r.raw?.byStatus.ARCHIVED ?? 0, indent: true },
        { label: 'status: other', value: other, indent: true },
        { label: 'effective_status: Active', value: (r) => r.metaActive, indent: true },
        { label: 'effective_status: Paused', value: (r) => r.paused, indent: true },
        { label: 'effective_status: Archived', value: (r) => r.archived, indent: true },
        { label: 'effective_status: In process / with issues', value: (r) => r.other, indent: true },
        { label: 'Campaigns whose status and effective_status differ', value: (r) => r.raw?.statusDiffers },
      ],
    },
    {
      title: 'Dashboard numbers made from it',
      lines: [
        { label: 'Total campaigns (not archived)', value: (r) => r.notArchived, strong: true, note: 'Unique campaigns − Archived. Ads Manager hides archived campaigns.' },
        { label: 'Campaign status Active', value: (r) => r.metaActive, note: 'effective_status Active; all audited for the SOP' },
        { label: 'Delivering = Active in Ads Manager', value: (r) => r.delivering, strong: true, note: 'At least one active ad in an active, running ad set' },
        ...META_DELIVERY_REASONS.map(
          (k): Line => ({ label: `Status Active, not delivering: ${META_DELIVERY_LABEL[k].toLowerCase()}`, value: (r) => r.notDelivering[k], indent: true }),
        ),
        { label: 'Active campaigns (strict, dashboard tile)', value: (r) => (counts.activeKnown ? r.active : null), strong: true, note: 'Campaign, every ad set and every ad Active' },
        {
          label: 'Delivering but not strict (some ad set or ad off)',
          value: (r) => (r.delivering !== null && counts.activeKnown ? r.delivering - r.active : null),
          indent: true,
        },
      ],
    },
  ];

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-head text-navy">
              <th className="px-2.5 py-2 text-left font-semibold">Count</th>
              {cols.map((r) => (
                <th key={r.metaAccountId} className="px-2.5 py-2 text-right font-semibold">
                  {r.name}
                  {r.metaAccountId !== 'all' && <span className="block text-[12px] font-normal text-muted">{r.metaAccountId}</span>}
                </th>
              ))}
              <th className="px-2.5 py-2 text-left font-semibold">How it is made</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.title}>
              <tr>
                <td colSpan={cols.length + 2} className="px-2.5 pt-3 pb-1 text-[12px] font-semibold tracking-wide text-navy uppercase">
                  {g.title}
                </td>
              </tr>
              {g.lines.map((l) => (
                <tr key={l.label} className="border-b border-line">
                  <td className={`px-2.5 py-1.5 ${l.indent ? 'pl-6 text-muted' : ''} ${l.strong ? 'font-semibold' : ''}`}>{l.label}</td>
                  {cols.map((r) => (
                    <td key={r.metaAccountId} className={`px-2.5 py-1.5 text-right tabular-nums ${l.strong ? 'font-semibold' : ''}`}>
                      {n(l.value(r))}
                    </td>
                  ))}
                  <td className="px-2.5 py-1.5 text-[13px] text-muted">{l.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="mt-3 text-[13px] text-muted">
        Counts come from the latest audit only, one per campaign ID; earlier audits stay in History. Deleted campaigns and unpublished
        drafts are not counted. If Ads Manager still shows a different number, compare with its filters (archived, date range) and the
        time it was read.
      </p>
    </Card>
  );
}
