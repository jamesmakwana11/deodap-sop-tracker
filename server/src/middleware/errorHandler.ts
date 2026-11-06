import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from '../http/errors.js';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' });
};

/**
 * HttpErrors carry a client-safe message. Anything else is logged in full server-side
 * and the client sees a generic message (no stack traces, SQL or tokens).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  // Malformed JSON bodies from express.json()
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON.', code: 'bad_request' });
    return;
  }
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
};
