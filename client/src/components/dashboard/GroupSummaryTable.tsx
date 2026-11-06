import type { GroupSummaryRow } from '@sop/shared';
import type { ReactNode } from 'react';
import { formatPercent } from '../../lib/format';
import { Card } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';

/** Account-wise or objective-wise rollup. */
export function GroupSummaryTable({ title, groupHeader, rows, action }: { title: string; groupHeader: string; rows: GroupSummaryRow[]; action?: ReactNode }) {
  const columns: Column<GroupSummaryRow>[] = [
    { key: 'label', header: groupHeader, cell: (r) => r.label },
    { key: 'campaigns', header: 'Campaigns', cell: (r) => r.campaigns, align: 'right' },
    { key: 'good', header: 'Good', cell: (r) => r.good, align: 'right' },
    { key: 'average', header: 'Average', cell: (r) => r.average, align: 'right' },
    { key: 'bad', header: 'Bad', cell: (r) => r.bad, align: 'right' },
    { key: 'notRated', header: 'Not rated', cell: (r) => r.notRated, align: 'right' },
    { key: 'following', header: 'Following SOP', cell: (r) => r.following, align: 'right' },
    { key: 'avg', header: 'Avg SOP %', cell: (r) => formatPercent(r.avgSopPercent), align: 'right' },
  ];

  return (
    <Card title={title} action={action}>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} />
    </Card>
  );
}
