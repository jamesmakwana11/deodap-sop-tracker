import type { SyncStatusResponse } from '@sop/shared';
import { Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { notFoundError } from '../http/errors.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { findLastFinishedMetaRun, findRun, findRunningRun, listRuns } from '../repositories/runRepository.js';
import { currentProgress, startSync } from '../services/syncService.js';
import { numericIdParams } from '../http/params.js';

export const syncRouter = Router();
numericIdParams(syncRouter, 'id');

/** Manual refresh. Returns at once; the client polls /status. */
syncRouter.post(
  '/sync',
  requireRole('auditor'),
  asyncHandler(async (req, res) => {
    const { runId } = await startSync({ trigger: 'manual', userId: req.user!.id });
    res.status(202).json({ runId });
  }),
);

syncRouter.get(
  '/sync/status',
  requireRole('viewer'),
  asyncHandler(async (_req, res) => {
    const body: SyncStatusResponse = { running: await findRunningRun(), lastFinished: await findLastFinishedMetaRun(), progress: currentProgress() };
    res.json(body);
  }),
);

syncRouter.get(
  '/runs',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 365);
    res.json({ runs: await listRuns(limit) });
  }),
);

syncRouter.get(
  '/runs/:id',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const run = await findRun(String(req.params.id));
    if (!run) throw notFoundError('Audit run not found.');
    res.json({ run });
  }),
);
