import { formatIst } from '@sop/shared';
import type { Cell, ExportColumn } from './types.js';

const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const rupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** Display text for PDF and Word. */
export function cellText(col: ExportColumn, v: Cell): string {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '–';
    if (col.type === 'money') return `₹${rupees.format(v)}`;
    if (col.type === 'percent') return `${Math.round(v)}%`;
    return num.format(v);
  }
  if (col.type === 'datetime') return isIso(v) ? formatIst(v) : v;
  return v;
}

const isIso = (v: string) => /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));

/** "2026-11-06 13:39" in IST: sortable and unambiguous in a spreadsheet. */
export function istSortable(iso: string): string {
  const d = new Date(Date.parse(iso) + 5.5 * 3600_000);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

/** Plain values for CSV: numbers stay numbers, dates become IST "YYYY-MM-DD HH:mm". */
export function cellPlain(col: ExportColumn, v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
  if (col.type === 'datetime' && isIso(v)) return istSortable(v);
  return v;
}

/** IST wall-clock Date for Excel (Excel has no time zones). */
export function istDate(iso: string): Date | null {
  return isIso(iso) ? new Date(Date.parse(iso) + 5.5 * 3600_000) : null;
}

/** Relative column width: the hint, but never narrower than the longest word of the header. */
export function columnWeight(col: ExportColumn): number {
  const longestWord = Math.max(...col.header.split(/\s+/).map((w) => w.length));
  return Math.max(col.width ?? 14, longestWord + 2);
}

const longestWordOf = (text: string) => text.split(/\s+/).reduce((a, w) => (w.length > a.length ? w : a), '');
export const longestHeaderWord = (col: ExportColumn) => longestWordOf(col.header);

/** Longest word among a column's values (first 500 rows), capped so one long URL cannot take the page. */
export function longestValueWord(col: ExportColumn, rows: Record<string, Cell>[], cap = 15): string {
  let best = '';
  for (const r of rows.slice(0, 500)) {
    const w = longestWordOf(cellText(col, r[col.key] ?? null));
    if (w.length > best.length) best = w;
  }
  return best.slice(0, cap);
}

/**
 * Splits `total` across columns in proportion to their weights, but gives every column at
 * least its minimum (so words do not break mid-word), taking the space from wider ones.
 * When even the minimums do not fit, they are scaled down together.
 */
export function fitWidths(weights: number[], mins: number[], total: number): number[] {
  const minSum = mins.reduce((a, b) => a + b, 0);
  if (minSum >= total) return mins.map((m) => (m / minSum) * total);
  const fixed = weights.map(() => false);
  for (;;) {
    const fixedTotal = mins.reduce((a, m, i) => a + (fixed[i] ? m : 0), 0);
    const freeWeight = weights.reduce((a, w, i) => a + (fixed[i] ? 0 : w), 0);
    const widths = weights.map((w, i) => (fixed[i] ? mins[i]! : (w / freeWeight) * (total - fixedTotal)));
    const short = widths.map((w, i) => !fixed[i] && w < mins[i]!);
    if (!short.some(Boolean)) return widths;
    short.forEach((s, i) => s && (fixed[i] = true));
  }
}
