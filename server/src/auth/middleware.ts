import { hasRole, type Role } from '@sop/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden, unauthorized } from '../http/errors.js';
import { findSessionUser, SESSION_COOKIE } from './sessions.js';

/** Attaches req.user when a valid session cookie is present. Never rejects on its own. */
export const loadUser: RequestHandler = (req, _res, next) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (!token) return next();
  findSessionUser(token)
    .then((user) => {
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
      next();
    })
    .catch(next);
};

export function requireRole(role: Role): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    // A user with a temporary password may only change it.
    if (req.user.mustChangePassword) return next(forbidden('Please set a new password first.'));
    if (!hasRole(req.user, role)) return next(forbidden());
    next();
  };
}

export const requireUser: RequestHandler = (req, _res, next) => (req.user ? next() : next(unauthorized()));

/**
 * CSRF guard for state-changing requests: the browser must send our custom header,
 * which a cross-site form or image cannot do without passing CORS.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-sop-csrf') !== '1') return next(forbidden('Missing request header.'));
  next();
};
