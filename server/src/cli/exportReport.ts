/**
 * Writes a report to disk without the web app, e.g. for a cron job:
 *   npm run report:export -- --run latest --format pdf --out ./reports
 * Optional filters: --rating BAD --objective Sales --sopStatus NOT_FOLLOWING --sort spend_desc
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { closeStore, openStore } from '../storage/store.js';
import { buildExcelReport } from '../reports/excelReport.js';
import { buildPdfReport } from '../reports/pdfReport.js';
import { loadReportData, reportFileName } from '../reports/reportData.js';

async function main() {
  const { values } = parseArgs({
    options: {
      run: { type: 'string', default: 'latest' },
      format: { type: 'string', default: 'pdf' },
      out: { type: 'string', default: '.' },
      rating: { type: 'string' },
      objective: { type: 'string' },
      sopStatus: { type: 'string' },
      accountId: { type: 'string' },
      sort: { type: 'string' },
    },
  });
  const format = values.format === 'xlsx' ? 'xlsx' : 'pdf';
  const query = Object.fromEntries(
    (['rating', 'objective', 'sopStatus', 'accountId', 'sort'] as const).filter((k) => values[k]).map((k) => [k, values[k]]),
  );
  const data = await loadReportData(values.run!, query, 'command line');
  const file = format === 'xlsx' ? await buildExcelReport(data) : await buildPdfReport(data);
  await mkdir(values.out!, { recursive: true });
  const target = path.join(values.out!, reportFileName(data, format));
  await writeFile(target, file);
  console.log(`Wrote ${target}`);
}

openStore()
  .then(main)
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closeStore());
