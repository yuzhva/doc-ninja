import { BM25Scorer } from './bm25-scorer';
import { DocumentExtractor } from './document-parsers';
import { FileIndexer } from './file-indexer';
import { levenshtein } from './fuzzy';
import { UkrainianTextProcessor } from './text-processor';
import {
  DocumentIndex,
  HighlightInfo,
  InvertedIndexEntry,
  ProcessedSearchToken,
  SearchConfig,
} from './types';

type SearchOptions = {
  topN?: number;
  fuzzy?: boolean;
  fuzzyThreshold?: number;
  snippetsLimit?: number | 'ALL';
  page?: number; // Add pagination
  pageSize?: number; // Add page size
};

type PaginatedSearchResult = {
  results: Array<{
    doc: any;
    score: number;
    snippets: string[];
    highlights: HighlightInfo[];
  }>;
  pagination: PaginationInfo;
};

type PaginationInfo = {
  currentPage: number;
  totalPages: number;
  totalResults: number;
  resultsPerPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

class MegaSearch {
  private indexer: FileIndexer;
  private textProcessor: UkrainianTextProcessor;
  private bm25Scorer: BM25Scorer;

  constructor(private config: SearchConfig) {
    this.indexer = new FileIndexer(config);
    this.textProcessor = new UkrainianTextProcessor();

    // Initialize BM25 scorer with config or defaults
    this.bm25Scorer = new BM25Scorer({
      k1: config.bm25K1 ?? 1.2,
      b: config.bm25B ?? 0.75,
    });
  }

  async initialize(): Promise<void> {
    console.log('Initializing Mega Search system...');
    console.log(`Root directory: ${this.config.rootDirectory}`);
    console.log(`Supported extensions: ${this.config.extensions.join(', ')}`);
    console.log(
      `Ukrainian stemming: ${this.config.ukrainianStemming ? 'enabled' : 'disabled'}`,
    );
    console.log(
      `Scoring method: ${this.config.useBM25 !== false ? this.bm25Scorer.getScoringMethod() : 'TF-IDF'}`,
    );

    await this.indexer.buildFullIndex();

    // Calculate average document length for BM25
    if (this.config.useBM25 !== false) {
      const docCache = this.indexer.getDocumentCache(); // Now synchronous
      this.bm25Scorer.calculateAverageDocLength(docCache);
    }

    const stats = this.indexer.getStats();
    console.log(
      `Indexing complete: ${stats.documentsCount} documents, ${stats.termsCount} unique terms`,
    );
  }

  async reindex(): Promise<void> {
    await this.indexer.buildFullIndex();
  }

  getStats() {
    return this.indexer.getStats();
  }

  /**
   * Safe wrapper for getting search data with proper error handling
   */
  private getSearchData(): {
    docCache: Map<string, DocumentIndex>;
    invertedIndex: Map<string, InvertedIndexEntry[]>;
  } {
    try {
      const docCache = this.indexer.getDocumentCache(); // Now synchronous
      const invertedIndex = this.indexer.getInvertedIndex(); // Now synchronous

      if (!docCache || !invertedIndex) {
        throw new Error('Search indexes not properly initialized');
      }

      return { docCache, invertedIndex };
    } catch (error) {
      console.error(
        'Failed to get search data:',
        error instanceof Error ? error.message : String(error),
      );
      throw new Error('Search indexes are not available');
    }
  }

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<PaginatedSearchResult> {
    const {
      topN = 50,
      fuzzy = true,
      fuzzyThreshold = 1,
      snippetsLimit = 3,
      page = 1,
      pageSize = 10,
    } = options;

    // console.log(`[SEARCH] Starting search for query: "${query}"`);
    // console.log(`[SEARCH] Options:`, { topN, fuzzy, fuzzyThreshold, snippetsLimit });
    // console.log(`[SEARCH] Scoring method: ${this.config.useBM25 !== false ? this.bm25Scorer.getScoringMethod() : 'TF-IDF'}`);

    try {
      // Phrase search: detect if query is wrapped in quotes
      const phraseMatch = query.match(/^"(.*)"$/);
      const isPhrase = !!phraseMatch;
      const phrase = isPhrase ? phraseMatch[1] : null;

      // console.log(`[SEARCH] Phrase search: ${isPhrase}, phrase: "${phrase}"`);

      // Tokenize and stem the query
      const queryTokens = this.textProcessor
        .tokenize(isPhrase ? phrase! : query)
        .map((t) => this.textProcessor.stemWord(t.term));
      const uniqueQueryTokens = Array.from(new Set(queryTokens));

      // console.log(`[SEARCH] Query tokens:`, queryTokens);
      // console.log(`[SEARCH] Unique query tokens:`, uniqueQueryTokens);

      if (uniqueQueryTokens.length === 0) {
        console.log(`No valid tokens found in query: "${query}"`);
        return this.createEmptyResult(page, pageSize);
      }

      // Get index data safely
      const { docCache, invertedIndex } = this.getSearchData();
      const docCount = docCache.size;

      if (docCount === 0) {
        console.log('No documents found in index. Please run indexing first.');
        return this.createEmptyResult(page, pageSize);
      }

      // Score documents using BM25 or TF-IDF
      const docScores = new Map<string, number>();
      const useBM25 = this.config.useBM25 !== false;

      for (const term of uniqueQueryTokens) {
        let candidateTerms: string[] = [term];
        if (fuzzy && !isPhrase) {
          candidateTerms = Array.from(invertedIndex.keys()).filter(
            (idxTerm: string) => levenshtein(term, idxTerm) <= fuzzyThreshold,
          );
        }

        for (const idxTerm of candidateTerms) {
          const postings = invertedIndex.get(idxTerm);
          if (!postings) continue;

          const df = postings.length; // Document frequency

          for (const entry of postings) {
            const tf = entry.frequency; // Term frequency
            const doc = docCache.get(entry.documentId);

            if (!doc) continue;

            let score: number;

            if (useBM25) {
              score = this.bm25Scorer.calculateScore(
                tf,
                doc.wordCount,
                df,
                docCount,
              );
            } else {
              score = this.bm25Scorer.calculateTfIdfScore(tf, df, docCount);
            }

            docScores.set(
              entry.documentId,
              (docScores.get(entry.documentId) || 0) + score,
            );
          }
        }
      }

      // If phrase search, filter to only docs containing the exact phrase
      let filteredDocIds: string[] = Array.from(docScores.keys());
      if (isPhrase) {
        filteredDocIds = filteredDocIds.filter((docId) => {
          const doc = docCache.get(docId);
          if (!doc) return false;
          const docText = doc.tokens
            .map((t: ProcessedSearchToken) => t.term)
            .join(' ');
          const phraseText = queryTokens.join(' ');
          return docText.includes(phraseText);
        });
      }

      // Calculate pagination
      const totalResults = filteredDocIds.length;
      const totalPages = Math.ceil(totalResults / pageSize);
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;

      // Sort and paginate results
      const sortedResults = filteredDocIds
        .map((docId) => [docId, docScores.get(docId) || 0] as [string, number])
        .sort((a, b) => b[1] - a[1]);

      // Apply pagination
      const paginatedResults = sortedResults
        .slice(startIndex, endIndex)
        .map(([docId, score]) => {
          return this.processSearchResult(
            docId,
            score,
            docCache,
            uniqueQueryTokens,
            fuzzy,
            isPhrase,
            queryTokens,
            snippetsLimit,
          );
        });

      const pagination: PaginationInfo = {
        currentPage: page,
        totalPages,
        totalResults,
        resultsPerPage: pageSize,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      };

      console.log(
        `Found ${totalResults} results, returning page ${page}/${totalPages} (${paginatedResults.length} results)`,
      );

      return {
        results: paginatedResults,
        pagination,
      };
    } catch (error) {
      console.error(
        `Search failed for query "${query}":`,
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `Search operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Helper method to create empty result with proper pagination
   */
  private createEmptyResult(
    page: number,
    pageSize: number,
  ): PaginatedSearchResult {
    return {
      results: [],
      pagination: {
        currentPage: page,
        totalPages: 0,
        totalResults: 0,
        resultsPerPage: pageSize,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
  }

  /**
   * Process individual search result with proper error handling
   */
  private processSearchResult(
    docId: string,
    score: number,
    docCache: Map<string, DocumentIndex>,
    uniqueQueryTokens: string[],
    fuzzy: boolean,
    isPhrase: boolean,
    queryTokens: string[],
    snippetsLimit: number | 'ALL',
  ): {
    doc: any;
    score: number;
    snippets: string[];
    highlights: HighlightInfo[];
  } {
    const doc = docCache.get(docId);
    let snippets: string[] = [];
    let highlights: HighlightInfo[] = [];

    if (doc) {
      try {
        // Extract highlights with character positions
        uniqueQueryTokens.forEach((queryToken) => {
          doc.tokens.forEach((docToken: ProcessedSearchToken) => {
            const docTokenStem = this.textProcessor.stemWord(docToken.term);

            if (docTokenStem === queryToken) {
              highlights.push({
                term: queryToken,
                originalWord: docToken.term,
                charStart: docToken.charStart,
                charEnd: docToken.charEnd,
                confidence: fuzzy
                  ? this.calculateMatchConfidence(queryToken, docTokenStem)
                  : 1.0,
              });
            }
          });
        });

        const text = doc.tokens
          .map((t: ProcessedSearchToken) => t.term)
          .join(' ');

        if (isPhrase) {
          snippets = this.extractPhraseSnippets(text, queryTokens);
        } else {
          snippets = this.extractTokenSnippets(doc, uniqueQueryTokens);
        }

        // Limit snippets if not 'ALL'
        if (snippetsLimit !== 'ALL' && typeof snippetsLimit === 'number') {
          snippets = snippets.slice(0, snippetsLimit);
        }
      } catch (error) {
        console.error(
          `Error processing snippets for document ${doc.metadata.fileName}:`,
          error instanceof Error ? error.message : String(error),
        );
        // Continue with empty snippets rather than failing
      }
    } else {
      console.warn(`Document not found in cache: "${docId}"`);
    }

    return {
      doc: doc?.metadata,
      score,
      snippets,
      highlights,
    };
  }

  /**
   * Extract snippets for phrase search
   */
  private extractPhraseSnippets(text: string, queryTokens: string[]): string[] {
    const snippets: string[] = [];
    const phraseText = queryTokens.join(' ');

    let idx = 0;
    while ((idx = text.indexOf(phraseText, idx)) !== -1) {
      let rawSnippet = text.substring(
        Math.max(0, idx - 30),
        idx + phraseText.length + 40,
      );
      rawSnippet = rawSnippet.replace(
        new RegExp(phraseText, 'gi'),
        (match: string) => `<b>${match}</b>`,
      );
      snippets.push(rawSnippet + '...');
      idx += phraseText.length;
    }

    return snippets;
  }

  /**
   * Extract snippets for token-based search with paragraph awareness
   */
  private extractTokenSnippets(
    doc: DocumentIndex,
    uniqueQueryTokens: string[],
  ): string[] {
    const snippetSet = new Set<string>();

    uniqueQueryTokens.forEach((queryToken) => {
      doc.tokens.forEach(
        (docToken: ProcessedSearchToken, tokenIndex: number) => {
          const docTokenStem = this.textProcessor.stemWord(docToken.term);

          if (docTokenStem === queryToken) {
            // Find which paragraph contains this token
            const containingParagraph = doc.paragraphs?.find(
              (p) => tokenIndex >= p.tokenStart && tokenIndex < p.tokenEnd,
            );

            if (containingParagraph) {
              // Use paragraph as context (more natural than token windows)
              let rawSnippet = containingParagraph.content;

              // Highlight the matched term
              rawSnippet = rawSnippet.replace(
                new RegExp(`\\b${docToken.term}\\b`, 'gi'),
                (m: string) => `<b>${m}</b>`,
              );

              // Truncate if paragraph is too long
              if (rawSnippet.length > 300) {
                const matchPos = rawSnippet
                  .toLowerCase()
                  .indexOf(docToken.term.toLowerCase());
                const start = Math.max(0, matchPos - 150);
                const end = Math.min(rawSnippet.length, matchPos + 150);
                rawSnippet = '...' + rawSnippet.substring(start, end) + '...';
              }

              snippetSet.add(rawSnippet);
            } else {
              // Fallback to token-based context if no paragraph info
              const startPos = Math.max(0, tokenIndex - 8);
              const endPos = Math.min(doc.tokens.length, tokenIndex + 12);
              const contextTokens = doc.tokens.slice(startPos, endPos);

              let rawSnippet = contextTokens
                .map((t: ProcessedSearchToken) => t.term)
                .join(' ');
              rawSnippet = rawSnippet.replace(
                new RegExp(`\\b${docToken.term}\\b`, 'gi'),
                (m: string) => `<b>${m}</b>`,
              );

              snippetSet.add(rawSnippet + '...');
            }
          }
        },
      );
    });

    return Array.from(snippetSet);
  }

  private calculateMatchConfidence(
    queryTerm: string,
    matchedTerm: string,
  ): number {
    if (queryTerm === matchedTerm) return 1.0;

    // Use Levenshtein distance for confidence calculation
    const distance = levenshtein(queryTerm, matchedTerm);
    const maxLength = Math.max(queryTerm.length, matchedTerm.length);

    return Math.max(0, (maxLength - distance) / maxLength);
  }

  async testDocumentParsing(): Promise<void> {
    console.log('Testing document parsing...');

    const files = await this.indexer.discoverFiles();
    console.log(`Found ${files.length} files to test`);

    for (const file of files.slice(0, 5)) {
      // Test first 5 files
      try {
        console.log(`\n${'='.repeat(50)}`);
        console.log(
          `Testing: ${file.fileName} (${(file.size / 1024).toFixed(1)} KB)`,
        );
        console.log(`File path: ${file.filePath}`);

        const extractor = new DocumentExtractor();
        const startTime = Date.now();
        const text = await extractor.extractText(file.filePath);
        const extractionTime = Date.now() - startTime;

        console.log(
          `Extracted ${text.length} characters in ${extractionTime}ms`,
        );

        if (text.length > 0) {
          // Detect language
          const language = this.textProcessor.detectLanguage(text);
          console.log(`Detected language: ${language}`);

          const preview = text.substring(0, 300).replace(/\s+/g, ' ');
          console.log(`Preview: "${preview}${text.length > 300 ? '...' : ''}"`);

          // Test tokenization
          const tokens = this.textProcessor.tokenize(text);
          console.log(`Tokenized into ${tokens.length} tokens`);

          if (tokens.length > 0) {
            console.log(
              `First 15 tokens: ${tokens
                .slice(0, 15)
                .map((t) => t.term)
                .join(', ')}`,
            );

            // Show token statistics
            const uniqueTokens = new Set(tokens.map((t) => t.term));
            console.log(`Unique tokens: ${uniqueTokens.size}`);

            // Test stemming if enabled
            if (this.config.ukrainianStemming) {
              const stemmedSample = tokens
                .slice(0, 5)
                .map(
                  (t) => `${t.term} -> ${this.textProcessor.stemWord(t.term)}`,
                );
              console.log(`Stemming sample: ${stemmedSample.join(', ')}`);
            }

            // Show language-specific analysis
            const ukrainianTokens = tokens.filter((t) =>
              /[а-яїієґ]/.test(t.term),
            );
            const englishTokens = tokens.filter(
              (t) => /[a-z]/.test(t.term) && !/[а-яїієґ]/.test(t.term),
            );
            console.log(
              `Language breakdown: ${ukrainianTokens.length} Ukrainian, ${englishTokens.length} English tokens`,
            );
          }
        } else {
          console.log(
            '⚠️  No text extracted - this file might be corrupted or use unsupported encoding',
          );
        }
      } catch (error) {
        console.error(
          `❌ Failed to parse ${file.fileName}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log('Document parsing test completed');
  }
}

// Default configuration for Ukrainian document search
const defaultConfig: SearchConfig = {
  rootDirectory: './documents',
  extensions: ['.doc', '.docx', '.txt'],
  maxFileSize: 50 * 1024 * 1024, // 50MB
  concurrency: 4,
  ukrainianStemming: true,

  // BM25 scoring parameters (best practice values)
  useBM25: true,
  bm25K1: 1.2, // Good balance for term frequency saturation
  bm25B: 0.75, // Standard length normalization
};

// Main factory function
async function createMegaSearch(
  config: Partial<SearchConfig> = {},
): Promise<MegaSearch> {
  const finalConfig = { ...defaultConfig, ...config };
  const megaSearch = new MegaSearch(finalConfig);

  await megaSearch.initialize();
  return megaSearch;
}

// Legacy compatibility
async function createFileIndexer(
  config: Partial<SearchConfig> = {},
): Promise<FileIndexer> {
  const finalConfig = { ...defaultConfig, ...config };
  const indexer = new FileIndexer(finalConfig);
  return indexer;
}

// Test function for CLI usage
async function testMegaSearch(
  config: Partial<SearchConfig> = {},
): Promise<void> {
  const finalConfig = { ...defaultConfig, ...config };
  const megaSearch = new MegaSearch(finalConfig);

  // Test without full indexing first
  await megaSearch.testDocumentParsing();
}

export {
  createFileIndexer,
  createMegaSearch,
  defaultConfig,
  MegaSearch,
  testMegaSearch,
};

export type { SearchOptions };
