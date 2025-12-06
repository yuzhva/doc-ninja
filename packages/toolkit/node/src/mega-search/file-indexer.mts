import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as zlib from 'zlib';

import { DocumentExtractor } from './document-parser/index.mjs';
import { LRUCache } from './lru-cache.mjs';
import { scanDirectory } from './shared/file-utils.mjs';
import { createLogger } from './shared/logger.mjs';
import { UkrainianTextProcessor } from './text-processor.mjs';
import {
  DocumentIndex,
  DocumentMetadata,
  InvertedIndexEntry,
  SearchConfig,
} from './types.mjs';

class FileIndexer {
  private logger = createLogger('FileIndexer');
  private textProcessor = new UkrainianTextProcessor();
  private documentExtractor = new DocumentExtractor();
  private documentCache = new Map<string, DocumentIndex>();
  private invertedIndex = new Map<string, InvertedIndexEntry[]>();
  private stemDictionary = new Map<string, Set<string>>();

  // Optimized LRU cache sizes for better memory management
  private documentLRU = new LRUCache<string, DocumentIndex>(50); // Reduced from 100
  private textLRU = new LRUCache<string, string>(25); // Reduced from 50

  constructor(private config: SearchConfig) {
    // Ensure root directory is absolute to avoid path ambiguity
    this.config.rootDirectory = path.resolve(this.config.rootDirectory);
  }

  private getCacheRelativePath(filePath: string): string {
    // Get relative path from rootDirectory, remove leading slash
    const rel = path.relative(this.config.rootDirectory, filePath);
    return rel.replace(/^[/\\]/, '');
  }

  private getTextCachePath(filePath: string): string {
    const rel = this.getCacheRelativePath(filePath);
    const txtCacheRoot = this.config.txtCacheSubdir || '.cache/txt';
    // Append .txt to the full filename including original extension (e.g. file.doc -> file.doc.txt)
    return path.join(this.config.rootDirectory, txtCacheRoot, `${rel}.txt`);
  }

  private getIndexCachePath(filePath: string): string {
    const rel = this.getCacheRelativePath(filePath);
    const indexCacheRoot = this.config.indexCacheSubdir || '.cache/index';
    // Append .index.json to the full filename including original extension (e.g. file.doc -> file.doc.index.json)
    return path.join(
      this.config.rootDirectory,
      indexCacheRoot,
      `${rel}.index.json`,
    );
  }

  async extractTextFromFile(filePath: string): Promise<string> {
    try {
      // Check LRU cache first
      const cached = this.textLRU.get(filePath);
      if (cached) return cached;

      const txtPath = this.getTextCachePath(filePath);
      // Ensure directory exists
      await fs.promises.mkdir(path.dirname(txtPath), { recursive: true });

      // Use cached .txt if up-to-date
      try {
        const srcStat = await promisify(fs.stat)(filePath);
        if (fs.existsSync(txtPath)) {
          const txtStat = await promisify(fs.stat)(txtPath);
          if (txtStat.mtimeMs >= srcStat.mtimeMs) {
            const text = await promisify(fs.readFile)(txtPath, 'utf8');
            this.textLRU.set(filePath, text);
            return text;
          }
        }

        // Extract and cache
        const text = await this.documentExtractor.extractText({ filePath });

        // Save to cache file
        await promisify(fs.writeFile)(txtPath, text, 'utf8');

        // Store in LRU cache before returning
        this.textLRU.set(filePath, text);
        return text;
      } catch (diskError) {
        this.logger.warn(
          `Cache operation failed for ${path.basename(filePath)}, extracting directly:`,
          diskError instanceof Error ? diskError.message : String(diskError),
        );

        // Fallback to direct extraction
        const text = await this.documentExtractor.extractText({ filePath });
        this.textLRU.set(filePath, text);
        return text;
      }
    } catch (error) {
      this.logger.error(
        `Text extraction failed for ${path.basename(filePath)}:`,
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `Failed to extract text from ${path.basename(filePath)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Check if file should be skipped (temp files, system files, etc.)
   */
  private shouldSkipFile(fileName: string, filePath: string): boolean {
    // Skip Microsoft Office temp files
    if (fileName.startsWith('~$')) {
      // this.logger.info(`⏭️ Skipping temp file: ${fileName}`);
      return true;
    }

    // Skip system files
    if (fileName.startsWith('.') || fileName.startsWith('~')) {
      // this.logger.info(`⏭️ Skipping system file: ${fileName}`);
      return true;
    }

    // Skip very large files that might cause memory issues
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > (this.config.maxFileSize || 50 * 1024 * 1024)) {
        // this.logger.info(
        //   `⏭️ Skipping large file: ${fileName} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`,
        // );
        return true;
      }
    } catch (error) {
      // this.logger.info(`⏭️ Skipping inaccessible file: ${fileName}`);
      return true;
    }

    // Skip empty files
    try {
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        // this.logger.info(`⏭️ Skipping empty file: ${fileName}`);
        return true;
      }
    } catch (error) {
      return true;
    }

    return false;
  }

  async discoverFiles(): Promise<DocumentMetadata[]> {
    try {
      this.logger.info(`Starting file discovery ${this.config.rootDirectory}`);

      const fileInfos = await scanDirectory(
        this.config.rootDirectory,
        this.config.extensions,
        {
          maxFileSize: this.config.maxFileSize,
          excludeDirs: [this.config.cacheRoot || '.cache'],
        },
      );

      // Filter out temp and system files
      const filteredFileInfos = fileInfos.filter(
        (file) => !this.shouldSkipFile(file.fileName, file.filePath),
      );

      const documentMetadata: DocumentMetadata[] = filteredFileInfos.map(
        (file) => ({
          originalFilePath: file.filePath,
          fileName: file.fileName,
          lastModified: file.lastModified,
          size: file.size,
          indexed: false,
          language: 'mixed' as const,
          textFilePath: this.getTextCachePath(file.filePath),
        }),
      );

      this.logger.info('File discovery completed', {
        filesFound: documentMetadata.length,
        totalSize: documentMetadata.reduce((sum, f) => sum + f.size, 0),
        filteredOut: fileInfos.length - filteredFileInfos.length,
      });

      return documentMetadata;
    } catch (error) {
      this.logger.error('File discovery failed', error);
      throw new Error(
        `Failed to discover files: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  needsReindexing(metadata: DocumentMetadata): boolean {
    // Check memory cache first for faster lookup
    const cached = this.documentCache.get(metadata.originalFilePath);
    if (cached) {
      if (!cached.metadata.indexed) return true;
      if (cached.metadata.lastModified !== metadata.lastModified) return true;
      return false; // Already indexed and up to date
    }

    // Check if index cache file exists and is up to date
    const indexPath = this.getIndexCachePath(metadata.originalFilePath);
    if (fs.existsSync(indexPath)) {
      try {
        const indexStat = fs.statSync(indexPath);
        const sourceStat = fs.statSync(metadata.originalFilePath);

        // FIXED: Use proper comparison and also check if it's already in document cache
        if (indexStat.mtimeMs >= sourceStat.mtimeMs) {
          // Load the cached index to verify it's valid and update document cache
          try {
            const cached = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            cached.termFrequency = new Map(
              Object.entries(cached.termFrequency),
            );

            // Update the metadata with current file stats
            cached.metadata.lastModified = sourceStat.mtimeMs;
            cached.metadata.size = sourceStat.size;

            // Migration: Ensure new fields exist
            if (
              !cached.metadata.originalFilePath &&
              (cached.metadata as any).filePath
            ) {
              cached.metadata.originalFilePath = (
                cached.metadata as any
              ).filePath;
            }
            if (!cached.metadata.textFilePath) {
              cached.metadata.textFilePath = this.getTextCachePath(
                metadata.originalFilePath,
              );
            }

            // Store in document cache to prevent future cache misses
            this.documentCache.set(metadata.originalFilePath, cached);

            this.logger.debug(
              `📋 Pre-loaded cached index for ${metadata.fileName} - no reindexing needed`,
            );
            return false; // No need to reindex
          } catch (loadError) {
            this.logger.warn(
              `📋 Cache file corrupted for ${metadata.fileName}, will rebuild`,
            );
            return true; // Cache corrupted, need to reindex
          }
        }
      } catch (error) {
        // If we can't check stats, safer to reindex
        this.logger.info(
          `⚠️ Cannot check cache stats for ${metadata.fileName}, will reindex`,
        );
      }
    }

    return true;
  }

  async indexDocument(metadata: DocumentMetadata): Promise<DocumentIndex> {
    // Add timeout protection for individual documents
    const DOCUMENT_TIMEOUT = 30000; // 30 seconds per document
    let timeoutHandle: NodeJS.Timeout;

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(`Document indexing timeout after ${DOCUMENT_TIMEOUT}ms`),
          );
        }, DOCUMENT_TIMEOUT);
      });

      // Create indexing promise
      const indexingPromise = this.indexDocumentInternal(metadata);

      // Race between indexing and timeout
      const result = await Promise.race([indexingPromise, timeoutPromise]);

      clearTimeout(timeoutHandle);
      return result;
    } catch (error) {
      if (timeoutHandle) clearTimeout(timeoutHandle);

      this.logger.error('Document indexing failed', {
        fileName: metadata.fileName,
        error,
      });

      // Don't throw for individual document failures - log and continue
      this.logger.error(
        `❌ Failed to index ${metadata.fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      // Return a minimal index to keep processing going
      return {
        metadata: {
          ...metadata,
          indexed: false,
          indexedAt: Date.now(),
          language: 'unknown' as const,
        },
        vocab: [],
        positions: [],
        termFrequency: new Map(),
        wordCount: 0,
      };
    }
  }

  private async indexDocumentInternal(
    metadata: DocumentMetadata,
  ): Promise<DocumentIndex> {
    const startTime = Date.now();

    this.logger.debug('Starting document indexing', {
      fileName: metadata.fileName,
    });

    const indexPath = this.getIndexCachePath(metadata.originalFilePath);
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });

    try {
      const srcStat = await promisify(fs.stat)(metadata.originalFilePath);

      // Use cached index if up-to-date
      if (fs.existsSync(indexPath)) {
        try {
          const idxStat = await promisify(fs.stat)(indexPath);
          if (idxStat.mtimeMs >= srcStat.mtimeMs) {
            const cached = JSON.parse(
              await promisify(fs.readFile)(indexPath, 'utf8'),
            );
            // Restore Map from object
            cached.termFrequency = new Map(
              Object.entries(cached.termFrequency),
            );

            // FIXED: Update metadata with current file stats to prevent future cache misses
            cached.metadata.lastModified = srcStat.mtimeMs;
            cached.metadata.size = srcStat.size;
            cached.metadata.indexed = true; // Ensure it's marked as indexed

            // Migration: Ensure new fields exist
            if (
              !cached.metadata.originalFilePath &&
              (cached.metadata as any).filePath
            ) {
              cached.metadata.originalFilePath = (
                cached.metadata as any
              ).filePath;
            }
            if (!cached.metadata.textFilePath) {
              cached.metadata.textFilePath = this.getTextCachePath(
                metadata.originalFilePath,
              );
            }

            // Store in cache but don't update inverted index yet (do it later in batch)
            this.documentCache.set(metadata.originalFilePath, cached);
            this.logger.info(`📋 Loaded cached index for ${metadata.fileName}`);
            return cached;
          }
        } catch (cacheError) {
          this.logger.warn(
            `Index cache corrupted for ${metadata.fileName}, rebuilding:`,
            cacheError instanceof Error
              ? cacheError.message
              : String(cacheError),
          );
          // Continue to rebuild index
        }
      }

      // Extract text with better error handling
      let text: string;
      try {
        text = await this.extractTextFromFile(metadata.originalFilePath);
      } catch (extractError) {
        this.logger.warn(
          `Text extraction failed for ${metadata.fileName}, creating empty index`,
        );
        // Create empty index for files that can't be processed
        return {
          metadata: {
            ...metadata,
            indexed: false,
            indexedAt: Date.now(),
            language: 'unknown' as const,
          },
          vocab: [],
          positions: [],
          termFrequency: new Map(),
          wordCount: 0,
        };
      }

      if (!text || text.trim().length === 0) {
        this.logger.warn(
          `No text content in ${metadata.fileName}, creating empty index`,
        );
        return {
          metadata: {
            ...metadata,
            indexed: false,
            indexedAt: Date.now(),
            language: 'unknown' as const,
          },
          vocab: [],
          positions: [],
          termFrequency: new Map(),
          wordCount: 0,
        };
      }

      const rawTokens = this.textProcessor.tokenize(text);
      if (rawTokens.length === 0) {
        this.logger.warn(`No valid tokens found in ${metadata.fileName}`);
      }

      // ✅ REFACTOR: Build efficient vocab/positions structure
      const termFrequency = new Map<string, number>();
      const vocab: string[] = [];
      const vocabMap = new Map<string, number>();
      const positions: Array<[number, number, number]> = [];

      rawTokens.forEach((token) => {
        // Build vocab
        let vocabIndex = vocabMap.get(token.term);
        if (vocabIndex === undefined) {
          vocabIndex = vocab.length;
          vocab.push(token.term);
          vocabMap.set(token.term, vocabIndex);
        }

        // Build positions array
        positions.push([vocabIndex, token.charStart, token.charEnd]);

        // Build term frequency on stemmed tokens
        const stemmedTerm = this.config.ukrainianStemming
          ? this.textProcessor.stemWord(token.normalized)
          : token.normalized;
        termFrequency.set(
          stemmedTerm,
          (termFrequency.get(stemmedTerm) || 0) + 1,
        );
      });

      const language = this.textProcessor.detectLanguage(text);
      const documentIndex: DocumentIndex = {
        metadata: {
          ...metadata,
          indexed: true,
          indexedAt: Date.now(),
          language,
          textFilePath: this.getTextCachePath(metadata.originalFilePath),
        },
        vocab,
        positions,
        termFrequency,
        wordCount: positions.length,
      };

      this.documentCache.set(metadata.originalFilePath, documentIndex);

      // Save index to disk (convert Map to object)
      try {
        const toSave = {
          ...documentIndex,
          termFrequency: Object.fromEntries(termFrequency),
        };
        await promisify(fs.writeFile)(
          indexPath,
          JSON.stringify(toSave),
          'utf8',
        );
        this.logger.debug(`💾 Cached index for ${metadata.fileName}`);
      } catch (saveError) {
        this.logger.warn(
          `Failed to save index cache for ${metadata.fileName}:`,
          saveError instanceof Error ? saveError.message : String(saveError),
        );
        // Continue without caching
      }

      const endTime = Date.now();
      this.logger.debug('Document indexing completed', {
        fileName: metadata.fileName,
        tokens: documentIndex.wordCount,
        duration: endTime - startTime,
      });

      return documentIndex;
    } catch (error) {
      throw new Error(
        `Failed to index document ${metadata.fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * DEPRECATED: This method is no longer used. The `updateInvertedIndexBatch`
   * method is the correct implementation.
   */
  /*
  private updateInvertedIndex(
    documentId: string,
    docIndex: DocumentIndex,
  ): void {
    // Remove old entries for this document
    for (const [term, entries] of this.invertedIndex.entries()) {
      this.invertedIndex.set(
        term,
        entries.filter((entry) => entry.documentId !== documentId),
      );
    }

    // Add new entries
    docIndex.termFrequency.forEach((frequency, term) => {
      const positions = docIndex.tokens
        .filter((token) => {
          const normalized = this.config.ukrainianStemming
            ? this.textProcessor.stemWord(token.normalized)
            : token.normalized;
          return normalized === term;
        })
        .map((token) => token.position);

      const entry: InvertedIndexEntry = {
        documentId,
        frequency,
        positions,
      };

      const existing = this.invertedIndex.get(term) || [];
      existing.push(entry);
      this.invertedIndex.set(term, existing);
    });
  }
  */

  /**
   * Optimized batch update for inverted index
   * Instead of updating incrementally, rebuild the entire index efficiently
   */
  private async updateInvertedIndexBatch(
    documentPaths: string[],
  ): Promise<void> {
    const startTime = Date.now();

    this.logger.info(
      `🔗 Starting inverted index rebuild for ${documentPaths.length} documents...`,
    );

    try {
      // Clear existing inverted index - we'll rebuild it completely
      this.logger.info(
        `🗑️ Clearing existing inverted index (${this.invertedIndex.size} terms)...`,
      );
      this.invertedIndex.clear();
      this.stemDictionary.clear();

      // Get all documents that should be in the index (cached + new)
      const allDocuments = Array.from(this.documentCache.values()).filter(
        (doc) => doc.metadata.indexed,
      );

      // ✅ NEW: Sort documents by date (newest first) and then by name.
      // This ensures that search results from the inverted index are naturally ordered by relevance (recency).
      // allDocuments.sort((a, b) => {
      //   // Primary: Last modified descending (newest first)
      //   const dateDiff = b.metadata.lastModified - a.metadata.lastModified;
      //   if (dateDiff !== 0) return dateDiff;
      //   // Secondary: Filename ascending (A-Z)
      //   return a.metadata.fileName.localeCompare(b.metadata.fileName);
      // });

      this.logger.info(
        `🔄 Found ${allDocuments.length} indexed documents to process...`,
      );

      if (allDocuments.length === 0) {
        this.logger.info(`⚠️ No indexed documents found, nothing to process`);
        return;
      }

      // Rebuild inverted index in one pass
      let totalTermsProcessed = 0;
      let processedDocs = 0;
      let lastProgressTime = Date.now();

      for (const docIndex of allDocuments) {
        const docStartTime = Date.now();
        let docTermsProcessed = 0;

        try {
          // ✅ REFACTOR: Process terms from the new structure more efficiently in a single pass.
          const termPositions = new Map<string, number[]>();

          // Collect all positions for each stemmed term.
          for (let i = 0; i < docIndex.positions.length; i++) {
            const [vocabIndex] = docIndex.positions[i];
            const term = docIndex.vocab[vocabIndex];

            // BUG FIX: Correctly get the normalized form by re-tokenizing the single term.
            // The previous implementation called a non-existent `normalize` method.
            const normalized = this.textProcessor.tokenize(term)[0]?.normalized;
            if (!normalized) continue;

            const stemmedTerm = this.config.ukrainianStemming
              ? this.textProcessor.stemWord(normalized)
              : normalized;

            if (!termPositions.has(stemmedTerm)) {
              termPositions.set(stemmedTerm, []);
            }
            termPositions.get(stemmedTerm)!.push(i); // Push the position index `i`

            // STAGE 1: Populate the stem dictionary
            if (!this.stemDictionary.has(stemmedTerm)) {
              this.stemDictionary.set(stemmedTerm, new Set());
            }
            this.stemDictionary.get(stemmedTerm)!.add(term);
          }

          // Update the inverted index from the collected positions.
          termPositions.forEach((positions, stemmedTerm) => {
            const entry: InvertedIndexEntry = {
              documentId: docIndex.metadata.originalFilePath,
              frequency: positions.length,
              positions,
            };

            if (this.invertedIndex.has(stemmedTerm)) {
              this.invertedIndex.get(stemmedTerm)!.push(entry);
            } else {
              this.invertedIndex.set(stemmedTerm, [entry]);
            }
            docTermsProcessed++;
          });

          totalTermsProcessed += docIndex.termFrequency.size;
          processedDocs++;

          const docProcessTime = Date.now() - docStartTime;

          // Log detailed progress for first few docs and every 10th doc
          if (processedDocs <= 5 || processedDocs % 10 === 0) {
            this.logger.info(
              `  📄 Doc ${processedDocs}/${allDocuments.length}: ${docIndex.metadata.fileName} (${docTermsProcessed} terms, ${docProcessTime}ms)`,
            );
          }

          // Progress update every 25 documents or every 30 seconds
          const timeSinceLastProgress = Date.now() - lastProgressTime;
          if (processedDocs % 25 === 0 || timeSinceLastProgress > 30000) {
            const elapsed = Date.now() - startTime;
            const docsPerSecond = processedDocs / (elapsed / 1000);
            const estimatedTotal = allDocuments.length / docsPerSecond;
            const remaining = estimatedTotal - elapsed / 1000;

            this.logger.info(
              `  🔗 Progress: ${processedDocs}/${allDocuments.length} docs (${docsPerSecond.toFixed(1)} docs/sec, ~${Math.round(remaining)}s remaining)`,
            );
            this.logger.info(
              `  💾 Index size: ${this.invertedIndex.size} unique terms, ${totalTermsProcessed} total term entries`,
            );
            this.logger.info(
              `  ⏱️ Elapsed: ${Math.round(elapsed / 1000)}s, Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
            );

            lastProgressTime = Date.now();
          }

          // Yield control every 10 documents to prevent blocking
          if (processedDocs % 10 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }

          // Force garbage collection every 50 docs if available
          if (global.gc && processedDocs % 50 === 0) {
            const beforeGC = process.memoryUsage().heapUsed;
            global.gc();
            const afterGC = process.memoryUsage().heapUsed;
            const freed = (beforeGC - afterGC) / 1024 / 1024;
            if (freed > 10) {
              // Only log if significant memory was freed
              this.logger.info(`  🗑️ GC freed ${freed.toFixed(1)}MB memory`);
            }
          }
        } catch (docError) {
          this.logger.error(
            `  ❌ Error processing document ${docIndex.metadata.fileName}:`,
            docError,
          );
          // Continue with next document
          processedDocs++;
        }
      }

      const duration = Date.now() - startTime;
      const docsPerSecond = processedDocs / (duration / 1000);
      const termsPerSecond = Math.round(
        totalTermsProcessed / (duration / 1000),
      );

      this.logger.info(`✅ Inverted index rebuild completed successfully!`);
      this.logger.info(`📊 Final stats:`);
      this.logger.info(
        `   - Processed docs: ${processedDocs}/${allDocuments.length}`,
      );
      this.logger.info(`   - Total terms: ${totalTermsProcessed}`);
      this.logger.info(
        `   - Unique terms: ${this.invertedIndex.size} (stems: ${this.stemDictionary.size})`,
      );
      this.logger.info(
        `   - Duration: ${duration}ms (${Math.round(duration / 1000)}s)`,
      );
      this.logger.info(
        `   - Performance: ${docsPerSecond.toFixed(1)} docs/sec, ${termsPerSecond} terms/sec`,
      );
      this.logger.info(
        `   - Final memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB heap`,
      );
      this.logger.info(`⏰ Completed at: ${new Date().toISOString()}`);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `❌ Inverted index rebuild FAILED after ${duration}ms:`,
        error,
      );
      this.logger.error(`💥 Error details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        documentsInCache: this.documentCache.size,
        indexSizeBeforeError: this.invertedIndex.size,
        memoryUsage: process.memoryUsage(),
      });
      throw error;
    }
  }

  private async isGlobalIndexStale(
    globalIndexPath: string,
    files: DocumentMetadata[],
  ): Promise<boolean> {
    if (!fs.existsSync(globalIndexPath)) return true;
    const idxStat = await promisify(fs.stat)(globalIndexPath);
    for (const file of files) {
      if (file.lastModified > idxStat.mtimeMs) {
        return true;
      }
    }
    return false;
  }

  private async loadGlobalInvertedIndex(): Promise<boolean> {
    const startTime = Date.now();
    try {
      const globalIndexPath =
        this.config.globalIndexPath ||
        path.join(
          this.config.rootDirectory,
          '.cache',
          'global-inverted-index.json.gz',
        );

      if (!fs.existsSync(globalIndexPath)) return false;

      // Check if it's a chunked format
      const content = await fs.promises.readFile(globalIndexPath, 'utf8');

      try {
        const marker = JSON.parse(content);
        if (marker.format === 'chunked') {
          this.logger.debug('📦 Loading chunked index format...');
          return await this.loadGlobalInvertedIndexChunked(
            globalIndexPath,
            marker,
          );
        }
      } catch (parseError) {
        // Not JSON, probably compressed standard format - continue with standard loading
      }

      this.logger.info('📋 Loading standard index format...');
      const result =
        await this.loadGlobalInvertedIndexStandard(globalIndexPath);
      this.logger.info(
        `Global index loading completed in ${Date.now() - startTime}ms`,
      );
      return result;
    } catch (error) {
      this.logger.warn(
        'Failed to load global inverted index:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  private async saveGlobalInvertedIndex(): Promise<void> {
    const startTime = Date.now();
    try {
      const globalIndexPath =
        this.config.globalIndexPath ||
        path.join(
          this.config.rootDirectory,
          '.cache',
          'global-inverted-index.json.gz',
        );
      const tempPath = globalIndexPath + '.tmp';

      // ✅ NEW: Check if the data is too large for JSON serialization
      const estimatedSize = this.estimateIndexSize();
      this.logger.info(
        `💾 Estimated index size: ${Math.round(estimatedSize / 1024 / 1024)}MB`,
      );

      // ✅ FIX: Lower the threshold significantly to avoid OOM errors.
      // Use chunked serialization for any index estimated over 50MB.
      if (estimatedSize > 50 * 1024 * 1024) {
        // > 50MB
        this.logger.info(
          `🚨 Index is large, using memory-safe chunked serialization.`,
        );
        await this.saveGlobalInvertedIndexChunked(globalIndexPath, tempPath);
      } else {
        this.logger.info(`💾 Using standard JSON serialization`);
        await this.saveGlobalInvertedIndexStandard(globalIndexPath, tempPath);
      }
      this.logger.info(
        `Global index saving completed in ${Date.now() - startTime}ms`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to save global inverted index:',
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `Failed to save index: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * ✅ NEW: Estimate the serialized size before attempting to serialize
   */
  private estimateIndexSize(): number {
    let estimatedSize = 0;

    // Estimate inverted index size
    this.invertedIndex.forEach((entries, term) => {
      // Term key: ~term.length bytes
      estimatedSize += term.length * 2; // UTF-16 encoding

      // Entries array: each entry has ~100-200 bytes when serialized
      estimatedSize += entries.length * 150;

      // Positions arrays: each position is ~10 bytes when serialized
      entries.forEach((entry) => {
        estimatedSize += entry.positions.length * 10;
      });
    });

    // Estimate document cache size
    this.documentCache.forEach((doc) => {
      // Metadata: ~500 bytes
      estimatedSize += 500;

      // ✅ REFACTOR: Estimate based on new structure
      // Vocab size
      estimatedSize += doc.vocab.reduce(
        (sum, term) => sum + term.length * 2,
        0,
      );
      // Positions size (3 numbers per position)
      estimatedSize += doc.positions.length * 12;

      // Term frequency map: ~30 bytes per entry
      estimatedSize += doc.termFrequency.size * 30;

      // Original text removed from estimation
    });

    // Add JSON overhead (~30%)
    return Math.round(estimatedSize * 1.3);
  }

  /**
   * ✅ NEW: Standard JSON serialization for smaller indexes
   */
  private async saveGlobalInvertedIndexStandard(
    globalIndexPath: string,
    tempPath: string,
  ): Promise<void> {
    // Save both invertedIndex and documentCache
    const obj: Record<string, any> = {
      invertedIndex: Object.fromEntries(this.invertedIndex),
      documentCache: Object.fromEntries(
        Array.from(this.documentCache.entries()).map(([k, v]) => [
          k,
          { ...v, termFrequency: Object.fromEntries(v.termFrequency) },
        ]),
      ),
      // STAGE 1: Serialize stemDictionary (convert Set to Array)
      stemDictionary: Object.fromEntries(
        Array.from(this.stemDictionary.entries()).map(([k, v]) => [
          k,
          Array.from(v),
        ]),
      ),
    };

    await fs.promises.mkdir(path.dirname(globalIndexPath), {
      recursive: true,
    });

    const json = JSON.stringify(obj);
    const gzipped = zlib.gzipSync(json);

    // Write to temp file first
    await fs.promises.writeFile(tempPath, gzipped);
    // Atomically replace the old file
    await fs.promises.rename(tempPath, globalIndexPath);

    this.logger.info(
      `✅ Standard index saved: ${Math.round(gzipped.length / 1024 / 1024)}MB compressed`,
    );
  }

  /**
   * ✅ NEW: Chunked serialization for very large indexes
   */
  private async saveGlobalInvertedIndexChunked(
    globalIndexPath: string,
    tempPath: string,
  ): Promise<void> {
    await fs.promises.mkdir(path.dirname(globalIndexPath), { recursive: true });

    // Create chunked directory structure
    const chunkedDir = globalIndexPath.replace('.json.gz', '.chunks');
    await fs.promises.mkdir(chunkedDir, { recursive: true });

    this.logger.info(`📦 Saving index in chunks to: ${chunkedDir}`);

    try {
      // Save metadata first
      const metadata = {
        version: '1.0',
        timestamp: Date.now(),
        totalDocuments: this.documentCache.size,
        totalTerms: this.invertedIndex.size,
        totalStems: this.stemDictionary.size, // STAGE 1: Add stem count
        chunkInfo: {
          documentChunks: 0,
          invertedIndexChunks: 0,
          stemChunks: 0, // Initialize stemChunks
        },
      };

      // ✅ Chunk 1: Save document cache in smaller pieces
      const docChunks = this.chunkMapEntries(
        Array.from(this.documentCache.entries()),
        100,
      );
      this.logger.info(
        `📑 Saving document cache in ${docChunks.length} chunks`,
      );

      for (let i = 0; i < docChunks.length; i++) {
        const chunk = Object.fromEntries(
          docChunks[i].map(([k, v]) => [
            k,
            {
              ...v,
              termFrequency: Object.fromEntries(v.termFrequency),
            },
          ]),
        );

        const chunkPath = path.join(chunkedDir, `documents_${i}.json.gz`);
        const chunkJson = JSON.stringify({ documents: chunk });
        const compressed = zlib.gzipSync(chunkJson);
        await fs.promises.writeFile(chunkPath, compressed);

        if (i % 10 === 0 || i === docChunks.length - 1) {
          this.logger.info(
            `  📄 Document chunk ${i + 1}/${docChunks.length} saved`,
          );
        }
      }
      metadata.chunkInfo.documentChunks = docChunks.length;

      // ✅ Chunk 2: Save inverted index in smaller pieces
      const invertedChunks = this.chunkMapEntries(
        Array.from(this.invertedIndex.entries()),
        1000,
      );
      this.logger.info(
        `🔗 Saving inverted index in ${invertedChunks.length} chunks`,
      );

      for (let i = 0; i < invertedChunks.length; i++) {
        const chunk = Object.fromEntries(invertedChunks[i]);
        const chunkPath = path.join(chunkedDir, `inverted_${i}.json.gz`);
        const chunkJson = JSON.stringify({ inverted: chunk });
        const compressed = zlib.gzipSync(chunkJson);
        await fs.promises.writeFile(chunkPath, compressed);

        if (i % 5 === 0 || i === invertedChunks.length - 1) {
          this.logger.info(
            `  🔗 Inverted index chunk ${i + 1}/${invertedChunks.length} saved`,
          );
        }
      }
      metadata.chunkInfo.invertedIndexChunks = invertedChunks.length;

      // STAGE 1: Chunk 3: Save stem dictionary
      const stemChunks = this.chunkMapEntries(
        Array.from(this.stemDictionary.entries()),
        5000, // Stems are smaller, can use larger chunk size
      );
      this.logger.info(
        `📚 Saving stem dictionary in ${stemChunks.length} chunks`,
      );

      for (let i = 0; i < stemChunks.length; i++) {
        const chunk = Object.fromEntries(
          stemChunks[i].map(([k, v]) => [k, Array.from(v)]),
        );
        const chunkPath = path.join(chunkedDir, `stems_${i}.json.gz`);
        const chunkJson = JSON.stringify({ stems: chunk });
        const compressed = zlib.gzipSync(chunkJson);
        await fs.promises.writeFile(chunkPath, compressed);

        if (i % 5 === 0 || i === stemChunks.length - 1) {
          this.logger.info(
            `  📚 Stem dictionary chunk ${i + 1}/${stemChunks.length} saved`,
          );
        }
      }
      metadata.chunkInfo.stemChunks = stemChunks.length;

      // Save metadata
      const metadataPath = path.join(chunkedDir, 'metadata.json');
      await fs.promises.writeFile(
        metadataPath,
        JSON.stringify(metadata, null, 2),
      );

      // Create a marker file to indicate chunked format
      const markerContent = JSON.stringify({
        format: 'chunked',
        version: '1.0',
        chunkedDir: path.relative(path.dirname(globalIndexPath), chunkedDir),
        createdAt: new Date().toISOString(),
      });
      await fs.promises.writeFile(globalIndexPath, markerContent);

      this.logger.info(
        `✅ Chunked index saved successfully with ${
          metadata.chunkInfo.documentChunks +
          metadata.chunkInfo.invertedIndexChunks +
          (metadata.chunkInfo.stemChunks || 0)
        } total chunks`,
      );
    } catch (error) {
      // Clean up on failure
      try {
        await fs.promises.rm(chunkedDir, { recursive: true, force: true });
        await fs.promises.rm(globalIndexPath, { force: true });
      } catch (cleanupError) {
        this.logger.warn(
          'Failed to clean up after chunked save failure:',
          cleanupError,
        );
      }
      throw error;
    }
  }

  /**
   * ✅ NEW: Helper to chunk array entries
   */
  private chunkMapEntries<T>(entries: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < entries.length; i += chunkSize) {
      chunks.push(entries.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * BUG FIX: This is a duplicated, older version of the method.
   * The correct one is above. This block should be removed.
   */
  /*
  private async loadGlobalInvertedIndex(): Promise<boolean> {
    try {
      const globalIndexPath =
        this.config.globalIndexPath ||
        path.join(
          this.config.rootDirectory,
          '.cache',
          'global-inverted-index.json.gz',
        );

      if (!fs.existsSync(globalIndexPath)) return false;

      // Check if it's a chunked format
      const content = await fs.promises.readFile(globalIndexPath, 'utf8');

      try {
        const marker = JSON.parse(content);
        if (marker.format === 'chunked') {
          this.logger.info('📦 Loading chunked index format...');
          return await this.loadGlobalInvertedIndexChunked(
            globalIndexPath,
            marker,
          );
        }
      } catch (parseError) {
        // Not JSON, probably compressed standard format - continue with standard loading
      }

      this.logger.info('📋 Loading standard index format...');
      const result = await this.loadGlobalInvertedIndexStandard(globalIndexPath);
      this.logger.info(
        `Global index loading completed in ${Date.now() - startTime}ms`,
      );
      return result;
    } catch (error) {
      this.logger.warn(
        'Failed to load global inverted index:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }
  */

  /**
   * ✅ NEW: Load standard format index
   */
  private async loadGlobalInvertedIndexStandard(
    globalIndexPath: string,
  ): Promise<boolean> {
    const gzipped = await fs.promises.readFile(globalIndexPath);
    const data = zlib.gunzipSync(gzipped).toString('utf8');
    const obj = JSON.parse(data);

    // Validate the loaded data
    if (!obj.invertedIndex || !obj.documentCache) {
      this.logger.warn('Invalid global index format, rebuilding...');
      return false;
    }

    // Restore invertedIndex
    this.invertedIndex.clear();
    for (const term of Object.keys(obj.invertedIndex)) {
      this.invertedIndex.set(term, obj.invertedIndex[term]);
    }

    // Restore documentCache
    this.documentCache.clear();
    for (const filePath of Object.keys(obj.documentCache)) {
      const doc = obj.documentCache[filePath];
      doc.termFrequency = new Map(Object.entries(doc.termFrequency));

      // Migration: Ensure new fields exist
      if (!doc.metadata.originalFilePath && (doc.metadata as any).filePath) {
        doc.metadata.originalFilePath = (doc.metadata as any).filePath;
        delete (doc.metadata as any).filePath;
      }
      if (!doc.metadata.textFilePath) {
        doc.metadata.textFilePath = this.getTextCachePath(
          doc.metadata.originalFilePath,
        );
      }

      this.documentCache.set(filePath, doc);
    }

    // STAGE 1: Restore stemDictionary
    this.stemDictionary.clear();
    if (obj.stemDictionary) {
      for (const stem of Object.keys(obj.stemDictionary)) {
        this.stemDictionary.set(stem, new Set(obj.stemDictionary[stem]));
      }
    }

    this.logger.info(
      `✅ Standard index loaded: ${this.documentCache.size} docs, ${this.invertedIndex.size} terms, ${this.stemDictionary.size} stems`,
    );
    return true;
  }

  /**
   * ✅ NEW: Load chunked format index
   */
  private async loadGlobalInvertedIndexChunked(
    globalIndexPath: string,
    marker: any,
  ): Promise<boolean> {
    const chunkedDir = path.resolve(
      path.dirname(globalIndexPath),
      marker.chunkedDir,
    );

    if (!fs.existsSync(chunkedDir)) {
      this.logger.warn('Chunked directory not found, rebuilding index...');
      return false;
    }

    // Load metadata
    const metadataPath = path.join(chunkedDir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      this.logger.warn('Chunked metadata not found, rebuilding index...');
      return false;
    }

    const metadata = JSON.parse(
      await fs.promises.readFile(metadataPath, 'utf8'),
    );
    this.logger.info(
      `📦 Loading chunked index: ${metadata.totalDocuments} docs, ${metadata.totalTerms} terms`,
    );

    try {
      // Clear existing data
      this.documentCache.clear();
      this.invertedIndex.clear();
      this.stemDictionary.clear(); // STAGE 1

      // Load document chunks
      this.logger.debug(
        `📑 Loading ${metadata.chunkInfo.documentChunks} document chunks...`,
      );
      for (let i = 0; i < metadata.chunkInfo.documentChunks; i++) {
        const chunkPath = path.join(chunkedDir, `documents_${i}.json.gz`);
        const compressed = await fs.promises.readFile(chunkPath);
        const chunkJson = zlib.gunzipSync(compressed).toString('utf8');
        const chunk = JSON.parse(chunkJson);

        // Restore document cache entries
        Object.entries(chunk.documents).forEach(
          ([filePath, doc]: [string, any]) => {
            doc.termFrequency = new Map(Object.entries(doc.termFrequency));

            // Migration: Ensure new fields exist
            if (
              !doc.metadata.originalFilePath &&
              (doc.metadata as any).filePath
            ) {
              doc.metadata.originalFilePath = (doc.metadata as any).filePath;
              delete (doc.metadata as any).filePath;
            }
            if (!doc.metadata.textFilePath) {
              doc.metadata.textFilePath = this.getTextCachePath(
                doc.metadata.originalFilePath,
              );
            }

            this.documentCache.set(filePath, doc);
          },
        );

        if (i % 10 === 0 || i === metadata.chunkInfo.documentChunks - 1) {
          this.logger.debug(
            `  📄 Loaded document chunk ${i + 1}/${metadata.chunkInfo.documentChunks}`,
          );
        }
      }

      // Load inverted index chunks
      this.logger.debug(
        `🔗 Loading ${metadata.chunkInfo.invertedIndexChunks} inverted index chunks...`,
      );
      for (let i = 0; i < metadata.chunkInfo.invertedIndexChunks; i++) {
        const chunkPath = path.join(chunkedDir, `inverted_${i}.json.gz`);
        const compressed = await fs.promises.readFile(chunkPath);
        const chunkJson = zlib.gunzipSync(compressed).toString('utf8');
        const chunk = JSON.parse(chunkJson);

        // Restore inverted index entries
        Object.entries(chunk.inverted).forEach(
          ([term, entries]: [string, any]) => {
            this.invertedIndex.set(term, entries);
          },
        );

        if (i % 5 === 0 || i === metadata.chunkInfo.invertedIndexChunks - 1) {
          this.logger.debug(
            `  🔗 Loaded inverted index chunk ${i + 1}/${metadata.chunkInfo.invertedIndexChunks}`,
          );
        }
      }

      // STAGE 1: Load stem dictionary chunks
      if (metadata.chunkInfo.stemChunks > 0) {
        this.logger.debug(
          `📚 Loading ${metadata.chunkInfo.stemChunks} stem dictionary chunks...`,
        );
        for (let i = 0; i < metadata.chunkInfo.stemChunks; i++) {
          const chunkPath = path.join(chunkedDir, `stems_${i}.json.gz`);
          const compressed = await fs.promises.readFile(chunkPath);
          const chunkJson = zlib.gunzipSync(compressed).toString('utf8');
          const chunk = JSON.parse(chunkJson);

          // Restore stem dictionary entries
          Object.entries(chunk.stems).forEach(
            ([stem, words]: [string, any]) => {
              this.stemDictionary.set(stem, new Set(words));
            },
          );

          if (i % 5 === 0 || i === metadata.chunkInfo.stemChunks - 1) {
            this.logger.debug(
              `  📚 Loaded stem dictionary chunk ${i + 1}/${metadata.chunkInfo.stemChunks}`,
            );
          }
        }
      }

      this.logger.info(
        `✅ Chunked index loaded successfully: ${this.documentCache.size} docs, ${this.invertedIndex.size} terms, ${this.stemDictionary.size} stems`,
      );
      return true;
    } catch (error) {
      this.logger.error('Failed to load chunked index:', error);
      // Clear partially loaded data
      this.documentCache.clear();
      this.invertedIndex.clear();
      this.stemDictionary.clear(); // STAGE 1
      return false;
    }
  }

  /**
   * Enhanced intelligent selection based on system characteristics
   */
  private async selectIndexingMethod(
    files: DocumentMetadata[],
  ): Promise<'sequential' | 'parallel'> {
    // Get system info
    const totalMemory = os.totalmem() / 1024 / 1024 / 1024; // GB
    const cpuCount = os.cpus().length;

    // Estimate corpus size
    const avgFileSize =
      files.length > 0
        ? files.reduce((sum, f) => sum + f.size, 0) / files.length
        : 0;
    const estimatedCorpusSize = (files.length * avgFileSize) / 1024 / 1024; // MB

    this.logger.debug(
      `🖥️  System: ${totalMemory.toFixed(1)}GB RAM, ${cpuCount} CPUs`,
    );
    this.logger.debug(
      `📊 Corpus: ${files.length} files, ~${estimatedCorpusSize.toFixed(0)}MB`,
    );

    // Decision matrix
    const useParallel =
      totalMemory >= 8 && // At least 8GB RAM
      cpuCount >= 4 && // At least quad-core
      files.length >= 100 && // Meaningful corpus size
      estimatedCorpusSize <= 2000 && // Not too large (< 2GB)
      this.config.concurrency >= 3; // User allows parallelism

    const method = useParallel ? 'parallel' : 'sequential';

    if (useParallel) {
      this.logger.debug(
        `🚀 Auto-selected parallel indexing (good hardware + medium corpus)`,
      );
    } else {
      this.logger.debug(
        `🐢 Auto-selected sequential indexing (conservative choice)`,
      );

      // Explain why parallel wasn't chosen
      if (totalMemory < 8)
        this.logger.debug(`   • Low memory: ${totalMemory.toFixed(1)}GB < 8GB`);
      if (cpuCount < 4) this.logger.debug(`   • Few CPUs: ${cpuCount} < 4`);
      if (files.length < 100)
        this.logger.debug(`   • Small corpus: ${files.length} < 100 files`);
      if (estimatedCorpusSize > 2000)
        this.logger.debug(
          `   • Large corpus: ${estimatedCorpusSize.toFixed(0)}MB > 2GB`,
        );
    }

    return method;
  }

  async buildFullIndex(): Promise<void> {
    // REFACTOR: Consolidate file discovery and pre-checks.
    const allDiscoveredFiles = await this.discoverFiles();
    if (allDiscoveredFiles.length === 0) {
      this.logger.info('No files found to index.');
      return;
    }

    // Choose indexing method based on system analysis
    const indexingMethod = await this.selectIndexingMethod(allDiscoveredFiles);
    this.logger.debug(`📂 Using indexing method: ${indexingMethod}`);

    // Make threshold configurable
    const buildFullIndexConfig = {
      rebuildThreshold: this.config.indexRebuildThreshold ?? 0.001, // Default 0.1%
      minFiles: this.config.minFilesForRebuild ?? 1, // Default to 1 file
    };

    // Load existing index and determine which files *actually* need processing
    this.logger.info(
      `📁 Found ${allDiscoveredFiles.length} documents to process...`,
    );
    const loaded = await this.loadGlobalInvertedIndex();
    let filesToIndex = allDiscoveredFiles;

    if (loaded) {
      this.logger.debug('📋 Loaded existing global index from cache.');
      this.logger.debug('🔍 Checking which files actually need reindexing...');

      const filesToReindex = allDiscoveredFiles.filter((file) =>
        this.needsReindexing(file),
      );

      if (filesToReindex.length === 0) {
        this.logger.info('✅ All files are up to date. No reindexing needed.');
        return;
      }

      this.logger.info(
        `📝 Found ${filesToReindex.length} files to reindex out of ${allDiscoveredFiles.length} total.`,
      );
      filesToIndex = filesToReindex;
    }

    // Use the selected indexing method on the filtered list of files
    if (indexingMethod === 'parallel') {
      await this.buildFullIndexParallel(filesToIndex, buildFullIndexConfig);
    } else {
      await this.buildFullIndexSequential(filesToIndex, buildFullIndexConfig);
    }
  }

  async buildFullIndexSequential(
    files: DocumentMetadata[], // REFACTOR: Receive files to index
    {
      rebuildThreshold,
      minFiles,
    }: { rebuildThreshold?: number; minFiles?: number } = {},
  ): Promise<void> {
    const startTime = Date.now();
    try {
      if (files.length === 0) {
        this.logger.info(
          'No new or modified files to index in sequential mode.',
        );
        return;
      }

      this.logger.info(`🔄 Indexing ${files.length} documents sequentially...`);
      let indexed = 0;
      let skipped = 0;
      let errors = 0;
      let actuallyProcessed = 0; // NEW: Track files that were actually processed vs loaded from cache

      // Process in smaller batches to prevent memory issues
      const BATCH_SIZE = 25; // Optimized batch size
      const batches = [];
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        batches.push(files.slice(i, i + BATCH_SIZE));
      }

      this.logger.info(
        `📦 Processing ${batches.length} batches of ${BATCH_SIZE} files each...`,
      );

      // Track documents that need inverted index updates
      const documentsToUpdate: string[] = [];

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        this.logger.info(
          `📦 Processing batch ${batchIndex + 1}/${batches.length}...`,
        );

        // Process batch with individual error handling
        const batchPromises = batch.map(async (file) => {
          try {
            // FIXED: Double-check if reindexing is still needed (might have been loaded in needsReindexing)
            const wasInCache = this.documentCache.has(file.originalFilePath);

            if (this.needsReindexing(file)) {
              const result = await this.indexDocument(file);

              // Check if it was actually processed or just loaded from cache
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

        // Wait for batch to complete
        const batchResults = await Promise.all(batchPromises);

        // Update counters and track indexed documents
        batchResults.forEach((result) => {
          if (result.success) {
            if (result.type === 'newly-indexed') {
              indexed++;
              actuallyProcessed++;
              documentsToUpdate.push(result.filePath);
            } else if (result.type === 'cached-loaded') {
              indexed++; // Count as indexed for reporting
              documentsToUpdate.push(result.filePath);
              // But don't count as actuallyProcessed
            } else if (result.type === 'skipped') {
              skipped++;
              documentsToUpdate.push(result.filePath);
            }
          } else {
            errors++;
          }
        });

        // Progress update
        const totalProcessed = (batchIndex + 1) * BATCH_SIZE;
        const actualProcessed = Math.min(totalProcessed, files.length);
        this.logger.info(
          `📊 Progress: ${actualProcessed}/${files.length} files processed (${indexed} indexed, ${skipped} skipped, ${errors} errors)`,
        );

        // Force garbage collection between batches if available
        if (global.gc && batchIndex % 3 === 0) {
          global.gc();
        }

        // Small delay to prevent overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // FIXED: Use actuallyProcessed for threshold calculation, not just indexed
      const significantChanges =
        actuallyProcessed > Math.max(minFiles, files.length * rebuildThreshold);

      if (documentsToUpdate.length > 0 && significantChanges) {
        this.logger.info(
          `🔗 Updating inverted index for ${documentsToUpdate.length} documents (${actuallyProcessed} newly processed)...`,
        );
        this.logger.info(
          `📊 Threshold: ${(rebuildThreshold * 100).toFixed(1)}% (${Math.max(minFiles, Math.round(files.length * rebuildThreshold))} files)`,
        );
        await this.updateInvertedIndexBatch(documentsToUpdate);
      } else if (documentsToUpdate.length > 0) {
        this.logger.info(
          `🚀 Skipping inverted index rebuild - only ${actuallyProcessed} newly processed documents (< ${(rebuildThreshold * 100).toFixed(1)}% threshold)`,
        );
        this.logger.info(`💡 Search will use existing cached inverted index`);
      }

      this.logger.info(
        `✅ Indexing complete: ${indexed} total (${actuallyProcessed} newly processed, ${indexed - actuallyProcessed} from cache), ${skipped} skipped, ${errors} errors`,
      );

      // FIXED: Only save if we actually processed new content OR if the document cache was updated
      if (actuallyProcessed > 0 || documentsToUpdate.length > 0) {
        this.logger.info('💾 Saving global index...');
        await this.saveGlobalInvertedIndex();
        this.logger.info('✅ Index saved successfully.');
      } else {
        this.logger.info('💡 No changes made, skipping save.');
      }
    } catch (error) {
      this.logger.error(
        'Index building failed:',
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `Failed to build index: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
    this.logger.info(
      `Sequential index build completed in ${Date.now() - startTime}ms`,
    );
  }

  /**
   * NEW: True parallel processing for independent documents
   */
  async buildFullIndexParallel(
    files: DocumentMetadata[], // REFACTOR: Receive files to index
    {
      rebuildThreshold,
      minFiles,
    }: { rebuildThreshold?: number; minFiles?: number } = {},
  ): Promise<void> {
    const startTime = Date.now();
    try {
      if (files.length === 0) {
        this.logger.info('No new or modified files to index in parallel mode.');
        return;
      }

      this.logger.info(
        `🚀 Processing ${files.length} documents with parallel workers...`,
      );

      // Use actual parallel processing with worker pool
      const PARALLEL_WORKERS = Math.min(
        this.config.concurrency || 4,
        files.length,
      );
      const chunks = this.chunkArray(
        files,
        Math.ceil(files.length / PARALLEL_WORKERS),
      );

      this.logger.info(
        `👥 Starting ${PARALLEL_WORKERS} parallel workers for ${chunks.length} chunks`,
      );

      let totalIndexed = 0;
      let totalErrors = 0;

      const workerPromises = chunks.map(async (chunk, workerIndex) => {
        let workerIndexed = 0;
        let workerErrors = 0;

        for (const file of chunk) {
          try {
            await this.indexDocument(file);
            workerIndexed++;
            totalIndexed++;

            // Progress update from worker
            if (workerIndexed % 5 === 0) {
              this.logger.info(
                `👷 Worker ${workerIndex + 1}: processed ${workerIndexed}/${chunk.length} files`,
              );
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

      // Wait for all workers to complete
      const results = await Promise.all(workerPromises);

      // Log worker results
      results.forEach(({ workerIndex, workerIndexed, workerErrors }) => {
        this.logger.info(
          `👷 Worker ${workerIndex + 1} completed: ${workerIndexed} indexed, ${workerErrors} errors`,
        );
      });

      this.logger.info(
        `✅ Parallel indexing complete: ${totalIndexed} indexed, ${totalErrors} errors`,
      );

      // Rebuild inverted index if significant changes
      if (totalIndexed > Math.max(minFiles, files.length * rebuildThreshold)) {
        this.logger.info(
          `📊 Threshold met: ${totalIndexed} files > ${(rebuildThreshold * 100).toFixed(1)}% threshold`,
        );
        await this.updateInvertedIndexBatch(
          files.map((f) => f.originalFilePath),
        );
      } else {
        this.logger.info(
          `🚀 Skipping rebuild - ${totalIndexed} files < ${(rebuildThreshold * 100).toFixed(1)}% threshold`,
        );
      }

      // Save and validate
      await this.saveGlobalInvertedIndex();
      const health = await this.validateIndexHealth();

      if (!health.isHealthy) {
        this.logger.warn(`⚠️ Index health issues detected:`, health.issues);
      }
    } catch (error) {
      this.logger.error('Parallel index building failed:', error);
      throw error;
    }
    this.logger.info(
      `Parallel index build completed in ${Date.now() - startTime}ms`,
    );
  }

  /**
   * Helper: Split array into chunks for parallel processing
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * OPTIONAL: Enhanced progress callbacks for UI integration
   */
  async buildFullIndexWithCallbacks(
    progressCallback?: (progress: {
      phase:
        | 'discovery'
        | 'indexing'
        | 'inverted-index'
        | 'saving'
        | 'validation';
      current: number;
      total: number;
      message: string;
      percentage: number;
    }) => void,
  ): Promise<void> {
    const progress = (
      phase: any,
      current: number,
      total: number,
      message: string,
    ) => {
      const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
      progressCallback?.({ phase, current, total, message, percentage });
    };

    try {
      // Phase 1: Discovery
      progress('discovery', 0, 1, 'Discovering files...');
      const files = await this.discoverFiles();
      progress('discovery', 1, 1, `Found ${files.length} files`);

      if (files.length === 0) return;

      // Phase 2: Indexing
      let indexed = 0;
      for (const file of files) {
        if (this.needsReindexing(file)) {
          await this.indexDocument(file);
          indexed++;
          progress(
            'indexing',
            indexed,
            files.length,
            `Indexing ${file.fileName}`,
          );
        }
      }

      // Phase 3: Inverted Index
      if (indexed > 0) {
        progress('inverted-index', 0, 1, 'Building inverted index...');
        await this.updateInvertedIndexBatch(files.map((f) => f.filePath));
        progress('inverted-index', 1, 1, 'Inverted index complete');
      }

      // Phase 4: Saving
      progress('saving', 0, 1, 'Saving index to disk...');
      await this.saveGlobalInvertedIndex();
      progress('saving', 1, 1, 'Index saved');

      // Phase 5: Validation
      progress('validation', 0, 1, 'Validating index health...');
      const health = await this.validateIndexHealth();
      progress(
        'validation',
        1,
        1,
        health.isHealthy ? 'Index healthy' : 'Health issues detected',
      );
    } catch (error) {
      progressCallback?.({
        phase: 'indexing',
        current: 0,
        total: 1,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        percentage: 0,
      });
      throw error;
    }
  }

  /**
   * NEW: Index health check to detect corruption
   */
  async validateIndexHealth(): Promise<{
    isHealthy: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];

    try {
      // Check document cache consistency
      const docCacheSize = this.documentCache.size;
      const invertedIndexDocs = new Set<string>();

      this.invertedIndex.forEach((entries) => {
        entries.forEach((entry) => {
          invertedIndexDocs.add(entry.documentId);
        });
      });

      if (docCacheSize !== invertedIndexDocs.size) {
        issues.push(
          `Document cache size (${docCacheSize}) doesn't match inverted index documents (${invertedIndexDocs.size})`,
        );
      }

      // Check for orphaned documents in inverted index
      const orphanedDocs = Array.from(invertedIndexDocs).filter(
        (docId) => !this.documentCache.has(docId),
      );

      if (orphanedDocs.length > 0) {
        issues.push(
          `Found ${orphanedDocs.length} orphaned documents in inverted index`,
        );
      }

      // Check for empty terms in inverted index
      const emptyTerms = Array.from(this.invertedIndex.keys()).filter(
        (term) => !this.invertedIndex.get(term)?.length,
      );

      if (emptyTerms.length > 0) {
        issues.push(`Found ${emptyTerms.length} empty terms in inverted index`);
      }

      // Check memory usage
      const memStats = this.getMemoryStats();
      if (memStats.heap.used > 1000) {
        // > 1GB
        issues.push(`High memory usage: ${memStats.heap.used}MB heap`);
      }

      this.logger.info(
        `🔍 Index health check: ${issues.length === 0 ? '✅ Healthy' : `⚠️ ${issues.length} issues found`}`,
      );

      return {
        isHealthy: issues.length === 0,
        issues,
      };
    } catch (error) {
      issues.push(
        `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { isHealthy: false, issues };
    }
  }

  /**
   * Pre-warm search caches for better performance
   */
  async preWarmSearchCaches(): Promise<void> {
    this.logger.debug('🔥 Pre-warming search caches...');
    const startTime = Date.now();

    try {
      // Pre-calculate frequently used data structures
      const termFrequencies = new Map<string, number>();
      const documentLengths = new Map<string, number>();

      this.documentCache.forEach((doc, docId) => {
        documentLengths.set(docId, doc.wordCount);

        doc.termFrequency.forEach((freq, term) => {
          termFrequencies.set(term, (termFrequencies.get(term) || 0) + 1);
        });
      });

      // Store search-optimized data
      (this as any).searchCache = {
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

      const duration = Date.now() - startTime;
      this.logger.debug(`🔥 Search caches pre-warmed in ${duration}ms`);
    } catch (error) {
      this.logger.warn('⚠️ Failed to pre-warm search caches:', error);
      // Don't throw - this is an optimization, not critical
    }
  }

  /**
   * Get memory usage statistics
   */
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
        textLRU: this.textLRU.size || 0,
        documentLRU: this.documentLRU.size || 0,
      },
    };
  }

  /**
   * Get a copy of the inverted index
   */
  getInvertedIndex(): Map<string, InvertedIndexEntry[]> {
    return new Map(this.invertedIndex);
  }

  /**
   * STAGE 1: Add getter for the stem dictionary.
   */
  getStemDictionary(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    this.stemDictionary.forEach((value, key) => {
      result.set(key, Array.from(value));
    });
    return result;
  }

  /**
   * Get a copy of the document cache with LRU enhancement
   */
  getDocumentCache(): Map<string, DocumentIndex> {
    // Enhanced to use LRU for frequently accessed documents
    const result = new Map(this.documentCache);

    // Add LRU cached items if they exist
    try {
      // Access the private cache property safely
      const lruCache = (this.documentLRU as any).cache;
      if (lruCache && typeof lruCache.entries === 'function') {
        for (const [key, value] of lruCache.entries()) {
          if (!result.has(key)) {
            result.set(key, value);
          }
        }
      }
    } catch (error) {
      // LRU cache access failed, just return the main cache
      this.logger.debug('Could not access LRU cache:', error);
    }

    return result;
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
   * Clear memory caches to free up RAM
   */
  clearMemoryCaches(): void {
    this.textLRU = new LRUCache<string, string>(25);
    this.documentLRU = new LRUCache<string, DocumentIndex>(50);

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Get optimized search data with caching
   */
  getSearchDataOptimized(): {
    docCache: Map<string, DocumentIndex>;
    invertedIndex: Map<string, InvertedIndexEntry[]>;
    stemDictionary: Map<string, string[]>; // STAGE 1
    searchCache?: any;
  } {
    return {
      docCache: this.getDocumentCache(),
      invertedIndex: this.getInvertedIndex(),
      stemDictionary: this.getStemDictionary(), // STAGE 1
      searchCache: (this as any).searchCache,
    };
  }
}

export { FileIndexer };
