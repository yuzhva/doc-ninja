import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import { DocumentExtractor } from '../document-parser/index.mjs';
import { LRUCache } from '../lru-cache.mjs';
import { Logger } from '../shared/logger.mjs';
import { UkrainianTextProcessor } from '../text-processor.mjs';
import { DocumentIndex, DocumentMetadata, SearchConfig } from '../types.mjs';

class DocumentProcessor {
  private textProcessor = new UkrainianTextProcessor();
  private documentExtractor = new DocumentExtractor();
  private textLRU = new LRUCache<string, string>(25);
  private createdDirectories = new Set<string>();

  constructor(
    private config: SearchConfig,
    private logger: Logger,
  ) {}

  private getCacheRelativePath(filePath: string): string {
    const rel = path.relative(this.config.rootDirectory, filePath);
    return rel.replace(/^[/\\]/, '');
  }

  private getTextCachePath(filePath: string): string {
    const rel = this.getCacheRelativePath(filePath);
    const txtCacheRoot = this.config.txtCacheSubdir || '.cache/txt';
    return path.join(this.config.rootDirectory, txtCacheRoot, `${rel}.txt`);
  }

  private getIndexCachePath(filePath: string): string {
    const rel = this.getCacheRelativePath(filePath);
    const indexCacheRoot = this.config.indexCacheSubdir || '.cache/index';
    return path.join(
      this.config.rootDirectory,
      indexCacheRoot,
      `${rel}.index.json`,
    );
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    if (this.createdDirectories.has(dirPath)) return;
    await fs.promises.mkdir(dirPath, { recursive: true });
    this.createdDirectories.add(dirPath);
  }

  async extractTextFromFile(filePath: string): Promise<string> {
    try {
      const cached = this.textLRU.get(filePath);
      if (cached) return cached;

      const txtPath = this.getTextCachePath(filePath);
      await this.ensureDirectory(path.dirname(txtPath));

      try {
        const srcStat = await promisify(fs.stat)(filePath);
        try {
          const txtStat = await promisify(fs.stat)(txtPath);
          if (txtStat.mtimeMs >= srcStat.mtimeMs) {
            const text = await promisify(fs.readFile)(txtPath, 'utf8');
            this.textLRU.set(filePath, text);
            return text;
          }
        } catch (statError) {
          // Cache file missing
        }

        const text = await this.documentExtractor.extractText({ filePath });
        await promisify(fs.writeFile)(txtPath, text, 'utf8');
        this.textLRU.set(filePath, text);
        return text;
      } catch (diskError) {
        this.logger.warn(
          `Cache operation failed for ${path.basename(filePath)}, extracting directly:`,
          diskError instanceof Error ? diskError.message : String(diskError),
        );
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

  async needsReindexing(
    metadata: DocumentMetadata,
    documentCache: Map<string, DocumentIndex>,
  ): Promise<boolean> {
    const cached = documentCache.get(metadata.originalFilePath);
    if (cached) {
      if (!cached.metadata.indexed) return true;
      if (cached.metadata.lastModified !== metadata.lastModified) return true;
      return false;
    }

    const indexPath = this.getIndexCachePath(metadata.originalFilePath);
    try {
      const indexStat = await promisify(fs.stat)(indexPath);
      const sourceStat = await promisify(fs.stat)(metadata.originalFilePath);

      if (indexStat.mtimeMs >= sourceStat.mtimeMs) {
        try {
          const content = await promisify(fs.readFile)(indexPath, 'utf8');
          const cached = JSON.parse(content);
          cached.termFrequency = new Map();
          cached.metadata.lastModified = sourceStat.mtimeMs;
          cached.metadata.size = sourceStat.size;

          if (!cached.metadata.originalFilePath && cached.metadata.filePath) {
            cached.metadata.originalFilePath = cached.metadata.filePath;
          }
          if (!cached.metadata.textFilePath) {
            cached.metadata.textFilePath = this.getTextCachePath(
              metadata.originalFilePath,
            );
          }

          documentCache.set(metadata.originalFilePath, cached);
          this.logger.debug(
            `📋 Pre-loaded cached index for ${metadata.fileName} - no reindexing needed`,
          );
          return false;
        } catch (loadError) {
          this.logger.warn(
            `📋 Cache file corrupted for ${metadata.fileName}, will rebuild`,
          );
          return true;
        }
      }
    } catch (error) {
      // File missing, reindex
    }
    return true;
  }

  async indexDocument(metadata: DocumentMetadata): Promise<DocumentIndex> {
    const DOCUMENT_TIMEOUT = 30000;
    let timeoutHandle: NodeJS.Timeout | undefined = undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(`Document indexing timeout after ${DOCUMENT_TIMEOUT}ms`),
          );
        }, DOCUMENT_TIMEOUT);
      });

      const indexingPromise = this.indexDocumentInternal(metadata);
      const result = await Promise.race([indexingPromise, timeoutPromise]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      return result;
    } catch (error) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.logger.error(
        `❌ Failed to index ${metadata.fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      // Ensure we save the empty index to prevent infinite re-indexing loops
      const emptyIndex = this.createEmptyIndex(metadata);
      await this.saveIndexToDisk(emptyIndex);
      return emptyIndex;
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
    await this.ensureDirectory(path.dirname(indexPath));

    try {
      const srcStat = await promisify(fs.stat)(metadata.originalFilePath);

      try {
        const idxStat = await promisify(fs.stat)(indexPath);
        if (idxStat.mtimeMs >= srcStat.mtimeMs) {
          const cached = JSON.parse(
            await promisify(fs.readFile)(indexPath, 'utf8'),
          );
          cached.termFrequency = new Map(Object.entries(cached.termFrequency));
          cached.metadata.lastModified = srcStat.mtimeMs;
          cached.metadata.size = srcStat.size;
          cached.metadata.indexed = true;

          if (!cached.metadata.originalFilePath && cached.metadata.filePath) {
            cached.metadata.originalFilePath = cached.metadata.filePath;
          }
          if (!cached.metadata.textFilePath) {
            cached.metadata.textFilePath = this.getTextCachePath(
              metadata.originalFilePath,
            );
          }

          this.logger.info(`📋 Loaded cached index for ${metadata.fileName}`);
          return cached;
        }
      } catch (cacheError) {
        // Cache missing
      }

      const tExtractStart = Date.now();
      let text: string;
      try {
        text = await this.extractTextFromFile(metadata.originalFilePath);
      } catch (extractError) {
        this.logger.warn(
          `Text extraction failed for ${metadata.fileName}, creating empty index`,
        );
        const emptyIndex = this.createEmptyIndex(metadata);
        await this.saveIndexToDisk(emptyIndex);
        return emptyIndex;
      }
      const tExtractEnd = Date.now();

      if (!text || text.trim().length === 0) {
        this.logger.warn(
          `No text content in ${metadata.fileName}, creating empty index`,
        );
        const emptyIndex = this.createEmptyIndex(metadata);
        await this.saveIndexToDisk(emptyIndex);
        return emptyIndex;
      }

      const tTokenizeStart = Date.now();
      const rawTokens = this.textProcessor.tokenize(text);
      const tTokenizeEnd = Date.now();

      if (rawTokens.length === 0) {
        this.logger.warn(`No valid tokens found in ${metadata.fileName}`);
      }

      const tIndexStart = Date.now();
      const termFrequency = new Map<string, number>();
      const vocab: string[] = [];
      const vocabMap = new Map<string, number>();
      const positions: Array<[number, number, number]> = [];
      const stemCache = new Map<string, string>();

      rawTokens.forEach((token) => {
        let vocabIndex = vocabMap.get(token.term);
        if (vocabIndex === undefined) {
          vocabIndex = vocab.length;
          vocab.push(token.term);
          vocabMap.set(token.term, vocabIndex);
        }

        positions.push([vocabIndex, token.charStart, token.charEnd]);

        let stemmedTerm = stemCache.get(token.normalized);
        if (stemmedTerm === undefined) {
          stemmedTerm = this.config.ukrainianStemming
            ? this.textProcessor.stemWord(token.normalized)
            : token.normalized;
          stemCache.set(token.normalized, stemmedTerm);
        }

        termFrequency.set(
          stemmedTerm,
          (termFrequency.get(stemmedTerm) || 0) + 1,
        );
      });
      const tIndexEnd = Date.now();

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

      const tSaveStart = Date.now();
      await this.saveIndexToDisk(documentIndex);
      const tSaveEnd = Date.now();

      documentIndex.termFrequency = new Map();

      const endTime = Date.now();
      const duration = endTime - startTime;

      if (duration > 1000) {
        this.logger.info(
          `🐢 Slow indexing (${duration}ms) for ${metadata.fileName}:`,
          {
            extract: tExtractEnd - tExtractStart,
            tokenize: tTokenizeEnd - tTokenizeStart,
            indexing: tIndexEnd - tIndexStart,
            saving: tSaveEnd - tSaveStart,
          },
        );
      }

      this.logger.info('💾 Document indexing completed', {
        fileName: metadata.fileName,
        tokens: documentIndex.wordCount,
        duration,
      });

      return documentIndex;
    } catch (error) {
      throw new Error(
        `Failed to index document ${metadata.fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private createEmptyIndex(metadata: DocumentMetadata): DocumentIndex {
    return {
      metadata: {
        ...metadata,
        indexed: true, // Mark as indexed so we don't retry immediately
        indexedAt: Date.now(),
        language: 'unknown' as const,
        textFilePath: this.getTextCachePath(metadata.originalFilePath),
      },
      vocab: [],
      positions: [],
      termFrequency: new Map(),
      wordCount: 0,
    };
  }

  private async saveIndexToDisk(documentIndex: DocumentIndex): Promise<void> {
    try {
      const indexPath = this.getIndexCachePath(
        documentIndex.metadata.originalFilePath,
      );
      await this.ensureDirectory(path.dirname(indexPath));

      const toSave = {
        ...documentIndex,
        termFrequency: Object.fromEntries(documentIndex.termFrequency),
      };
      await promisify(fs.writeFile)(indexPath, JSON.stringify(toSave), 'utf8');
      this.logger.debug(
        `💾 Cached index for ${documentIndex.metadata.fileName}`,
      );
    } catch (saveError) {
      this.logger.warn(
        `Failed to save index cache for ${documentIndex.metadata.fileName}:`,
        saveError,
      );
    }
  }
}

export { DocumentProcessor };
