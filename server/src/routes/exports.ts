import { existsSync } from 'node:fs';
import { EXPORT_DATASETS, EXPORT_FORMATS, type ExportFormat } from '@sop/shared';
import { Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { badRequest, notFoundError } from '../http/errors.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { isDatasetId } from '../exports/datasets.js';
import { canSeeReport, EXPORT_MIME, generateExport, listReports, reportFilePath } from '../exports/exportService.js';
import { store } from '../storage/store.js';

/**
 * Exports for every report area, in PDF, Excel, Word and CSV. Any signed-in user may export
 * the audit data they can already see; nothing exported contains tokens, secrets or passwords.
 */
export const exportsRouter = Router();
exportsRouter.use(requireRole('viewer'));

exportsRouter.get('/', (_req, res) => {
  res.json({ formats: EXPORT_FORMATS, datasets: Object.values(EXPORT_DATASETS) });
});

exportsRouter.get('/history', (req, res) => {
  res.json({ reports: listReports(req.user!) });
});

exportsRouter.get(
  '/files/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const r = /^[0-9a-f]{32}$/.test(id) ? store.c.generatedReports.get(id) : undefined;
    if (!r || !canSeeReport(r, req.user!) || !existsSync(reportFilePath(r))) throw notFoundError('That report is no longer available. Generate it again.');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.type(EXPORT_MIME[r.format]).attachment(r.fileName).sendFile(reportFilePath(r));
  }),
);

/** GET /api/exports/<dataset>.<format>?runId=…&scope=filtered|all&<filters> */
exportsRouter.get(
  '/:dataset.:format',
  asyncHandler(async (req, res) => {
    const dataset = String(req.params.dataset);
    const format = String(req.params.format);
    if (!isDatasetId(dataset)) throw notFoundError('Unknown report.');
    if (!(EXPORT_FORMATS as readonly string[]).includes(format)) throw badRequest('Choose PDF, Excel (.xlsx), Word (.docx) or CSV.');
    const r = await generateExport(dataset, format as ExportFormat, req.query, req.user!);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Report-Id', r.id);
    res.type(EXPORT_MIME[r.format]).attachment(r.fileName).sendFile(reportFilePath(r));
  }),
);
