import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

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

/** The inverted index in an order-independent form, for comparing two. */
const postingsOf = (indexer: FileIndexer) =>
  Object.fromEntries(
    [...indexer.getInvertedIndex()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([term, entries]) => [
        term,
        [...entries].sort((a, b) => a.documentId.localeCompare(b.documentId)),
      ]),
  );

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

  it('rebuilds the postings from per-document caches when the global index is gone', async () => {
    // e.g. a deleted/corrupted marker, or a legacy format that loadGlobalIndex()
    // deliberately rejects "for a rebuild": every file is still cached, so none
    // of them counts as changed — the rebuild must happen anyway.
    await indexed();
    await corpus.remove('.cache/global-inverted-index.json.gz');

    const restarted = await indexed();

    assert.deepEqual(docsWithWord(restarted, 'наказ'), ['a.txt']);
    assert.deepEqual(docsWithWord(await indexed(), 'наказ'), ['a.txt']);
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

  it('drops a deleted file from the postings too', async () => {
    // Regression guard: with nothing else changed, the "all files up to date"
    // early return saved the index without rebuilding it, leaving orphaned
    // postings that inflated document frequencies.
    const indexer = await indexed();
    await corpus.remove('b.txt');

    await indexer.buildFullIndex();

    assert.deepEqual(docsWithWord(indexer, 'бюджет'), []);
    assert.equal((await indexer.validateIndexHealth()).isHealthy, true);
  });

  // Regression guards: an edited file already in the document cache was
  // tallied as "cached-loaded" instead of indexed, so the inverted-index
  // rebuild and the global-index save were both skipped.
  it('re-indexes a file edited while the app was closed', async () => {
    await indexed();
    await corpus.write('a.txt', 'Кошторис затверджено.', later());

    const restarted = await indexed();

    assert.deepEqual(docsWithWord(restarted, 'кошторис'), ['a.txt']);
    assert.deepEqual(docsWithWord(restarted, 'наказ'), []);
    assert.deepEqual(docsWithWord(await indexed(), 'кошторис'), ['a.txt']);
  });

  it('re-indexes a file edited while the app is running', async () => {
    const indexer = await indexed();
    await corpus.write('a.txt', 'Кошторис затверджено.', later());

    await indexer.buildFullIndex();

    assert.deepEqual(docsWithWord(indexer, 'кошторис'), ['a.txt']);
    assert.deepEqual(docsWithWord(indexer, 'наказ'), []);
    assert.deepEqual(docsWithWord(await indexed(), 'кошторис'), ['a.txt']);
  });

  describe('with fewer changes than a full rebuild takes', () => {
    // with indexRebuildThreshold 1, only a change to every document rebuilds
    // the inverted index from all of them, as 1–4 changes in 5000 documents
    // would not by default
    const fewChanges = { indexRebuildThreshold: 1 };

    it('still applies a change that indexSpecificPaths() finds among unchanged files', async () => {
      // Regression guard: below the threshold the inverted index was left as
      // it was, while the per-document index was saved as current — so the
      // change was lost for good, restarts included.
      const indexer = await indexed(fewChanges);
      await corpus.write('a.txt', 'Кошторис затверджено.', later());

      await indexer.indexSpecificPaths([
        corpus.pathOf('a.txt'),
        corpus.pathOf('b.txt'),
      ]);

      assert.deepEqual(docsWithWord(indexer, 'кошторис'), ['a.txt']);
      assert.deepEqual(docsWithWord(indexer, 'наказ'), []);
      assert.deepEqual(docsWithWord(await indexed(fewChanges), 'кошторис'), [
        'a.txt',
      ]);
    });

    it('updates the postings of the changed documents to what a full rebuild gives', async () => {
      await corpus.write('c.txt', 'Наказом затверджено кошторис.');
      const indexer = await indexed(fewChanges);
      // a.txt drops words only it held, and ones c.txt holds too
      await corpus.write('a.txt', 'Бюджет міста затверджено.', later());

      await indexer.buildFullIndex();
      // no global index: a full rebuild from the per-document indexes
      await corpus.remove('.cache/global-inverted-index.json.gz');
      const rebuilt = await indexed();

      assert.deepEqual(postingsOf(indexer), postingsOf(rebuilt));
      // The same stems, each listing at least the words a full rebuild lists.
      // A word gone from a stem other documents still hold may stay.
      const stems = indexer.getStemDictionary();
      const rebuiltStems = rebuilt.getStemDictionary();
      assert.deepEqual(
        [...stems.keys()].sort(),
        [...rebuiltStems.keys()].sort(),
      );
      for (const [stem, words] of rebuiltStems) {
        for (const word of words) assert.ok(stems.get(stem)!.includes(word));
      }
      assert.equal((await indexer.validateIndexHealth()).isHealthy, true);
    });

    it('reads no unchanged document from disk', async () => {
      await indexed(fewChanges);
      await corpus.write('a.txt', 'Кошторис затверджено.', later());
      // A full rebuild reads every document's vocab from its per-document
      // index, so without b.txt's it would drop b.txt's postings.
      await corpus.remove('.cache/index/b.txt.index.json');

      const restarted = await indexed(fewChanges);

      assert.deepEqual(docsWithWord(restarted, 'кошторис'), ['a.txt']);
      assert.deepEqual(docsWithWord(restarted, 'бюджет'), ['b.txt']);
    });
  });

  it('after an index version change, re-tokenizes every document once, from the cached text', async () => {
    await indexed();
    // what an install from before index versioning left: no indexVersion
    // anywhere, and vocab from an older tokenizer
    const marker = '.cache/global-inverted-index.json.gz';
    const { indexVersion, ...unversioned } = JSON.parse(
      await corpus.read(marker),
    );
    await corpus.write(marker, JSON.stringify(unversioned), later());
    for (const file of ['a.txt', 'b.txt']) {
      const cacheFile = `.cache/index/${file}.index.json`;
      const { indexVersion, vocab, ...cached } = JSON.parse(
        await corpus.read(cacheFile),
      );
      await corpus.write(
        cacheFile,
        JSON.stringify({ ...cached, vocab: vocab.map((w: string) => `x${w}`) }),
        later(),
      );
    }
    const textCacheMtime = () =>
      fs.statSync(corpus.pathOf('.cache/txt/a.txt.txt')).mtimeMs;
    const textCachedAt = textCacheMtime();

    const upgraded = await indexed();

    assert.deepEqual(
      upgraded.getDocumentCache().get(corpus.pathOf('a.txt'))!.vocab,
      ['начальник', 'підписав', 'наказ'],
    );
    assert.deepEqual(docsWithWord(upgraded, 'наказ'), ['a.txt']);
    assert.equal(textCacheMtime(), textCachedAt);

    // and only once: the next start reuses what the upgrade wrote
    const indexCachedAt = fs.statSync(
      corpus.pathOf('.cache/index/a.txt.index.json'),
    ).mtimeMs;
    await indexed();
    assert.equal(
      fs.statSync(corpus.pathOf('.cache/index/a.txt.index.json')).mtimeMs,
      indexCachedAt,
    );
  });

  describe('indexSpecificPaths()', () => {
    it('adds the documents found under the given paths', async () => {
      const indexer = await indexed();
      await corpus.write('extra/c.txt', 'Квартальний звіт.');

      await indexer.indexSpecificPaths([corpus.pathOf('extra')]);

      assert.equal(indexer.getStats().documentsCount, 3);
    });

    it('makes the added documents searchable', async () => {
      // Regression guard: it passed {} as rebuild thresholds, so
      // Math.max(undefined, NaN) made the rebuild condition "n >= NaN".
      const indexer = await indexed();
      await corpus.write('extra/c.txt', 'Квартальний звіт.');

      await indexer.indexSpecificPaths([corpus.pathOf('extra')]);

      assert.deepEqual(docsWithWord(indexer, 'звіт'), ['c.txt']);
      assert.deepEqual(docsWithWord(indexer, 'наказ'), ['a.txt']);
    });
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
