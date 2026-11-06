import { cellPlain } from './cells.js';
import type { ExportDoc } from './types.js';

/**
 * CSV of the report's main table: UTF-8 with BOM (so Excel shows ₹ and names correctly),
 * CRLF line ends, RFC 4180 quoting. Text starting with = + - @ (or a tab / CR) is prefixed
 * with ' so a spreadsheet never runs it as a formula.
 */
export function renderCsv(doc: ExportDoc): Buffer {
  let { columns, rows } = doc.primary;
  // Development data is marked on every row, so a copied-out row can never pass as a Meta result.
  if (doc.devData && !columns.some((c) => c.key === 'source')) {
    columns = [{ key: '__data', header: 'Data' }, ...columns];
    rows = rows.map((r) => ({ __data: 'DEVELOPMENT DATA', ...r }));
  }
  const lines: string[] = [columns.map((c) => quote(c.header, false)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => {
      const v = row[c.key] ?? null;
      return quote(cellPlain(c, v), typeof v === 'number');
    }).join(','));
  }
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

function quote(value: string, isNumber: boolean): string {
  let v = value;
  if (!isNumber && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
}
