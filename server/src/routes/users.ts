import { ROLES } from '@sop/shared';
import { Router } from 'express';
import { z } from 'zod';
import { generatePassword, hashPassword } from '../auth/password.js';
import { requireRole } from '../auth/middleware.js';
import { deleteUserSessions } from '../auth/sessions.js';
import { badRequest, conflict, notFoundError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { numericIdParams } from '../http/params.js';
import {
  countActiveAdmins,
  findUserByEmail,
  findUserById,
  insertUser,
  listUsers,
  setPassword,
  updateUser,
} from '../repositories/userRepository.js';

/** Admin-only user management. New users and resets get a one-time temporary password. */
export const usersRouter = Router();
numericIdParams(usersRouter, 'id');
usersRouter.use(requireRole('admin'));

usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ users: await listUsers() });
  }),
);

const CreateBody = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(120),
  role: z.enum(ROLES),
});

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(CreateBody, req.body);
    if (await findUserByEmail(body.email)) throw conflict('A user with this email already exists.');
    const temporaryPassword = generatePassword();
    const user = await insertUser({ ...body, passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true });
    res.status(201).json({ user, temporaryPassword });
  }),
);

const UpdateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

usersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = parse(UpdateBody, req.body);
    const existing = await findUserById(id);
    if (!existing) throw notFoundError('User not found.');

    const losesAdmin = existing.role === 'admin' && existing.isActive && (body.role && body.role !== 'admin' || body.isActive === false);
    if (losesAdmin && (await countActiveAdmins()) <= 1) {
      throw badRequest('At least one active admin is required.');
    }
    const user = await updateUser(id, body);
    if (body.isActive === false) await deleteUserSessions(id);
    res.json({ user });
  }),
);

usersRouter.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!(await findUserById(id))) throw notFoundError('User not found.');
    const temporaryPassword = generatePassword();
    await setPassword(id, await hashPassword(temporaryPassword), true);
    await deleteUserSessions(id);
    res.json({ temporaryPassword });
  }),
);
