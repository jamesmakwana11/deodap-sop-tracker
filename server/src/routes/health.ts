import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { store } from '../storage/store.js';

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    if (await store.healthy()) res.json({ status: 'ok', storage: 'up' });
    else res.status(503).json({ status: 'degraded', storage: 'down' });
  }),
);
