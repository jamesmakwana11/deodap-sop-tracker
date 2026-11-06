import { Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { buildExcelReport } from '../reports/excelReport.js';
import { buildPdfReport } from '../reports/pdfReport.js';
import { loadReportData, reportFileName } from '../reports/reportData.js';

export const reportsRouter = Router();
reportsRouter.use(requireRole('viewer'));

/** GET /api/reports/:runId.xlsx — :runId may be "latest". Accepts the tracker's filter and sort query. */
reportsRouter.get(
  '/:runId.xlsx',
  asyncHandler(async (req, res) => {
    const data = await loadReportData(String(req.params.runId), req.query, req.user!.name);
    const file = await buildExcelReport(data);
    res
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .attachment(reportFileName(data, 'xlsx'))
      .send(file);
  }),
);

reportsRouter.get(
  '/:runId.pdf',
  asyncHandler(async (req, res) => {
    const data = await loadReportData(String(req.params.runId), req.query, req.user!.name);
    const file = await buildPdfReport(data);
    res.type('application/pdf').attachment(reportFileName(data, 'pdf')).send(file);
  }),
);
