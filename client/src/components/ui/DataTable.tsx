import type { ReactNode } from 'react';

/** Shared table look: tinted header row, hairline row dividers, numeric columns right-aligned. */
export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'Nothing to show yet.',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="bg-head text-navy">
            {columns.map((c) => (
              <th key={c.key} className={`px-2.5 py-2.5 font-semibold ${ALIGN[c.align ?? 'left']} ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-2.5 py-6 text-center text-muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-line last:border-b-0">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-2.5 py-2.5 tabular-nums ${ALIGN[c.align ?? 'left']} ${c.className ?? ''}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
