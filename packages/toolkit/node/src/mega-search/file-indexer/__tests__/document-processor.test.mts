import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createLogger } from '../../shared/logger.mjs';
import { createTempCorpus, later } from '../../test-utils/temp-corpus.mjs';
import type { TempCorpus } from '../../test-utils/temp-corpus.mjs';
import { UkrainianTextProcessor } from '../../text-processor.mjs';
import type {
  DocumentIndex,
  DocumentMetadata,
  SearchConfig,
} from '../../types.mjs';
import { DocumentProcessor } from '../document-processor.mjs';
import { INDEX_VERSION } from '../index-version.mjs';

const ORDER_TEXT = 'Наказ про бюджет. Наказ виконано.';

describe('DocumentProcessor', () => {
  let corpus: TempCorpus;
  let config: SearchConfig;

  const newProcessor = () =>
    new DocumentProcessor(config, createLogger('test:document-processor'));

  /** Metadata as FileScannerIndexer would discover it. */
  const discovered = async (
    relativePath: string,
  ): Promise<DocumentMetadata> => {
    const filePath = corpus.pathOf(relativePath);
    const stats = await fs.promises.stat(filePath);
    return {
      originalFilePath: filePath,
      fileName: path.basename(filePath),
      lastModified: stats.mtimeMs,
      size: stats.size,
      indexed: false,
      language: 'mixed',
    };
  };

  const indexCacheFile = (relativePath: string) =>
    `.cache/index/${relativePath}.index.json`;

  /**
   * Rewrites a per-document index as an install from before index versioning
   * left it, optionally with the vocab an older tokenizer produced.
   */
  const makeUnversioned = async (relativePath: string, vocab?: string[]) => {
    const file = indexCacheFile(relativePath);
    const { indexVersion, ...cached } = JSON.parse(await corpus.read(file));
    await corpus.write(
      file,
      JSON.stringify(vocab ? { ...cached, vocab } : cached),
      later(),
    );
  };

  beforeEach(async () => {
    corpus = await createTempCorpus({ 'orders/order.txt': ORDER_TEXT });
    config = {
      rootDirectory: corpus.root,
      extensions: ['.txt'],
      maxFileSize: Infinity,
      concurrency: 1,
    };
  });

  afterEach(() => corpus.cleanup());

  describe('indexDocument()', () => {
    it('encodes the text as vocab + positions and marks the document indexed', async () => {
      const doc = await newProcessor().indexDocument(
        await discovered('orders/order.txt'),
      );

      assert.deepEqual(doc.vocab, ['наказ', 'бюджет', 'виконано']);
      assert.deepEqual(
        doc.positions.map(([vocabIndex, start, end]) => [
          doc.vocab[vocabIndex],
          ORDER_TEXT.slice(start, end),
        ]),
        [
          ['наказ', 'Наказ'],
          ['бюджет', 'бюджет'],
          ['наказ', 'Наказ'],
          ['виконано', 'виконано'],
        ],
      );
      assert.equal(doc.wordCount, 4);
      assert.equal(doc.metadata.indexed, true);
      assert.equal(doc.metadata.language, 'ukrainian');
    });

    it('caches the extracted text and the per-document index, mirroring the source path', async () => {
      const doc = await newProcessor().indexDocument(
        await discovered('orders/order.txt'),
      );

      assert.equal(
        doc.metadata.textFilePath,
        corpus.pathOf('.cache/txt/orders/order.txt.txt'),
      );
      assert.equal(
        await corpus.read('.cache/txt/orders/order.txt.txt'),
        ORDER_TEXT,
      );
      assert.ok(corpus.exists(indexCacheFile('orders/order.txt')));
    });

    it('persists stemmed term frequencies on disk but keeps them out of memory', async () => {
      const doc = await newProcessor().indexDocument(
        await discovered('orders/order.txt'),
      );
      const onDisk = JSON.parse(
        await corpus.read(indexCacheFile('orders/order.txt')),
      );

      const stem = (word: string) =>
        new UkrainianTextProcessor().stemWord(word);

      assert.deepEqual(onDisk.termFrequency, {
        [stem('наказ')]: 2,
        [stem('бюджет')]: 1,
        [stem('виконано')]: 1,
      });
      // memory optimization — the inverted index carries frequencies instead
      assert.equal(doc.termFrequency.size, 0);
    });

    it('stores an empty, indexed entry for a file without text, so it is not retried forever', async () => {
      await corpus.write('blank.txt', '   \n  ');
      const doc = await newProcessor().indexDocument(
        await discovered('blank.txt'),
      );

      assert.equal(doc.wordCount, 0);
      assert.deepEqual(doc.vocab, []);
      assert.equal(doc.metadata.indexed, true);
      assert.equal(doc.metadata.language, 'unknown');
      assert.ok(corpus.exists(indexCacheFile('blank.txt')));
    });

    it('stores an empty, indexed entry when text extraction fails', async (t) => {
      t.mock.method(console, 'error', () => {}); // DocumentExtractor logs the failure
      await corpus.write('data.xyz', 'no parser for this extension');

      const doc = await newProcessor().indexDocument(
        await discovered('data.xyz'),
      );

      assert.equal(doc.wordCount, 0);
      assert.equal(doc.metadata.indexed, true);
    });

    it('reuses the cached per-document index while it is newer than the source', async () => {
      await newProcessor().indexDocument(await discovered('orders/order.txt'));
      // new content, but an mtime older than the cache files
      await corpus.write('orders/order.txt', 'Інший зміст.');

      const doc = await newProcessor().indexDocument(
        await discovered('orders/order.txt'),
      );

      assert.deepEqual(doc.vocab, ['наказ', 'бюджет', 'виконано']);
    });

    it('stamps the per-document index with the INDEX_VERSION that built it', async () => {
      await newProcessor().indexDocument(await discovered('orders/order.txt'));

      const cached = JSON.parse(
        await corpus.read(indexCacheFile('orders/order.txt')),
      );
      assert.equal(cached.indexVersion, INDEX_VERSION);
    });

    it('re-tokenizes a per-document index from another index version, from the cached text', async () => {
      await newProcessor().indexDocument(await discovered('orders/order.txt'));
      await makeUnversioned('orders/order.txt', ['старий', 'токенізатор', 'x']);
      // new content with the old mtime: the extracted text cache stays valid,
      // so a re-extraction would show up as "Інший зміст"
      await corpus.write('orders/order.txt', 'Інший зміст.');

      const doc = await newProcessor().indexDocument(
        await discovered('orders/order.txt'),
      );

      assert.deepEqual(doc.vocab, ['наказ', 'бюджет', 'виконано']);
      assert.equal(
        JSON.parse(await corpus.read(indexCacheFile('orders/order.txt')))
          .indexVersion,
        INDEX_VERSION,
      );
    });

    it('re-extracts a source edited after it was cached (next app start)', async () => {
      await newProcessor().indexDocument(await discovered('orders/order.txt'));
      await corpus.write('orders/order.txt', 'Кошторис затверджено.', later());

      const doc = await newProcessor().indexDocument(
        await discovered('orders/order.txt'),
      );

      assert.deepEqual(doc.vocab, ['кошторис', 'затверджено']);
      assert.equal(
        await corpus.read('.cache/txt/orders/order.txt.txt'),
        'Кошторис затверджено.',
      );
    });

    it('re-extracts a source edited after it was cached (same process)', async () => {
      // Regression guard: the in-memory text LRU was keyed by path only, so
      // the old text was re-indexed — and written back as a per-document
      // index newer than the source, which kept it stale across restarts.
      const processor = newProcessor();
      await processor.indexDocument(await discovered('orders/order.txt'));
      await corpus.write('orders/order.txt', 'Кошторис затверджено.', later());

      const doc = await processor.indexDocument(
        await discovered('orders/order.txt'),
      );

      assert.deepEqual(doc.vocab, ['кошторис', 'затверджено']);
      assert.deepEqual(
        (
          await newProcessor().indexDocument(
            await discovered('orders/order.txt'),
          )
        ).vocab,
        ['кошторис', 'затверджено'],
      );
    });
  });

  describe('needsReindexing()', () => {
    const inMemory = (doc: DocumentIndex) =>
      new Map([[doc.metadata.originalFilePath, doc]]);

    it('is false for an indexed in-memory entry with the same lastModified', async () => {
      const processor = newProcessor();
      const metadata = await discovered('orders/order.txt');
      const doc = await processor.indexDocument(metadata);

      assert.equal(
        await processor.needsReindexing(metadata, inMemory(doc)),
        false,
      );
    });

    it('is true when lastModified changed or the entry was never indexed', async () => {
      const processor = newProcessor();
      const metadata = await discovered('orders/order.txt');
      const doc = await processor.indexDocument(metadata);

      assert.equal(
        await processor.needsReindexing(
          { ...metadata, lastModified: metadata.lastModified + 1 },
          inMemory(doc),
        ),
        true,
      );
      assert.equal(
        await processor.needsReindexing(
          metadata,
          inMemory({ ...doc, metadata: { ...doc.metadata, indexed: false } }),
        ),
        true,
      );
    });

    it('preloads a per-document index from disk when it is newer than the source', async () => {
      const metadata = await discovered('orders/order.txt');
      await newProcessor().indexDocument(metadata);
      const documentCache = new Map<string, DocumentIndex>();

      assert.equal(
        await newProcessor().needsReindexing(metadata, documentCache),
        false,
      );
      assert.deepEqual(documentCache.get(metadata.originalFilePath)?.vocab, [
        'наказ',
        'бюджет',
        'виконано',
      ]);
    });

    it('is true when nothing is cached', async () => {
      assert.equal(
        await newProcessor().needsReindexing(
          await discovered('orders/order.txt'),
          new Map(),
        ),
        true,
      );
    });

    it('is true when the cached per-document index is from another index version', async () => {
      const metadata = await discovered('orders/order.txt');
      await newProcessor().indexDocument(metadata);
      await makeUnversioned('orders/order.txt');
      const documentCache = new Map<string, DocumentIndex>();

      assert.equal(
        await newProcessor().needsReindexing(metadata, documentCache),
        true,
      );
      assert.equal(documentCache.size, 0);
    });

    it('is true when the cached per-document index is corrupted', async () => {
      const metadata = await discovered('orders/order.txt');
      await newProcessor().indexDocument(metadata);
      await fs.promises.writeFile(
        corpus.pathOf(indexCacheFile('orders/order.txt')),
        '{ not json',
      );

      assert.equal(
        await newProcessor().needsReindexing(metadata, new Map()),
        true,
      );
    });
  });
});
