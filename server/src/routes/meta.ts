import { randomBytes } from 'node:crypto';
import type { MetaStatusResponse } from '@sop/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { env } from '../config/env.js';
import { badRequest, HttpError, notFoundError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { MetaApiError } from '../meta/graphClient.js';
import { graphVersion, metaAppPublicConfig, resolveRedirectUri, saveMetaAppConfig } from '../meta/appConfig.js';
import { detectedRedirectUri, isLoopbackHost, META_CALLBACK_PATH } from '../http/publicUrl.js';
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
import { addAccountById, connectWithCode, connectWithToken, recheckConnection } from '../services/metaConnectionService.js';
import { getSyncTimeIst, nextRunAt, SYNC_TIME_SETTING } from '../services/scheduleTime.js';
import { numericIdParams } from '../http/params.js';

export const metaRouter = Router();
numericIdParams(metaRouter, 'id');

metaRouter.get(
  '/status',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const timeIst = await getSyncTimeIst();
    const body: MetaStatusResponse = {
      oauthConfigured: Boolean(metaAppConfig()) && encryptionKeySource() !== 'none',
      tokenStorageConfigured: encryptionKeySource() !== 'none',
      graphVersion: graphVersion(),
      app: metaAppPublicConfig(detectedRedirectUri(req)),
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
    const redirectUri = resolveRedirectUri(cfg, detectedRedirectUri(req)).uri;
    const state = randomBytes(24).toString('base64url');
    await saveOAuthState(state, req.user!.id, redirectUri);
    res.json({ url: buildAuthorizeUrl(cfg, state, redirectUri), redirectUri });
  }),
);

/**
 * Step 2: Facebook redirects here. Always ends with a redirect back to Settings — a relative one,
 * so it stays on the domain this callback was reached on (localhost, Render or a custom domain).
 */
metaRouter.get('/oauth/callback', async (req, res) => {
  const back = (params: Record<string, string>) => res.redirect(`/settings?${new URLSearchParams(params).toString()}`);
  try {
    if (!req.user || req.user.role !== 'admin' || req.user.mustChangePassword) return back({ meta: 'error', reason: 'Sign in as an admin, then connect again.' });
    const { code, state, error_description: denied } = req.query as Record<string, string | undefined>;
    if (denied || !code) return back({ meta: 'error', reason: denied ?? 'Meta did not return an authorisation code.' });
    const savedRedirectUri = state ? await consumeOAuthState(state, req.user.id) : null;
    if (savedRedirectUri === null) {
      return back({ meta: 'error', reason: 'The sign-in link expired or was already used. Try again.' });
    }
    // Exactly the URI the login dialog received (older states without one: recompute it).
    const redirectUri = savedRedirectUri || resolveRedirectUri(requireMetaAppConfig(), detectedRedirectUri(req)).uri;
    const { accountsFound, report } = await connectWithCode(code, req.user.id, redirectUri);
    return back({ meta: 'connected', accounts: String(accountsFound), readable: String(report.readable) });
  } catch (err) {
    console.error('Meta OAuth callback failed', err instanceof Error ? err.message : err);
    const reason = err instanceof HttpError || err instanceof MetaApiError ? err.message : 'Could not complete the Meta connection.';
    return back({ meta: 'error', reason });
  }
});

const TokenBody = z.object({
  accessToken: z.string().trim().min(20, 'Paste the whole access token.').max(1000),
  /** Optional: ad account IDs to add when automatic discovery does not list them. */
  adAccountIds: z.array(z.string().max(2000)).max(50).optional(),
});

/** Validates the token (status, type, permissions, account access) before anything is saved. */
metaRouter.post(
  '/connections/token',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { accessToken, adAccountIds } = parse(TokenBody, req.body);
    const { connection, accountsFound, report } = await connectWithToken(accessToken, req.user!.id, adAccountIds);
    res.status(201).json({ connection, accountsFound, report });
  }),
);

/** "Check again": re-inspects the token, rediscovers accounts and test-reads each one. */
metaRouter.post(
  '/connections/:id/discover',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    res.json(await recheckConnection(String(req.params.id)));
  }),
);

const AccountBody = z.object({ adAccountId: z.string().trim().min(1).max(40) });

/** Manual fallback: add an ad account by ID once the token is shown to read it. */
metaRouter.post(
  '/connections/:id/accounts',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { adAccountId } = parse(AccountBody, req.body);
    res.status(201).json(await addAccountById(String(req.params.id), adAccountId));
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
  asyncHandler(async (req, res) => {
    res.json({ app: metaAppPublicConfig(detectedRedirectUri(req)) });
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
    if (body.redirectUri) {
      // Optional fixed URI: it must reach this app's callback route.
      const u = new URL(body.redirectUri);
      if (u.pathname !== META_CALLBACK_PATH || u.search || u.hash) throw badRequest(`A fixed redirect URI must end in ${META_CALLBACK_PATH}.`);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopbackHost(u.host))) throw badRequest('A fixed redirect URI must use https:// (http:// only for localhost).');
    }
    const app = await saveMetaAppConfig(body, req.user!.id, detectedRedirectUri(req));
    if (!app.hasAppSecret) throw badRequest('Enter the App Secret too. It is stored encrypted and never shown again.');
    res.json({ app });
  }),
);
