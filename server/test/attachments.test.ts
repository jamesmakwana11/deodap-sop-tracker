/** Manual-check evidence attachments. */
import { readdir } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seedDevData } from '../src/dev/seedDevData.js';
import { closeStore, store } from '../src/storage/store.js';
import { CSRF, prepareDb, resetDb, signedIn } from './helpers.js';

const app = createApp();
beforeAll(prepareDb);
beforeEach(async () => {
  await resetDb();
  await seedDevData();
});
afterAll(() => closeStore());

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('evidence attachments', () => {
  it('uploads, lists, downloads as a file and deletes', async () => {
    const { agent: auditor } = await signedIn(app, 'auditor');
    const up = await auditor
      .post('/api/manual-checks/dev-c-001/stock/attachments')
      .set(CSRF)
      .set('Content-Type', 'image/png')
      .set('X-File-Name', encodeURIComponent('stock screenshot ../../x.png'))
      .send(png);
    expect(up.status).toBe(201);
    const item = up.body.manualChecks.find((m: { key: string }) => m.key === 'stock');
    expect(item.attachments).toHaveLength(1);
    const att = item.attachments[0];
    expect(att.fileName).toBe('stock screenshot .._.._x.png'); // no path separators survive
    expect(await readdir(store.path('attachments'))).toEqual([att.id]); // stored under a random id

    const { agent: viewer } = await signedIn(app, 'viewer');
    const dl = await viewer.get(`/api/attachments/${att.id}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(dl.body as Buffer, png)).toBe(0);

    expect((await viewer.delete(`/api/attachments/${att.id}`).set(CSRF)).status).toBe(403);
    const del = await auditor.delete(`/api/attachments/${att.id}`).set(CSRF);
    expect(del.status).toBe(200);
    expect(await readdir(store.path('attachments'))).toEqual([]);
  });

  it('rejects viewers, unknown types, empty and oversized files', async () => {
    const { agent: viewer } = await signedIn(app, 'viewer');
    const { agent: auditor } = await signedIn(app, 'auditor');
    const url = '/api/manual-checks/dev-c-001/stock/attachments';
    expect((await viewer.post(url).set(CSRF).set('Content-Type', 'image/png').send(png)).status).toBe(403);
    expect((await auditor.post(url).set(CSRF).set('Content-Type', 'text/html').send('<script>x</script>')).status).toBe(400);
    expect((await auditor.post(url).set(CSRF).set('Content-Type', 'image/svg+xml').send('<svg/>')).status).toBe(400);
    expect((await auditor.post(url).set(CSRF).set('Content-Type', 'image/png').send(Buffer.alloc(0))).status).toBe(400);
    const big = await auditor.post(url).set(CSRF).set('Content-Type', 'application/pdf').send(Buffer.alloc(10 * 1024 * 1024 + 1));
    expect(big.status).toBe(400);
    expect(big.body.error).toMatch(/up to 10 MB/);
  });

  it('uses the file extension when the browser sends a generic type', async () => {
    const { agent: auditor } = await signedIn(app, 'auditor');
    const url = '/api/manual-checks/dev-c-001/sku/attachments';
    const ok = await auditor.post(url).set(CSRF).set('Content-Type', 'application/vnd.ms-excel').set('X-File-Name', 'skus.csv').send('a,b\n1,2\n');
    expect(ok.status).toBe(201);
    const file = ok.body.manualChecks.find((c: { key: string }) => c.key === 'sku').attachments[0];
    expect(file).toMatchObject({ fileName: 'skus.csv', contentType: 'text/csv' });
    const bad = await auditor.post(url).set(CSRF).set('Content-Type', 'application/octet-stream').set('X-File-Name', 'page.html').send('<b>x</b>');
    expect(bad.status).toBe(400);
  });

  it('is kept in backups', async () => {
    const { agent: auditor } = await signedIn(app, 'auditor');
    await auditor.post('/api/manual-checks/dev-c-001/sku/attachments').set(CSRF).set('Content-Type', 'text/plain').send('SKU list');
    const b = await store.backup('test');
    expect(Object.keys(b.files).some((f) => f.startsWith('attachments/'))).toBe(true);
  });
});
