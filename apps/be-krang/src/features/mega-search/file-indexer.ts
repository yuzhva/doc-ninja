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

class FileIndexer {
  private textProcessor = new UkrainianTextProcessor();
  private documentExtractor = new DocumentExtractor();
  private documentCache = new Map<string, DocumentIndex>();
  private invertedIndex = new Map<string, InvertedIndexEntry[]>();

  constructor(private config: SearchConfig) {}

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
            await scanDirectory(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();

            if (this.config.extensions.includes(ext)) {
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
    try {
      const text = await this.documentExtractor.extractText(metadata.filePath);
      const tokens = this.textProcessor.tokenize(text);

      // Calculate term frequencies
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

      return documentIndex;
    } catch (error) {
      console.error(`Error indexing ${metadata.filePath}:`, error);
      throw error;
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

export { FileIndexer };
