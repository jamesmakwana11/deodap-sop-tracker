/** Integrity checks, backups, restore, storage status and Meta app settings. */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createRun, finishRun, insertCampaignAudit, upsertAdAccount } from '../src/repositories/auditWriter.js';
import { listBackups, pruneBackups, restoreBackup, verifyBackup } from '../src/storage/backups.js';
import { closeStore, openStore, store } from '../src/storage/store.js';
import { dailyBackupIfDue, getStorageStatus } from '../src/services/storageStatus.js';
import { claimServerLock, releaseServerLock, serverIsRunning } from '../src/storage/serverLock.js';
import { CSRF, signedIn } from './helpers.js';

const freshDir = () => mkdtemp(path.join(tmpdir(), 'sop-harden-'));
afterAll(() => closeStore());

async function seedUser(name: string) {
  await store.c.users.insert({
    email: `${name}@x.test`, name, passwordHash: 'x', role: 'viewer', isActive: true, mustChangePassword: false,
    createdAt: '', updatedAt: '', lastLoginAt: null,
  });
}

describe('integrity checks', () => {
  it('writes a checksum and accepts a hand edit with a warning', async () => {
    const dir = await freshDir();
    await openStore(dir);
    await seedUser('ana');
    const file = path.join(dir, 'users.json');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved).toMatchObject({ format: 'sop-tracker-collection', version: 2 });
    expect(saved.checksum).toMatch(/^[0-9a-f]{64}$/);

    saved.rows[0].name = 'Ana (edited)';
    await writeFile(file, JSON.stringify(saved));
    await openStore(dir);
    expect(store.c.users.all()[0]!.name).toBe('Ana (edited)');
    expect(store.warnings.at(-1)?.message).toMatch(/changed outside the app/);
  });

  it('restores a damaged file from the newest backup on start-up', async () => {
    const dir = await freshDir();
    await openStore(dir);
    await seedUser('before-backup');
    await store.backup('test');
    await seedUser('after-backup');
    await writeFile(path.join(dir, 'users.json'), '{"rows": [ truncated');

    await openStore(dir);
    expect(store.c.users.all().map((u) => u.name)).toEqual(['before-backup']);
    expect(store.warnings.some((w) => /Restored it from backup/.test(w.message))).toBe(true);
  });

  it('refuses to start, rather than lose data, when no backup can repair a file', async () => {
    const dir = await freshDir();
    await openStore(dir);
    await seedUser('x');
    await writeFile(path.join(dir, 'users.json'), 'not json');
    await expect(openStore(dir)).rejects.toThrow(/will not start rather than lose data/);
  });

  it('rejects structurally broken data such as duplicate ids', async () => {
    const dir = await freshDir();
    await writeFile(path.join(dir, 'users.json'), JSON.stringify({ nextId: 3, rows: [{ id: '1' }, { id: '1' }] }));
    await expect(openStore(dir)).rejects.toThrow(/duplicate id 1/);
  });

  it('recovers a damaged audit run file from a backup', async () => {
    const dir = await freshDir();
    await openStore(dir);
    const runId = await createRun({ source: 'meta', trigger: 'manual', periodStart: '2026-10-30', periodEnd: '2026-11-05' });
    const acc = await upsertAdAccount({ metaAccountId: '1', name: 'A' });
    await insertCampaignAudit(runId, acc, {
      metaCampaignId: 'c1', name: 'C1', objectiveRaw: 'OUTCOME_SALES', objective: 'Sales', effectiveStatus: 'ACTIVE',
      currency: 'INR', spend7d: 1, mainMetric: null, rating: 'NOT_RATED', ratingIndicative: false, checks: [],
    });
    await finishRun(runId, 'succeeded');
    expect(store.c.auditRuns.get(runId)!.rulesVersion).toMatch(/^[0-9a-f]{12}$/); // rule set recorded with the run
    await store.backup('test');
    await writeFile(path.join(dir, 'audits', `run-${runId}.json`), '[{"id": ');
    await openStore(dir);
    expect((await store.readRunAudits(runId)).map((c) => c.name)).toEqual(['C1']);
  });
});

describe('backups and restore', () => {
  it('backs up, verifies, restores (with a safety backup) and prunes', async () => {
    const dir = await freshDir();
    await openStore(dir);
    await seedUser('one');
    const b1 = await store.backup('first');
    expect(Object.keys(b1.files)).toContain('users.json');
    expect(await verifyBackup(dir, b1.name)).toEqual([]);

    await seedUser('two');
    const { safetyBackup } = await restoreBackup(dir, b1.name);
    await openStore(dir);
    expect(store.c.users.all().map((u) => u.name)).toEqual(['one']);
    expect((await listBackups(dir)).map((b) => b.name)).toContain(safetyBackup);

    await writeFile(path.join(dir, 'backups', b1.name, 'users.json'), 'tampered');
    expect((await verifyBackup(dir, b1.name))[0]).toMatch(/checksum does not match/);
    await expect(restoreBackup(dir, b1.name)).rejects.toThrow(/integrity check/);

    await pruneBackups(dir, 1);
    expect(await listBackups(dir)).toHaveLength(1);
  });

  it('makes one daily backup per day', async () => {
    const dir = await freshDir();
    await openStore(dir);
    expect(await dailyBackupIfDue()).toBe(true);
    expect(await dailyBackupIfDue()).toBe(false);
    expect(await dailyBackupIfDue(Date.now() + 86_400_001)).toBe(true);
  });

  it('a restore refuses to run while a server uses the folder', async () => {
    const dir = await freshDir();
    await writeFile(path.join(dir, 'server.pid'), String(process.ppid)); // a live process that is not us
    expect(await serverIsRunning(dir)).toBe(true);
    await expect(claimServerLock(dir)).rejects.toThrow(/already using/);
    await writeFile(path.join(dir, 'server.pid'), '999999'); // stale
    await claimServerLock(dir);
    await releaseServerLock(dir);
  });
});

describe('storage status and Meta app settings', () => {
  it('reports status to admins only and keeps the App Secret write-only', async () => {
    const dir = await freshDir();
    await openStore(dir);
    const app = createApp();
    const { agent: viewer } = await signedIn(app, 'viewer');
    const { agent: admin } = await signedIn(app, 'admin');

    expect((await viewer.get('/api/system/storage')).status).toBe(403);
    // Everyone signed in can see whether storage is safe, without paths.
    expect((await viewer.get('/api/system/health')).body).toEqual({ persistence: expect.stringMatching(/^(ok|warning|error)$/) });
    const status = (await admin.get('/api/system/storage')).body;
    expect(status).toMatchObject({ dataDir: dir, writable: true });
    expect((await admin.post('/api/system/backups').set(CSRF)).status).toBe(201);
    expect((await getStorageStatus()).backups).toHaveLength(1);

    const bad = await admin.put('/api/meta/app').set(CSRF).send({ appId: '123456789012345', appSecret: 'short' });
    expect(bad.status).toBe(400);
    const secret = '0123456789abcdef0123456789abcdef';
    const saved = await admin.put('/api/meta/app').set(CSRF).send({ appId: '123456789012345', appSecret: secret });
    expect(saved.status).toBe(200);
    expect(saved.body.app).toMatchObject({ appId: '123456789012345', hasAppSecret: true, source: 'settings' });
    expect(JSON.stringify(saved.body)).not.toContain(secret);
    expect(await readFile(path.join(dir, 'settings.json'), 'utf8')).not.toContain(secret); // encrypted at rest

    const meta = (await admin.get('/api/meta/status')).body;
    expect(meta.app.appId).toBe('123456789012345');
    expect(JSON.stringify(meta)).not.toContain(secret);
    const start = new URL((await admin.get('/api/meta/oauth/start')).body.url);
    expect(start.searchParams.get('client_id')).toBe('123456789012345');
    expect((await viewer.put('/api/meta/app').set(CSRF).send({ appId: '1234567' })).status).toBe(403);
  });
});
