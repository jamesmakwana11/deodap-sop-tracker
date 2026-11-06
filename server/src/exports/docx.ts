import { writeFile } from 'node:fs/promises';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
} from 'docx';
import { cellText, columnWeight, fitWidths, longestHeaderWord, longestValueWord } from './cells.js';
import type { ExportDoc, ExportTable } from './types.js';

/**
 * Word files are built in memory, so each table is limited to about 15,000 cells (at most
 * 2,000 rows); beyond that the table is cut with a note pointing to Excel or CSV.
 */
export const DOCX_MAX_ROWS = 2000;
const DOCX_MAX_CELLS = 15_000;
export const docxRowLimit = (columns: number) => Math.min(DOCX_MAX_ROWS, Math.max(100, Math.floor(DOCX_MAX_CELLS / Math.max(columns, 1))));

const A4 = { width: 11906, height: 16838 };
const MARGIN = 720; // 0.5 inch
const FONT = 'Calibri';
const INK = '1F2A3D';
const HEAD_INK = '14306B';
const HEAD_BG = 'E4EDFB';
const LINE = 'DBE5F3';

const isWide = (t: ExportTable) => t.columns.length > 6 || t.columns.reduce((s, c) => s + (c.width ?? 14), 0) > 90;

function tableBlock(t: ExportTable, contentWidth: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [new Paragraph({ text: t.title, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 } })];
  const size = t.columns.length > 12 ? 13 : t.columns.length > 7 ? 15 : 18; // half-points
  // Bold header text: about 0.62 × font size per character, plus cell margins (all in twips).
  const charTwips = (size / 2) * 20; // one em at this size
  const mins = t.columns.map((c) => Math.ceil(Math.max(longestHeaderWord(c).length * 0.62, longestValueWord(c, t.rows).length * 0.55) * charTwips) + 160);
  const widths = fitWidths(t.columns.map(columnWeight), mins, contentWidth).map(Math.floor);
  const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text: string, i: number, head: boolean, right: boolean) =>
    new TableCell({
      width: { size: widths[i]!, type: WidthType.DXA },
      borders,
      shading: head ? { type: ShadingType.CLEAR, fill: HEAD_BG, color: 'auto' } : undefined,
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      children: [
        new Paragraph({
          alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text, bold: head, size, font: FONT, color: head ? HEAD_INK : INK })],
        }),
      ],
    });

  const limit = docxRowLimit(t.columns.length);
  const shown = t.rows.slice(0, limit);
  const rows = [
    new TableRow({ tableHeader: true, children: t.columns.map((c, i) => cell(c.header, i, true, false)) }),
    ...shown.map(
      (r) =>
        new TableRow({
          cantSplit: true,
          children: t.columns.map((c, i) => cell(cellText(c, r[c.key] ?? null), i, false, c.type !== undefined && c.type !== 'text' && c.type !== 'datetime')),
        }),
    ),
  ];
  out.push(new Table({ rows, width: { size: contentWidth, type: WidthType.DXA }, columnWidths: widths }));
  const notes = [
    ...(t.rows.length > limit ? [`Showing the first ${limit} of ${t.rows.length} rows. Download Excel or CSV for every row.`] : []),
    ...(t.note ? [t.note] : []),
  ];
  for (const n of notes) out.push(new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: n, italics: true, size: 16, font: FONT, color: '5A6478' })] }));
  return out;
}

/** A Word report: title, report details, then each table (landscape when the tables are wide). */
export async function renderDocx(doc: ExportDoc, file: string): Promise<void> {
  const tables = doc.sections.filter((s): s is ExportTable => s.kind === 'table');
  const landscape = tables.some(isWide);
  const contentWidth = (landscape ? A4.height : A4.width) - MARGIN * 2;

  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: doc.title, font: FONT, color: HEAD_INK, size: 40, bold: true })] }),
  ];
  for (const line of doc.meta) {
    const dev = line.startsWith('DEVELOPMENT') || line.startsWith('Includes DEVELOPMENT');
    children.push(
      new Paragraph({
        shading: dev ? { type: ShadingType.CLEAR, fill: 'FFF1D6', color: 'auto' } : undefined,
        spacing: { after: 40 },
        children: [new TextRun({ text: line, font: FONT, size: dev ? 20 : 18, bold: dev, color: dev ? '8A4B00' : '5A6478' })],
      }),
    );
  }
  for (const s of doc.sections) {
    if (s.kind === 'table') children.push(...tableBlock(s, contentWidth));
    else {
      if (s.title) children.push(new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_3, spacing: { before: 240, after: 80 } }));
      children.push(new Paragraph({ children: [new TextRun({ text: s.text, font: FONT, size: 18, color: INK })] }));
    }
  }

  const section: ISectionOptions = {
    properties: {
      page: {
        size: { width: A4.width, height: A4.height, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `DeoDap SOP Campaign Tracker${doc.devData ? ' · DEVELOPMENT DATA' : ''}`, font: FONT, size: 14, color: '8090A8' })] })],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 14, color: '8090A8' })],
          }),
        ],
      }),
    },
    children,
  };

  const document = new Document({
    creator: 'DeoDap SOP Campaign Tracker',
    title: doc.title,
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [section],
  });
  await writeFile(file, await Packer.toBuffer(document));
}
