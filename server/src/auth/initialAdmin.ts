import { MIN_PASSWORD_LENGTH } from '@sop/shared';
import { z } from 'zod';
import { insertUser } from '../repositories/userRepository.js';
import { store } from '../storage/store.js';
import { hashPassword } from './password.js';

/**
 * First-time admin from INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD, for hosts where no one can
 * run `npm run user:create` before the first sign-in (e.g. Render).
 *
 * Runs at start-up and only acts when the data folder has no users at all. It never changes,
 * re-creates or resets an existing user, so the variables are ignored after the first start and a
 * later change to them has no effect. The password is stored only as a scrypt hash.
 */

export type InitialAdminResult = 'created' | 'users-exist' | 'not-configured';

const Input = z.object({
  email: z.string().trim().toLowerCase().email('INITIAL_ADMIN_EMAIL is not a valid email address.').max(200, 'INITIAL_ADMIN_EMAIL is too long.'),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `INITIAL_ADMIN_PASSWORD must have at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(200, 'INITIAL_ADMIN_PASSWORD must have at most 200 characters.')
    .refine((p) => p.trim() === p, 'INITIAL_ADMIN_PASSWORD must not start or end with a space.'),
  name: z.string().trim().min(1).max(120, 'INITIAL_ADMIN_NAME is too long.'),
});

export async function ensureInitialAdmin(cfg: { email?: string; password?: string; name?: string }): Promise<InitialAdminResult> {
  if (store.c.users.all().length > 0) return 'users-exist';
  if (!cfg.email && !cfg.password) return 'not-configured';
  if (!cfg.email || !cfg.password) {
    throw new Error('Set both INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD to create the first admin (or neither).');
  }
  const parsed = Input.safeParse({ email: cfg.email, password: cfg.password, name: cfg.name || 'Admin' });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(' '));

  const { email, password, name } = parsed.data;
  await insertUser({ email, name, role: 'admin', passwordHash: await hashPassword(password), mustChangePassword: false });
  return 'created';
}
