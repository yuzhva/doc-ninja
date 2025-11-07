import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import { DocumentExtractor } from './document-parsers';
import { UkrainianTextProcessor } from './text-processor';
import {
  DocumentIndex,
  DocumentMetadata,
  InvertedIndexEntry,
  SearchConfig,
} from './types';

export class FileIndexer {
  private textProcessor = new UkrainianTextProcessor();
  private documentExtractor = new DocumentExtractor();
  private documentCache = new Map<string, DocumentIndex>();
  private invertedIndex = new Map<string, InvertedIndexEntry[]>();

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
    const txtPath = this.getTextCachePath(filePath);
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(txtPath), { recursive: true });
    // Use cached .txt if up-to-date
    try {
      const srcStat = await promisify(fs.stat)(filePath);
      if (fs.existsSync(txtPath)) {
        const txtStat = await promisify(fs.stat)(txtPath);
        if (txtStat.mtimeMs >= srcStat.mtimeMs) {
          return await promisify(fs.readFile)(txtPath, 'utf8');
        }
      }
      // Extract and cache
      const extractor = new (require('./document-parsers').DocumentExtractor)();
      const text = await extractor.extractText(filePath);
      await promisify(fs.writeFile)(txtPath, text, 'utf8');
      return text;
    } catch (e) {
      // fallback to extraction if cache fails
      const extractor = new (require('./document-parsers').DocumentExtractor)();
      return await extractor.extractText(filePath);
    }
  }

  async discoverFiles(): Promise<DocumentMetadata[]> {
    const files: DocumentMetadata[] = [];

    const scanDirectory = async (dir: string): Promise<void> => {
      try {
        const entries = await promisify(fs.readdir)(dir, {
          withFileTypes: true,
        });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // Exclude .cache directory from scanning
            if (entry.name === (this.config.cacheRoot || '.cache')) continue;
            await scanDirectory(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();

            // Exclude generated files in any location
            if (
              !this.config.extensions.includes(ext) ||
              entry.name.endsWith('.txt') ||
              entry.name.endsWith('.index.json')
            ) {
              continue;
            }

            const stats = await promisify(fs.stat)(fullPath);

            if (stats.size <= this.config.maxFileSize) {
              files.push({
                filePath: fullPath,
                fileName: entry.name,
                lastModified: stats.mtimeMs,
                size: stats.size,
                indexed: false,
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error scanning directory ${dir}:`, error);
      }
    };

    await scanDirectory(this.config.rootDirectory);
    return files;
  }

  needsReindexing(metadata: DocumentMetadata): boolean {
    const cached = this.documentCache.get(metadata.filePath);

    if (!cached) return true;
    if (!cached.metadata.indexed) return true;
    if (cached.metadata.lastModified !== metadata.lastModified) return true;

    return false;
  }

  async indexDocument(metadata: DocumentMetadata): Promise<DocumentIndex> {
    const indexPath = this.getIndexCachePath(metadata.filePath);
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
    const srcStat = await promisify(fs.stat)(metadata.filePath);
    // Use cached index if up-to-date
    if (fs.existsSync(indexPath)) {
      const idxStat = await promisify(fs.stat)(indexPath);
      if (idxStat.mtimeMs >= srcStat.mtimeMs) {
        const cached = JSON.parse(
          await promisify(fs.readFile)(indexPath, 'utf8'),
        );
        // Restore Map from object
        cached.termFrequency = new Map(Object.entries(cached.termFrequency));
        this.documentCache.set(metadata.filePath, cached);
        this.updateInvertedIndex(metadata.filePath, cached);
        return cached;
      }
    }
    const text = await this.extractTextFromFile(metadata.filePath);
    const tokens = this.textProcessor.tokenize(text);
    const termFrequency = new Map<string, number>();
    tokens.forEach((token) => {
      const term = this.config.ukrainianStemming
        ? this.textProcessor.stemWord(token.normalized)
        : token.normalized;
      termFrequency.set(term, (termFrequency.get(term) || 0) + 1);
    });
    const documentIndex: DocumentIndex = {
      metadata: { ...metadata, indexed: true, indexedAt: Date.now() },
      tokens,
      termFrequency,
      wordCount: tokens.length,
    };
    this.documentCache.set(metadata.filePath, documentIndex);
    this.updateInvertedIndex(metadata.filePath, documentIndex);
    // Save index to disk (convert Map to object)
    const toSave = {
      ...documentIndex,
      termFrequency: Object.fromEntries(termFrequency),
    };
    await promisify(fs.writeFile)(indexPath, JSON.stringify(toSave), 'utf8');
    return documentIndex;
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

  async buildFullIndex(): Promise<void> {
    const files = await this.discoverFiles();
    console.log(`Found ${files.length} documents to process`);

    let indexed = 0;
    let skipped = 0;

    for (const file of files) {
      try {
        if (this.needsReindexing(file)) {
          await this.indexDocument(file);
          indexed++;
          console.log(`Indexed: ${file.fileName} (${indexed}/${files.length})`);
        } else {
          skipped++;
        }
      } catch (error) {
        console.error(`Failed to index ${file.fileName}:`, error);
      }
    }

    console.log(`Indexing complete: ${indexed} indexed, ${skipped} skipped`);
  }

  getInvertedIndex(): Map<string, InvertedIndexEntry[]> {
    return new Map(this.invertedIndex);
  }

  getDocumentCache(): Map<string, DocumentIndex> {
    return new Map(this.documentCache);
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
