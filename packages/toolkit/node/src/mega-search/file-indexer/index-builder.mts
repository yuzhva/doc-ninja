import { Logger } from '../shared/logger.mjs';
import { UkrainianTextProcessor, isNumberTerm } from '../text-processor.mjs';
import { DocumentIndex, SearchConfig } from '../types.mjs';
import { InvertedIndex } from './inverted-index.mjs';

export class IndexBuilder {
  private textProcessor = new UkrainianTextProcessor();

  constructor(
    private config: SearchConfig,
    private logger: Logger,
  ) {}

  /**
   * Brings the inverted index up to date for the given documents only: drops
   * their old postings and adds their current ones, without reading any other
   * document. Stems no document holds any more leave the stem dictionary.
   * A word that just disappeared from a stem that other documents still hold
   * stays listed under it until the next full rebuild. It matches no position,
   * so search results are the same.
   */
  updateDocuments(
    documentCache: Map<string, DocumentIndex>,
    invertedIndex: InvertedIndex,
    stemDictionary: Map<string, Set<string>>,
    documentPaths: Iterable<string>,
  ): void {
    const paths = new Set(documentPaths);
    this.logger.info(
      `🔗 Updating the inverted index for ${paths.size} documents...`,
    );

    for (const stem of invertedIndex.removeDocuments(paths)) {
      stemDictionary.delete(stem);
    }
    for (const docPath of paths) {
      const doc = documentCache.get(docPath);
      if (doc?.metadata.indexed) {
        this.addDocument(doc, invertedIndex, stemDictionary);
      }
    }
  }

  /** Rebuilds the inverted index and the stem dictionary from every document. */
  async updateInvertedIndexBatch(
    documentCache: Map<string, DocumentIndex>,
    invertedIndex: InvertedIndex,
    stemDictionary: Map<string, Set<string>>,
  ): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`🔗 Starting inverted index rebuild...`);

    try {
      this.logger.info(
        `🗑️ Clearing existing inverted index (${invertedIndex.size} terms)...`,
      );
      invertedIndex.clear();
      stemDictionary.clear();

      const allDocuments = Array.from(documentCache.values()).filter(
        (doc) => doc.metadata.indexed,
      );

      allDocuments.sort((a, b) => {
        const dateDiff = b.metadata.lastModified - a.metadata.lastModified;
        if (dateDiff !== 0) return dateDiff;
        return a.metadata.fileName.localeCompare(b.metadata.fileName);
      });

      this.logger.info(
        `🔄 Found ${allDocuments.length} indexed documents to process...`,
      );

      if (allDocuments.length === 0) {
        this.logger.info(`⚠️ No indexed documents found, nothing to process`);
        return;
      }

      let totalTermsProcessed = 0;
      let processedDocs = 0;
      let lastProgressTime = Date.now();

      for (const docIndex of allDocuments) {
        const docStartTime = Date.now();
        let docTermsProcessed = 0;

        try {
          docTermsProcessed = this.addDocument(
            docIndex,
            invertedIndex,
            stemDictionary,
          );

          totalTermsProcessed += docIndex.vocab.length;
          processedDocs++;

          const docProcessTime = Date.now() - docStartTime;

          if (processedDocs <= 5 || processedDocs % 10 === 0) {
            this.logger.info(
              `  📄 Doc ${processedDocs}/${allDocuments.length}: ${docIndex.metadata.fileName} (${docTermsProcessed} terms, ${docProcessTime}ms)`,
            );
          }

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
              `  💾 Index size: ${invertedIndex.size} unique terms, ${totalTermsProcessed} total term entries`,
            );
            this.logger.info(
              `  ⏱️ Elapsed: ${Math.round(elapsed / 1000)}s, Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
            );

            lastProgressTime = Date.now();
          }

          if (processedDocs % 10 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        } catch (docError) {
          this.logger.error(
            `  ❌ Error processing document ${docIndex.metadata.fileName}:`,
            docError,
          );
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
        `   - Unique terms: ${invertedIndex.size} (stems: ${stemDictionary.size})`,
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
      throw error;
    }
  }

  /**
   * Adds one document's postings and words to the index.
   * @returns how many terms it added
   */
  private addDocument(
    docIndex: DocumentIndex,
    invertedIndex: InvertedIndex,
    stemDictionary: Map<string, Set<string>>,
  ): number {
    const termPositions = new Map<string, number[]>();
    const vocabStemMap = new Array<string | null>(docIndex.vocab.length);

    for (let v = 0; v < docIndex.vocab.length; v++) {
      const term = docIndex.vocab[v];
      const normalized = this.textProcessor.tokenize(term)[0]?.normalized;

      if (!normalized) {
        vocabStemMap[v] = null;
        continue;
      }

      // REVIEW: the {isInflectedWordFormsAllowed} been used before
      const stemmedTerm = this.textProcessor.stemWord(normalized);

      vocabStemMap[v] = stemmedTerm;

      // A number has no other forms to look up: it is matched from its
      // postings alone (TermMatcher), so the dictionary holds words only
      if (isNumberTerm(stemmedTerm)) continue;
      if (!stemDictionary.has(stemmedTerm)) {
        stemDictionary.set(stemmedTerm, new Set());
      }
      stemDictionary.get(stemmedTerm)!.add(term);
    }

    for (let i = 0; i < docIndex.positions.length; i++) {
      const [vocabIndex] = docIndex.positions[i];
      const stemmedTerm = vocabStemMap[vocabIndex];

      if (!stemmedTerm) continue;

      if (!termPositions.has(stemmedTerm)) {
        termPositions.set(stemmedTerm, []);
      }
      termPositions.get(stemmedTerm)!.push(i);
    }

    termPositions.forEach((positions, stemmedTerm) => {
      invertedIndex.addEntry(
        stemmedTerm,
        docIndex.metadata.originalFilePath,
        positions,
      );
    });
    return termPositions.size;
  }
}
