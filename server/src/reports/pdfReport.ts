import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECK_OUTCOME_SYMBOL,
  formatDate,
  formatIst,
  formatMainMetric,
  formatPercent,
  formatRupees,
  MANUAL_CHECKS,
  joinWithAnd,
  RATING_LABEL,
  RATING_RULES,
  SOP_RULES,
  SOP_STATUS_LABEL,
  SORT_OPTIONS,
  type CheckKey,
  type Rating,
  type SopStatus,
} from '@sop/shared';
import PDFDocument from 'pdfkit';
import { drawTable, type PdfColumn } from './pdfTable.js';
import type { ReportData } from './reportData.js';

const FONTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');

/** Short check headers that fit a narrow PDF column; spelled out in the legend. */
const PDF_CHECK_HEADER: Record<CheckKey, string> = {
  naming: 'Nm',
  buying_type: 'Buy',
  bid_strategy: 'Bid',
  min_budget: 'Bdgt',
  dynamic_creative: 'DCO',
  seven_sisters: '7S',
  placements: 'Plc',
  frequency: 'Freq',
  creative_complete: 'Crtv',
};

const C = {
  navy: '#14306b',
  muted: '#55627a',
  good: '#17803d',
  goodBg: '#e3f5ea',
  avg: '#946200',
  avgBg: '#fdf3d6',
  bad: '#b42318',
  badBg: '#fde4e3',
  grey: '#64748b',
  greyBg: '#f1f5f9',
};
const RATING_TONE: Record<Rating, [string, string]> = {
  GOOD: [C.good, C.goodBg],
  AVERAGE: [C.avg, C.avgBg],
  BAD: [C.bad, C.badBg],
  NOT_RATED: [C.grey, C.greyBg],
};
const STATUS_TONE: Record<SopStatus, [string, string]> = {
  FOLLOWING: [C.good, C.goodBg],
  PARTLY_FOLLOWING: [C.avg, C.avgBg],
  NOT_FOLLOWING: [C.bad, C.badBg],
  NEEDS_REVIEW: [C.grey, C.greyBg],
};

/** PDF report: summary, rollups, rule failures, the campaign tracker and how campaigns are judged. */
export function buildPdfReport(data: ReportData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, bufferPages: true, info: { Title: 'DeoDap SOP audit report' } });
  doc.registerFont('Regular', path.join(FONTS, 'DejaVuSans.ttf'));
  doc.registerFont('Bold', path.join(FONTS, 'DejaVuSans-Bold.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - 64;
  const heading = (text: string) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.4).font('Bold').fontSize(12).fillColor(C.navy).text(text).moveDown(0.3);
  };
  const isDev = data.run.source === 'development';

  // ── Title ──
  doc.font('Bold').fontSize(20).fillColor(C.navy).text('DeoDap SOP Campaign Tracker');
  if (isDev) {
    const y = doc.y + 4;
    doc.rect(32, y, width, 20).fill(C.badBg);
    doc.font('Bold').fontSize(9).fillColor(C.bad).text('DEVELOPMENT DATA — NOT REAL META RESULTS. Sample records for testing only.', 40, y + 5);
    doc.y = y + 24;
  }
  doc.font('Regular').fontSize(9).fillColor(C.muted);
  const period = data.run.periodStart && data.run.periodEnd ? `${formatDate(data.run.periodStart)} – ${formatDate(data.run.periodEnd)}` : '–';
  doc.text(
    `Audit run #${data.run.id}, settings as of ${formatIst(data.run.finishedAt ?? data.run.startedAt)}. Performance period ${period}. ` +
      `Ad accounts: ${data.run.accounts.map((a) => `${a.name} (${a.metaAccountId})`).join(', ') || '–'}.`,
    { width },
  );
  doc.text(`${data.filterDescription}. Sorted by ${SORT_OPTIONS[data.sort].toLowerCase()}. Generated ${formatIst(data.generatedAt.toISOString())} by ${data.generatedBy}.`, { width });
  doc.moveDown(0.6);

  // ── KPI tiles ──
  const t = data.summary.totals;
  const tiles: [number, string, string][] = [
    [t.active, 'Active campaigns', C.navy],
    [t.good, 'Rated Good', C.good],
    [t.average, 'Rated Average', C.avg],
    [t.bad, 'Rated Bad', C.bad],
    [t.notRated, 'Not rated', C.grey],
    [t.following, 'Following SOP', C.good],
    [t.partlyFollowing, 'Partly following', C.avg],
    [t.notFollowing, 'Not following', C.bad],
    [t.needsReview, 'Needs review', C.grey],
  ];
  const tileW = width / tiles.length;
  const ty = doc.y;
  tiles.forEach(([n, label, color], i) => {
    const x = 32 + i * tileW;
    doc.rect(x + 2, ty, tileW - 4, 40).lineWidth(0.6).strokeColor('#dbe5f3').stroke();
    doc.rect(x + 2, ty, tileW - 4, 3).fill(color);
    doc.font('Bold').fontSize(15).fillColor(color).text(String(n), x + 8, ty + 7, { width: tileW - 14 });
    doc.font('Regular').fontSize(7).fillColor(C.muted).text(label, x + 8, ty + 27, { width: tileW - 14 });
  });
  doc.x = 32;
  doc.y = ty + 50;

  // ── Rollups ──
  const groupCols = (first: string): PdfColumn[] => [
    { header: first, width: 230 },
    ...['Campaigns', 'Good', 'Average', 'Bad', 'Not rated', 'Following SOP', 'Avg SOP %'].map((h) => ({ header: h, width: 68, align: 'right' as const })),
  ];
  const groupRows = (rows: typeof data.summary.byAccount) =>
    rows.map((r) => ({
      cells: [r.label, ...[r.campaigns, r.good, r.average, r.bad, r.notRated, r.following].map(String), formatPercent(r.avgSopPercent)],
    }));
  heading('By account');
  drawTable(doc, groupCols('Account'), groupRows(data.summary.byAccount), 7.5, true);
  heading('By objective');
  drawTable(doc, groupCols('Objective'), groupRows(data.summary.byObjective), 7.5, true);

  if (doc.y > doc.page.height * 0.6) doc.addPage();
  heading('Which SOP rules break most often');
  drawTable(
    doc,
    [
      { header: 'Check', width: 110 },
      { header: 'SOP rule', width: 400 },
      { header: 'Pass', width: 45, align: 'right' },
      { header: 'Fail', width: 45, align: 'right' },
      { header: 'Not checkable', width: 65, align: 'right' },
      { header: 'Not applicable', width: 65, align: 'right' },
      { header: 'Fail rate', width: 48, align: 'right' },
    ],
    data.summary.ruleFailures.map((r) => ({
      cells: [r.label, r.rule, String(r.pass), String(r.fail), String(r.notCheckable), String(r.notApplicable), r.failRate === null ? '–' : formatPercent(r.failRate * 100)],
    })),
    7.5,
    true,
  );

  // ── Campaign tracker ──
  doc.addPage();
  heading('Campaign tracker');
  doc.font('Regular').fontSize(7.5).fillColor(C.muted)
    .text(
      '✓ passes   ✗ fails   ? not checkable from Meta data   – not applicable. Indicative = Sales campaign under ₹15,000 spend in the period. ' +
        `Columns: ${SOP_RULES.map((r) => `${PDF_CHECK_HEADER[r.key]} = ${r.label}`).join(', ')}.`,
      { width },
    );
  doc.moveDown(0.4);
  const cols: PdfColumn[] = [
    { header: 'Rating', width: 44 },
    { header: 'Campaign', width: 118 },
    { header: 'Account', width: 50 },
    { header: 'Objective', width: 54 },
    { header: 'Spend, 7 days', width: 50, align: 'right' },
    { header: 'Main metric', width: 56 },
    { header: 'SOP %', width: 30, align: 'right' },
    { header: 'SOP status', width: 50 },
    ...SOP_RULES.map((r) => ({ header: PDF_CHECK_HEADER[r.key], width: 25, align: 'center' as const })),
    { header: 'What is off', width: 101 },
  ];
  drawTable(
    doc,
    cols,
    data.campaigns.map((c) => {
      const checkCells = SOP_RULES.map((r) => c.checks.find((x) => x.key === r.key)?.outcome ?? 'NOT_CHECKABLE');
      const [rInk, rBg] = RATING_TONE[c.rating];
      const [sInk, sBg] = STATUS_TONE[c.compliance.status];
      return {
        cells: [
          RATING_LABEL[c.rating],
          c.name,
          c.account.name,
          c.objective,
          formatRupees(c.spend7d),
          formatMainMetric(c.mainMetric) + (c.ratingIndicative ? ' · indicative' : ''),
          formatPercent(c.compliance.percent),
          SOP_STATUS_LABEL[c.compliance.status],
          ...checkCells.map((o) => CHECK_OUTCOME_SYMBOL[o]),
          c.whatIsOff.join('\n') || '–',
        ],
        fills: [rBg, null, null, null, null, null, null, sBg, ...checkCells.map((o) => (o === 'FAIL' ? C.badBg : null)), null],
        colors: [rInk, null, null, null, null, null, null, sInk, ...checkCells.map((o) => (o === 'PASS' ? C.good : o === 'FAIL' ? C.bad : C.grey)), C.muted],
      };
    }),
    6.8,
  );

  // ── How campaigns are judged ──
  heading('How campaigns are judged');
  drawTable(
    doc,
    [
      { header: 'Objective', width: 100 },
      { header: 'Main metric', width: 200 },
      { header: 'Good', width: 160 },
      { header: 'Average', width: 160 },
      { header: 'Bad', width: 158 },
    ],
    RATING_RULES.map((r) => ({
      cells: [r.objective, r.metricLabel, r.goodText, r.averageText, r.badText],
      fills: [null, null, C.goodBg, C.avgBg, C.badBg],
      colors: [null, null, C.good, C.avg, C.bad],
    })),
    7.5,
    true,
  );
  if (doc.y > doc.page.height - 100) doc.addPage();
  doc.font('Regular').fontSize(8).fillColor(C.muted);
  doc.text(
    'SOP % = passed ÷ (passed + failed). All pass is Following SOP; a quarter or fewer failing is Partly following; more than a quarter is Not following. ' +
      'Not checkable and not applicable settings are left out; with nothing checkable a campaign Needs review. ' +
      `Checked by hand, never automatically: ${joinWithAnd(MANUAL_CHECKS.map((m) => m.toLowerCase()))}.`,
    { width },
  );

  // ── Page numbers ──
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // writing inside the bottom margin must not trigger a new page
    const footer = `${isDev ? 'DEVELOPMENT DATA · ' : ''}DeoDap SOP audit · run #${data.run.id} · page ${i + 1} of ${range.count}`;
    doc.font('Regular').fontSize(7).fillColor(isDev ? C.bad : C.muted)
      .text(footer, 32, doc.page.height - 24, { width, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
