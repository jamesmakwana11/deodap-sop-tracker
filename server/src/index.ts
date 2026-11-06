import { createApp } from './app.js';
import { ensureInitialAdmin } from './auth/initialAdmin.js';
import { env } from './config/env.js';
import { ensureRulesSaved } from './services/rulesSnapshot.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { getStorageStatus, insideFolder } from './services/storageStatus.js';
import { claimServerLock, releaseServerLock } from './storage/serverLock.js';
import { closeStore, DEFAULT_DATA_DIR, openStore, store } from './storage/store.js';

async function main() {
  const dir = env.DATA_DIR || DEFAULT_DATA_DIR;
  if (env.CLIENT_DIST_DIR && insideFolder(dir, env.CLIENT_DIST_DIR)) {
    throw new Error('DATA_DIR is inside the public web folder (CLIENT_DIST_DIR). Choose a folder outside it.');
  }
  await openStore(dir);
  await claimServerLock(store.dataDir);
  await ensureRulesSaved();

  const admin = await ensureInitialAdmin({ email: env.INITIAL_ADMIN_EMAIL, password: env.INITIAL_ADMIN_PASSWORD, name: env.INITIAL_ADMIN_NAME });
  if (admin === 'created') console.log(`Created the first admin (${env.INITIAL_ADMIN_EMAIL!.toLowerCase()}) from INITIAL_ADMIN_EMAIL.`);
  else if (admin === 'users-exist' && (env.INITIAL_ADMIN_EMAIL || env.INITIAL_ADMIN_PASSWORD)) {
    console.log('[users] Users already exist, so INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD are ignored (nothing was changed). You can remove them.');
  } else if (admin === 'not-configured') {
    console.warn('[users] No users yet. Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD, or run: npm run user:create -- --email <email> --name "<name>" --role admin');
  }

  const status = await getStorageStatus();
  console.log(`Data folder: ${store.dataDir} (storage ${status.persistence})`);
  for (const m of status.messages) console.warn(`[storage] ${m}`);
  if (!status.writable) throw new Error('The data folder is not writable.');

  const server = createApp().listen(env.PORT, () => {
    console.log(`SOP tracker listening on http://localhost:${env.PORT}`);
  });
  startScheduler();

  const shutdown = () => {
    stopScheduler();
    server.close(() => {
      void closeStore()
        .then(() => releaseServerLock(store.dataDir))
        .then(() => process.exit(0));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
