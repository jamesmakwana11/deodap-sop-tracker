import { randomBytes } from 'node:crypto';
import type { MetaStatusResponse } from '@sop/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { env } from '../config/env.js';
import { badRequest, HttpError, notFoundError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { MetaApiError } from '../meta/graphClient.js';
import { graphVersion, metaAppPublicConfig, saveMetaAppConfig } from '../meta/appConfig.js';
import { buildAuthorizeUrl, metaAppConfig, requireMetaAppConfig } from '../meta/oauth.js';
import { encryptionKeySource } from '../security/tokenCrypto.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  consumeOAuthState,
  deleteConnection,
  listAccounts,
  listConnections,
  putSetting,
  saveOAuthState,
  setAccountSelected,
} from '../repositories/metaRepository.js';
import { connectWithCode, connectWithToken, discoverAccounts } from '../services/metaConnectionService.js';
import { getSyncTimeIst, nextRunAt, SYNC_TIME_SETTING } from '../services/scheduleTime.js';
import { numericIdParams } from '../http/params.js';

export const metaRouter = Router();
numericIdParams(metaRouter, 'id');

metaRouter.get(
  '/status',
  requireRole('viewer'),
  asyncHandler(async (_req, res) => {
    const timeIst = await getSyncTimeIst();
    const body: MetaStatusResponse = {
      oauthConfigured: Boolean(metaAppConfig()) && encryptionKeySource() !== 'none',
      tokenStorageConfigured: encryptionKeySource() !== 'none',
      graphVersion: graphVersion(),
      app: metaAppPublicConfig(),
      encryptionKey: encryptionKeySource(),
      connections: await listConnections(),
      accounts: await listAccounts(),
      schedule: { timeIst, nextRunAt: timeIst ? nextRunAt(timeIst).toISOString() : null },
    };
    res.json(body);
  }),
);

/** Step 1: the admin's browser asks for the Facebook login URL, carrying a one-time state. */
metaRouter.get(
  '/oauth/start',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const cfg = requireMetaAppConfig();
    const state = randomBytes(24).toString('base64url');
    await saveOAuthState(state, req.user!.id);
    res.json({ url: buildAuthorizeUrl(cfg, state) });
  }),
);

/** Step 2: Facebook redirects here. Always ends with a redirect back to Settings. */
metaRouter.get('/oauth/callback', async (req, res) => {
  const back = (params: Record<string, string>) =>
    res.redirect(`${env.CLIENT_ORIGIN}/settings?${new URLSearchParams(params).toString()}`);
  try {
    if (!req.user || req.user.role !== 'admin' || req.user.mustChangePassword) return back({ meta: 'error', reason: 'Sign in as an admin, then connect again.' });
    const { code, state, error_description: denied } = req.query as Record<string, string | undefined>;
    if (denied || !code) return back({ meta: 'error', reason: denied ?? 'Meta did not return an authorisation code.' });
    if (!state || !(await consumeOAuthState(state, req.user.id))) {
      return back({ meta: 'error', reason: 'The sign-in link expired or was already used. Try again.' });
    }
    const { accountsFound } = await connectWithCode(code, req.user.id);
    return back({ meta: 'connected', accounts: String(accountsFound) });
  } catch (err) {
    console.error('Meta OAuth callback failed', err instanceof Error ? err.message : err);
    const reason = err instanceof HttpError || err instanceof MetaApiError ? err.message : 'Could not complete the Meta connection.';
    return back({ meta: 'error', reason });
  }
});

const TokenBody = z.object({ accessToken: z.string().trim().min(20).max(1000) });

metaRouter.post(
  '/connections/token',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { accessToken } = parse(TokenBody, req.body);
    const { connection, accountsFound } = await connectWithToken(accessToken, req.user!.id);
    res.status(201).json({ connection, accountsFound });
  }),
);

metaRouter.post(
  '/connections/:id/discover',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const accountsFound = await discoverAccounts(String(req.params.id));
    res.json({ accountsFound });
  }),
);

/** Forgets the stored token. Past audit records are kept. */
metaRouter.delete(
  '/connections/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    if (!(await deleteConnection(String(req.params.id)))) throw notFoundError('Connection not found.');
    res.json({ ok: true });
  }),
);

const SelectBody = z.object({ selected: z.boolean() });

metaRouter.patch(
  '/accounts/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { selected } = parse(SelectBody, req.body);
    const account = await setAccountSelected(String(req.params.id), selected);
    if (!account) throw notFoundError('Ad account not found.');
    res.json({ account });
  }),
);

const ScheduleBody = z.object({
  timeIst: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour).')
    .nullable(),
});

metaRouter.put(
  '/schedule',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { timeIst } = parse(ScheduleBody, req.body);
    await putSetting(SYNC_TIME_SETTING, { time: timeIst }, req.user!.id);
    res.json({ schedule: { timeIst, nextRunAt: timeIst ? nextRunAt(timeIst).toISOString() : null } });
  }),
);

const AppBody = z.object({
  appId: z.string().trim().regex(/^\d{5,25}$/, 'The App ID is the number shown in the Meta app dashboard.'),
  appSecret: z.string().trim().max(200).optional().nullable(),
  redirectUri: z.string().trim().url().max(500).optional().nullable().or(z.literal('')),
  graphVersion: z.string().trim().regex(/^v\d+\.\d+$/, 'Use a version like v26.0.').optional().nullable().or(z.literal('')),
});

/** Meta app settings. The App Secret is write-only: it is encrypted and never sent back. */
metaRouter.get(
  '/app',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    res.json({ app: metaAppPublicConfig() });
  }),
);

metaRouter.put(
  '/app',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = parse(AppBody, req.body);
    if (body.appSecret && !/^[0-9a-f]{32}$/i.test(body.appSecret)) {
      throw badRequest('The App Secret is the 32-character code under App settings → Basic.');
    }
    const app = await saveMetaAppConfig(body, req.user!.id);
    if (!app.hasAppSecret) throw badRequest('Enter the App Secret too. It is stored encrypted and never shown again.');
    res.json({ app });
  }),
);
