import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as v8 from 'v8';

import { resolveCachePaths } from '../cache-paths.mjs';
import { LRUCache } from '../lru-cache.mjs';
import { createLogger } from '../shared/logger.mjs';
import {
  DocumentIndex,
  DocumentMetadata,
  InvertedIndexEntry,
  SearchConfig,
} from '../types.mjs';
import { DocumentProcessor } from './document-processor.mjs';
import { FileScannerIndexer } from './file-scanner.indexer.mjs';
import { IndexBuilder } from './index-builder.mjs';
import { IndexStorage } from './index-storage.mjs';
import { InvertedIndex } from './inverted-index.mjs';

class FileIndexer {
  private logger = createLogger('FileIndexer');
  private documentCache = new Map<string, DocumentIndex>();
  private invertedIndex = new InvertedIndex();
  private stemDictionary = new Map<string, Set<string>>();
  private documentLRU = new LRUCache<string, DocumentIndex>(50);
  private searchCache?: {
    termFrequencies: Map<string, number>;
    documentLengths: Map<string, number>;
    totalDocuments: number;
    averageDocLength: number;
    lastWarmed: number;
  };

  private scanner: FileScannerIndexer;
  private processor: DocumentProcessor;
  private storage: IndexStorage;
  private builder: IndexBuilder;

  constructor(private config: SearchConfig) {
    this.config.rootDirectory = path.resolve(this.config.rootDirectory);
    this.scanner = new FileScannerIndexer(this.config, this.logger);
    this.processor = new DocumentProcessor(this.config, this.logger);
    this.storage = new IndexStorage(this.config, this.logger, this.documentLRU);
    this.builder = new IndexBuilder(this.config, this.logger);
  }

  async discoverFiles(): Promise<DocumentMetadata[]> {
    return this.scanner.discoverFiles();
  }

  async extractTextFromFile(filePath: string): Promise<string> {
    return this.processor.extractTextFromFile(filePath);
  }

  /**
   * Indexes only the specified paths (files or directories).
   * Merges the results into the existing global index.
   */
  async indexSpecificPaths(paths: string[]): Promise<void> {
    // Default behavior: if no paths provided, build full index
    if (!paths || paths.length === 0) {
      this.logger.info('No specific paths provided. Running full index build.');
      return this.buildFullIndex();
    }

    this.logger.info(`🎯 Indexing ${paths.length} specific paths...`);

    // Ensure global index is loaded so we can merge updates
    if (this.documentCache.size === 0) {
      const loadedData = await this.storage.loadGlobalIndex();
      if (loadedData) {
        this.documentCache = loadedData.documentCache;
        this.invertedIndex = loadedData.invertedIndex;
        this.stemDictionary = loadedData.stemDictionary;
        this.logger.debug(
          '📋 Loaded existing global index for partial update.',
        );
      }
    }

    // 1. Discover files within the requested paths
    const filesToIndex = await this.scanner.discoverSpecificPaths(paths);

    if (filesToIndex.length === 0) {
      this.logger.info('No valid files found in the specified paths.');
      return;
    }

    this.logger.info(`Found ${filesToIndex.length} files to process.`);

    // 2. Select method (Sequential vs Parallel)
    const indexingMethod = await this.selectIndexingMethod(filesToIndex);

    // 3. Process files
    // Note: We pass filesRemoved=false because we are doing an additive update,
    // not a full sweep that should prune missing files.
    if (indexingMethod === 'parallel') {
      await this.buildFullIndexParallel(filesToIndex, {}, false);
    } else {
      await this.buildFullIndexSequential(filesToIndex, {}, false);
    }
  }

  /**
   * Monitors memory usage and pauses execution if heap usage is high.
   * This allows V8's garbage collector to run naturally without blocking the main thread
   * via global.gc(), and prevents OOM crashes by slowing down allocation rate.
   */
  private async manageMemoryPressure(): Promise<void> {
    const heapUsed = process.memoryUsage().heapUsed;
    const heapLimit = v8.getHeapStatistics().heap_size_limit;
    const usageRatio = heapUsed / heapLimit;

    if (usageRatio > 0.85) {
      this.logger.warn(
        `⚠️ High memory usage (${(usageRatio * 100).toFixed(1)}%). Pausing for GC...`,
      );
      // Long pause (5s) to allow V8 to perform major GC cycles
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } else if (usageRatio > 0.7) {
      // Short pause (200ms) to allow minor GC / incremental marking
      await new Promise((resolve) => setTimeout(resolve, 200));
    } else {
      // Minimal pause to yield to event loop
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async buildFullIndex(): Promise<void> {
    // Optimization: Run file discovery and index loading in parallel
    // This saves ~500ms by overlapping IO operations
    const [allDiscoveredFiles, loadedData] = await Promise.all([
      this.scanner.discoverFiles(),
      this.storage.loadGlobalIndex(),
    ]);

    if (allDiscoveredFiles.length === 0) {
      this.logger.info('No files found to index.');
      return;
    }

    const indexingMethod = await this.selectIndexingMethod(allDiscoveredFiles);
    this.logger.debug(`📂 Using indexing method: ${indexingMethod}`);

    const buildFullIndexConfig = {
      // require at least 0.1% of index to have changed to trigger rebuild
      rebuildThreshold: this.config.indexRebuildThreshold ?? 0.001,
      // rebuild if at least N files changed
      minFiles: this.config.minFilesForRebuild ?? 1,
    };

    this.logger.info(
      `📁 Found ${allDiscoveredFiles.length} documents to process...`,
    );

    let filesToIndex = allDiscoveredFiles;
    let filesRemoved = false;

    if (loadedData) {
      this.documentCache = loadedData.documentCache;
      this.invertedIndex = loadedData.invertedIndex;
      this.stemDictionary = loadedData.stemDictionary;

      // Prune deleted files from cache
      const discoveredPaths = new Set(
        allDiscoveredFiles.map((f) => f.originalFilePath),
      );
      let deletedCount = 0;
      for (const path of this.documentCache.keys()) {
        if (!discoveredPaths.has(path)) {
          this.documentCache.delete(path);
          deletedCount++;
        }
      }
      if (deletedCount > 0) {
        this.logger.info(
          `🗑️ Pruned ${deletedCount} deleted documents from cache.`,
        );
        filesRemoved = true;
      }

      this.logger.debug('📋 Loaded existing global index from cache.');
      this.logger.debug('🔍 Checking which files actually need reindexing...');

      const checks = await Promise.all(
        allDiscoveredFiles.map(async (file) => {
          const needsReindexing = await this.processor.needsReindexing(
            file,
            this.documentCache,
          );
          if (needsReindexing) {
            this.logger.debug(
              `🔄 File needs reindexing: ${file.fileName} (Path: ${file.originalFilePath})`,
            );
          }
          return {
            file,
            needsReindexing,
          };
        }),
      );

      const filesToReindex = checks
        .filter((c) => c.needsReindexing)
        .map((c) => c.file);

      if (filesToReindex.length === 0) {
        this.logger.info('✅ All files are up to date. No reindexing needed.');

        // If files were removed, we should save the index to reflect deletions
        if (filesRemoved) {
          this.logger.info('💾 Saving global index (files removed)...');
          await this.storage.saveGlobalIndex(
            this.documentCache,
            this.invertedIndex,
            this.stemDictionary,
          );
        }
        return;
      }

      this.logger.info(
        `📝 Found ${filesToReindex.length} files to reindex out of ${allDiscoveredFiles.length} total.`,
      );
      // Log the first few files to help debugging
      filesToReindex.slice(0, 5).forEach((f) => {
        this.logger.info(`   - ${f.fileName}`);
      });

      filesToIndex = filesToReindex;
    }

    if (indexingMethod === 'parallel') {
      await this.buildFullIndexParallel(
        filesToIndex,
        buildFullIndexConfig,
        filesRemoved,
      );
    } else {
      await this.buildFullIndexSequential(
        filesToIndex,
        buildFullIndexConfig,
        filesRemoved,
      );
    }
  }

  /**
   * Removes a document's terms from the inverted index.
   * Crucial for partial updates to prevent stale terms.
   */
  private purgeDocumentFromIndex(doc: DocumentIndex, docId: string) {
    // Iterate over all terms in the old document
    for (const term of doc.termFrequency.keys()) {
      // Access entries using public get() method
      const entries = this.invertedIndex.get(term);

      if (entries && Array.isArray(entries)) {
        // Mutate array in place to remove the document entry
        for (let i = entries.length - 1; i >= 0; i--) {
          if (entries[i].documentId === docId) {
            entries.splice(i, 1);
          }
        }

        // If term has no more documents, remove the term entirely
        if (entries.length === 0) {
          this.invertedIndex.delete(term);
        }
      }
    }
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

  async buildFullIndexSequential(
    files: DocumentMetadata[],
    {
      rebuildThreshold,
      minFiles,
    }: { rebuildThreshold?: number; minFiles?: number } = {},
    filesRemoved: boolean = false,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      if (files.length === 0 && !filesRemoved) return;

      this.logger.info(`🔄 Indexing ${files.length} documents sequentially...`);
      let indexed = 0;
      let skipped = 0;
      let errors = 0;
      let actuallyProcessed = 0;

      const BATCH_SIZE = 25;
      const batches = [];
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        batches.push(files.slice(i, i + BATCH_SIZE));
      }

      const documentsToUpdate: string[] = [];

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        this.logger.info(
          `📦 Processing batch ${batchIndex + 1}/${batches.length}...`,
        );

        const batchPromises = batch.map(async (file) => {
          try {
            const wasInCache = this.documentCache.has(file.originalFilePath);
            if (
              await this.processor.needsReindexing(file, this.documentCache)
            ) {
              // PURGE: Remove old terms before re-indexing
              if (wasInCache) {
                const oldDoc = this.documentCache.get(file.originalFilePath);
                if (oldDoc) {
                  this.purgeDocumentFromIndex(oldDoc, file.originalFilePath);
                }
              }

              const result = await this.processor.indexDocument(file);
              this.documentCache.set(file.originalFilePath, result);
              const isNewlyProcessed = !wasInCache && result.metadata.indexed;
              return {
                success: true,
                type: isNewlyProcessed ? 'newly-indexed' : 'cached-loaded',
                filePath: file.originalFilePath,
              };
            } else {
              return {
                success: true,
                type: 'skipped',
                filePath: file.originalFilePath,
              };
            }
          } catch (error) {
            this.logger.error(
              `❌ Failed to index ${file.fileName}:`,
              error instanceof Error ? error.message : String(error),
            );
            return {
              success: false,
              type: 'error',
              filePath: file.originalFilePath,
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);

        batchResults.forEach((result) => {
          if (result.success) {
            if (result.type === 'newly-indexed') {
              indexed++;
              actuallyProcessed++;
              documentsToUpdate.push(result.filePath);
            } else if (result.type === 'cached-loaded') {
              indexed++;
              documentsToUpdate.push(result.filePath);
            } else if (result.type === 'skipped') {
              skipped++;
              documentsToUpdate.push(result.filePath);
            }
          } else {
            errors++;
          }
        });

        // Replaced manual GC with memory pressure management
        await this.manageMemoryPressure();
      }

      const significantChanges =
        actuallyProcessed >=
        Math.max(minFiles!, files.length * rebuildThreshold!);

      // If files were removed, we should consider it a significant change to ensure index consistency
      if (
        (documentsToUpdate.length > 0 && significantChanges) ||
        filesRemoved
      ) {
        this.logger.info(
          `🔗 Updating inverted index (processed ${documentsToUpdate.length}, removed ${filesRemoved})...`,
        );
        await this.builder.updateInvertedIndexBatch(
          this.documentCache,
          this.invertedIndex,
          this.stemDictionary,
          documentsToUpdate,
        );
      } else if (documentsToUpdate.length > 0) {
        this.logger.info(`🚀 Skipping inverted index rebuild`);
      }

      this.logger.info(
        `✅ Indexing complete: ${indexed} total, ${skipped} skipped, ${errors} errors`,
      );

      if (
        actuallyProcessed > 0 ||
        filesRemoved ||
        this.storage.needsOptimization
      ) {
        this.logger.info('💾 Saving global index...');
        await this.storage.saveGlobalIndex(
          this.documentCache,
          this.invertedIndex,
          this.stemDictionary,
        );
        this.storage.needsOptimization = false;
      }
    } catch (error) {
      this.logger.error('Index building failed:', error);
      throw error;
    }
    this.logger.info(
      `Sequential index build completed in ${Date.now() - startTime}ms`,
    );
  }

  async buildFullIndexParallel(
    files: DocumentMetadata[],
    {
      rebuildThreshold,
      minFiles,
    }: { rebuildThreshold?: number; minFiles?: number } = {},
    filesRemoved: boolean = false,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      if (files.length === 0 && !filesRemoved) return;

      this.logger.info(
        `🚀 Processing ${files.length} documents with parallel workers...`,
      );
      const PARALLEL_WORKERS = Math.min(
        this.config.concurrency || 4,
        files.length,
      );
      const chunks = [];
      for (
        let i = 0;
        i < files.length;
        i += Math.ceil(files.length / PARALLEL_WORKERS)
      ) {
        chunks.push(
          files.slice(i, i + Math.ceil(files.length / PARALLEL_WORKERS)),
        );
      }

      let totalIndexed = 0;
      let totalErrors = 0;

      const workerPromises = chunks.map(async (chunk, workerIndex) => {
        let workerIndexed = 0;
        let workerErrors = 0;
        for (const file of chunk) {
          try {
            // PURGE: Remove old terms before re-indexing
            const wasInCache = this.documentCache.has(file.originalFilePath);
            if (wasInCache) {
              const oldDoc = this.documentCache.get(file.originalFilePath);
              if (oldDoc) {
                this.purgeDocumentFromIndex(oldDoc, file.originalFilePath);
              }
            }

            const result = await this.processor.indexDocument(file);
            this.documentCache.set(file.originalFilePath, result);
            workerIndexed++;
            totalIndexed++;

            // Check memory pressure periodically within worker
            if (workerIndexed % 5 === 0) {
              await this.manageMemoryPressure();
            }
          } catch (error) {
            workerErrors++;
            totalErrors++;
            this.logger.error(
              `❌ Worker ${workerIndex + 1} failed on ${file.fileName}:`,
              error,
            );
          }
        }
        return { workerIndex, workerIndexed, workerErrors };
      });

      await Promise.all(workerPromises);

      if (
        totalIndexed >= Math.max(minFiles!, files.length * rebuildThreshold!) ||
        filesRemoved
      ) {
        await this.builder.updateInvertedIndexBatch(
          this.documentCache,
          this.invertedIndex,
          this.stemDictionary,
          files.map((f) => f.originalFilePath),
        );
      }

      if (totalIndexed > 0 || filesRemoved || this.storage.needsOptimization) {
        await this.storage.saveGlobalIndex(
          this.documentCache,
          this.invertedIndex,
          this.stemDictionary,
        );
        this.storage.needsOptimization = false;
      }

      await this.validateIndexHealth();
    } catch (error) {
      this.logger.error('Parallel index building failed:', error);
      throw error;
    }
    this.logger.info(
      `Parallel index build completed in ${Date.now() - startTime}ms`,
    );
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

      // Filter out empty documents from the count check
      const nonEmptyDocsCount = Array.from(this.documentCache.values()).filter(
        (doc) => doc.wordCount > 0,
      ).length;

      if (nonEmptyDocsCount !== invertedIndexDocs.size)
        issues.push(
          `Non-empty document count (${nonEmptyDocsCount}) doesn't match inverted index documents (${invertedIndexDocs.size})`,
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

  async preWarmSearchCaches(): Promise<void> {
    this.logger.debug('🔥 Pre-warming search caches...');
    const startTime = Date.now();
    try {
      const termFrequencies = new Map<string, number>();
      const documentLengths = new Map<string, number>();
      this.documentCache.forEach((doc, docId) => {
        documentLengths.set(docId, doc.wordCount);
        doc.termFrequency.forEach((freq, term) =>
          termFrequencies.set(term, (termFrequencies.get(term) || 0) + 1),
        );
      });
      this.searchCache = {
        termFrequencies,
        documentLengths,
        totalDocuments: this.documentCache.size,
        averageDocLength:
          Array.from(documentLengths.values()).reduce(
            (sum, len) => sum + len,
            0,
          ) / documentLengths.size,
        lastWarmed: Date.now(),
      };
      this.logger.debug(
        `🔥 Search caches pre-warmed in ${Date.now() - startTime}ms`,
      );
    } catch (error) {
      this.logger.warn('⚠️ Failed to pre-warm search caches:', error);
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

  getInvertedIndex(): Map<string, InvertedIndexEntry[]> {
    return this.invertedIndex.toLegacyMap();
  }

  getStemDictionary(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    this.stemDictionary.forEach((value, key) =>
      result.set(key, Array.from(value)),
    );
    return result;
  }

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

  getSearchDataOptimized() {
    return {
      docCache: this.getDocumentCache(),
      invertedIndex: this.getInvertedIndex(),
      stemDictionary: this.getStemDictionary(),
      searchCache: this.searchCache,
    };
  }

  /**
   * Wipes the on-disk index cache (global index + per-file vocab/positions +
   * extracted text) and every in-memory cache mirroring it. Uses the same
   * resolver (resolveCachePaths) that IndexStorage/DocumentProcessor/
   * FileScannerIndexer use to locate cache files, so this stays correct even
   * when cacheRoot/txtCacheSubdir/indexCacheSubdir/globalIndexPath have been
   * customized away from the defaults.
   */
  async clearCache(): Promise<void> {
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

    this.documentCache.clear();
    this.invertedIndex = new InvertedIndex();
    this.stemDictionary.clear();
    this.documentLRU.clear();
    this.searchCache = undefined;
  }
}

export { FileIndexer };
