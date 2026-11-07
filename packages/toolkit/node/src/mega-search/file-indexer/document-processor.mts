import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import { DocumentExtractor } from '../../document-extractor/index.mjs';
import { SavedPaths, resolveCachePaths } from '../cache-paths.mjs';
import type { ResolvedCachePaths, SavedMetadata } from '../cache-paths.mjs';
import { LRUCache } from '../lru-cache.mjs';
import { Logger } from '../shared/logger.mjs';
import {
  UkrainianTextProcessor,
  countsAsWord,
  findJoints,
} from '../text-processor.mjs';
import { TokenPositions } from '../token-positions.mjs';
import { DocumentIndex, DocumentMetadata, SearchConfig } from '../types.mjs';
import { INDEX_VERSION } from './index-version.mjs';
import { SharedWords } from './shared-words.mjs';

/**
 * Whether `doc` was indexed from the file as discovery reports it now.
 *
 * Discovery reports whole milliseconds, while a document read back from its
 * per-document cache carries fs.stat's fractions of one. Times less than
 * 1 ms apart are the same version — compared exactly, every such document
 * counted as changed on every start, and the whole index was rebuilt.
 */
function isIndexedAsIs(
  doc: DocumentIndex | undefined,
  file: DocumentMetadata,
): boolean {
  return (
    !!doc?.metadata.indexed &&
    Math.abs(doc.metadata.lastModified - file.lastModified) < 1
  );
}

class DocumentProcessor {
  private textProcessor = new UkrainianTextProcessor();
  private documentExtractor = new DocumentExtractor();
  // Remembers which source version (mtime) the text came from, so an edit to
  // the file invalidates it instead of re-indexing the old text.
  private textLRU = new LRUCache<
    string,
    { text: string; sourceMtimeMs: number }
  >(25);
  private createdDirectories = new Set<string>();
  private cachePaths: ResolvedCachePaths;
  private savedPaths: SavedPaths;

  constructor(
    private config: SearchConfig,
    private logger: Logger,
    private sharedWords = new SharedWords(),
  ) {
    this.cachePaths = resolveCachePaths(this.config);
    this.savedPaths = new SavedPaths(this.config, this.cachePaths);
  }

  private getCacheRelativePath(filePath: string): string {
    const rel = path.relative(this.config.rootDirectory, filePath);
    return rel.replace(/^[/\\]/, '');
  }

  private getTextCachePath(filePath: string): string {
    const rel = this.getCacheRelativePath(filePath);
    return path.join(this.cachePaths.txtCacheRoot, `${rel}.txt`);
  }

  private getIndexCachePath(filePath: string): string {
    const rel = this.getCacheRelativePath(filePath);
    return path.join(this.cachePaths.indexCacheRoot, `${rel}.index.json`);
  }

  /**
   * Forgets what it keeps in memory about the caches on disk — call it when
   * they're deleted, or the folders it created would count as still there.
   */
  clearMemoryCache(): void {
    this.textLRU.clear();
    this.createdDirectories.clear();
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    if (this.createdDirectories.has(dirPath)) return;
    await fs.promises.mkdir(dirPath, { recursive: true });
    this.createdDirectories.add(dirPath);
  }

  async extractTextFromFile(filePath: string): Promise<string> {
    try {
      const txtPath = this.getTextCachePath(filePath);
      await this.ensureDirectory(path.dirname(txtPath));

      try {
        const srcStat = await promisify(fs.stat)(filePath);
        const sourceMtimeMs = srcStat.mtimeMs;

        const cached = this.textLRU.get(filePath);
        if (cached && cached.sourceMtimeMs === sourceMtimeMs)
          return cached.text;

        try {
          const txtStat = await promisify(fs.stat)(txtPath);
          if (txtStat.mtimeMs >= sourceMtimeMs) {
            const text = await promisify(fs.readFile)(txtPath, 'utf8');
            this.textLRU.set(filePath, { text, sourceMtimeMs });
            return text;
          }
        } catch (statError) {
          // Cache file missing
        }

        const text = await this.documentExtractor.extractText({ filePath });
        await promisify(fs.writeFile)(txtPath, text, 'utf8');
        this.textLRU.set(filePath, { text, sourceMtimeMs });
        return text;
      } catch (diskError) {
        // Without a source mtime the text can't be validated later, so it is
        // not kept in the LRU.
        this.logger.warn(
          `Cache operation failed for ${path.basename(filePath)}, extracting directly:`,
          diskError instanceof Error ? diskError.message : String(diskError),
        );
        return await this.documentExtractor.extractText({ filePath });
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
    if (cached) return !isIndexedAsIs(cached, metadata);

    const indexPath = this.getIndexCachePath(metadata.originalFilePath);
    try {
      const indexStat = await promisify(fs.stat)(indexPath);
      const sourceStat = await promisify(fs.stat)(metadata.originalFilePath);

      if (indexStat.mtimeMs >= sourceStat.mtimeMs) {
        try {
          const cached = await this.readCachedIndex(indexPath, metadata);
          if (!cached) return true;
          cached.metadata.lastModified = sourceStat.mtimeMs;
          cached.metadata.size = sourceStat.size;

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
        const cached =
          idxStat.mtimeMs >= srcStat.mtimeMs
            ? await this.readCachedIndex(indexPath, metadata)
            : null;
        if (cached) {
          cached.metadata.lastModified = srcStat.mtimeMs;
          cached.metadata.size = srcStat.size;
          cached.metadata.indexed = true;

          this.logger.debug(`📋 Loaded cached index for ${metadata.fileName}`);
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
      const vocab: string[] = [];
      const vocabMap = new Map<string, number>();
      // vocabIndex, charStart, charEnd of each token in turn
      const positions = new Uint32Array(rawTokens.length * 3);
      // Words only: numbers and function words leave BM25 document lengths
      // as they were
      let wordCount = 0;
      const vocabCountsAsWord: boolean[] = [];

      rawTokens.forEach((token, tokenIndex) => {
        let vocabIndex = vocabMap.get(token.term);
        if (vocabIndex === undefined) {
          vocabIndex = vocab.length;
          vocab.push(this.sharedWords.get(token.term));
          vocabMap.set(token.term, vocabIndex);
          vocabCountsAsWord.push(countsAsWord(token.term));
        }
        if (vocabCountsAsWord[vocabIndex]) wordCount++;

        positions[tokenIndex * 3] = vocabIndex;
        positions[tokenIndex * 3 + 1] = token.charStart;
        positions[tokenIndex * 3 + 2] = token.charEnd;
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
        positions: TokenPositions.fromFlat(positions),
        joints: findJoints(text, rawTokens),
        wordCount,
      };

      const tSaveStart = Date.now();
      await this.saveIndexToDisk(documentIndex);
      const tSaveEnd = Date.now();

      const endTime = Date.now();
      const duration = endTime - startTime;

      if (duration > 1000) {
        this.logger.debug(
          `🐢 Slow indexing (${duration}ms) for ${metadata.fileName}:`,
          {
            extract: tExtractEnd - tExtractStart,
            tokenize: tTokenizeEnd - tTokenizeStart,
            indexing: tIndexEnd - tIndexStart,
            saving: tSaveEnd - tSaveStart,
          },
        );
      }

      this.logger.debug('💾 Document indexing completed', {
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

  /**
   * The per-document index of the document `metadata` describes, from disk,
   * or null when another INDEX_VERSION built it: its vocab and positions may
   * not be what tokenizing the text gives now. Throws on a corrupted file.
   */
  private async readCachedIndex(
    indexPath: string,
    metadata: DocumentMetadata,
  ): Promise<any | null> {
    const { indexVersion = 1, ...cached } = JSON.parse(
      await promisify(fs.readFile)(indexPath, 'utf8'),
    );
    if (indexVersion !== INDEX_VERSION) {
      this.logger.debug(
        `📋 Cached index for ${metadata.fileName} is from index version ${indexVersion}, will rebuild`,
      );
      return null;
    }
    const { relativeFilePath, ...saved }: SavedMetadata = cached.metadata;
    return {
      ...cached,
      // Its paths are the document's: the file was found by them
      metadata: {
        ...saved,
        originalFilePath: metadata.originalFilePath,
        textFilePath: this.getTextCachePath(metadata.originalFilePath),
      },
      vocab: this.sharedWords.share(cached.vocab ?? []),
      positions: TokenPositions.fromSaved(cached.positions),
    };
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
      positions: TokenPositions.EMPTY,
      joints: {},
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
        indexVersion: INDEX_VERSION,
        ...documentIndex,
        metadata: this.savedPaths.saveMetadata(documentIndex.metadata),
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

export { DocumentProcessor, isIndexedAsIs };
