import * as fs from 'fs';
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

  // Add LRU caches
  private documentLRU = new LRUCache<string, DocumentIndex>(100); // Cache 100 most recent docs
  private textLRU = new LRUCache<string, string>(50); // Cache 50 most recent text extractions

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
        const extractor =
          new (require('./document-parsers').DocumentExtractor)();
        const text = await extractor.extractText(filePath);

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
        const extractor =
          new (require('./document-parsers').DocumentExtractor)();
        const text = await extractor.extractText(filePath);
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

      const documentMetadata: DocumentMetadata[] = fileInfos.map((file) => ({
        filePath: file.filePath,
        fileName: file.fileName,
        lastModified: file.lastModified,
        size: file.size,
        indexed: false,
        language: 'mixed' as const,
      }));

      this.logger.info('File discovery completed', {
        filesFound: documentMetadata.length,
        totalSize: documentMetadata.reduce((sum, f) => sum + f.size, 0),
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
    const cached = this.documentCache.get(metadata.filePath);

    if (!cached) return true;
    if (!cached.metadata.indexed) return true;
    if (cached.metadata.lastModified !== metadata.lastModified) return true;

    return false;
  }

  async indexDocument(metadata: DocumentMetadata): Promise<DocumentIndex> {
    const startTime = Date.now();

    try {
      this.logger.debug('Starting document indexing', {
        fileName: metadata.fileName,
      });

      const indexPath = this.getIndexCachePath(metadata.filePath);
      // Ensure directory exists
      await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });

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
            this.documentCache.set(metadata.filePath, cached);
            this.updateInvertedIndex(metadata.filePath, cached);
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

      const text = await this.extractTextFromFile(metadata.filePath);
      if (!text || text.trim().length === 0) {
        throw new Error('No text content extracted from file');
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
        originalText: text, // Store original text for highlighting
      };

      this.documentCache.set(metadata.filePath, documentIndex);
      this.updateInvertedIndex(metadata.filePath, documentIndex);

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
      this.logger.error('Document indexing failed', {
        fileName: metadata.fileName,
        error,
      });
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

  async buildFullIndex(): Promise<void> {
    try {
      const files = await this.discoverFiles();
      if (files.length === 0) {
        console.log('No files found to index.');
        return;
      }

      const globalIndexPath =
        this.config.globalIndexPath ||
        path.join(
          this.config.rootDirectory,
          '.cache',
          'global-inverted-index.json.gz',
        );
      const isStale = await this.isGlobalIndexStale(globalIndexPath, files);

      if (!isStale) {
        const loaded = await this.loadGlobalInvertedIndex();
        if (loaded) {
          console.log('Loaded existing index from cache.');
          return;
        }
      }

      // Try to load chunked index first
      const loaded = await this.loadChunkedInvertedIndex();
      if (loaded) {
        console.log('Loaded sharded index from cache.');
        return;
      }

      console.log(`Indexing ${files.length} documents...`);
      let indexed = 0;
      let skipped = 0;
      let errors = 0;

      for (const file of files) {
        try {
          if (this.needsReindexing(file)) {
            await this.indexDocument(file);
            indexed++;
            // Only log every 10th file to reduce noise
            if (indexed % 10 === 0 || indexed === files.length) {
              console.log(`Progress: ${indexed}/${files.length} files indexed`);
            }
          } else {
            skipped++;
          }
        } catch (error) {
          errors++;
          console.error(
            `Failed to index ${file.fileName}:`,
            error instanceof Error ? error.message : String(error),
          );
          // Continue processing other files
        }
      }

      console.log(
        `Indexing complete: ${indexed} indexed, ${skipped} skipped, ${errors} errors`,
      );

      if (indexed > 0) {
        await this.saveGlobalInvertedIndex();
        console.log('Index saved successfully.');
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

  private async loadChunkedInvertedIndex(): Promise<boolean> {
    const chunkDir = path.join(
      this.config.rootDirectory,
      '.cache',
      'sharded-index',
    );
    if (!fs.existsSync(chunkDir)) return false;
    const files = await fs.promises.readdir(chunkDir);
    this.invertedIndex.clear();
    for (const file of files) {
      if (!file.endsWith('.json.gz')) continue;
      const gzipped = await fs.promises.readFile(path.join(chunkDir, file));
      const data = zlib.gunzipSync(gzipped).toString('utf8');
      const obj = JSON.parse(data);
      for (const term of Object.keys(obj)) {
        this.invertedIndex.set(term, obj[term]);
      }
    }
    return this.invertedIndex.size > 0;
  }

  getInvertedIndex(): Map<string, InvertedIndexEntry[]> {
    return new Map(this.invertedIndex);
  }

  getDocumentCache(): Map<string, DocumentIndex> {
    // Enhanced to use LRU for frequently accessed documents
    const result = new Map(this.documentCache);

    // Add LRU cached items
    for (const [key, value] of this.documentLRU['cache']) {
      if (!result.has(key)) {
        result.set(key, value);
      }
    }

    return result;
  }

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
}

export { FileIndexer };
