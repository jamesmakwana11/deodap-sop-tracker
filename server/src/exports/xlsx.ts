import ExcelJS from 'exceljs';
import { istDate } from './cells.js';
import type { ExportColumn, ExportDoc, ExportTable } from './types.js';

const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4EDFB' } };
const DEV_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1D6' } };

/** Excel sheet names: ≤ 31 characters, no []:*?/\ , unique within the workbook. */
export function sheetNames(titles: string[]): string[] {
  const used = new Set<string>(['about']);
  return titles.map((t) => {
    const base = t.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function numFmt(col: ExportColumn): string | undefined {
  if (col.type === 'money') return '"₹"#,##0;-"₹"#,##0';
  if (col.type === 'percent') return '0%';
  if (col.type === 'datetime') return 'dd mmm yyyy hh:mm "IST"';
  return undefined;
}

/**
 * Streams the workbook to disk row by row, so large exports never sit in memory.
 * Sheet "About" holds the report details; each table gets its own sheet.
 */
export async function renderXlsx(doc: ExportDoc, file: string): Promise<void> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: true, useSharedStrings: false });
  wb.creator = 'DeoDap SOP Campaign Tracker';
  wb.created = new Date();

  const about = wb.addWorksheet('About');
  about.columns = [{ width: 110 }];
  about.addRow([doc.title]).font = { bold: true, size: 14 };
  for (const line of doc.meta) {
    const r = about.addRow([line]);
    if (doc.devData && line.startsWith('DEVELOPMENT')) {
      r.getCell(1).fill = DEV_FILL;
      r.font = { bold: true };
    }
    r.commit();
  }
  about.addRow([]).commit();
  const tables = doc.sections.filter((s): s is ExportTable => s.kind === 'table');
  const names = sheetNames(tables.map((t) => t.title));
  about.addRow(['Sheets in this workbook']).font = { bold: true };
  tables.forEach((t, i) => about.addRow([`${names[i]} — ${t.rows.length} row${t.rows.length === 1 ? '' : 's'}`]).commit());
  for (const s of doc.sections) {
    if (s.kind === 'text') {
      about.addRow([]).commit();
      if (s.title) about.addRow([s.title]).font = { bold: true };
      const r = about.addRow([s.text]);
      r.alignment = { wrapText: true, vertical: 'top' };
      r.commit();
    }
  }
  about.commit();

  tables.forEach((t, i) => {
    const ws = wb.addWorksheet(names[i]!, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = t.columns.map((c) => ({ header: c.header, key: c.key, width: Math.min(Math.max(c.width ?? 14, c.header.length + 2), 60), style: numFmt(c) ? { numFmt: numFmt(c) } : {} }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FF14306B' } };
    head.fill = HEAD_FILL;
    head.alignment = { vertical: 'middle', wrapText: true };
    head.commit();
    if (t.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
    for (const row of t.rows) {
      const values = t.columns.map((c) => {
        const v = row[c.key] ?? null;
        if (v === null) return null;
        if (c.type === 'percent' && typeof v === 'number') return v / 100;
        if (c.type === 'datetime' && typeof v === 'string') return istDate(v) ?? v;
        return v;
      });
      ws.addRow(values).commit();
    }
    if (t.note) {
      ws.addRow([]).commit();
      const r = ws.addRow([t.note]);
      r.font = { italic: true, color: { argb: 'FF5A6478' } };
      r.commit();
    }
    ws.commit();
  });

  await wb.commit();
}
