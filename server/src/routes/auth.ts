import { MIN_PASSWORD_LENGTH } from '@sop/shared';
import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../auth/password.js';
import { requireUser } from '../auth/middleware.js';
import { createSession, deleteSession, deleteUserSessions, SESSION_COOKIE } from '../auth/sessions.js';
import { cookieSecure } from '../config/env.js';
import { badRequest, HttpError, unauthorized } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { findUserByEmail, findUserById, recordLogin, setPassword, toAuthUser } from '../repositories/userRepository.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, _res, next) => next(new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.')),
});

function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

const LoginBody = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parse(LoginBody, req.body);
    const user = await findUserByEmail(email);
    if (!user) {
      await burnPasswordCheck(password);
      throw unauthorized('Email or password is incorrect.');
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok || !user.isActive) throw unauthorized('Email or password is incorrect.');

    const { token, expiresAt } = await createSession(user.id, req.get('user-agent'));
    await recordLogin(user.id);
    setSessionCookie(res, token, expiresAt);
    res.json({ user: toAuthUser(user) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (req.sessionToken) await deleteSession(req.sessionToken);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  }),
);

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ?? null });
});

const PasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`).max(200),
});

authRouter.post(
  '/password',
  requireUser,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parse(PasswordBody, req.body);
    const user = await findUserById(req.user!.id);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect.');
    }
    if (currentPassword === newPassword) throw badRequest('Choose a password different from the current one.');
    await setPassword(user.id, await hashPassword(newPassword), false);
    await deleteUserSessions(user.id, req.sessionToken);
    res.json({ user: { ...toAuthUser(user), mustChangePassword: false } });
  }),
);
