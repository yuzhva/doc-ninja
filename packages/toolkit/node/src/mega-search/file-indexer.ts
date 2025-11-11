import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as zlib from 'zlib';

import { DocumentExtractor } from './document-parsers';
import { LRUCache } from './lru-cache';
import { scanDirectory } from './shared/file-utils';
import { createLogger } from './shared/logger';
import { UkrainianTextProcessor } from './text-processor';
import {
  DocumentIndex,
  DocumentMetadata,
  InvertedIndexEntry,
  SearchConfig,
} from './types';

class FileIndexer {
  private logger = createLogger('FileIndexer');
  private textProcessor = new UkrainianTextProcessor();
  private documentExtractor = new DocumentExtractor();
  private documentCache = new Map<string, DocumentIndex>();
  private invertedIndex = new Map<string, InvertedIndexEntry[]>();

  // Optimized LRU cache sizes for better memory management
  private documentLRU = new LRUCache<string, DocumentIndex>(50); // Reduced from 100
  private textLRU = new LRUCache<string, string>(25); // Reduced from 50

  constructor(private config: SearchConfig) {}

  private getCacheRelativePath(filePath: string): string {
    // Get relative path from rootDirectory, remove leading slash
    const rel = path.relative(this.config.rootDirectory, filePath);
    return rel.replace(/^[/\\]/, '');
  }

  private getTextCachePath(filePath: string): string {
    const rel = this.getCacheRelativePath(filePath);
    const txtCacheRoot = this.config.txtCacheSubdir || '.cache/txt';
    return path.join(
      this.config.rootDirectory,
      txtCacheRoot,
      rel.replace(/\.[^.]+$/, '.txt'),
    );
  }

  private getIndexCachePath(filePath: string): string {
    const rel = this.getCacheRelativePath(filePath);
    const indexCacheRoot = this.config.indexCacheSubdir || '.cache/index';
    return path.join(
      this.config.rootDirectory,
      indexCacheRoot,
      rel.replace(/\.[^.]+$/, '.index.json'),
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
        const text = await this.documentExtractor.extractText(filePath);

        // Save to cache file
        await promisify(fs.writeFile)(txtPath, text, 'utf8');

        // Store in LRU cache before returning
        this.textLRU.set(filePath, text);
        return text;
      } catch (diskError) {
        console.warn(
          `Cache operation failed for ${path.basename(filePath)}, extracting directly:`,
          diskError instanceof Error ? diskError.message : String(diskError),
        );

        // Fallback to direct extraction
        const text = await this.documentExtractor.extractText(filePath);
        this.textLRU.set(filePath, text);
        return text;
      }
    } catch (error) {
      console.error(
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
      console.log(`⏭️ Skipping temp file: ${fileName}`);
      return true;
    }

    // Skip system files
    if (fileName.startsWith('.') || fileName.startsWith('~')) {
      console.log(`⏭️ Skipping system file: ${fileName}`);
      return true;
    }

    // Skip very large files that might cause memory issues
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > (this.config.maxFileSize || 50 * 1024 * 1024)) {
        console.log(
          `⏭️ Skipping large file: ${fileName} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`,
        );
        return true;
      }
    } catch (error) {
      console.log(`⏭️ Skipping inaccessible file: ${fileName}`);
      return true;
    }

    // Skip empty files
    try {
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        console.log(`⏭️ Skipping empty file: ${fileName}`);
        return true;
      }
    } catch (error) {
      return true;
    }

    return false;
  }

  async discoverFiles(): Promise<DocumentMetadata[]> {
    try {
      this.logger.info('Starting file discovery', {
        rootDirectory: this.config.rootDirectory,
      });

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
          filePath: file.filePath,
          fileName: file.fileName,
          lastModified: file.lastModified,
          size: file.size,
          indexed: false,
          language: 'mixed' as const,
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
    const cached = this.documentCache.get(metadata.filePath);
    if (cached) {
      if (!cached.metadata.indexed) return true;
      if (cached.metadata.lastModified !== metadata.lastModified) return true;
      return false; // Already indexed and up to date
    }

    // Check if index cache file exists and is up to date
    const indexPath = this.getIndexCachePath(metadata.filePath);
    if (fs.existsSync(indexPath)) {
      try {
        const indexStat = fs.statSync(indexPath);
        const sourceStat = fs.statSync(metadata.filePath);

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

            // Store in document cache to prevent future cache misses
            this.documentCache.set(metadata.filePath, cached);

            console.log(
              `📋 Pre-loaded cached index for ${metadata.fileName} - no reindexing needed`,
            );
            return false; // No need to reindex
          } catch (loadError) {
            console.warn(
              `📋 Cache file corrupted for ${metadata.fileName}, will rebuild`,
            );
            return true; // Cache corrupted, need to reindex
          }
        }
      } catch (error) {
        // If we can't check stats, safer to reindex
        console.log(
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
      console.error(
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
        tokens: [],
        termFrequency: new Map(),
        wordCount: 0,
        originalText: '',
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

    const indexPath = this.getIndexCachePath(metadata.filePath);
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });

    try {
      const srcStat = await promisify(fs.stat)(metadata.filePath);

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

            // Store in cache but don't update inverted index yet (do it later in batch)
            this.documentCache.set(metadata.filePath, cached);
            console.log(`📋 Loaded cached index for ${metadata.fileName}`);
            return cached;
          }
        } catch (cacheError) {
          console.warn(
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
        text = await this.extractTextFromFile(metadata.filePath);
      } catch (extractError) {
        console.warn(
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
          tokens: [],
          termFrequency: new Map(),
          wordCount: 0,
          originalText: '',
        };
      }

      if (!text || text.trim().length === 0) {
        console.warn(
          `No text content in ${metadata.fileName}, creating empty index`,
        );
        return {
          metadata: {
            ...metadata,
            indexed: false,
            indexedAt: Date.now(),
            language: 'unknown' as const,
          },
          tokens: [],
          termFrequency: new Map(),
          wordCount: 0,
          originalText: '',
        };
      }

      const tokens = this.textProcessor.tokenize(text);
      if (tokens.length === 0) {
        console.warn(`No valid tokens found in ${metadata.fileName}`);
      }

      const termFrequency = new Map<string, number>();
      tokens.forEach((token) => {
        const term = this.config.ukrainianStemming
          ? this.textProcessor.stemWord(token.normalized)
          : token.normalized;
        termFrequency.set(term, (termFrequency.get(term) || 0) + 1);
      });

      const language = this.textProcessor.detectLanguage(text);
      const documentIndex: DocumentIndex = {
        metadata: {
          ...metadata,
          indexed: true,
          indexedAt: Date.now(),
          language,
        },
        tokens,
        termFrequency,
        wordCount: tokens.length,
        // Don't store original text for large documents to save memory
        originalText: text.length > 100000 ? '' : text,
      };

      this.documentCache.set(metadata.filePath, documentIndex);

      // Save index to disk (convert Map to object)
      try {
        const toSave = {
          ...documentIndex,
          termFrequency: Object.fromEntries(termFrequency),
          // Don't save original text to disk to save space
          originalText: '',
        };
        await promisify(fs.writeFile)(
          indexPath,
          JSON.stringify(toSave),
          'utf8',
        );
        console.log(`💾 Cached index for ${metadata.fileName}`);
      } catch (saveError) {
        console.warn(
          `Failed to save index cache for ${metadata.fileName}:`,
          saveError instanceof Error ? saveError.message : String(saveError),
        );
        // Continue without caching
      }

      const endTime = Date.now();
      this.logger.debug('Document indexing completed', {
        fileName: metadata.fileName,
        tokens: documentIndex.tokens.length,
        duration: endTime - startTime,
      });

      return documentIndex;
    } catch (error) {
      throw new Error(
        `Failed to index document ${metadata.fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

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

  /**
   * Optimized batch update for inverted index
   * Instead of updating incrementally, rebuild the entire index efficiently
   */
  private async updateInvertedIndexBatch(
    documentPaths: string[],
  ): Promise<void> {
    const startTime = Date.now();

    console.log(
      `🔗 Starting inverted index rebuild for ${documentPaths.length} documents...`,
    );

    try {
      // Clear existing inverted index - we'll rebuild it completely
      console.log(
        `🗑️ Clearing existing inverted index (${this.invertedIndex.size} terms)...`,
      );
      this.invertedIndex.clear();

      // Get all documents that should be in the index (cached + new)
      const allDocuments = Array.from(this.documentCache.values()).filter(
        (doc) => doc.metadata.indexed,
      );

      console.log(
        `🔄 Found ${allDocuments.length} indexed documents to process...`,
      );

      if (allDocuments.length === 0) {
        console.log(`⚠️ No indexed documents found, nothing to process`);
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
          // Process each term in the document
          docIndex.termFrequency.forEach((frequency, term) => {
            // Pre-calculate positions efficiently
            const positions: number[] = [];

            // Use a more efficient position lookup
            for (let i = 0; i < docIndex.tokens.length; i++) {
              const token = docIndex.tokens[i];
              const normalized = this.config.ukrainianStemming
                ? this.textProcessor.stemWord(token.normalized)
                : token.normalized;

              if (normalized === term) {
                positions.push(token.position);
              }
            }

            const entry: InvertedIndexEntry = {
              documentId: docIndex.metadata.filePath,
              frequency,
              positions,
            };

            // Get or create term entry in inverted index
            if (this.invertedIndex.has(term)) {
              this.invertedIndex.get(term)!.push(entry);
            } else {
              this.invertedIndex.set(term, [entry]);
            }

            docTermsProcessed++;
          });

          totalTermsProcessed += docIndex.termFrequency.size;
          processedDocs++;

          const docProcessTime = Date.now() - docStartTime;

          // Log detailed progress for first few docs and every 10th doc
          if (processedDocs <= 5 || processedDocs % 10 === 0) {
            console.log(
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

            console.log(
              `  🔗 Progress: ${processedDocs}/${allDocuments.length} docs (${docsPerSecond.toFixed(1)} docs/sec, ~${Math.round(remaining)}s remaining)`,
            );
            console.log(
              `  💾 Index size: ${this.invertedIndex.size} unique terms, ${totalTermsProcessed} total term entries`,
            );
            console.log(
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
              console.log(`  🗑️ GC freed ${freed.toFixed(1)}MB memory`);
            }
          }
        } catch (docError) {
          console.error(
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

      console.log(`✅ Inverted index rebuild completed successfully!`);
      console.log(`📊 Final stats:`);
      console.log(
        `   - Processed docs: ${processedDocs}/${allDocuments.length}`,
      );
      console.log(`   - Total terms: ${totalTermsProcessed}`);
      console.log(`   - Unique terms: ${this.invertedIndex.size}`);
      console.log(
        `   - Duration: ${duration}ms (${Math.round(duration / 1000)}s)`,
      );
      console.log(
        `   - Performance: ${docsPerSecond.toFixed(1)} docs/sec, ${termsPerSecond} terms/sec`,
      );
      console.log(
        `   - Final memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB heap`,
      );
      console.log(`⏰ Completed at: ${new Date().toISOString()}`);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        `❌ Inverted index rebuild FAILED after ${duration}ms:`,
        error,
      );
      console.error(`💥 Error details:`, {
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
    try {
      const globalIndexPath =
        this.config.globalIndexPath ||
        path.join(
          this.config.rootDirectory,
          '.cache',
          'global-inverted-index.json.gz',
        );

      if (!fs.existsSync(globalIndexPath)) return false;

      const gzipped = await fs.promises.readFile(globalIndexPath);
      const data = zlib.gunzipSync(gzipped).toString('utf8');
      const obj = JSON.parse(data);

      // Validate the loaded data
      if (!obj.invertedIndex || !obj.documentCache) {
        console.warn('Invalid global index format, rebuilding...');
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
        this.documentCache.set(filePath, doc);
      }

      return true;
    } catch (error) {
      console.warn(
        'Failed to load global inverted index:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  private async saveGlobalInvertedIndex(): Promise<void> {
    try {
      const globalIndexPath =
        this.config.globalIndexPath ||
        path.join(
          this.config.rootDirectory,
          '.cache',
          'global-inverted-index.json.gz',
        );
      const tempPath = globalIndexPath + '.tmp';

      // Save both invertedIndex and documentCache
      const obj: Record<string, any> = {
        invertedIndex: Object.fromEntries(this.invertedIndex),
        documentCache: Object.fromEntries(
          Array.from(this.documentCache.entries()).map(([k, v]) => [
            k,
            { ...v, termFrequency: Object.fromEntries(v.termFrequency) },
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
    } catch (error) {
      console.error(
        'Failed to save global inverted index:',
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `Failed to save index: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Enhanced intelligent selection based on system characteristics
   */
  private async selectIndexingMethod(): Promise<'sequential' | 'parallel'> {
    // Get system info
    const totalMemory = os.totalmem() / 1024 / 1024 / 1024; // GB
    const cpuCount = os.cpus().length;

    // Estimate corpus size
    const files = await this.discoverFiles();
    const avgFileSize =
      files.length > 0
        ? files.reduce((sum, f) => sum + f.size, 0) / files.length
        : 0;
    const estimatedCorpusSize = (files.length * avgFileSize) / 1024 / 1024; // MB

    console.log(
      `🖥️  System: ${totalMemory.toFixed(1)}GB RAM, ${cpuCount} CPUs`,
    );
    console.log(
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
      console.log(
        `🚀 Auto-selected parallel indexing (good hardware + medium corpus)`,
      );
    } else {
      console.log(`🐢 Auto-selected sequential indexing (conservative choice)`);

      // Explain why parallel wasn't chosen
      if (totalMemory < 8)
        console.log(`   • Low memory: ${totalMemory.toFixed(1)}GB < 8GB`);
      if (cpuCount < 4) console.log(`   • Few CPUs: ${cpuCount} < 4`);
      if (files.length < 100)
        console.log(`   • Small corpus: ${files.length} < 100 files`);
      if (estimatedCorpusSize > 2000)
        console.log(
          `   • Large corpus: ${estimatedCorpusSize.toFixed(0)}MB > 2GB`,
        );
    }

    return method;
  }

  async buildFullIndex(): Promise<void> {
    // Choose indexing method based on system analysis
    const indexingMethod = await this.selectIndexingMethod();
    console.log(`📂 Using indexing method: ${indexingMethod}`);

    // Make threshold configurable
    const buildFullIndexConfig = {
      rebuildThreshold: this.config.indexRebuildThreshold ?? 0.001, // Default 0.1%
      minFiles: this.config.minFilesForRebuild ?? 5, // Default to 1 file
    };

    // Use the selected indexing method
    if (indexingMethod === 'parallel') {
      await this.buildFullIndexParallel(buildFullIndexConfig);
    } else {
      await this.buildFullIndexSequential(buildFullIndexConfig);
    }
  }

  async buildFullIndexSequential({
    rebuildThreshold,
    minFiles,
  }: { rebuildThreshold?: number; minFiles?: number } = {}): Promise<void> {
    try {
      const files = await this.discoverFiles();
      if (files.length === 0) {
        console.log('No files found to index.');
        return;
      }

      console.log(`📁 Found ${files.length} documents to process...`);

      // Check if we can load existing index
      const loaded = await this.loadGlobalInvertedIndex();
      if (loaded) {
        console.log('📋 Loaded existing global index from cache.');

        // FIXED: Pre-check all files against cache to avoid false positives
        console.log('🔍 Checking which files actually need reindexing...');

        const filesToReindex = [];
        for (const file of files) {
          if (this.needsReindexing(file)) {
            filesToReindex.push(file);
          }
        }

        if (filesToReindex.length === 0) {
          console.log('✅ All files are up to date. No reindexing needed.');
          return;
        }

        console.log(
          `📝 Actually need to reindex ${filesToReindex.length} files out of ${files.length} total.`,
        );

        // Replace the files array with only those that need reindexing
        files.length = 0;
        files.push(...filesToReindex);
      }

      console.log(`🔄 Indexing ${files.length} documents...`);
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

      console.log(
        `📦 Processing ${batches.length} batches of ${BATCH_SIZE} files each...`,
      );

      // Track documents that need inverted index updates
      const documentsToUpdate: string[] = [];

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(
          `📦 Processing batch ${batchIndex + 1}/${batches.length}...`,
        );

        // Process batch with individual error handling
        const batchPromises = batch.map(async (file) => {
          try {
            // FIXED: Double-check if reindexing is still needed (might have been loaded in needsReindexing)
            const wasInCache = this.documentCache.has(file.filePath);

            if (this.needsReindexing(file)) {
              const result = await this.indexDocument(file);

              // Check if it was actually processed or just loaded from cache
              const isNewlyProcessed = !wasInCache && result.metadata.indexed;

              return {
                success: true,
                type: isNewlyProcessed ? 'newly-indexed' : 'cached-loaded',
                filePath: file.filePath,
              };
            } else {
              return {
                success: true,
                type: 'skipped',
                filePath: file.filePath,
              };
            }
          } catch (error) {
            console.error(
              `❌ Failed to index ${file.fileName}:`,
              error instanceof Error ? error.message : String(error),
            );
            return { success: false, type: 'error', filePath: file.filePath };
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
        console.log(
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
        console.log(
          `🔗 Updating inverted index for ${documentsToUpdate.length} documents (${actuallyProcessed} newly processed)...`,
        );
        console.log(
          `📊 Threshold: ${(rebuildThreshold * 100).toFixed(1)}% (${Math.max(minFiles, Math.round(files.length * rebuildThreshold))} files)`,
        );
        await this.updateInvertedIndexBatch(documentsToUpdate);
      } else if (documentsToUpdate.length > 0) {
        console.log(
          `🚀 Skipping inverted index rebuild - only ${actuallyProcessed} newly processed documents (< ${(rebuildThreshold * 100).toFixed(1)}% threshold)`,
        );
        console.log(`💡 Search will use existing cached inverted index`);
      }

      console.log(
        `✅ Indexing complete: ${indexed} total (${actuallyProcessed} newly processed, ${indexed - actuallyProcessed} from cache), ${skipped} skipped, ${errors} errors`,
      );

      // FIXED: Only save if we actually processed new content OR if the document cache was updated
      if (actuallyProcessed > 0 || documentsToUpdate.length > 0) {
        console.log('💾 Saving global index...');
        await this.saveGlobalInvertedIndex();
        console.log('✅ Index saved successfully.');
      } else {
        console.log('💡 No changes made, skipping save.');
      }
    } catch (error) {
      console.error(
        'Index building failed:',
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `Failed to build index: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * NEW: True parallel processing for independent documents
   */
  async buildFullIndexParallel({
    rebuildThreshold,
    minFiles,
  }: { rebuildThreshold?: number; minFiles?: number } = {}): Promise<void> {
    try {
      const files = await this.discoverFiles();
      if (files.length === 0) {
        console.log('No files found to index.');
        return;
      }

      console.log(
        `📁 Found ${files.length} documents to process in parallel...`,
      );

      // Check existing index
      const loaded = await this.loadGlobalInvertedIndex();
      if (loaded) {
        const filesToReindex = files.filter((file) =>
          this.needsReindexing(file),
        );
        if (filesToReindex.length === 0) {
          console.log('✅ All files are up to date. No reindexing needed.');
          return;
        }
        files.length = 0;
        files.push(...filesToReindex);
      }

      console.log(
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

      console.log(
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
              console.log(
                `👷 Worker ${workerIndex + 1}: processed ${workerIndexed}/${chunk.length} files`,
              );
            }
          } catch (error) {
            workerErrors++;
            totalErrors++;
            console.error(
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
        console.log(
          `👷 Worker ${workerIndex + 1} completed: ${workerIndexed} indexed, ${workerErrors} errors`,
        );
      });

      console.log(
        `✅ Parallel indexing complete: ${totalIndexed} indexed, ${totalErrors} errors`,
      );

      // Rebuild inverted index if significant changes
      if (totalIndexed > Math.max(minFiles, files.length * rebuildThreshold)) {
        console.log(
          `📊 Threshold met: ${totalIndexed} files > ${(rebuildThreshold * 100).toFixed(1)}% threshold`,
        );
        await this.updateInvertedIndexBatch(files.map((f) => f.filePath));
      } else {
        console.log(
          `🚀 Skipping rebuild - ${totalIndexed} files < ${(rebuildThreshold * 100).toFixed(1)}% threshold`,
        );
      }

      // Save and validate
      await this.saveGlobalInvertedIndex();
      const health = await this.validateIndexHealth();

      if (!health.isHealthy) {
        console.warn(`⚠️ Index health issues detected:`, health.issues);
      }
    } catch (error) {
      console.error('Parallel index building failed:', error);
      throw error;
    }
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

      console.log(
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
    console.log('🔥 Pre-warming search caches...');
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
      console.log(`🔥 Search caches pre-warmed in ${duration}ms`);
    } catch (error) {
      console.warn('⚠️ Failed to pre-warm search caches:', error);
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
      console.debug('Could not access LRU cache:', error);
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
    searchCache?: any;
  } {
    return {
      docCache: this.getDocumentCache(),
      invertedIndex: this.getInvertedIndex(),
      searchCache: (this as any).searchCache,
    };
  }
}

export { FileIndexer };
