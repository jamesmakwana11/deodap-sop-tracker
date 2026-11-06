/** A format-neutral report: titled tables and notes, rendered to PDF, Excel, Word or CSV. */

export type Cell = string | number | null;

export interface ExportColumn {
  key: string;
  header: string;
  /** percent values are 0–100; money is rupees; datetime is an ISO string. */
  type?: 'text' | 'number' | 'money' | 'percent' | 'datetime';
  /** Relative width hint in characters. */
  width?: number;
}

export interface ExportTable {
  kind: 'table';
  title: string;
  columns: ExportColumn[];
  rows: Record<string, Cell>[];
  note?: string;
}

export interface ExportText {
  kind: 'text';
  title?: string;
  text: string;
}

export type ExportSection = ExportTable | ExportText;

export interface ExportDoc {
  title: string;
  /** Used in the file name, e.g. "campaign-tracker". */
  fileStem: string;
  /** Lines under the title: audit, filters, period, who generated it. */
  meta: string[];
  devData: boolean;
  sections: ExportSection[];
  /** The table a CSV contains. */
  primary: ExportTable;
  runId: string | null;
}

export const table = (title: string, columns: ExportColumn[], rows: Record<string, Cell>[], note?: string): ExportTable => ({
  kind: 'table',
  title,
  columns,
  rows,
  note,
});

/** Two-column field/value table for key facts. */
export const facts = (title: string, pairs: [string, Cell][]): ExportTable =>
  table(title, [{ key: 'field', header: 'Field', width: 28 }, { key: 'value', header: 'Value', width: 70 }], pairs.map(([field, value]) => ({ field, value })));
