import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { knownBug } from '../../test-utils/known-bug.mjs';
import { createTempCorpus, later } from '../../test-utils/temp-corpus.mjs';
import type { TempCorpus } from '../../test-utils/temp-corpus.mjs';
import { UkrainianTextProcessor } from '../../text-processor.mjs';
import type { SearchConfig } from '../../types.mjs';
import { FileIndexer } from '../file-indexer.mjs';

const textProcessor = new UkrainianTextProcessor();

/** Names of the documents the inverted index lists for a word. */
const docsWithWord = (indexer: FileIndexer, word: string) =>
  (indexer.getInvertedIndex().get(textProcessor.stemWord(word)) ?? [])
    .map((entry) => path.basename(entry.documentId))
    .sort();

const STALE_EDIT_CAUSE =
  'an edited file that is already in the document cache is tallied as "cached-loaded" instead ' +
  'of "newly-indexed", so actuallyProcessed stays 0 — the inverted-index rebuild and the ' +
  'global-index save are both skipped and the old postings keep being served';

describe('FileIndexer', () => {
  let corpus: TempCorpus;

  const newIndexer = (overrides: Partial<SearchConfig> = {}) =>
    new FileIndexer({
      rootDirectory: corpus.root,
      extensions: ['.txt'],
      maxFileSize: Infinity,
      concurrency: 1,
      ...overrides,
    });

  const indexed = async (overrides: Partial<SearchConfig> = {}) => {
    const indexer = newIndexer(overrides);
    await indexer.buildFullIndex();
    return indexer;
  };

  beforeEach(async () => {
    corpus = await createTempCorpus({
      'a.txt': 'Начальник підписав наказ.',
      'b.txt': 'Бюджет міста затверджено.',
    });
  });

  afterEach(() => corpus.cleanup());

  it('indexes every discovered document into a consistent inverted index', async () => {
    const indexer = await indexed();

    assert.equal(indexer.getStats().documentsCount, 2);
    assert.deepEqual(docsWithWord(indexer, 'наказ'), ['a.txt']);
    assert.deepEqual(docsWithWord(indexer, 'бюджет'), ['b.txt']);
    assert.deepEqual(await indexer.validateIndexHealth(), {
      isHealthy: true,
      issues: [],
    });
  });

  it('never indexes its own cache artifacts, even under a non-dot cacheRoot', async () => {
    // Regression guard for 42ee843f: '.json' would match the per-document
    // index files, '.txt' the extracted text cache.
    const config = { cacheRoot: 'search-cache', extensions: ['.txt', '.json'] };

    assert.equal((await indexed(config)).getStats().documentsCount, 2);
    assert.ok(corpus.exists('search-cache/index/a.txt.index.json'));
    assert.equal((await indexed(config)).getStats().documentsCount, 2);
  });

  it('reuses the persisted index on the next start without re-extracting anything', async () => {
    await indexed();
    const cacheFiles = [
      '.cache/txt/a.txt.txt',
      '.cache/index/a.txt.index.json',
    ];
    const mtimes = () =>
      cacheFiles.map((file) => fs.statSync(corpus.pathOf(file)).mtimeMs);
    const before = mtimes();

    const restarted = await indexed();

    assert.deepEqual(mtimes(), before);
    assert.deepEqual(docsWithWord(restarted, 'наказ'), ['a.txt']);
  });

  it('picks up a single added file on rebuild', async () => {
    // Regression guard for 31f37498: one changed file must be enough to
    // trigger the inverted-index rebuild (the threshold used to be exclusive).
    const indexer = await indexed();
    await corpus.write('c.txt', 'Квартальний звіт.');

    await indexer.buildFullIndex();

    assert.deepEqual(docsWithWord(indexer, 'звіт'), ['c.txt']);
    assert.deepEqual(docsWithWord(await indexed(), 'звіт'), ['c.txt']);
  });

  it('drops a deleted file from the documents', async () => {
    const indexer = await indexed();
    await corpus.remove('b.txt');

    await indexer.buildFullIndex();

    assert.equal(indexer.getStats().documentsCount, 1);
    assert.equal((await indexed()).getStats().documentsCount, 1);
  });

  it(
    'drops a deleted file from the postings too',
    knownBug(
      'when nothing else changed, buildFullIndex takes the "all files up to date" early return, ' +
        'which saves the index without rebuilding it. Search hides the orphaned postings (their ' +
        'document is gone), but they still inflate document frequencies and fail validateIndexHealth()',
    ),
    async () => {
      const indexer = await indexed();
      await corpus.remove('b.txt');

      await indexer.buildFullIndex();

      assert.deepEqual(docsWithWord(indexer, 'бюджет'), []);
      assert.equal((await indexer.validateIndexHealth()).isHealthy, true);
    },
  );

  it(
    're-indexes a file edited while the app was closed',
    knownBug(STALE_EDIT_CAUSE),
    async () => {
      await indexed();
      await corpus.write('a.txt', 'Кошторис затверджено.', later());

      const restarted = await indexed();

      assert.deepEqual(docsWithWord(restarted, 'кошторис'), ['a.txt']);
      assert.deepEqual(docsWithWord(restarted, 'наказ'), []);
    },
  );

  it(
    're-indexes a file edited while the app is running',
    knownBug(
      `${STALE_EDIT_CAUSE}; on top of that the text-extraction LRU still returns the old text`,
    ),
    async () => {
      const indexer = await indexed();
      await corpus.write('a.txt', 'Кошторис затверджено.', later());

      await indexer.buildFullIndex();

      assert.deepEqual(docsWithWord(indexer, 'кошторис'), ['a.txt']);
      assert.deepEqual(docsWithWord(indexer, 'наказ'), []);
    },
  );

  describe('indexSpecificPaths()', () => {
    it('adds the documents found under the given paths', async () => {
      const indexer = await indexed();
      await corpus.write('extra/c.txt', 'Квартальний звіт.');

      await indexer.indexSpecificPaths([corpus.pathOf('extra')]);

      assert.equal(indexer.getStats().documentsCount, 3);
    });

    it(
      'makes the added documents searchable',
      knownBug(
        'it calls the batch builders with {} as rebuild thresholds, so ' +
          'Math.max(undefined, NaN) turns the rebuild condition into "n >= NaN" — always false',
      ),
      async () => {
        const indexer = await indexed();
        await corpus.write('extra/c.txt', 'Квартальний звіт.');

        await indexer.indexSpecificPaths([corpus.pathOf('extra')]);

        assert.deepEqual(docsWithWord(indexer, 'звіт'), ['c.txt']);
      },
    );
  });

  it('clearCache() wipes caches on disk — including a globalIndexPath outside cacheRoot — and in memory', async () => {
    const indexer = await indexed({ globalIndexPath: 'meta/global.json.gz' });
    assert.ok(corpus.exists('meta/global.json.gz'));

    await indexer.clearCache();

    for (const artifact of [
      '.cache',
      'meta/global.json.gz',
      'meta/global.chunks',
    ]) {
      assert.equal(
        corpus.exists(artifact),
        false,
        `${artifact} should be gone`,
      );
    }
    assert.deepEqual(indexer.getStats(), {
      documentsCount: 0,
      termsCount: 0,
      totalTokens: 0,
    });
  });
});
