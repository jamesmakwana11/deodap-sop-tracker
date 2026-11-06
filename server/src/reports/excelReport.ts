import {
  CHECK_OUTCOME_LABEL,
  formatDate,
  formatIst,
  MANUAL_CHECK_ITEMS,
  RATING_LABEL,
  RATING_RULE_BY_METRIC,
  SOP_RULES,
  SOP_STATUS_LABEL,
  SORT_OPTIONS,
  type CheckOutcome,
  type Rating,
  type SopStatus,
} from '@sop/shared';
import ExcelJS from 'exceljs';
import { manualStatusOf, type ReportData } from './reportData.js';

const FILL = {
  head: 'FFE4EDFB',
  good: 'FFE3F5EA',
  avg: 'FFFDF3D6',
  bad: 'FFFDE4E3',
  grey: 'FFF1F5F9',
  dev: 'FFFDE4E3',
};
const RATING_FILL: Record<Rating, string> = { GOOD: FILL.good, AVERAGE: FILL.avg, BAD: FILL.bad, NOT_RATED: FILL.grey };
const STATUS_FILL: Record<SopStatus, string> = {
  FOLLOWING: FILL.good,
  PARTLY_FOLLOWING: FILL.avg,
  NOT_FOLLOWING: FILL.bad,
  NEEDS_REVIEW: FILL.grey,
};
const OUTCOME_FILL: Partial<Record<CheckOutcome, string>> = { FAIL: FILL.bad, NOT_CHECKABLE: FILL.grey };

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FF14306B' } };
  row.eachCell((c) => {
    c.fill = fill(FILL.head);
    c.alignment = { vertical: 'middle', wrapText: true };
  });
}

/** Writes a header + rows block. `percentCol` (1-based) holds 0–1 fractions shown as %. */
function addTable(ws: ExcelJS.Worksheet, header: string[], rows: (string | number | null)[][], percentCol?: number) {
  styleHeader(ws.addRow(header));
  for (const r of rows) {
    const row = ws.addRow(r);
    if (percentCol && typeof row.getCell(percentCol).value === 'number') row.getCell(percentCol).numFmt = '0%';
  }
  ws.addRow([]);
}

/** Excel report: Summary, Campaigns, Findings and Manual checks sheets. */
export async function buildExcelReport(data: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DeoDap SOP Campaign Tracker';
  wb.created = data.generatedAt;
  const isDev = data.run.source === 'development';

  // ── Summary ──
  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 34 }, { width: 70 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 12 }];
  const title = s.addRow(['DeoDap SOP Campaign Tracker — audit report']);
  title.font = { bold: true, size: 16, color: { argb: 'FF14306B' } };
  if (isDev) {
    const r = s.addRow(['DEVELOPMENT DATA — NOT REAL META RESULTS. Sample records for testing only.']);
    r.font = { bold: true, color: { argb: 'FFB42318' } };
    r.getCell(1).fill = fill(FILL.dev);
  }
  const info: [string, string][] = [
    ['Audit run', `#${data.run.id} (${data.run.source === 'meta' ? 'Meta' : 'development data'}, ${data.run.trigger})`],
    ['Settings as of', formatIst(data.run.finishedAt ?? data.run.startedAt)],
    ['Performance period', data.run.periodStart && data.run.periodEnd ? `${formatDate(data.run.periodStart)} – ${formatDate(data.run.periodEnd)}` : '–'],
    ['Ad accounts', data.run.accounts.map((a) => `${a.name} (${a.metaAccountId})`).join(', ')],
    ['Campaigns included', data.filterDescription],
    ['Sorted by', SORT_OPTIONS[data.sort]],
    ['Generated', `${formatIst(data.generatedAt.toISOString())} by ${data.generatedBy}`],
  ];
  for (const [k, v] of info) {
    const r = s.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  }
  s.addRow([]);

  const t = data.summary.totals;
  addTable(s, ['Measure', 'Campaigns'], [
    ['Active campaigns', t.active],
    ['Rated Good', t.good],
    ['Rated Average', t.average],
    ['Rated Bad', t.bad],
    ['Not rated', t.notRated],
    ['Following SOP', t.following],
    ['Partly following SOP', t.partlyFollowing],
    ['Not following SOP', t.notFollowing],
    ['SOP needs review', t.needsReview],
  ]);
  const group = (label: string, rows: typeof data.summary.byAccount) =>
    addTable(
      s,
      [label, 'Campaigns', 'Good', 'Average', 'Bad', 'Not rated', 'Following SOP', 'Avg SOP %'],
      rows.map((r) => [r.label, r.campaigns, r.good, r.average, r.bad, r.notRated, r.following, r.avgSopPercent === null ? '–' : r.avgSopPercent / 100]),
      8,
    );
  group('Account', data.summary.byAccount);
  group('Objective', data.summary.byObjective);
  addTable(
    s,
    ['Check', 'SOP rule', 'Pass', 'Fail', 'Not checkable', 'Not applicable', 'Fail rate'],
    data.summary.ruleFailures.map((r) => [r.label, r.rule, r.pass, r.fail, r.notCheckable, r.notApplicable, r.failRate === null ? '–' : r.failRate]),
    7,
  );

  // ── Campaigns ──
  const ws = wb.addWorksheet('Campaigns', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  const header = [
    'Rating', 'Campaign', 'Meta campaign ID', 'Account', 'Objective', 'Spend, 7 days (₹)', 'Main metric', 'Metric value',
    'Indicative', 'Rating note', 'SOP %', 'SOP status', ...SOP_RULES.map((r) => r.label), 'What is off',
    'Manual verified', 'Manual failed', 'Manual pending',
  ];
  ws.columns = header.map((h) => ({ header: h, width: h === 'Campaign' || h === 'What is off' || h === 'Rating note' ? 48 : 14 }));
  styleHeader(ws.getRow(1));
  for (const c of data.campaigns) {
    const row = ws.addRow([
      RATING_LABEL[c.rating],
      c.name,
      c.metaCampaignId,
      c.account.name,
      c.objective,
      c.spend7d,
      c.mainMetric ? RATING_RULE_BY_METRIC[c.mainMetric.kind].metricLabel : '–',
      c.mainMetric?.value ?? '–',
      c.ratingIndicative ? 'Yes' : '',
      c.ratingNote ?? '',
      c.compliance.percent === null ? '–' : c.compliance.percent / 100,
      SOP_STATUS_LABEL[c.compliance.status],
      ...SOP_RULES.map((r) => CHECK_OUTCOME_LABEL[c.checks.find((x) => x.key === r.key)?.outcome ?? 'NOT_CHECKABLE']),
      c.whatIsOff.join('\n'),
      c.manual.verified,
      c.manual.failed,
      c.manual.pending,
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell(1).fill = fill(RATING_FILL[c.rating]);
    row.getCell(6).numFmt = '₹#,##,##0';
    row.getCell(11).numFmt = '0%';
    row.getCell(12).fill = fill(STATUS_FILL[c.compliance.status]);
    SOP_RULES.forEach((r, i) => {
      const f = OUTCOME_FILL[c.checks.find((x) => x.key === r.key)?.outcome ?? 'NOT_CHECKABLE'];
      if (f) row.getCell(13 + i).fill = fill(f);
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };

  // ── Findings: one row per failure ──
  const fw = wb.addWorksheet('Findings', { views: [{ state: 'frozen', ySplit: 1 }] });
  fw.columns = [
    { header: 'Campaign', width: 48 },
    { header: 'Account', width: 20 },
    { header: 'Check', width: 24 },
    { header: 'Finding', width: 80 },
  ];
  styleHeader(fw.getRow(1));
  for (const c of data.campaigns) {
    for (const ch of c.checks.filter((x) => x.outcome === 'FAIL')) {
      fw.addRow([c.name, c.account.name, SOP_RULES.find((r) => r.key === ch.key)?.label ?? ch.key, ch.detail ?? '']);
    }
    for (const item of MANUAL_CHECK_ITEMS) {
      const m = manualStatusOf(data, c.metaCampaignId, item.key);
      if (m.status === 'FAILED') fw.addRow([c.name, c.account.name, `Manual: ${item.label}`, m.note ?? '']);
    }
  }

  // ── Manual checks ──
  const mw = wb.addWorksheet('Manual checks', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
  mw.columns = [{ header: 'Campaign', width: 48 }, ...MANUAL_CHECK_ITEMS.map((i) => ({ header: i.label, width: 18 }))];
  styleHeader(mw.getRow(1));
  const MANUAL_TEXT = { PENDING: 'Pending', VERIFIED: 'Verified', FAILED: 'Failed', NOT_APPLICABLE: 'Not applicable' } as const;
  for (const c of data.campaigns) {
    const row = mw.addRow([c.name, ...MANUAL_CHECK_ITEMS.map((i) => MANUAL_TEXT[manualStatusOf(data, c.metaCampaignId, i.key).status])]);
    row.eachCell((cell, col) => {
      if (col === 1) return;
      if (cell.value === 'Failed') cell.fill = fill(FILL.bad);
      else if (cell.value === 'Verified') cell.fill = fill(FILL.good);
    });
  }
  mw.addRow([]);
  mw.addRow(['Manual checks are set by people in the tracker. Pending means nobody has verified the item yet.']).font = { italic: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
