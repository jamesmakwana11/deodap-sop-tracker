import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { csrfGuard, loadUser, requireRole } from './auth/middleware.js';
import { env, isProduction } from './config/env.js';
import { HttpError } from './http/errors.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { campaignsRouter } from './routes/campaigns.js';
import { dashboardRouter } from './routes/dashboard.js';
import { healthRouter } from './routes/health.js';
import { metaRouter } from './routes/meta.js';
import { exportsRouter } from './routes/exports.js';
import { reportsRouter } from './routes/reports.js';
import { syncRouter } from './routes/sync.js';
import { systemRouter } from './routes/system.js';
import { usersRouter } from './routes/users.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Trust X-Forwarded-* only from known proxies: TRUST_PROXY hops, or Render's one proxy (Render sets RENDER=true).
  const proxies = env.TRUST_PROXY > 0 ? env.TRUST_PROXY : process.env.RENDER === 'true' ? 1 : 0;
  if (proxies > 0) app.set('trust proxy', proxies);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          // Creative thumbnails come from Meta's CDNs.
          imgSrc: ["'self'", 'data:', 'https://*.fbcdn.net', 'https://*.facebook.com', 'https://*.cdninstagram.com'],
          // Ad previews are Meta-hosted iframes.
          frameSrc: ['https://www.facebook.com', 'https://business.facebook.com'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true, exposedHeaders: ['Content-Disposition', 'X-Report-Id'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/health', healthRouter);

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 5 * 60_000,
      limit: env.NODE_ENV === 'test' ? 100_000 : 1500,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new HttpError(429, 'Too many requests. Wait a minute and try again.')),
    }),
  );
  api.use(csrfGuard, loadUser);
  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/meta', metaRouter);
  api.use('/dashboard', requireRole('viewer'), dashboardRouter);
  api.use(syncRouter);
  api.use(campaignsRouter);
  api.use('/reports', reportsRouter);
  api.use('/exports', exportsRouter);
  api.use('/system', systemRouter);
  app.use('/api', api);
  app.use('/api', notFound);

  // Production: serve the built React app and let it handle its own routes.
  if (env.CLIENT_DIST_DIR) {
    const dist = path.resolve(env.CLIENT_DIST_DIR);
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '365d' }));
    app.use(express.static(dist, { index: false, maxAge: '5m' }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
