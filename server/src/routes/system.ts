import { Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getStorageStatus } from '../services/storageStatus.js';
import { store } from '../storage/store.js';

/** Data storage status and backups. Admin only (it shows server paths), except /health. */
export const systemRouter = Router();

/** For every signed-in user: is data storage safe? No paths or details, just the level. */
systemRouter.get(
  '/health',
  requireRole('viewer'),
  asyncHandler(async (_req, res) => {
    const s = await getStorageStatus();
    res.json({ persistence: s.persistence });
  }),
);

systemRouter.use(requireRole('admin'));

systemRouter.get(
  '/storage',
  asyncHandler(async (_req, res) => {
    res.json(await getStorageStatus());
  }),
);

systemRouter.post(
  '/backups',
  asyncHandler(async (_req, res) => {
    const b = await store.backup('manual');
    res.status(201).json({ backup: { name: b.name, createdAt: b.createdAt, reason: b.reason, files: Object.keys(b.files).length, totalBytes: b.totalBytes } });
  }),
);
