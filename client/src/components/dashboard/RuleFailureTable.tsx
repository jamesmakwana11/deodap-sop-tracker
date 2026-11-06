import type { RuleFailureRow } from '@sop/shared';
import { formatPercent } from '../../lib/format';
import { Card } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';

function FailRateBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-muted">–</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-[70px] overflow-hidden rounded-full bg-head" aria-hidden>
        <div className="h-full rounded-full bg-bad" style={{ width: `${Math.max(rate * 100, rate > 0 ? 3 : 0)}%` }} />
      </div>
      <span className="w-10 tabular-nums">{formatPercent(rate * 100)}</span>
    </div>
  );
}

const columns: Column<RuleFailureRow>[] = [
  { key: 'label', header: 'Check', cell: (r) => r.label, className: 'whitespace-nowrap' },
  { key: 'rule', header: 'SOP rule', cell: (r) => r.rule, className: 'min-w-[320px]' },
  { key: 'pass', header: 'Pass', cell: (r) => r.pass, align: 'right' },
  { key: 'fail', header: 'Fail', cell: (r) => r.fail, align: 'right' },
  { key: 'nc', header: 'Not checkable', cell: (r) => r.notCheckable, align: 'right', className: 'whitespace-nowrap' },
  { key: 'na', header: 'Not applicable', cell: (r) => r.notApplicable, align: 'right', className: 'whitespace-nowrap' },
  { key: 'rate', header: 'Fail rate', cell: (r) => <FailRateBar rate={r.failRate} /> },
];

export function RuleFailureTable({ rows }: { rows: RuleFailureRow[] }) {
  return (
    <Card>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} />
    </Card>
  );
}
