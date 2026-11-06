import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { resolveCachePaths } from '../../cache-paths.mjs';
import { LRUCache } from '../../lru-cache.mjs';
import { createLogger } from '../../shared/logger.mjs';
import { createTempCorpus } from '../../test-utils/temp-corpus.mjs';
import type { TempCorpus } from '../../test-utils/temp-corpus.mjs';
import type { DocumentIndex, SearchConfig } from '../../types.mjs';
import { DocumentProcessor } from '../document-processor.mjs';
import { FileScannerIndexer } from '../file-scanner.indexer.mjs';
import { IndexBuilder } from '../index-builder.mjs';
import { IndexStorage } from '../index-storage.mjs';
import { INDEX_VERSION } from '../index-version.mjs';
import { InvertedIndex } from '../inverted-index.mjs';

const logger = createLogger('test:index-storage');

describe('IndexStorage', () => {
  let corpus: TempCorpus;
  let config: SearchConfig;

  const newStorage = () =>
    new IndexStorage(config, logger, new LRUCache<string, DocumentIndex>(50));

  /** Indexes the corpus through the production components, without FileIndexer. */
  const buildIndex = async () => {
    const processor = new DocumentProcessor(config, logger);
    const documentCache = new Map<string, DocumentIndex>();
    for (const file of await new FileScannerIndexer(
      config,
      logger,
    ).discoverFiles()) {
      documentCache.set(
        file.originalFilePath,
        await processor.indexDocument(file),
      );
    }
    const invertedIndex = new InvertedIndex();
    const stemDictionary = new Map<string, Set<string>>();
    await new IndexBuilder(config, logger).updateInvertedIndexBatch(
      documentCache,
      invertedIndex,
      stemDictionary,
    );
    return { documentCache, invertedIndex, stemDictionary };
  };

  const saveIndex = async () => {
    const built = await buildIndex();
    await newStorage().saveGlobalIndex(
      built.documentCache,
      built.invertedIndex,
      built.stemDictionary,
    );
    return built;
  };

  const writeMarker = (content: string) =>
    fs.promises.writeFile(resolveCachePaths(config).globalIndexPath, content);

  beforeEach(async () => {
    corpus = await createTempCorpus({
      'a.txt': 'Начальник підписав наказ № 15/2.',
      'nested/b.txt': 'Бюджет міста затверджено. Наказ виконано.',
    });
    config = {
      rootDirectory: corpus.root,
      extensions: ['.txt'],
      maxFileSize: Infinity,
      concurrency: 1,
    };
  });

  afterEach(() => corpus.cleanup());

  it('returns null when no index has been saved yet', async () => {
    assert.equal(await newStorage().loadGlobalIndex(), null);
  });

  it('round-trips documents, postings and the stem dictionary', async () => {
    const saved = await saveIndex();
    const loaded = (await newStorage().loadGlobalIndex())!;

    assert.deepEqual(
      [...loaded.documentCache.keys()].sort(),
      [...saved.documentCache.keys()].sort(),
    );
    for (const [docId, doc] of saved.documentCache) {
      assert.deepEqual(loaded.documentCache.get(docId)!.metadata, doc.metadata);
      assert.equal(loaded.documentCache.get(docId)!.wordCount, doc.wordCount);
    }
    assert.deepEqual(
      loaded.invertedIndex.toLegacyMap(),
      saved.invertedIndex.toLegacyMap(),
    );
    assert.deepEqual(loaded.stemDictionary, saved.stemDictionary);
  });

  it('keeps vocab/positions/joints out of the global index and reads them per document on demand', async () => {
    const saved = await saveIndex();
    const loaded = (await newStorage().loadGlobalIndex())!;
    const [first, second] = [...saved.documentCache.keys()];

    assert.deepEqual(
      loaded.documentCache.get(first)!.vocab,
      saved.documentCache.get(first)!.vocab,
    );
    assert.deepEqual(
      loaded.documentCache.get(first)!.positions,
      saved.documentCache.get(first)!.positions,
    );
    assert.equal(first, corpus.pathOf('a.txt'));
    assert.deepEqual(loaded.documentCache.get(first)!.joints, { 4: '/' });

    // a missing per-document file degrades to an empty document, not a crash
    await fs.promises.rm(corpus.pathOf('.cache/index/nested/b.txt.index.json'));
    assert.equal(second, corpus.pathOf('nested/b.txt'));
    assert.deepEqual(loaded.documentCache.get(second)!.vocab, []);
    assert.equal(loaded.documentCache.get(second)!.positions.length, 0);
    assert.deepEqual(loaded.documentCache.get(second)!.joints, {});
  });

  it('reads no words of another version of the document, indexed since', async () => {
    // A search reads the document as the postings it reads have it: the
    // words of a newer version are at other positions
    await saveIndex();
    const loaded = (await newStorage().loadGlobalIndex())!;
    const doc = loaded.documentCache.get(corpus.pathOf('a.txt'))!;
    const file = corpus.pathOf('.cache/index/a.txt.index.json');
    const saved = JSON.parse(
      await corpus.read('.cache/index/a.txt.index.json'),
    );
    await fs.promises.writeFile(
      file,
      JSON.stringify({
        ...saved,
        metadata: {
          ...saved.metadata,
          indexedAt: saved.metadata.indexedAt + 1,
        },
        vocab: ['кошторис'],
        positions: [0, 0, 8],
      }),
    );

    assert.deepEqual(doc.vocab, []);
    assert.equal(doc.positions.length, 0);
    assert.deepEqual(doc.joints, {});
  });

  it('treats a legacy index format as missing, so the index gets rebuilt', async () => {
    await saveIndex();
    await writeMarker(JSON.stringify({ format: 'v8-chunked' }));

    assert.equal(await newStorage().loadGlobalIndex(), null);
  });

  it('treats an index from another index version as missing, so the index gets rebuilt', async () => {
    await saveIndex();
    const marker = JSON.parse(
      await fs.promises.readFile(
        resolveCachePaths(config).globalIndexPath,
        'utf8',
      ),
    );
    assert.equal(marker.indexVersion, INDEX_VERSION);
    assert.ok(await newStorage().loadGlobalIndex());

    const { indexVersion, ...unversioned } = marker; // before versioning
    await writeMarker(JSON.stringify(unversioned));
    assert.equal(await newStorage().loadGlobalIndex(), null);

    await writeMarker(
      JSON.stringify({ ...marker, indexVersion: INDEX_VERSION + 1 }),
    );
    assert.equal(await newStorage().loadGlobalIndex(), null);
  });

  it('returns null for a corrupted marker or missing chunk metadata', async () => {
    await saveIndex();

    await writeMarker('{ not json');
    assert.equal(await newStorage().loadGlobalIndex(), null);

    await writeMarker(
      JSON.stringify({ format: 'v8-chunked-compact', chunkedDir: 'missing' }),
    );
    assert.equal(await newStorage().loadGlobalIndex(), null);
  });

  it('writes to and reads from a custom globalIndexPath', async () => {
    config.globalIndexPath = 'meta/global.json.gz';
    const saved = await saveIndex();

    assert.ok(corpus.exists('meta/global.json.gz'));
    assert.ok(corpus.exists('meta/global.chunks/metadata.json'));
    assert.equal(
      (await newStorage().loadGlobalIndex())!.documentCache.size,
      saved.documentCache.size,
    );
  });
});
