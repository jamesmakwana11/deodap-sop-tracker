import type PDFDocument from 'pdfkit';

type Doc = InstanceType<typeof PDFDocument>;

export interface PdfColumn {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

export interface PdfRow {
  cells: string[];
  /** Background per cell (hex), or null. */
  fills?: (string | null)[];
  /** Text colour per cell (hex), or null. */
  colors?: (string | null)[];
}

const PAD = 3;
const INK = '#1f2a3d';
const LINE = '#dbe5f3';
const HEAD_BG = '#e4edfb';
const HEAD_INK = '#14306b';

/**
 * Draws a table at the current y, wrapping text and repeating the header on new pages.
 * With keepTogether, a table that would fit on one page starts on a new page instead of splitting.
 */
export function drawTable(doc: Doc, columns: PdfColumn[], rows: PdfRow[], fontSize = 7.5, keepTogether = false): void {
  const left = doc.page.margins.left;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 14;
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);

  const rowHeight = (cells: string[], bold: boolean) => {
    doc.font(bold ? 'Bold' : 'Regular').fontSize(fontSize);
    return Math.max(...cells.map((t, i) => doc.heightOfString(t || ' ', { width: columns[i]!.width - PAD * 2 }))) + PAD * 2;
  };

  const drawCells = (cells: string[], y: number, h: number, bold: boolean, fills?: (string | null)[], colors?: (string | null)[]) => {
    let x = left;
    cells.forEach((text, i) => {
      const col = columns[i]!;
      const bg = fills?.[i];
      if (bg) doc.rect(x, y, col.width, h).fill(bg);
      doc
        .font(bold ? 'Bold' : 'Regular')
        .fontSize(fontSize)
        .fillColor(colors?.[i] ?? (bold ? HEAD_INK : INK))
        .text(text, x + PAD, y + PAD, { width: col.width - PAD * 2, align: col.align ?? 'left' });
      x += col.width;
    });
    doc.moveTo(left, y + h).lineTo(left + totalWidth, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
  };

  const header = () => {
    const cells = columns.map((c) => c.header);
    const h = rowHeight(cells, true);
    const y = doc.y;
    doc.rect(left, y, totalWidth, h).fill(HEAD_BG);
    drawCells(cells, y, h, true);
    doc.y = y + h;
  };

  if (keepTogether) {
    const total = rowHeight(columns.map((c) => c.header), true) + rows.reduce((s, r) => s + rowHeight(r.cells, false), 0);
    const pageSpace = bottom() - doc.page.margins.top;
    if (doc.y + total > bottom() && total < pageSpace) doc.addPage();
  }

  header();
  for (const row of rows) {
    const h = rowHeight(row.cells, false);
    if (doc.y + h > bottom()) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    drawCells(row.cells, y, h, false, row.fills, row.colors);
    doc.y = y + h;
  }
  doc.x = left;
  doc.moveDown(0.8);
}
