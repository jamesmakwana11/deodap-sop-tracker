/**
 * Creates a user from the command line — use it to make the first admin.
 *   npm run user:create -- --email you@deodap.com --name "Your Name" --role admin
 * Prints a temporary password once; the user must change it at first sign-in.
 */
import { parseArgs } from 'node:util';
import { ROLES, type Role } from '@sop/shared';
import { generatePassword, hashPassword } from '../auth/password.js';
import { closeStore, openStore } from '../storage/store.js';
import { findUserByEmail, insertUser } from '../repositories/userRepository.js';

async function main() {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'admin' } },
  });
  const email = values.email?.trim();
  const name = values.name?.trim();
  const role = values.role as Role;
  if (!email || !name) throw new Error('Usage: npm run user:create -- --email <email> --name "<name>" [--role admin|auditor|viewer]');
  if (!ROLES.includes(role)) throw new Error(`Role must be one of: ${ROLES.join(', ')}`);
  if (await findUserByEmail(email)) throw new Error(`A user with email ${email} already exists.`);

  const temporaryPassword = generatePassword();
  const user = await insertUser({ email, name, role, passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true });
  console.log(`Created ${user.role} ${user.email}`);
  console.log(`Temporary password (shown once): ${temporaryPassword}`);
}

openStore()
  .then(main)
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closeStore());
