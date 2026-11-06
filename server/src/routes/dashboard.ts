import { Router } from 'express';
import { getDashboard } from '../services/dashboardService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const dashboardRouter = Router();

/** GET /api/dashboard[?runId=123] */
dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const runId = typeof req.query.runId === 'string' && /^\d+$/.test(req.query.runId) ? req.query.runId : undefined;
    res.json(await getDashboard(runId));
  }),
);
