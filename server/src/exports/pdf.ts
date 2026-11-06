import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { drawTable } from '../reports/pdfTable.js';
import { cellText, columnWeight, fitWidths, longestHeaderWord, longestValueWord } from './cells.js';
import type { ExportDoc, ExportTable } from './types.js';

const FONTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');
/** Rows per table in a PDF; beyond this the table is cut with a note (use Excel or CSV for everything). */
export const PDF_MAX_ROWS = 3000;

const NAVY = '#14306b';
const MUTED = '#55627a';
const DEV_INK = '#b42318';
const DEV_BG = '#fde4e3';
const MARGIN = 32;

const isWide = (t: ExportTable) => t.columns.length > 6 || t.columns.reduce((s, c) => s + (c.width ?? 14), 0) > 90;

/** A PDF report: title, report details, then each table with repeated headers and page numbers. */
export function renderPdf(doc: ExportDoc, file: string): Promise<void> {
  const tables = doc.sections.filter((s): s is ExportTable => s.kind === 'table');
  const pdf = new PDFDocument({
    size: 'A4',
    layout: tables.some(isWide) ? 'landscape' : 'portrait',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: doc.title, Creator: 'DeoDap SOP Campaign Tracker' },
  });
  pdf.registerFont('Regular', path.join(FONTS, 'DejaVuSans.ttf'));
  pdf.registerFont('Bold', path.join(FONTS, 'DejaVuSans-Bold.ttf'));
  const out = createWriteStream(file);
  const done = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
    pdf.on('error', reject);
  });
  pdf.pipe(out);

  const width = pdf.page.width - MARGIN * 2;
  const heading = (text: string, size = 11) => {
    if (pdf.y > pdf.page.height - 110) pdf.addPage();
    pdf.x = MARGIN;
    pdf.moveDown(0.5).font('Bold').fontSize(size).fillColor(NAVY).text(text, { width }).moveDown(0.25);
  };

  pdf.font('Bold').fontSize(17).fillColor(NAVY).text(doc.title, { width });
  pdf.font('Regular').fontSize(8).fillColor(MUTED).text('DeoDap SOP Campaign Tracker', { width });
  pdf.moveDown(0.4);
  for (const line of doc.meta) {
    if (line.startsWith('DEVELOPMENT') || line.startsWith('Includes DEVELOPMENT')) {
      const y = pdf.y;
      pdf.font('Bold').fontSize(8.5);
      const h = pdf.heightOfString(line, { width: width - 12 }) + 8;
      pdf.rect(MARGIN, y, width, h).fill(DEV_BG);
      pdf.fillColor(DEV_INK).text(line, MARGIN + 6, y + 4, { width: width - 12 });
      pdf.x = MARGIN;
      pdf.y = y + h + 3;
    } else {
      pdf.font('Regular').fontSize(8).fillColor(MUTED).text(line, MARGIN, pdf.y, { width });
    }
  }

  for (const s of doc.sections) {
    if (s.kind === 'text') {
      if (s.title) heading(s.title, 10);
      pdf.font('Regular').fontSize(8).fillColor('#1f2a3d').text(s.text, MARGIN, pdf.y, { width });
      continue;
    }
    heading(s.title);
    const fontSize = s.columns.length > 14 ? 5.8 : s.columns.length > 9 ? 6.5 : 7.5;
    const mins = s.columns.map((c) => {
      const head = pdf.font('Bold').fontSize(fontSize).widthOfString(longestHeaderWord(c));
      const body = pdf.font('Regular').fontSize(fontSize).widthOfString(longestValueWord(c, s.rows));
      return Math.max(head, body) + 8;
    });
    const widths = fitWidths(s.columns.map(columnWeight), mins, width);
    const columns = s.columns.map((c, i) => ({
      header: c.header,
      width: widths[i]!,
      align: c.type && c.type !== 'text' && c.type !== 'datetime' ? ('right' as const) : ('left' as const),
    }));
    const rows = s.rows.slice(0, PDF_MAX_ROWS).map((r) => ({ cells: s.columns.map((c) => cellText(c, r[c.key] ?? null)) }));
    pdf.x = MARGIN;
    drawTable(pdf, columns, rows, fontSize);
    const notes = [
      ...(s.rows.length > PDF_MAX_ROWS ? [`Showing the first ${PDF_MAX_ROWS} of ${s.rows.length} rows. Download Excel or CSV for every row.`] : []),
      ...(s.note ? [s.note] : []),
    ];
    for (const n of notes) pdf.moveDown(0.2).font('Regular').fontSize(7).fillColor(MUTED).text(n, MARGIN, pdf.y, { width });
  }

  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(range.start + i);
    pdf.page.margins.bottom = 0; // writing inside the bottom margin must not trigger a new page
    const footer = `${doc.devData ? 'DEVELOPMENT DATA · ' : ''}${doc.title} · page ${i + 1} of ${range.count}`;
    pdf.font('Regular').fontSize(7).fillColor(doc.devData ? DEV_INK : MUTED).text(footer, MARGIN, pdf.page.height - 22, { width, align: 'right', lineBreak: false });
  }
  pdf.end();
  return done;
}
