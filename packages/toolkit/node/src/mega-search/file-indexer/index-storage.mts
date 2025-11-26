import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as v8 from 'v8';
import * as zlib from 'zlib';

import { LRUCache } from '../lru-cache.mjs';
import { Logger } from '../shared/logger.mjs';
import { DocumentIndex, SearchConfig } from '../types.mjs';
import { InvertedIndex } from './inverted-index.mjs';

class IndexStorage {
  private gunzipAsync = promisify(zlib.gunzip);
  public needsOptimization = false;

  constructor(
    private config: SearchConfig,
    private logger: Logger,
    private documentLRU: LRUCache<string, DocumentIndex>,
  ) {}

  private getCacheRelativePath(filePath: string): string {
    const rel = path.relative(this.config.rootDirectory, filePath);
    return rel.replace(/^[/\\]/, '');
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

  private estimateIndexSize(
    documentCache: Map<string, DocumentIndex>,
    invertedIndex: InvertedIndex,
  ): number {
    let estimatedSize = 0;
    // Estimate based on raw map size (number[] is compact)
    // Each number is 8 bytes in V8 (double) or 4 bytes (smi)
    // Let's assume 8 bytes per number for safety + map overhead
    invertedIndex.getRawIndex().forEach((entries, term) => {
      estimatedSize += term.length * 2;
      estimatedSize += entries.length * 8;
    });

    documentCache.forEach((doc) => {
      estimatedSize += 500;
      estimatedSize += doc.vocab.reduce(
        (sum, term) => sum + term.length * 2,
        0,
      );
      estimatedSize += doc.positions.length * 12;
      estimatedSize += doc.termFrequency.size * 30;
    });
    return Math.round(estimatedSize * 1.3);
  }

  async saveGlobalIndex(
    documentCache: Map<string, DocumentIndex>,
    invertedIndex: InvertedIndex,
    stemDictionary: Map<string, Set<string>>,
  ): Promise<void> {
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

      const estimatedSize = this.estimateIndexSize(
        documentCache,
        invertedIndex,
      );
      this.logger.info(
        `💾 Estimated index size: ${Math.round(estimatedSize / 1024 / 1024)}MB`,
      );

      this.logger.info(
        `🚀 Saving index using optimized V8 binary serialization...`,
      );
      await this.saveGlobalInvertedIndexChunked(
        globalIndexPath,
        tempPath,
        documentCache,
        invertedIndex,
        stemDictionary,
      );

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

  async loadGlobalIndex(): Promise<{
    documentCache: Map<string, DocumentIndex>;
    invertedIndex: InvertedIndex;
    stemDictionary: Map<string, Set<string>>;
  } | null> {
    const startTime = Date.now();
    try {
      const globalIndexPath =
        this.config.globalIndexPath ||
        path.join(
          this.config.rootDirectory,
          '.cache',
          'global-inverted-index.json.gz',
        );

      let content: string;
      try {
        content = await fs.promises.readFile(globalIndexPath, 'utf8');
      } catch (e) {
        return null;
      }

      let result: any = null;
      try {
        const marker = JSON.parse(content);
        if (marker.format === 'v8-chunked-compact') {
          // New format version
          this.logger.debug('📦 Loading optimized V8 chunked compact index...');
          result = await this.loadGlobalInvertedIndexChunked(
            globalIndexPath,
            marker,
          );
        } else if (
          marker.format === 'v8-chunked' ||
          marker.format === 'chunked'
        ) {
          this.logger.warn(
            '⚠️ Found legacy index format. Rebuilding for performance...',
          );
          return null;
        }
      } catch (parseError) {
        // Not JSON
      }

      if (result) {
        this.logger.info(
          `Global index loading completed in ${Date.now() - startTime}ms`,
        );
      }
      return result;
    } catch (error) {
      this.logger.warn(
        'Failed to load global inverted index:',
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private async saveGlobalInvertedIndexChunked(
    globalIndexPath: string,
    tempPath: string,
    documentCache: Map<string, DocumentIndex>,
    invertedIndex: InvertedIndex,
    stemDictionary: Map<string, Set<string>>,
  ): Promise<void> {
    await fs.promises.mkdir(path.dirname(globalIndexPath), { recursive: true });
    const chunkedDir = globalIndexPath.replace('.json.gz', '.chunks');
    await fs.promises.rm(chunkedDir, { recursive: true, force: true });
    await fs.promises.mkdir(chunkedDir, { recursive: true });

    this.logger.info(`📦 Saving index in chunks to: ${chunkedDir}`);

    const useCompression = true;
    const gzipOptions = { level: zlib.constants.Z_BEST_SPEED };
    const chunkExt = useCompression ? '.v8.gz' : '.v8';

    try {
      const metadata = {
        version: '3.0', // Bump version for compact index
        timestamp: Date.now(),
        totalDocuments: documentCache.size,
        totalTerms: invertedIndex.size,
        totalStems: stemDictionary.size,
        chunkInfo: { documentChunks: 0, invertedIndexChunks: 0, stemChunks: 0 },
      };

      // Save Document Mapping
      const docMappingPath = path.join(chunkedDir, `doc_mapping${chunkExt}`);
      const docMappingBuffer = v8.serialize(invertedIndex.getDocMapping());
      await fs.promises.writeFile(
        docMappingPath,
        useCompression
          ? zlib.gzipSync(docMappingBuffer, gzipOptions)
          : docMappingBuffer,
      );

      // Save Documents
      const docEntries = Array.from(documentCache.entries());
      const lightDocEntries = docEntries.map(([key, doc]) => {
        const lightDoc: any = {
          metadata: doc.metadata,
          wordCount: doc.wordCount,
          termFrequency: new Map(),
        };
        return [key, lightDoc];
      });

      const docChunks = this.chunkMapEntries(lightDocEntries, 50);
      this.logger.info(
        `📑 Saving document cache in ${docChunks.length} chunks`,
      );

      for (let i = 0; i < docChunks.length; i++) {
        const chunkPath = path.join(chunkedDir, `documents_${i}${chunkExt}`);
        const buffer = v8.serialize(docChunks[i]);
        const dataToWrite = useCompression
          ? zlib.gzipSync(buffer, gzipOptions)
          : buffer;
        await fs.promises.writeFile(chunkPath, dataToWrite);
      }
      metadata.chunkInfo.documentChunks = docChunks.length;

      // Save Inverted Index (Raw Map<string, number[]>)
      const invertedEntries = Array.from(invertedIndex.getRawIndex().entries());
      const invertedChunks = this.chunkMapEntries(invertedEntries, 1000);
      this.logger.info(
        `🔗 Saving inverted index in ${invertedChunks.length} chunks`,
      );

      for (let i = 0; i < invertedChunks.length; i++) {
        const chunkPath = path.join(chunkedDir, `inverted_${i}${chunkExt}`);
        const buffer = v8.serialize(invertedChunks[i]);
        const dataToWrite = useCompression
          ? zlib.gzipSync(buffer, gzipOptions)
          : buffer;
        await fs.promises.writeFile(chunkPath, dataToWrite);
      }
      metadata.chunkInfo.invertedIndexChunks = invertedChunks.length;

      // Save Stems
      const stemEntries = Array.from(stemDictionary.entries());
      const stemChunks = this.chunkMapEntries(stemEntries, 5000);
      this.logger.info(
        `📚 Saving stem dictionary in ${stemChunks.length} chunks`,
      );

      for (let i = 0; i < stemChunks.length; i++) {
        const chunkPath = path.join(chunkedDir, `stems_${i}${chunkExt}`);
        const buffer = v8.serialize(stemChunks[i]);
        const dataToWrite = useCompression
          ? zlib.gzipSync(buffer, gzipOptions)
          : buffer;
        await fs.promises.writeFile(chunkPath, dataToWrite);
      }
      metadata.chunkInfo.stemChunks = stemChunks.length;

      const metadataPath = path.join(chunkedDir, 'metadata.json');
      await fs.promises.writeFile(
        metadataPath,
        JSON.stringify(metadata, null, 2),
      );

      const markerContent = JSON.stringify({
        format: 'v8-chunked-compact',
        version: '3.0',
        compression: useCompression ? 'gzip' : 'none',
        chunkedDir: path.relative(path.dirname(globalIndexPath), chunkedDir),
        createdAt: new Date().toISOString(),
      });
      await fs.promises.writeFile(globalIndexPath, markerContent);

      this.logger.info(`✅ V8 Chunked Compact index saved successfully`);
    } catch (error) {
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

  private chunkMapEntries<T>(entries: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < entries.length; i += chunkSize) {
      chunks.push(entries.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private getTextCachePath(filePath: string): string {
    const rel = this.getCacheRelativePath(filePath);
    const txtCacheRoot = this.config.txtCacheSubdir || '.cache/txt';
    return path.join(this.config.rootDirectory, txtCacheRoot, `${rel}.txt`);
  }

  private async loadGlobalInvertedIndexChunked(
    globalIndexPath: string,
    marker: any,
  ): Promise<{
    documentCache: Map<string, DocumentIndex>;
    invertedIndex: InvertedIndex;
    stemDictionary: Map<string, Set<string>>;
  } | null> {
    const chunkedDir = path.resolve(
      path.dirname(globalIndexPath),
      marker.chunkedDir,
    );
    const metadataPath = path.join(chunkedDir, 'metadata.json');

    let metadataStr: string;
    try {
      metadataStr = await fs.promises.readFile(metadataPath, 'utf8');
    } catch (e) {
      this.logger.warn('Chunked metadata not found, rebuilding index...');
      return null;
    }

    const metadata = JSON.parse(metadataStr);
    const compression = marker.compression || 'gzip';
    const chunkExt = compression === 'gzip' ? '.v8.gz' : '.v8';

    this.logger.info(
      `📦 Loading V8 chunked compact index (${compression}): ${metadata.totalDocuments} docs, ${metadata.totalTerms} terms`,
    );

    const documentCache = new Map<string, DocumentIndex>();
    const invertedIndex = new InvertedIndex();
    const stemDictionary = new Map<string, Set<string>>();

    try {
      // Load Doc Mapping first
      const docMappingPath = path.join(chunkedDir, `doc_mapping${chunkExt}`);
      const docMappingData = await fs.promises.readFile(docMappingPath);
      const docMappingBuffer =
        compression === 'gzip'
          ? await this.gunzipAsync(docMappingData)
          : docMappingData;
      const docMapping = v8.deserialize(docMappingBuffer) as string[];

      // Initialize InvertedIndex with mapping but empty map
      invertedIndex.restore(new Map(), docMapping);

      const loadChunksParallel = async <T,>(
        count: number,
        prefix: string,
        processor: (data: T) => void,
        label: string,
      ) => {
        const indices = Array.from({ length: count }, (_, i) => i);
        const start = Date.now();
        const cpuCount = os.cpus().length;
        const CONCURRENCY = Math.max(4, cpuCount);

        let totalRead = 0;
        let totalUnzip = 0;
        let totalDeserialize = 0;
        let totalProcess = 0;
        let totalSize = 0;

        for (let i = 0; i < indices.length; i += CONCURRENCY) {
          const batch = indices.slice(i, i + CONCURRENCY);
          const promises = batch.map(async (index) => {
            const t0 = Date.now();
            const chunkPath = path.join(
              chunkedDir,
              `${prefix}_${index}${chunkExt}`,
            );
            const fileData = await fs.promises.readFile(chunkPath);
            const size = fileData.length;
            const t1 = Date.now();
            let buffer: Buffer;
            if (compression === 'gzip') {
              buffer = await this.gunzipAsync(fileData);
            } else {
              buffer = fileData;
            }
            const t2 = Date.now();
            const data = v8.deserialize(buffer);
            const t3 = Date.now();
            return {
              data,
              size,
              metrics: { read: t1 - t0, unzip: t2 - t1, deserialize: t3 - t2 },
            };
          });

          const results = await Promise.all(promises);
          const tProcessStart = Date.now();
          for (const result of results) {
            processor(result.data);
            totalRead += result.metrics.read;
            totalUnzip += result.metrics.unzip;
            totalDeserialize += result.metrics.deserialize;
            totalSize += result.size;
          }
          totalProcess += Date.now() - tProcessStart;
        }

        const duration = Date.now() - start;
        const avgUnzip = Math.round(totalUnzip / count);
        const totalSizeMB = (totalSize / 1024 / 1024).toFixed(1);
        this.logger.info(
          `  ⏱️ ${label} loaded in ${duration}ms (${count} chunks, ${totalSizeMB}MB).`,
        );
        if (avgUnzip > 200 && compression === 'gzip') {
          this.logger.info(
            `  💡 Hint: Unzip is still slow (${avgUnzip}ms). Ensure UV_THREADPOOL_SIZE=${cpuCount} is set before Node starts.`,
          );
        }
      };

      await loadChunksParallel(
        metadata.chunkInfo.documentChunks,
        'documents',
        (entries: [string, any][]) => {
          for (const [filePath, doc] of entries) {
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
            if (doc.vocab || doc.positions) {
              this.needsOptimization = true;
            }
            doc.termFrequency = new Map();
            this.makeDocumentLazy(doc);
            documentCache.set(filePath, doc);
          }
        },
        'Documents',
      );

      // Load Inverted Index Chunks (Raw Map<string, number[]>)
      const rawIndex = new Map<string, number[]>();
      await loadChunksParallel(
        metadata.chunkInfo.invertedIndexChunks,
        'inverted',
        (entries: [string, number[]][]) => {
          for (const [term, data] of entries) {
            rawIndex.set(term, data);
          }
        },
        'Inverted Index',
      );
      // Restore the map into the InvertedIndex instance
      invertedIndex.restore(rawIndex, docMapping);

      if (metadata.chunkInfo.stemChunks > 0) {
        await loadChunksParallel(
          metadata.chunkInfo.stemChunks,
          'stems',
          (entries: [string, any][]) => {
            for (const [stem, words] of entries) {
              stemDictionary.set(stem, words);
            }
          },
          'Stems',
        );
      }

      return { documentCache, invertedIndex, stemDictionary };
    } catch (error) {
      this.logger.error('Failed to load chunked index:', error);
      return null;
    }
  }

  private makeDocumentLazy(doc: DocumentIndex): void {
    const indexPath = this.getIndexCachePath(doc.metadata.originalFilePath);
    let _vocab: string[] | null = doc.vocab || null;
    let _positions: [number, number, number][] | null = doc.positions || null;

    const loadFromDisk = () => {
      if (_vocab && _positions) return;
      const cached = this.documentLRU.get(doc.metadata.originalFilePath);
      if (cached && cached.vocab && cached.positions) {
        _vocab = cached.vocab;
        _positions = cached.positions;
        return;
      }
      try {
        const content = fs.readFileSync(indexPath, 'utf8');
        const fullDoc = JSON.parse(content);
        _vocab = fullDoc.vocab || [];
        _positions = fullDoc.positions || [];
        this.documentLRU.set(doc.metadata.originalFilePath, fullDoc);
      } catch (e) {
        _vocab = [];
        _positions = [];
      }
    };

    Object.defineProperty(doc, 'vocab', {
      get: () => {
        loadFromDisk();
        return _vocab;
      },
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(doc, 'positions', {
      get: () => {
        loadFromDisk();
        return _positions;
      },
      configurable: true,
      enumerable: true,
    });
  }
}

export { IndexStorage };
