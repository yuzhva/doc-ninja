import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { MegaSearch } from 'toolkit--local/node';

import { MegaSearchEngines } from '../mega-search-engines.mjs';
import type { MegaSearchEnginesOptions } from '../mega-search-engines.mjs';

/**
 * Engines that record what was asked of them: `log` lists each creation
 * ("create /docs"), engine cache delete ("engine clear /docs"), cache
 * delete without an engine ("clear /docs") and engine close ("close
 * /docs"), in order.
 */
const fakeEngines = (
  options: Partial<MegaSearchEnginesOptions> & {
    failFirstCreation?: boolean;
  } = {},
) => {
  const log: string[] = [];
  let creations = 0;
  const engines = new MegaSearchEngines({
    createEngine: async (rootDirectory) => {
      log.push(`create ${rootDirectory}`);
      if (options.failFirstCreation && creations++ === 0) {
        throw new Error('index failed');
      }
      return {
        rootDirectory,
        clearCache: async () => {
          log.push(`engine clear ${rootDirectory}`);
        },
      } as unknown as MegaSearch;
    },
    clearCacheOf: async (rootDirectory) => {
      log.push(`clear ${rootDirectory}`);
    },
    closeEngine: (megaSearch) => {
      log.push(`close ${(megaSearch as any).rootDirectory}`);
    },
    ...options,
  });
  return { engines, log };
};

const docs = path.resolve('/docs');

describe('MegaSearchEngines', () => {
  it('shares one engine per folder, created once when requests come at once', async () => {
    const { engines, log } = fakeEngines();

    const [first, second] = await Promise.all([
      engines.get(docs),
      engines.get(docs),
    ]);
    const later = await engines.get(docs);

    assert.deepEqual(log, [`create ${docs}`]);
    assert.equal(first.megaSearch, second.megaSearch);
    assert.equal(first.megaSearch, later.megaSearch);
    assert.deepEqual(
      [first.isNew, second.isNew, later.isNew],
      [true, false, false],
    );
  });

  it('takes a folder however its path is written for the same folder', async () => {
    const { engines, log } = fakeEngines();

    const { megaSearch } = await engines.get(docs);
    for (const spelling of [
      docs + path.sep,
      path.join(docs, 'orders', '..'),
      ...(process.platform === 'win32' ? [docs.toUpperCase()] : []),
    ]) {
      assert.equal((await engines.get(spelling)).megaSearch, megaSearch);
    }
    assert.deepEqual(log, [`create ${docs}`]);
  });

  it('keeps only the folder searched last by default', async () => {
    const { engines, log } = fakeEngines();

    await engines.get('/a');
    await engines.get('/b'); // lets go of /a

    assert.equal((await engines.get('/b')).isNew, false);
    assert.deepEqual(log, ['create /a', 'create /b', 'close /a']);
  });

  it('keeps the most recently searched folders within the limit', async () => {
    const { engines, log } = fakeEngines({ maxEngines: 2 });

    await engines.get('/a');
    await engines.get('/b');
    await engines.get('/a'); // /b is now the least recently searched
    await engines.get('/c'); // lets go of /b
    await engines.get('/a');
    await engines.get('/b'); // created again

    assert.deepEqual(log, [
      'create /a',
      'create /b',
      'create /c',
      'close /b',
      'create /b',
      'close /c',
    ]);
  });

  it('lets go of an engine nobody asked for in idleMs, and keeps one in use', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { engines, log } = fakeEngines({ idleMs: 1000, maxEngines: 2 });

    await engines.get('/a');
    await engines.get('/b');
    t.mock.timers.tick(600);
    await engines.get('/a'); // starts /a's wait over
    t.mock.timers.tick(600); // /b waited 1200 ms, /a 600 ms

    assert.equal((await engines.get('/a')).isNew, false);
    assert.equal((await engines.get('/b')).isNew, true);
    assert.deepEqual(log, ['create /a', 'create /b', 'close /b', 'create /b']);
  });

  it('does not keep an engine whose creation failed', async () => {
    const { engines, log } = fakeEngines({ failFirstCreation: true });

    await assert.rejects(engines.get(docs), /index failed/);
    const retry = await engines.get(docs);

    assert.equal(retry.isNew, true);
    assert.deepEqual(log, [`create ${docs}`, `create ${docs}`]);
  });

  describe('clearCache()', () => {
    it('deletes through the live engine and keeps it, to index anew', async () => {
      const { engines, log } = fakeEngines();
      const { megaSearch } = await engines.get(docs);

      await engines.clearCache(docs);
      const after = await engines.get(docs);

      assert.equal(after.megaSearch, megaSearch);
      assert.equal(after.isNew, false);
      assert.deepEqual(log, [`create ${docs}`, `engine clear ${docs}`]);
    });

    it('creates no engine for a folder without one', async () => {
      const { engines, log } = fakeEngines();

      await engines.clearCache(docs);

      assert.deepEqual(log, [`clear ${docs}`]);
    });

    it('makes a search that comes in meanwhile wait for the delete', async () => {
      let finishClear = () => {};
      const { engines, log } = fakeEngines({
        clearCacheOf: async (rootDirectory) => {
          log.push(`clear ${rootDirectory} started`);
          await new Promise<void>((resolve) => (finishClear = resolve));
          log.push(`clear ${rootDirectory} done`);
        },
      });

      const clearing = engines.clearCache(docs);
      const searching = engines.get(docs);
      await new Promise((resolve) => setImmediate(resolve));
      finishClear();
      await Promise.all([clearing, searching]);

      assert.deepEqual(log, [
        `clear ${docs} started`,
        `clear ${docs} done`,
        `create ${docs}`,
      ]);
    });

    it('deletes without an engine when the folder failed to get one', async () => {
      const { engines, log } = fakeEngines({ failFirstCreation: true });
      const failed = engines.get(docs).catch(() => undefined);

      await engines.clearCache(docs);
      await failed;

      assert.deepEqual(log, [`create ${docs}`, `clear ${docs}`]);
    });
  });
});
