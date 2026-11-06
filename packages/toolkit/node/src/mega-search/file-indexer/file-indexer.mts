import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resolveCachePaths } from '../cache-paths.mjs';
import { LRUCache } from '../lru-cache.mjs';
import { createLogger } from '../shared/logger.mjs';
import {
  DocumentIndex,
  DocumentMetadata,
  InvertedIndexEntry,
  SearchConfig,
  SearchSnapshot,
} from '../types.mjs';
import { DocumentProcessor, isIndexedAsIs } from './document-processor.mjs';
import { FileScannerIndexer } from './file-scanner.indexer.mjs';
import { FolderWatcher } from './folder-watcher.mjs';
import { IndexBuilder } from './index-builder.mjs';
import { IndexStorage } from './index-storage.mjs';
import { InvertedIndex } from './inverted-index.mjs';

/** Whether the folder is there, and can be listed. */
const isReadableDirectory = async (directory: string): Promise<boolean> => {
  try {
    await fs.promises.readdir(directory);
    return true;
  } catch {
    return false;
  }
};

/**
 * Keeps the index of a folder in step with its files.
 *
 * A search reads the index in place, as it was when the search started
 * (see getSearchSnapshot), so an update never shows it half-done and never
 * changes what a search reads: documents are indexed into a copy of the
 * document cache, postings into a copy of the index that shares what didn't
 * change, and the copies go in together, in one synchronous step (see
 * commit). Updates run one at a time, in call order.
 */
class FileIndexer {
  private logger = createLogger('FileIndexer');
  private documentCache = new Map<string, DocumentIndex>();
  private invertedIndex = new InvertedIndex();
  private stemDictionary = new Map<string, Set<string>>();
  private documentLRU = new LRUCache<string, DocumentIndex>(50);

  /** Whether the index saved on disk was loaded (or found missing). */
  private isLoaded = false;
  /** Changes with every update searches can see — see indexGeneration. */
  private generation = 0;
  /** The update running or last run; the next one starts after it. */
  private updates: Promise<void> = Promise.resolve();
  /** A refresh waiting for the running update; callers until it starts share it. */
  private queuedRefresh: Promise<void> | null = null;

  private scanner: FileScannerIndexer;
  private processor: DocumentProcessor;
  private storage: IndexStorage;
  private builder: IndexBuilder;
  /** With `watchFiles`: whether the files may have changed since the last look. */
  private watcher: FolderWatcher | null;

  constructor(private config: SearchConfig) {
    this.config.rootDirectory = path.resolve(this.config.rootDirectory);
    this.scanner = new FileScannerIndexer(this.config, this.logger);
    this.processor = new DocumentProcessor(this.config, this.logger);
    this.storage = new IndexStorage(this.config, this.logger, this.documentLRU);
    this.builder = new IndexBuilder(this.config, this.logger);
    this.watcher = this.config.watchFiles
      ? new FolderWatcher(
          this.config.rootDirectory,
          resolveCachePaths(this.config).excludeAbsoluteDirs,
          this.config.rescanAfterMs ?? 60_000,
        )
      : null;
  }

  /**
   * Version of the index searches read now: it changes whenever an update
   * goes in. Anything derived from the index (cached results, BM25's average
   * document length) is current only for the generation it was made from.
   */
  get indexGeneration(): number {
    return this.generation;
  }

  async discoverFiles(): Promise<DocumentMetadata[]> {
    return this.scanner.discoverFiles();
  }

  async extractTextFromFile(filePath: string): Promise<string> {
    return this.processor.extractTextFromFile(filePath);
  }

  /**
   * Brings the index up to date with the files on disk: indexes added and
   * edited documents, drops deleted ones. The first call starts from the
   * index saved on disk; later ones from the one in memory.
   *
   * Calls made while an update runs share one refresh, queued after it: files
   * may have changed since the running one looked at them.
   */
  buildFullIndex(): Promise<void> {
    this.queuedRefresh ??= this.exclusive(() => {
      this.queuedRefresh = null;
      return this.refresh();
    });
    return this.queuedRefresh;
  }

  /**
   * buildFullIndex(), when the files may have changed. With `watchFiles`
   * off, they always may. With it on, only when the folder watcher saw a
   * change since the last look, or `rescanAfterMs` went by — otherwise this
   * just waits for an update running or queued, and lists no file.
   */
  refreshIfChanged(): Promise<void> {
    if (this.watcher && !this.watcher.isLookDue) {
      return this.queuedRefresh ?? this.updates;
    }
    return this.buildFullIndex();
  }

  /** Stops watching the folder (see `watchFiles`). The index stays usable. */
  close(): void {
    this.watcher?.close();
  }

  /**
   * Indexes only the specified paths (files or directories): adds their new
   * documents and updates edited ones. Nothing is removed.
   */
  async indexSpecificPaths(paths: string[]): Promise<void> {
    if (!paths || paths.length === 0) {
      this.logger.info('No specific paths provided. Running full index build.');
      return this.buildFullIndex();
    }

    return this.exclusive(async () => {
      this.logger.info(`🎯 Indexing ${paths.length} specific paths...`);
      await this.loadSavedIndex();

      const files = await this.scanner.discoverSpecificPaths(paths);
      if (files.length === 0) {
        this.logger.info('No valid files found in the specified paths.');
        return;
      }

      this.logger.info(`Found ${files.length} files to process.`);
      await this.applyChanges(files, []);
    });
  }

  /** Runs `task` after every update called before it. */
  private exclusive(task: () => Promise<void>): Promise<void> {
    const run = this.updates.then(task);
    // A failed update leaves the index as it was, and doesn't stop the next
    this.updates = run.catch(() => undefined);
    return run;
  }

  /** Loads the index saved on disk, once: after that, memory holds it. */
  private async loadSavedIndex(): Promise<void> {
    if (this.isLoaded) return;

    const saved = await this.storage.loadGlobalIndex();
    if (saved) {
      this.documentCache = saved.documentCache;
      this.invertedIndex = saved.invertedIndex;
      this.stemDictionary = saved.stemDictionary;
      this.generation++;
      this.logger.debug('📋 Loaded existing global index from cache.');
    }
    this.isLoaded = true;
  }

  private async refresh(): Promise<void> {
    // A change from here on is for the next refresh to pick up
    this.watcher?.lookBegins();
    try {
      await this.refreshNow();
    } catch (error) {
      this.watcher?.markChanged();
      throw error;
    }
  }

  private async refreshNow(): Promise<void> {
    const [discovered] = await Promise.all([
      this.scanner.discoverFiles(),
      this.loadSavedIndex(),
    ]);

    // Discovery finds nothing in a folder it can't read, too. Then the index
    // stays: the folder may be back soon (a drive, a network share), and
    // saving the index would make the cache folder inside it anew.
    if (
      discovered.length === 0 &&
      !(await isReadableDirectory(this.config.rootDirectory))
    ) {
      this.logger.warn(
        `📁 Can't read ${this.config.rootDirectory}: the index stays as it is.`,
      );
      return;
    }
    this.logger.info(`📁 Found ${discovered.length} documents to process...`);

    const discoveredPaths = new Set(
      discovered.map((file) => file.originalFilePath),
    );
    const removed = [...this.documentCache.keys()].filter(
      (filePath) => !discoveredPaths.has(filePath),
    );
    await this.applyChanges(discovered, removed);
  }

  /**
   * Indexes those of `files` the index doesn't hold as they are now, drops
   * `removed`, puts both in at once (see commit) and saves the index.
   *
   * A file counts as changed whether it's indexed afresh or read back from
   * its per-document cache: either way the postings don't hold it as it is.
   */
  private async applyChanges(
    files: DocumentMetadata[],
    removed: string[],
  ): Promise<void> {
    const startTime = Date.now();
    const toIndex = files.filter(
      (file) =>
        !isIndexedAsIs(this.documentCache.get(file.originalFilePath), file),
    );

    if (toIndex.length === 0 && removed.length === 0) {
      this.logger.info('✅ All files are up to date. No reindexing needed.');
      if (this.storage.needsOptimization) await this.save();
      return;
    }

    this.logger.info(
      `📝 Found ${toIndex.length} files to index and ${removed.length} removed, out of ${files.length}.`,
    );
    toIndex.slice(0, 5).forEach((f) => this.logger.debug(`   - ${f.fileName}`));

    // The next document cache. Searches keep reading the current one.
    const documentCache = new Map(this.documentCache);
    for (const filePath of removed) documentCache.delete(filePath);
    if (removed.length > 0) {
      this.logger.info(
        `🗑️ Pruned ${removed.length} deleted documents from cache.`,
      );
    }

    const method = await this.selectIndexingMethod(toIndex);
    this.logger.debug(`📂 Using indexing method: ${method}`);
    const { indexed, errors } =
      method === 'parallel'
        ? await this.indexParallel(toIndex, documentCache)
        : await this.indexSequential(toIndex, documentCache);
    this.logger.info(
      `✅ Indexing complete: ${indexed.length} indexed, ${errors} errors`,
    );

    const changed = [...indexed, ...removed];
    if (changed.length === 0) return;

    await this.commit(documentCache, changed);
    await this.save();
    if (method === 'parallel') await this.validateIndexHealth();

    this.logger.info(
      `${method} index update completed in ${Date.now() - startTime}ms`,
    );
  }

  /**
   * How many re-indexed files it takes to rebuild the inverted index from
   * every document rather than update it for the changed ones only.
   *
   * Either way the change is in the next search. An update in place reads
   * the changed documents only, and takes a pass over the postings: on 362
   * documents, 39 ms for one changed, 540 ms for 100. A full rebuild reads
   * every document: 1.9 s. In place is quicker all the way up, but it runs
   * in one go — a search waits for it to finish, while a full rebuild lets
   * searches read the index from before. Past a fifth of the documents, the
   * wait isn't worth it.
   */
  private getRebuildThresholds(): {
    rebuildThreshold: number;
    minFiles: number;
  } {
    return {
      // a full rebuild once at least a fifth of the indexed documents changed
      rebuildThreshold: this.config.indexRebuildThreshold ?? 0.2,
      // ... and at least N files
      minFiles: this.config.minFilesForRebuild ?? 1,
    };
  }

  /**
   * Puts in `documentCache` with postings to match, for searches to read.
   *
   * Enough changes (see getRebuildThresholds) rebuild the postings from every
   * document, into new ones that go in whole once complete. Fewer update the
   * changed documents' postings, which reads no other document, in a copy
   * that shares the rest — in the same synchronous step that puts in the
   * documents, so no search starts between the two. Either way every change
   * is applied, and the index searches were reading stays as it was.
   */
  private async commit(
    documentCache: Map<string, DocumentIndex>,
    changedPaths: string[],
  ): Promise<void> {
    const { rebuildThreshold, minFiles } = this.getRebuildThresholds();
    const isFullRebuild =
      changedPaths.length >=
      Math.max(minFiles, documentCache.size * rebuildThreshold);

    if (isFullRebuild) {
      this.logger.info(
        `🔗 Rebuilding inverted index (${changedPaths.length} changed)...`,
      );
      const invertedIndex = new InvertedIndex();
      const stemDictionary = new Map<string, Set<string>>();
      await this.builder.updateInvertedIndexBatch(
        documentCache,
        invertedIndex,
        stemDictionary,
      );
      this.invertedIndex = invertedIndex;
      this.stemDictionary = stemDictionary;
    } else {
      const updated = this.builder.updateDocuments(
        documentCache,
        this.invertedIndex,
        this.stemDictionary,
        changedPaths,
      );
      this.invertedIndex = updated.invertedIndex;
      this.stemDictionary = updated.stemDictionary;
    }
    this.documentCache = documentCache;
    this.generation++;
  }

  private async save(): Promise<void> {
    this.logger.info('💾 Saving global index...');
    await this.storage.saveGlobalIndex(
      this.documentCache,
      this.invertedIndex,
      this.stemDictionary,
    );
    this.storage.needsOptimization = false;
  }

  /**
   * Puts the file as it is on disk into `documentCache`: read back from its
   * per-document cache when that's current, indexed afresh otherwise.
   * @returns false if that failed — `documentCache` keeps what it had
   */
  private async indexInto(
    file: DocumentMetadata,
    documentCache: Map<string, DocumentIndex>,
  ): Promise<boolean> {
    try {
      // Searches read the version in the index now until the update goes in.
      // Its words load from its per-document file on first use, which
      // indexing the file anew overwrites, so they load first.
      const current = documentCache.get(file.originalFilePath);
      if (current && !isIndexedAsIs(current, file)) void current.positions;

      if (await this.processor.needsReindexing(file, documentCache)) {
        documentCache.set(
          file.originalFilePath,
          await this.processor.indexDocument(file),
        );
      }
      return true;
    } catch (error) {
      this.logger.error(
        `❌ Failed to index ${file.fileName}:`,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  private async indexSequential(
    files: DocumentMetadata[],
    documentCache: Map<string, DocumentIndex>,
  ): Promise<{ indexed: string[]; errors: number }> {
    this.logger.info(`🔄 Indexing ${files.length} documents sequentially...`);
    const indexed: string[] = [];
    let errors = 0;

    const BATCH_SIZE = 25;
    const batchCount = Math.ceil(files.length / BATCH_SIZE);
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
      this.logger.info(
        `📦 Processing batch ${batchIndex + 1}/${batchCount}...`,
      );
      const batch = files.slice(
        batchIndex * BATCH_SIZE,
        (batchIndex + 1) * BATCH_SIZE,
      );
      const results = await Promise.all(
        batch.map((file) => this.indexInto(file, documentCache)),
      );
      batch.forEach((file, i) => {
        if (results[i]) indexed.push(file.originalFilePath);
        else errors++;
      });
    }
    return { indexed, errors };
  }

  private async indexParallel(
    files: DocumentMetadata[],
    documentCache: Map<string, DocumentIndex>,
  ): Promise<{ indexed: string[]; errors: number }> {
    this.logger.info(
      `🚀 Processing ${files.length} documents with parallel workers...`,
    );
    const workers = Math.min(this.config.concurrency || 4, files.length);
    const chunkSize = Math.ceil(files.length / workers);
    const indexed: string[] = [];
    let errors = 0;

    const runWorker = async (chunk: DocumentMetadata[]) => {
      for (const file of chunk) {
        if (!(await this.indexInto(file, documentCache))) {
          errors++;
          continue;
        }
        indexed.push(file.originalFilePath);
      }
    };

    const chunks = [];
    for (let i = 0; i < files.length; i += chunkSize) {
      chunks.push(files.slice(i, i + chunkSize));
    }
    await Promise.all(chunks.map(runWorker));
    return { indexed, errors };
  }

  private async selectIndexingMethod(
    files: DocumentMetadata[],
  ): Promise<'sequential' | 'parallel'> {
    const totalMemory = os.totalmem() / 1024 / 1024 / 1024;
    const cpuCount = os.cpus().length;
    const avgFileSize =
      files.length > 0
        ? files.reduce((sum, f) => sum + f.size, 0) / files.length
        : 0;
    const estimatedCorpusSize = (files.length * avgFileSize) / 1024 / 1024;

    this.logger.debug(
      `🖥️  System: ${totalMemory.toFixed(1)}GB RAM, ${cpuCount} CPUs`,
    );
    this.logger.debug(
      `📊 Corpus: ${files.length} files, ~${estimatedCorpusSize.toFixed(0)}MB`,
    );

    const useParallel =
      totalMemory >= 6 &&
      cpuCount >= 4 &&
      files.length >= 100 &&
      estimatedCorpusSize <= 2000 &&
      this.config.concurrency >= 3;

    return useParallel ? 'parallel' : 'sequential';
  }

  async validateIndexHealth(): Promise<{
    isHealthy: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];
    try {
      const docCacheSize = this.documentCache.size;
      const invertedIndexDocs = new Set<string>();
      this.invertedIndex.forEach((entries) =>
        entries.forEach((entry) => invertedIndexDocs.add(entry.documentId)),
      );

      // Every document with words has postings. One of numbers only has
      // postings too, and no words, so it is not counted either way.
      const docsWithWords = Array.from(this.documentCache.values()).filter(
        (doc) => doc.wordCount > 0,
      );
      const missingDocsCount = docsWithWords.filter(
        (doc) => !invertedIndexDocs.has(doc.metadata.originalFilePath),
      ).length;

      if (missingDocsCount > 0)
        issues.push(
          `${missingDocsCount} of ${docsWithWords.length} documents with words are missing from the inverted index`,
        );

      // Check for empty terms in inverted index
      let emptyTermsCount = 0;
      this.invertedIndex.forEach((entries) => {
        if (!entries || entries.length === 0) {
          emptyTermsCount++;
        }
      });

      if (emptyTermsCount > 0) {
        issues.push(`Found ${emptyTermsCount} empty terms in inverted index`);
      }

      const memStats = this.getMemoryStats();
      if (memStats.heap.used > 1000)
        issues.push(`High memory usage: ${memStats.heap.used}MB heap`);

      this.logger.info(
        `🔍 Index health check: ${issues.length === 0 ? '✅ Healthy' : `⚠️ ${issues.length} issues found`}`,
      );

      return { isHealthy: issues.length === 0, issues };
    } catch (error) {
      const msg = `Health check failed: ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error(msg);
      issues.push(msg);
      return { isHealthy: false, issues };
    }
  }

  getMemoryStats(): any {
    const memUsage = process.memoryUsage();
    return {
      heap: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        total: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
      rss: Math.round(memUsage.rss / 1024 / 1024),
      caches: {
        documents: this.documentCache.size,
        documentLRU: this.documentLRU.size || 0,
      },
    };
  }

  /**
   * The index as searches read it now, in place. What it holds never changes
   * (see commit), so a search reads one version from start to end, whatever
   * update goes in meanwhile.
   */
  getSearchSnapshot(): SearchSnapshot {
    return {
      generation: this.generation,
      docCache: this.documentCache,
      invertedIndex: this.invertedIndex,
      stemDictionary: this.stemDictionary,
    };
  }

  /** A copy of the postings, all decoded — to inspect, not to search. */
  getInvertedIndex(): Map<string, InvertedIndexEntry[]> {
    return this.invertedIndex.toLegacyMap();
  }

  /** A copy of the stem dictionary — to inspect, not to search. */
  getStemDictionary(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    this.stemDictionary.forEach((value, key) =>
      result.set(key, Array.from(value)),
    );
    return result;
  }

  /** A copy of the document cache — to inspect, not to search. */
  getDocumentCache(): Map<string, DocumentIndex> {
    return new Map(this.documentCache);
  }

  /**
   * Get basic statistics about the index
   */
  getStats() {
    return {
      documentsCount: this.documentCache.size,
      termsCount: this.invertedIndex.size,
      totalTokens: Array.from(this.documentCache.values()).reduce(
        (sum, doc) => sum + doc.wordCount,
        0,
      ),
    };
  }

  /**
   * Wipes the on-disk index cache (global index + per-file vocab/positions +
   * extracted text) and every in-memory cache mirroring it. Uses the same
   * resolver (resolveCachePaths) that IndexStorage/DocumentProcessor/
   * FileScannerIndexer use to locate cache files, so this stays correct even
   * when cacheRoot/txtCacheSubdir/indexCacheSubdir/globalIndexPath have been
   * customized away from the defaults.
   *
   * Waits for an update in progress, which would write the cache back.
   */
  clearCache(): Promise<void> {
    return this.exclusive(() => this.clearCacheNow());
  }

  private async clearCacheNow(): Promise<void> {
    const { cacheRoot, globalIndexPath } = resolveCachePaths(this.config);

    this.logger.info(`🗑️ Deleting index cache: ${cacheRoot}`);
    await fs.promises.rm(cacheRoot, { recursive: true, force: true });

    // globalIndexPath can be pointed outside cacheRoot via an explicit
    // override, in which case the rm above won't have touched it (or its
    // chunked-storage sibling directory) — clean those up too.
    const globalIndexDir = path.dirname(globalIndexPath);
    if (
      globalIndexDir !== cacheRoot &&
      !globalIndexDir.startsWith(cacheRoot + path.sep)
    ) {
      await fs.promises.rm(globalIndexPath, { force: true });
      await fs.promises.rm(globalIndexPath.replace('.json.gz', '.chunks'), {
        recursive: true,
        force: true,
      });
    }

    this.documentCache = new Map();
    this.invertedIndex = new InvertedIndex();
    this.stemDictionary = new Map();
    this.generation++;
    this.documentLRU.clear();
    this.processor.clearMemoryCache();
    // The next refresh indexes the folder anew
    this.watcher?.markChanged();
  }
}

export { FileIndexer };
