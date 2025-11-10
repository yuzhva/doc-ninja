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
  page?: number;
  pageSize?: number;
  fuzzyPhrase?: boolean; // Enable fuzzy phrase matching
  fuzzyPhraseMaxDistance?: number; // Max words between fuzzy phrase tokens
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
      fuzzyPhrase = false,
      fuzzyPhraseMaxDistance = 2,
    } = options;

    try {
      // Phrase search: detect if query is wrapped in quotes OR fuzzyPhrase is enabled
      const phraseMatch = query.match(/^"(.*)"$/);
      const isPhrase = !!phraseMatch || fuzzyPhrase;
      const phrase = phraseMatch ? phraseMatch[1] : fuzzyPhrase ? query : null;

      // Tokenize the query
      const rawTokens = this.textProcessor.tokenize(phrase || query);

      // For fuzzy phrase, we need both stemmed and original tokens
      const queryTokens = rawTokens.map((t) =>
        this.textProcessor.stemWord(t.term),
      );
      const originalTokens = rawTokens.map((t) => t.term.toLowerCase());

      // Use appropriate tokens based on search type
      const searchTokens =
        isPhrase && !fuzzyPhrase ? originalTokens : queryTokens;
      const uniqueQueryTokens = Array.from(new Set(queryTokens)); // Always use stemmed for indexing

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

      // Score documents using BM25 or TF-IDF (always use stemmed tokens for scoring)
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
        if (fuzzyPhrase) {
          // Fuzzy phrase matching - all tokens must appear close together with fuzzy variations
          filteredDocIds = filteredDocIds.filter((docId) => {
            const doc = docCache.get(docId);
            if (!doc) return false;

            return this.containsFuzzyPhrase(doc, originalTokens, {
              fuzzyThreshold,
              maxDistance: fuzzyPhraseMaxDistance,
            });
          });
        } else {
          // Exact phrase matching
          const phraseText = searchTokens.join(' ');
          filteredDocIds = filteredDocIds.filter((docId) => {
            const doc = docCache.get(docId);
            if (!doc) return false;

            const docText = doc.tokens
              .map((t: ProcessedSearchToken) => t.term.toLowerCase())
              .join(' ');

            return docText.includes(phraseText);
          });
        }
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
            fuzzyPhrase ? originalTokens : searchTokens,
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
   * Check if document contains fuzzy phrase - all tokens must appear close together
   * with fuzzy matching enabled for each token
   */
  private containsFuzzyPhrase(
    doc: DocumentIndex,
    queryTokens: string[],
    options: {
      fuzzyThreshold: number;
      maxDistance: number;
    },
  ): boolean {
    if (queryTokens.length === 0) return false;
    if (queryTokens.length === 1) {
      // Single token - just check fuzzy match
      return doc.tokens.some(
        (docToken) =>
          levenshtein(docToken.term.toLowerCase(), queryTokens[0]) <=
          options.fuzzyThreshold,
      );
    }

    // Find all possible fuzzy matches for each query token
    const tokenMatches = queryTokens.map((queryToken) => {
      const matches: Array<{
        token: ProcessedSearchToken;
        position: number;
        distance: number;
      }> = [];

      doc.tokens.forEach((docToken, position) => {
        const distance = levenshtein(docToken.term.toLowerCase(), queryToken);
        if (distance <= options.fuzzyThreshold) {
          matches.push({ token: docToken, position, distance });
        }
      });

      return matches;
    });

    // Check if any token has no matches
    if (tokenMatches.some((matches) => matches.length === 0)) {
      return false;
    }

    // Try to find a sequence where all tokens appear within maxDistance of each other
    return this.findFuzzyPhraseSequence(tokenMatches, options.maxDistance);
  }

  /**
   * Find if there's a valid sequence of fuzzy matches within the distance limit
   */
  private findFuzzyPhraseSequence(
    tokenMatches: Array<
      Array<{ token: ProcessedSearchToken; position: number; distance: number }>
    >,
    maxDistance: number,
  ): boolean {
    // Start with matches for the first token
    const firstTokenMatches = tokenMatches[0];

    for (const firstMatch of firstTokenMatches) {
      if (
        this.canCompleteSequence(
          firstMatch.position,
          tokenMatches,
          1,
          maxDistance,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Recursively check if we can complete the fuzzy phrase sequence
   */
  private canCompleteSequence(
    currentPosition: number,
    tokenMatches: Array<
      Array<{ token: ProcessedSearchToken; position: number; distance: number }>
    >,
    tokenIndex: number,
    maxDistance: number,
  ): boolean {
    // Base case - we've matched all tokens
    if (tokenIndex >= tokenMatches.length) {
      return true;
    }

    // Try each possible match for the current token
    const currentTokenMatches = tokenMatches[tokenIndex];

    for (const match of currentTokenMatches) {
      // Check if this match is within acceptable distance from the current position
      const distance = Math.abs(match.position - currentPosition);

      if (distance <= maxDistance && match.position > currentPosition) {
        // This match is valid, try to complete the rest of the sequence
        if (
          this.canCompleteSequence(
            match.position,
            tokenMatches,
            tokenIndex + 1,
            maxDistance,
          )
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Extract snippets for fuzzy phrase search
   */
  private extractFuzzyPhraseSnippets(
    doc: DocumentIndex,
    queryTokens: string[],
    fuzzyThreshold: number,
    maxDistance: number,
  ): string[] {
    const snippets: string[] = [];

    // Find fuzzy phrase matches and extract context
    const tokenMatches = queryTokens.map((queryToken) => {
      return doc.tokens
        .map((docToken, position) => ({ docToken, position }))
        .filter(
          ({ docToken }) =>
            levenshtein(docToken.term.toLowerCase(), queryToken) <=
            fuzzyThreshold,
        );
    });

    // Find valid sequences and create snippets
    const firstTokenMatches = tokenMatches[0] || [];

    for (const firstMatch of firstTokenMatches) {
      const sequence = this.findBestSequence(
        firstMatch.position,
        tokenMatches,
        maxDistance,
      );

      if (sequence.length === queryTokens.length) {
        // Found a complete sequence, create snippet
        const startPos = Math.min(...sequence.map((s) => s.position));
        const endPos = Math.max(...sequence.map((s) => s.position));

        const snippetStart = Math.max(0, startPos - 5);
        const snippetEnd = Math.min(doc.tokens.length, endPos + 6);

        let snippet = doc.tokens
          .slice(snippetStart, snippetEnd)
          .map((t) => t.term)
          .join(' ');

        // Highlight the matched tokens
        sequence.forEach((match) => {
          const token = match.docToken.term;
          snippet = snippet.replace(
            new RegExp(`\\b${token}\\b`, 'gi'),
            `<b>${token}</b>`,
          );
        });

        snippets.push(snippet + '...');
      }
    }

    return Array.from(new Set(snippets)); // Remove duplicates
  }

  /**
   * Find the best sequence of fuzzy matches starting from a position
   */
  private findBestSequence(
    startPosition: number,
    tokenMatches: Array<
      Array<{ docToken: ProcessedSearchToken; position: number }>
    >,
    maxDistance: number,
  ): Array<{ docToken: ProcessedSearchToken; position: number }> {
    const sequence = [
      { docToken: tokenMatches[0][0].docToken, position: startPosition },
    ];
    let currentPosition = startPosition;

    for (let i = 1; i < tokenMatches.length; i++) {
      const candidates = tokenMatches[i]
        .filter(
          (match) =>
            match.position > currentPosition &&
            Math.abs(match.position - currentPosition) <= maxDistance,
        )
        .sort(
          (a, b) =>
            Math.abs(a.position - currentPosition) -
            Math.abs(b.position - currentPosition),
        );

      if (candidates.length > 0) {
        sequence.push(candidates[0]);
        currentPosition = candidates[0].position;
      }
    }

    return sequence;
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
    searchTokens: string[], // Changed from queryTokens to be more generic
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
        if (isPhrase && fuzzy) {
          // For fuzzy phrase, find all fuzzy matches
          searchTokens.forEach((queryToken) => {
            doc.tokens.forEach((docToken: ProcessedSearchToken) => {
              const distance = levenshtein(
                docToken.term.toLowerCase(),
                queryToken,
              );
              if (distance <= 2) {
                // Use higher threshold for phrase fuzzy matching
                highlights.push({
                  term: queryToken,
                  originalWord: docToken.term,
                  charStart: docToken.charStart,
                  charEnd: docToken.charEnd,
                  confidence:
                    distance === 0 ? 1.0 : Math.max(0.5, 1.0 - distance * 0.2),
                });
              }
            });
          });
        } else {
          // Regular highlight extraction for non-fuzzy phrase searches
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
        }

        const text = doc.tokens
          .map((t: ProcessedSearchToken) => t.term)
          .join(' ');

        if (isPhrase) {
          if (fuzzy) {
            // Use fuzzy phrase snippet extraction - THIS WAS MISSING!
            snippets = this.extractFuzzyPhraseSnippets(doc, searchTokens, 2, 2);
          } else {
            snippets = this.extractPhraseSnippets(text, searchTokens);
          }
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
  private extractPhraseSnippets(
    text: string,
    searchTokens: string[],
  ): string[] {
    const snippets: string[] = [];
    const phraseText = searchTokens.join(' ');

    // Case-insensitive search for phrase
    const lowerText = text.toLowerCase();
    const lowerPhrase = phraseText.toLowerCase();

    let idx = 0;
    while ((idx = lowerText.indexOf(lowerPhrase, idx)) !== -1) {
      let rawSnippet = text.substring(
        Math.max(0, idx - 30),
        idx + phraseText.length + 40,
      );

      // Highlight the matched phrase (preserve original case in snippet)
      const actualPhrase = text.substring(idx, idx + phraseText.length);
      rawSnippet = rawSnippet.replace(actualPhrase, `<b>${actualPhrase}</b>`);

      snippets.push(rawSnippet + '...');
      idx += phraseText.length;
    }

    return snippets;
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
