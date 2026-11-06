import { ATTACHMENT_EXTENSIONS, ATTACHMENT_TYPES, MANUAL_CHECK_ITEMS, MAX_ATTACHMENT_BYTES } from '@sop/shared';
import express, { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { badRequest, notFoundError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { campaignExists, getManualChecks, getManualEvents, setManualCheck } from '../repositories/manualRepository.js';
import { getAdPreview, getCampaignDetail, PREVIEW_FORMATS } from '../services/campaignDetailService.js';
import { numericIdParams } from '../http/params.js';
import { attachmentPath, deleteAttachment, saveAttachment } from '../repositories/attachmentRepository.js';
import { store } from '../storage/store.js';

export const campaignsRouter = Router();
numericIdParams(campaignsRouter, 'id');

campaignsRouter.get(
  '/campaign-audits/:id',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!/^\d+$/.test(id)) throw notFoundError('Campaign audit not found.');
    res.json(await getCampaignDetail(id));
  }),
);

const ManualBody = z
  .object({
    status: z.enum(['PENDING', 'VERIFIED', 'FAILED', 'NOT_APPLICABLE']),
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((b) => b.status !== 'FAILED' || (b.note && b.note.length > 0), {
    message: 'Add a note saying what is wrong.',
    path: ['note'],
  });

const MANUAL_KEYS = new Set<string>(MANUAL_CHECK_ITEMS.map((i) => i.key));

/** A person records a manual check. Requires the auditor role; nothing sets these automatically. */
campaignsRouter.put(
  '/manual-checks/:metaCampaignId/:key',
  requireRole('auditor'),
  asyncHandler(async (req, res) => {
    const metaCampaignId = String(req.params.metaCampaignId);
    const key = String(req.params.key);
    if (!MANUAL_KEYS.has(key)) throw badRequest('Unknown manual check.');
    if (!(await campaignExists(metaCampaignId))) throw notFoundError('Campaign not found.');
    const body = parse(ManualBody, req.body);
    await setManualCheck(metaCampaignId, key as (typeof MANUAL_CHECK_ITEMS)[number]['key'], body.status, body.note || null, req.user!.id);
    res.json({ manualChecks: await getManualChecks(metaCampaignId), manualEvents: await getManualEvents(metaCampaignId) });
  }),
);

campaignsRouter.get(
  '/ads/:id/preview',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const format = (req.query.format as string | undefined) ?? 'MOBILE_FEED_STANDARD';
    if (!(PREVIEW_FORMATS as readonly string[]).includes(format)) throw badRequest('Unsupported preview format.');
    res.json(await getAdPreview(String(req.params.id), format as (typeof PREVIEW_FORMATS)[number]));
  }),
);

// ── Evidence attachments ──────────────────────────────────────────────────

const uploadBody = express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES });

/** Upload: the file is the raw request body; its name comes in the X-File-Name header. */
campaignsRouter.post(
  '/manual-checks/:metaCampaignId/:key/attachments',
  requireRole('auditor'),
  (req, res, next) => uploadBody(req, res, (err?: unknown) => (err ? next(badRequest(`Files can be up to ${MAX_ATTACHMENT_BYTES / 1_048_576} MB.`)) : next())),
  asyncHandler(async (req, res) => {
    const metaCampaignId = String(req.params.metaCampaignId);
    const key = String(req.params.key);
    if (!MANUAL_KEYS.has(key)) throw badRequest('Unknown manual check.');
    if (!(await campaignExists(metaCampaignId))) throw notFoundError('Campaign not found.');
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || data.length === 0) throw badRequest('The file is empty.');
    let fileName = 'evidence';
    try {
      fileName = decodeURIComponent(req.get('x-file-name') ?? 'evidence');
    } catch {
      // keep the default
    }
    fileName = fileName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150) || 'evidence';
    // Some browsers send a generic type (CSV as application/vnd.ms-excel); fall back to the extension.
    const sent = (req.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
    const contentType = ATTACHMENT_TYPES[sent] ? sent : (ATTACHMENT_EXTENSIONS[ext] ?? '');
    if (!ATTACHMENT_TYPES[contentType]) {
      throw badRequest(`This file type is not accepted. Use: ${[...new Set(Object.values(ATTACHMENT_TYPES))].join(', ')}.`);
    }
    await saveAttachment({ metaCampaignId, itemKey: key, fileName, contentType, data, userId: req.user!.id });
    res.status(201).json({ manualChecks: await getManualChecks(metaCampaignId) });
  }),
);

/** Always sent as a download, never displayed inline, so an uploaded file cannot run in the app. */
campaignsRouter.get(
  '/attachments/:fileId',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const r = store.c.attachments.get(String(req.params.fileId));
    if (!r) throw notFoundError('Attachment not found.');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.type(r.contentType).attachment(r.fileName).sendFile(attachmentPath(r));
  }),
);

campaignsRouter.delete(
  '/attachments/:fileId',
  requireRole('auditor'),
  asyncHandler(async (req, res) => {
    const r = store.c.attachments.get(String(req.params.fileId));
    if (!r || !(await deleteAttachment(r.id))) throw notFoundError('Attachment not found.');
    res.json({ manualChecks: await getManualChecks(r.metaCampaignId) });
  }),
);
