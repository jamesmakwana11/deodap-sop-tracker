/** JSON file storage: persistence, outside writers, atomic files. */
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonCollection } from '../src/storage/collection.js';
import { flushWrites } from '../src/storage/jsonFiles.js';

const tempFile = async () => path.join(await mkdtemp(path.join(tmpdir(), 'sop-store-')), 'things.json');

describe('JsonCollection', () => {
  it('persists every change to disk and survives a reopen', async () => {
    const file = await tempFile();
    const a = new JsonCollection<{ id: string; n: number }>(file);
    await a.load();
    await a.insert({ n: 1 });
    await a.insert({ n: 2 });
    await a.update('1', { n: 10 });
    await a.remove((r) => r.id === '2');

    const reopened = new JsonCollection<{ id: string; n: number }>(file);
    await reopened.load();
    expect(reopened.all()).toEqual([{ id: '1', n: 10 }]);
    expect((await reopened.insert({ n: 3 })).id).toBe('3'); // ids keep counting after a reopen
  });

  it('sees writes made by another process and never overwrites them', async () => {
    const file = await tempFile();
    const server = new JsonCollection<{ id: string; name: string }>(file);
    const cli = new JsonCollection<{ id: string; name: string }>(file);
    await server.load();
    await cli.load();

    await cli.insert({ name: 'created from the command line' });
    expect(server.all().map((r) => r.name)).toEqual(['created from the command line']);

    await server.insert({ name: 'created by the server' });
    const onDisk = JSON.parse(await readFile(file, 'utf8')) as { rows: { name: string }[] };
    expect(onDisk.rows.map((r) => r.name)).toEqual(['created from the command line', 'created by the server']);
  });

  it('leaves no temporary files behind', async () => {
    const file = await tempFile();
    const c = new JsonCollection<{ id: string }>(file);
    await c.load();
    await Promise.all(Array.from({ length: 20 }, () => c.insert({})));
    await flushWrites();
    expect(await readdir(path.dirname(file))).toEqual(['things.json']);
    expect(c.all()).toHaveLength(20);
  });
});

describe('JsonCollection under concurrent writes', () => {
  it('never loses rows while its own writes are queued', async () => {
    const file = await tempFile();
    const c = new JsonCollection<{ id: string }>(file);
    await c.load();
    const inserts = Array.from({ length: 50 }, () => c.insert({}));
    // Reads in between must not reload a half-way file and drop queued rows.
    for (let i = 0; i < 50; i++) {
      c.all();
      await new Promise((r) => setImmediate(r));
    }
    await Promise.all(inserts);
    await c.update('1', {});
    const reopened = new JsonCollection<{ id: string }>(file);
    await reopened.load();
    expect(reopened.all()).toHaveLength(50);
  });
});
