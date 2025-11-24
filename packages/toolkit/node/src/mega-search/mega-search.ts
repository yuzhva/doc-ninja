import { BM25Scorer } from './bm25-scorer';
import { DocumentExtractor } from './document-parsers';
import { FileIndexer } from './file-indexer';
import { levenshtein } from './fuzzy';
import { createLogger } from './shared/logger';
import { UkrainianTextProcessor } from './text-processor';
import {
  DocumentIndex,
  GlobalIndex,
  HighlightInfo,
  InvertedIndexEntry,
  ProcessedSearchToken,
  SearchConfig,
  SnippetInfo,
} from './types';

const logger = createLogger('MegaSearch');

type SearchOptions = {
  /**
   * Max number of results to return (default: 50).
   * Used for internal scoring limits before pagination.
   */
  topN?: number;

  /**
   * Enable fuzzy matching for individual terms (default: true).
   * Allows finding "apple" when searching for "aple".
   */
  fuzzy?: boolean;

  /**
   * Max Levenshtein distance for fuzzy matching (default: 1).
   * 1 means one character difference (insertion, deletion, substitution).
   * Increase to 2 for longer words or more typos.
   */
  fuzzyThreshold?: number;

  /**
   * Number of snippets to generate per document (default: 3).
   * Set to 'ALL' to get all occurrences.
   */
  snippetsLimit?: number | 'ALL';

  /**
   * Page number for pagination (1-based, default: 1).
   */
  page?: number;

  /**
   * Number of results per page (default: 10).
   */
  pageSize?: number;

  /**
   * Enable fuzzy matching *within* phrase searches (default: false).
   * Essential for finding "richi cars" when searching "rich car".
   * If false, phrases require exact word matches (modulo stemming).
   */
  fuzzyPhrase?: boolean;

  /**
   * Max distance between words in a fuzzy phrase (default: 2).
   * 1 = Strict adjacency (words must be next to each other).
   * 2 = Allows 1 word in between (e.g. "richi [middle] cars").
   * To preserve strict order like "Word1 Word2", set this to 1.
   */
  fuzzyPhraseMaxDistance?: number;

  /**
   * Sort results by 'relevance' (default) or 'date' (from filename).
   */
  sortBy?: 'relevance' | 'date';

  /**
   * Sort order: 'asc' (oldest first) or 'desc' (newest first). Default: 'desc'.
   */
  sortOrder?: 'asc' | 'desc';

  /**
   * Regex pattern to extract date from filename.
   * Must have 3 capturing groups: (Day, Month, Year).
   * Default handles: DD.MM.YYYY, DD-MM-YY, etc.
   */
  filenameDatePattern?: string;
};

type PaginatedSearchResult = {
  results: Array<{
    doc: any;
    score: number;
    snippets: SnippetInfo[];
    highlights: HighlightInfo[];
  }>;
  pagination: PaginationInfo;
};

type PaginationInfo = {
  currentPage: number;
  totalPages: number;
  totalResults: number;
  totalMatches: number;
  resultsPerPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

class MegaSearch {
  private fileIndexer: FileIndexer;
  private textProcessor: UkrainianTextProcessor;
  private bm25Scorer: BM25Scorer;
  private stemDictionary = new Map<string, string[]>(); // STAGE 1

  // ADD: Query preprocessing cache
  private queryCache = new Map<
    string,
    {
      queryTokens: string[];
      originalTokens: string[];
      uniqueQueryTokens: string[];
      // searchTokens removed as it was redundant
      isPhrase: boolean;
      timestamp: number;
    }
  >();
  private readonly QUERY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_QUERY_CACHE_SIZE = 1000;

  // ✅ NEW: Search result caching to speed up frequent queries
  private searchCache = new Map<string, PaginatedSearchResult>();
  private readonly MAX_SEARCH_CACHE_SIZE = 100;

  constructor(private config: SearchConfig) {
    this.fileIndexer = new FileIndexer(config);
    this.textProcessor = new UkrainianTextProcessor();

    // Initialize BM25 scorer with config or defaults
    this.bm25Scorer = new BM25Scorer({
      k1: config.bm25K1 ?? 1.2,
      b: config.bm25B ?? 0.75,
    });
  }

  /**
   * ✅ NEW: Helper to rehydrate a token object from the compact index on demand.
   * This avoids storing millions of token objects in memory.
   */
  private getDocumentToken(
    doc: DocumentIndex,
    position: number,
  ): ProcessedSearchToken | null {
    if (position < 0 || position >= doc.positions.length) {
      return null;
    }
    const [vocabIndex, charStart, charEnd] = doc.positions[position];
    const term = doc.vocab[vocabIndex];

    // The `normalized` property is not stored to save space, but can be recreated if needed.
    // For most search operations, we use the stemmed version anyway.
    return {
      term,
      position,
      charStart,
      charEnd,
      normalized: term.toLowerCase(), // A reasonable approximation for on-the-fly use.
    };
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Mega Search system...');
    logger.debug(`Root directory: ${this.config.rootDirectory}`);
    logger.debug(`Supported extensions: ${this.config.extensions.join(', ')}`);
    logger.debug(
      `Ukrainian stemming: ${this.config.ukrainianStemming ? 'enabled' : 'disabled'}`,
    );
    logger.debug(
      `Scoring method: ${this.config.useBM25 !== false ? this.bm25Scorer.getScoringMethod() : 'TF-IDF'}`,
    );

    const startTime = Date.now();

    await this.fileIndexer.buildFullIndex();

    // Calculate average document length for BM25
    if (this.config.useBM25 !== false) {
      const docCache = this.fileIndexer.getDocumentCache();
      this.bm25Scorer.calculateAverageDocLength(docCache);
    }

    // ✅ Pre-warm search caches for better performance (with safe check)
    try {
      if (
        this.fileIndexer.preWarmSearchCaches &&
        typeof this.fileIndexer.preWarmSearchCaches === 'function'
      ) {
        /*
         * Pre-warming means loading frequently-used data into memory before it's actually needed,
         * so the first searches don't have "cold cache" penalties.
         *
         * Positive Effects:
         *  ✅ Faster first searches - no "cold start" delay
         *  ✅ Predictable performance - consistent response times
         *  ✅ Better user experience - immediate responsiveness
         *
         *  Negative Effects:
         *  ⚠️ Longer startup time - system takes more time to initialize
         *  ⚠️ Higher memory usage - more RAM consumed upfront
         *  ⚠️ Potential startup failures - if pre-warming fails, could break initialization
         *
         * Without Pre-warming:
         *   First search:  800ms (cache miss penalty)
         *   Second search: 150ms (cache hit)
         *   Third search:  145ms (cache hit)
         *
         * With Pre-warming:
         *   Startup: +2000ms (pre-warming cost)
         *   First search:  150ms (cache hit)
         *   Second search: 145ms (cache hit)
         *   Third search:  140ms (cache hit)
         */
        await this.fileIndexer.preWarmSearchCaches();
      }
    } catch (error) {
      logger.warn('⚠️ Failed to pre-warm search caches:', error);
      // Continue without pre-warming - it's an optimization, not critical
    }

    const stats = this.fileIndexer.getStats();
    const indexTime = Date.now() - startTime;

    logger.info(
      `✅ Indexing complete: ${stats.documentsCount} documents, ${stats.termsCount} unique terms (${indexTime}ms)`,
    );

    // Log memory usage
    const memStats = this.fileIndexer.getMemoryStats?.();
    if (memStats) {
      logger.info(
        `💾 Memory usage: ${memStats.heap.used}MB heap, ${memStats.rss}MB RSS`,
      );
    }
  }

  async reindex(): Promise<void> {
    const startTime = Date.now();
    logger.info('Starting re-indexing...');
    await this.fileIndexer.buildFullIndex();
    logger.info(`Re-indexing completed in ${Date.now() - startTime}ms`);
  }

  getStats() {
    const baseStats = this.fileIndexer.getStats();
    const memStats = this.fileIndexer.getMemoryStats?.() || null;

    return {
      ...baseStats,
      memory: memStats,
    };
  }

  /**
   * Get the indexer instance for advanced operations
   */
  get indexer(): FileIndexer {
    return this.fileIndexer; // ✅ Updated to return the private property
  }

  /**
   * Get from query cache with TTL check
   */
  private getFromQueryCache(key: string) {
    const cached = this.queryCache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.QUERY_CACHE_TTL) {
      this.queryCache.delete(key);
      return null;
    }

    return cached;
  }

  /**
   * Set in query cache with size limit
   */
  private setInQueryCache(key: string, data: any) {
    // Clean old entries if cache is full
    if (this.queryCache.size >= this.MAX_QUERY_CACHE_SIZE) {
      const oldestKey = Array.from(this.queryCache.keys())[0];
      this.queryCache.delete(oldestKey);
    }

    this.queryCache.set(key, data);
  }

  /**
   * Safe wrapper for getting search data with proper error handling
   */
  private getSearchData(): {
    docCache: Map<string, DocumentIndex>;
    invertedIndex: Map<string, InvertedIndexEntry[]>;
    stemDictionary: Map<string, string[]>;
  } {
    try {
      const { docCache, invertedIndex, stemDictionary } =
        this.fileIndexer.getSearchDataOptimized();

      if (!docCache || !invertedIndex || !stemDictionary) {
        throw new Error('Search indexes not properly initialized');
      }

      return { docCache, invertedIndex, stemDictionary };
    } catch (error) {
      logger.error(
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
    const searchStartTime = Date.now();
    // Cast options to any to support new sorting parameters not yet in the interface
    const opts = options as any;
    const {
      topN = 50,
      fuzzy = true,
      fuzzyThreshold = 1,
      snippetsLimit = 3,
      page = 1,
      pageSize = 10,
      fuzzyPhrase = false,
      fuzzyPhraseMaxDistance = 2,
      sortBy = 'relevance',
      sortOrder = 'desc',
      filenameDatePattern,
    } = opts;

    // ✅ FIX: Create a comprehensive cache key that includes all options.
    const cacheKey = JSON.stringify({ query, options });

    // CHECK search result cache
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      logger.info(`📋 Using cached search result for: "${query}"`);
      logger.info(
        `Search completed in ${Date.now() - searchStartTime}ms (from cache)`,
      );
      return cached;
    }

    try {
      // CREATE cache key for tokenization part
      const tokenizationCacheKey = `${query}|${fuzzyPhrase}`;

      // CHECK query cache first
      let queryData = this.getFromQueryCache(tokenizationCacheKey);

      if (!queryData) {
        const tokenizationStartTime = Date.now();
        // Phrase search: detect if query is wrapped in quotes OR fuzzyPhrase is enabled
        const phraseMatch = query.match(/^"(.*)"$/);
        const isPhrase = !!phraseMatch || fuzzyPhrase;
        const phrase = phraseMatch
          ? phraseMatch[1]
          : fuzzyPhrase
            ? query
            : null;

        // Tokenize the query
        const rawTokens = this.textProcessor.tokenize(phrase || query);

        // For fuzzy phrase, we need both stemmed and original tokens
        const queryTokens = rawTokens.map((t) =>
          this.textProcessor.stemWord(t.term),
        );
        const originalTokens = rawTokens.map((t) => t.term.toLowerCase());

        // Use appropriate tokens based on search type
        const uniqueQueryTokens = Array.from(new Set(queryTokens));

        queryData = {
          queryTokens,
          originalTokens,
          uniqueQueryTokens,
          isPhrase,
          timestamp: Date.now(),
        };

        // CACHE the processed query
        this.setInQueryCache(tokenizationCacheKey, queryData);
        logger.debug(
          `Tokenization completed in ${Date.now() - tokenizationStartTime}ms`,
        );
      }

      if (queryData.uniqueQueryTokens.length === 0) {
        logger.info(`No valid tokens found in query: "${query}"`);
        return this.createEmptyResult(page, pageSize);
      }

      // Get index data safely
      const { docCache, invertedIndex, stemDictionary } = this.getSearchData();
      const docCount = docCache.size;

      if (docCount === 0) {
        logger.info('No documents found in index. Please run indexing first.');
        return this.createEmptyResult(page, pageSize);
      }

      // Score documents using BM25 or TF-IDF (always use stemmed tokens for scoring)
      const docScores = new Map<string, number>(); // Track amount of document scores
      const docMatchCounts = new Map<string, number>(); // Track match counts per document
      const useBM25 = this.config.useBM25 !== false;

      // If phrase search, filter to only docs containing the exact phrase
      let filteredDocIds: string[];
      // STAGE 3: Store match positions to pass to snippet generator
      const phraseMatches = new Map<string, number[][]>();

      if (queryData.isPhrase) {
        const phraseFilterStartTime = Date.now();

        if (fuzzyPhrase) {
          // STAGE 2: Index-based fuzzy phrase search
          const matches = this.findDocsWithFuzzyPhrase(
            queryData.originalTokens,
            { fuzzyThreshold, maxDistance: fuzzyPhraseMaxDistance },
            invertedIndex,
            stemDictionary,
            docCache, // ✅ PASS docCache for verification
          );
          filteredDocIds = Array.from(matches.keys());
          matches.forEach((value, key) => {
            phraseMatches.set(key, value);
            docMatchCounts.set(key, value.length); // ✅ Track phrase match counts
          });
        } else {
          // ✅ OPTIMIZATION: Use a much faster token-based check instead of string matching.
          const candidateDocIds = this.getCandidateDocsForPhrase(
            queryData.queryTokens, // ✅ FIXED: Use stemmed tokens
            invertedIndex,
          );
          filteredDocIds = candidateDocIds.filter((docId) => {
            const doc = docCache.get(docId);
            if (!doc) return false;

            // ✅ Use countExactPhrase to get accurate match count
            const count = this.countExactPhrase(
              doc,
              queryData.queryTokens, // Stemmed tokens
            );

            if (count > 0) {
              docMatchCounts.set(docId, count);
              // ✅ RELEVANCE BOOST: Apply a score boost for exact phrase matches.
              const currentScore = docScores.get(docId) || 0;
              docScores.set(docId, currentScore * 1.5); // 50% score boost
              return true;
            }
            return false;
          });
        }
        logger.debug(
          `Phrase filtering completed in ${Date.now() - phraseFilterStartTime}ms. ${filteredDocIds.length} documents remaining.`,
        );

        // STAGE 2: Score only the documents that passed the phrase filter
        const scoringStartTime = Date.now();
        for (const docId of filteredDocIds) {
          let score = 0;
          const doc = docCache.get(docId);
          if (!doc) continue;

          for (const term of queryData.uniqueQueryTokens) {
            const tf = doc.termFrequency.get(term) || 0;
            if (tf === 0) continue;

            const postings = invertedIndex.get(term);
            const df = postings ? postings.length : 0;
            if (df === 0) continue;

            if (useBM25) {
              score += this.bm25Scorer.calculateScore(
                tf,
                doc.wordCount,
                df,
                docCount,
              );
            } else {
              score += this.bm25Scorer.calculateTfIdfScore(tf, df, docCount);
            }
          }
          docScores.set(docId, score);
        }
        logger.debug(
          `Scoring ${docScores.size} documents completed in ${Date.now() - scoringStartTime}ms`,
        );
      } else {
        // Original logic for non-phrase search
        const scoringStartTime = Date.now();
        for (const term of queryData.uniqueQueryTokens) {
          let candidateTerms: string[] = [term];
          if (fuzzy) {
            // STAGE 1: Use stemDictionary for blazing-fast candidate lookup
            const candidates = stemDictionary.get(term);
            if (candidates) {
              // ✅ FIX: If we have exact stem matches, just use the stem.
              // The previous logic tried to filter original words and look them up in the stemmed index, which failed.
              candidateTerms = [term];
            } else {
              // Fallback for terms not in dictionary (e.g., misspellings)
              candidateTerms = Array.from(invertedIndex.keys()).filter(
                (idxTerm: string) =>
                  levenshtein(term, idxTerm) <= fuzzyThreshold,
              );
            }
          }

          for (const idxTerm of candidateTerms) {
            const postings = invertedIndex.get(idxTerm);
            if (!postings) continue;

            const df = postings.length; // Document frequency

            if (!Array.isArray(postings)) {
              logger.warn(`Invalid postings for term "${idxTerm}". Skipping.`);
              continue;
            }

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

              // ✅ Track match counts for normal search
              docMatchCounts.set(
                entry.documentId,
                (docMatchCounts.get(entry.documentId) || 0) + entry.frequency,
              );
            }
          }
        }
        logger.debug(
          `Scoring ${docScores.size} documents completed in ${Date.now() - scoringStartTime}ms`,
        );
        filteredDocIds = Array.from(docScores.keys());
      }

      // Calculate pagination
      const totalResults = filteredDocIds.length;
      // ✅ Calculate total matches across all found documents
      const totalMatches = filteredDocIds.reduce(
        (sum, docId) => sum + (docMatchCounts.get(docId) || 0),
        0,
      );

      // ✅ DEBUG: Log total results to help debug "off by one" issues
      logger.debug(
        `Found ${totalResults} documents with ${totalMatches} total matches for query: "${query}"`,
      );

      const totalPages = Math.ceil(totalResults / pageSize);
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;

      // Sort and paginate results
      const sortStartTime = Date.now();

      // Pre-calculate dates if sorting by date to avoid repeated regex parsing inside sort (O(N) vs O(N log N))
      const docDates = new Map<string, number>();
      if (sortBy === 'date') {
        for (const docId of filteredDocIds) {
          const doc = docCache.get(docId);
          docDates.set(
            docId,
            doc
              ? this.extractDateFromFilename(
                  doc.metadata.fileName,
                  filenameDatePattern,
                )
              : 0,
          );
        }
      }

      const sortedResults = filteredDocIds
        .map((docId) => [docId, docScores.get(docId) || 0] as [string, number])
        .sort((a, b) => {
          const [docIdA, scoreA] = a;
          const [docIdB, scoreB] = b;

          if (sortBy === 'date') {
            const dateA = docDates.get(docIdA) || 0;
            const dateB = docDates.get(docIdB) || 0;

            // Primary sort: Date
            const diff = sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
            if (diff !== 0) return diff;

            // Secondary sort: Relevance (always descending)
            return scoreB - scoreA;
          }

          // Default: Relevance
          // If scores are equal, sort by docId for stability
          const scoreDiff =
            sortOrder === 'asc' ? scoreA - scoreB : scoreB - scoreA;
          return scoreDiff !== 0 ? scoreDiff : docIdA.localeCompare(docIdB);
        });

      logger.debug(
        `Sorting results by ${sortBy} (${sortOrder}) completed in ${Date.now() - sortStartTime}ms`,
      );

      // Apply pagination
      const snippetGenerationStartTime = Date.now();
      const paginatedResults = sortedResults
        .slice(startIndex, endIndex)
        .map(([docId, score]) => {
          return this.processSearchResult(
            docId,
            score,
            docCache,
            invertedIndex,
            queryData.uniqueQueryTokens,
            fuzzy,
            queryData.isPhrase,
            // ✅ FIX: Pass stemmed tokens for exact phrase snippet extraction
            fuzzyPhrase ? queryData.originalTokens : queryData.queryTokens,
            snippetsLimit,
            phraseMatches.get(docId), // STAGE 3: Pass match positions
          );
        });
      logger.debug(
        `Snippet generation for ${paginatedResults.length} results completed in ${Date.now() - snippetGenerationStartTime}ms`,
      );

      const pagination: PaginationInfo = {
        currentPage: page,
        totalPages,
        totalResults,
        totalMatches,
        resultsPerPage: pageSize,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      };

      logger.debug(
        `Found ${totalResults} results, returning page ${page}/${totalPages} (${paginatedResults.length} results)`,
      );

      const result = {
        results: paginatedResults,
        pagination,
      };

      // CACHE the result
      if (this.searchCache.size >= this.MAX_SEARCH_CACHE_SIZE) {
        const oldestKey = Array.from(this.searchCache.keys())[0];
        this.searchCache.delete(oldestKey);
      }
      this.searchCache.set(cacheKey, result);

      logger.debug(`Search completed in ${Date.now() - searchStartTime}ms`);
      return result;
    } catch (error) {
      logger.error(
        `Search failed for query "${query}":`,
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `Search operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * ✅ NEW: Helper to extract date from filename for chronological sorting
   */
  private extractDateFromFilename(
    filename: string,
    customPattern?: string,
  ): number {
    try {
      // Default pattern matches DD.MM.YYYY or DD.MM.YY or D.M.YY with separators . / -
      // Captures: 1=Day, 2=Month, 3=Year
      // The (?:^|\D) ensures we don't match the middle of a number, but allows start of string or non-digit prefix
      const defaultPattern =
        /(?:^|\D)(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\D|$)/;
      const regex = customPattern ? new RegExp(customPattern) : defaultPattern;

      const match = filename.match(regex);
      if (!match) return 0; // No date found

      // Assuming the pattern captures (Day, Month, Year) in groups 1, 2, 3
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      let year = parseInt(match[3], 10);

      // Handle 2-digit years
      if (year < 100) {
        // Simple heuristic: if year is between 00-50 -> 2000-2050
        // if year is 51-99 -> 1951-1999
        // This covers the user's "25" -> 2025 case
        year += year < 50 ? 2000 : 1900;
      }

      // Validate date components
      if (month < 1 || month > 12 || day < 1 || day > 31) return 0;

      return new Date(year, month - 1, day).getTime();
    } catch (e) {
      return 0;
    }
  }

  /**
   * ✅ NEW: Efficiently count exact phrase occurrences
   */
  private countExactPhrase(doc: DocumentIndex, queryTokens: string[]): number {
    let count = 0;
    const phraseLength = queryTokens.length;
    if (phraseLength === 0) return 0;

    for (let i = 0; i <= doc.positions.length - phraseLength; i++) {
      let match = true;
      for (let j = 0; j < phraseLength; j++) {
        const docToken = this.getDocumentToken(doc, i + j);
        // ✅ FIX: Stem document token to match stemmed query tokens (handles declensions)
        if (
          !docToken ||
          this.textProcessor.stemWord(docToken.term) !== queryTokens[j]
        ) {
          match = false;
          break;
        }
      }
      if (match) {
        count++;
      }
    }
    return count;
  }

  /**
   * STAGE 2: Get candidate documents for a phrase search by finding the intersection
   * of documents containing each term.
   */
  private getCandidateDocsForPhrase(
    queryTokens: string[],
    invertedIndex: Map<string, InvertedIndexEntry[]>,
  ): string[] {
    if (queryTokens.length === 0) return [];

    const docSets = queryTokens.map((token) => {
      const postings = invertedIndex.get(token) || [];
      return new Set(postings.map((p) => p.documentId));
    });

    if (docSets.length === 0) return [];

    // Intersect all sets
    let intersection = docSets[0];
    for (let i = 1; i < docSets.length; i++) {
      intersection = new Set(
        [...intersection].filter((docId) => docSets[i].has(docId)),
      );
    }

    return Array.from(intersection);
  }

  /**
   * STAGE 2: New index-based fuzzy phrase search.
   * This replaces the slow, document-scanning `containsFuzzyPhrase`.
   */
  private findDocsWithFuzzyPhrase(
    queryTokens: string[],
    options: { fuzzyThreshold: number; maxDistance: number },
    invertedIndex: Map<string, InvertedIndexEntry[]>,
    stemDictionary: Map<string, string[]>,
    docCache: Map<string, DocumentIndex>, // ✅ NEW ARGUMENT
  ): Map<string, number[][]> {
    // STAGE 3: Return map with positions
    if (queryTokens.length === 0) return new Map();

    // 1. Find all fuzzy matching terms for each query token
    const termCandidatesPerQueryToken = queryTokens.map((queryToken) => {
      const stem = this.textProcessor.stemWord(queryToken);

      // ✅ FIX: Don't filter by Levenshtein for exact stem matches.
      // Grammatical variations (e.g. "ГЛУХИЙ" vs "ГЛУХОГО") have the same stem
      // but can have large Levenshtein distance. We want to keep them.
      const candidates = stemDictionary.get(stem) || [];

      return candidates;
    });

    // 2. Get document sets for each query token
    const docSets = termCandidatesPerQueryToken.map((candidates) => {
      const docIds = new Set<string>();
      for (const candidateWord of candidates) {
        // ✅ FIX: Stem the candidate word before looking up in inverted index
        const stem = this.textProcessor.stemWord(candidateWord);
        const postings = invertedIndex.get(stem);
        if (postings) {
          for (const p of postings) {
            docIds.add(p.documentId);
          }
        }
      }
      return docIds;
    });

    // 3. Find intersection of documents that contain a match for ALL query tokens
    if (docSets.some((s) => s.size === 0)) return [];
    let candidateDocIds = docSets[0];
    for (let i = 1; i < docSets.length; i++) {
      candidateDocIds = new Set(
        [...candidateDocIds].filter((docId) => docSets[i].has(docId)),
      );
    }

    // 4. For the small set of candidate documents, verify the phrase sequence
    const finalDocs = new Map<string, number[][]>(); // STAGE 3
    for (const docId of candidateDocIds) {
      const doc = docCache.get(docId);
      if (!doc) continue;

      // For each query token, get all positions of its fuzzy matches in this doc
      const matchesByToken = termCandidatesPerQueryToken.map((candidates) => {
        const positions: number[] = [];
        for (const candidateWord of candidates) {
          const stem = this.textProcessor.stemWord(candidateWord);
          const postings = invertedIndex.get(stem);
          const docPosting = postings?.find((p) => p.documentId === docId);

          if (docPosting) {
            for (const pos of docPosting.positions) {
              const actualWord = doc.vocab[doc.positions[pos][0]];
              if (actualWord.toLowerCase() === candidateWord) {
                positions.push(pos);
              }
            }
          }
        }
        return positions.sort((a, b) => a - b); // Sort positions numerically
      });

      const sequences = this.findSequencesInPositions(
        // STAGE 3
        matchesByToken,
        options.maxDistance,
      );
      if (sequences.length > 0) {
        finalDocs.set(docId, sequences); // STAGE 3
      }
    }

    return finalDocs; // STAGE 3
  }

  /**
   * STAGE 3: Helper to find all valid sequences in pre-fetched position arrays.
   * This replaces the boolean check.
   */
  private findSequencesInPositions(
    matchesByToken: number[][],
    maxDistance: number,
  ): number[][] {
    if (matchesByToken.some((m) => m.length === 0)) {
      return [];
    }

    // This recursive function will find all paths
    const findPaths = (
      tokenIndex: number,
      currentPath: number[],
    ): number[][] => {
      if (tokenIndex === matchesByToken.length) {
        return [currentPath]; // A complete path found
      }

      const lastPosition = currentPath[currentPath.length - 1];
      const nextTokenPositions = matchesByToken[tokenIndex];
      let paths: number[][] = [];

      for (const nextPos of nextTokenPositions) {
        const distance = nextPos - lastPosition;
        if (distance > 0 && distance <= maxDistance) {
          // This is a valid next step, continue search from here
          const newPaths = findPaths(tokenIndex + 1, [...currentPath, nextPos]);
          paths = paths.concat(newPaths);
        }
        // Since positions are sorted, we could break if nextPos is too far,
        // but for simplicity and correctness, we check all.
      }
      return paths;
    };

    let allSequences: number[][] = [];
    // Start a search from each possible starting position of the first token
    for (const startPos of matchesByToken[0]) {
      allSequences = allSequences.concat(findPaths(1, [startPos]));
    }

    return allSequences;
  }

  /**
   * Extract snippets for fuzzy phrase search
   */
  private extractFuzzyPhraseSnippets(
    doc: DocumentIndex,
    queryTokens: string[],
    sequences: number[][], // STAGE 3: Receive sequences directly
  ): SnippetInfo[] {
    // Only log in development mode
    logger.debug(
      `🔍 [SNIPPET] Starting fuzzy phrase extraction for ${sequences?.length || 0} sequences.`,
    );

    if (!sequences || sequences.length === 0) {
      return [];
    }

    const snippets: SnippetInfo[] = [];

    for (const sequencePositions of sequences) {
      if (sequencePositions.length !== queryTokens.length) continue;

      const sequence = sequencePositions.map((pos) =>
        this.getDocumentToken(doc, pos),
      );
      if (sequence.some((token) => token === null)) continue;

      const snippet = this.createSnippetFromSequence(
        doc,
        sequence,
        queryTokens,
        'fuzzy-phrase',
      );
      snippets.push(snippet);
    }

    return this.removeDuplicateSnippets(snippets);
  }

  /**
   * Find sentence boundaries for snippet extraction to avoid cross-sentence contamination
   */
  private findSentenceBoundariesForSnippet(
    doc: DocumentIndex,
    matchStartPos: number,
    matchEndPos: number,
  ): { start: number; end: number } {
    // Fallback: use token-based sentence boundary detection
    return this.findSentenceBoundariesFromTokens(
      doc, // Pass the whole doc index
      matchStartPos,
      matchEndPos,
    );
  }

  /**
   * Fallback: Find sentence boundaries using tokens only - FIXED VERSION
   */
  private findSentenceBoundariesFromTokens(
    doc: DocumentIndex, // ✅ REFACTOR: Accept DocumentIndex
    matchStartPos: number,
    matchEndPos: number,
  ): { start: number; end: number } {
    // ✅ FIX: Use reasonable limits instead of searching entire document
    const SEARCH_WINDOW = 50; // Look at most 50 tokens in each direction

    /**
     * Helper to check if a token represents a sentence or paragraph boundary.
     */
    const isBoundaryToken = (
      tokenIndex: number,
      direction: 'forward' | 'backward',
    ): boolean => {
      const token = doc.vocab[doc.positions[tokenIndex][0]];

      // 1. Check for sentence-ending punctuation
      if (/[.!?]$/.test(token) || ['?', '!', ';', '.'].includes(token)) {
        return true;
      }

      return false;
    };

    // Look backwards for a boundary
    let sentenceStart = Math.max(0, matchStartPos - SEARCH_WINDOW);
    for (let i = matchStartPos - 1; i >= sentenceStart; i--) {
      if (isBoundaryToken(i, 'backward')) {
        sentenceStart = i + 1;
        break;
      }
    }

    // Look forwards for a boundary
    let sentenceEnd = Math.min(
      doc.positions.length,
      matchEndPos + SEARCH_WINDOW,
    );
    for (let i = matchEndPos + 1; i < sentenceEnd; i++) {
      if (isBoundaryToken(i, 'forward')) {
        // For forward search, the boundary is the token itself, so we don't include it.
        // For punctuation, we might include it, but for a new paragraph, we definitely don't.
        // Let's be consistent and end before the boundary.
        // ✅ FIX: When a paragraph break is found, the boundary is BEFORE the current token.
        // The punctuation check inside isBoundaryToken is for the token at `i`, so ending at `i+1` is correct for that.
        // The paragraph check is between `i-1` and `i`.
        const token = doc.vocab[doc.positions[i][0]];
        if (/[.!?]$/.test(token) || ['?', '!', ';', '.'].includes(token)) {
          sentenceEnd = i + 1;
        } else {
          sentenceEnd = i; // Boundary is before this token (e.g., paragraph break)
        }
        break;
      }
    }

    // ✅ FIX: Apply reasonable final bounds
    let bufferStart = Math.max(0, sentenceStart);
    let bufferEnd = Math.min(doc.positions.length, sentenceEnd);

    // Ensure reasonable snippet size
    const MAX_SNIPPET_TOKENS = 100;
    const snippetTokenCount = bufferEnd - bufferStart;

    if (snippetTokenCount > MAX_SNIPPET_TOKENS) {
      const midPoint = bufferStart + Math.floor(snippetTokenCount / 2);
      bufferStart = Math.max(0, midPoint - 50);
      bufferEnd = Math.min(doc.positions.length, midPoint + 50);
    }

    return {
      start: bufferStart,
      end: bufferEnd,
    };
  }

  /**
   * Escape special regex characters
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * ✅ NEW: Helper to highlight multiple terms in a snippet robustly.
   */
  private highlightTermsInSnippet(
    snippetText: string,
    termsToHighlight: Array<{ term: string; originalWord: string }>,
  ): { text: string; highlightedWords: string[] } {
    const highlightedWords: string[] = [];
    let text = snippetText;

    const uniqueTerms = [
      ...new Map(
        termsToHighlight.map((item) => [item.originalWord.toLowerCase(), item]),
      ).values(),
    ];

    uniqueTerms.forEach(({ originalWord }) => {
      const regex = new RegExp(
        `\\b${this.escapeRegExp(originalWord)}\\b`,
        'gi',
      );
      text = text.replace(regex, (match) => {
        highlightedWords.push(match);
        return `<b>${match}</b>`;
      });
    });

    return { text, highlightedWords };
  }

  /**
   * ✅ NEW: Helper to remove duplicate snippets based on their context.
   */
  private removeDuplicateSnippets(snippets: SnippetInfo[]): SnippetInfo[] {
    const seen = new Set<string>();
    return snippets.filter((snippet) => {
      // Normalize context by removing HTML and whitespace to better detect duplicates.
      const simplifiedContext = snippet.context
        .replace(/<b>|<\/b>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (seen.has(simplifiedContext)) {
        return false;
      } else {
        seen.add(simplifiedContext);
        return true;
      }
    });
  }

  /**
   * Extract snippets for phrase search
   */
  private extractPhraseSnippets(
    doc: DocumentIndex,
    searchTokens: string[],
  ): SnippetInfo[] {
    const snippets: SnippetInfo[] = [];
    const phraseLength = searchTokens.length;
    if (phraseLength === 0) return [];

    // ✅ OPTIMIZATION: Iterate through tokens instead of doing a slow string search.
    for (let i = 0; i <= doc.positions.length - phraseLength; i++) {
      let isMatch = true;
      const sequence: ProcessedSearchToken[] = [];

      for (let j = 0; j < phraseLength; j++) {
        const token = this.getDocumentToken(doc, i + j);
        // ✅ FIX: Stem document token to match stemmed search tokens
        if (
          !token ||
          this.textProcessor.stemWord(token.term) !== searchTokens[j]
        ) {
          isMatch = false;
          break;
        }
        sequence.push(token);
      }

      if (isMatch) {
        const startTokenIndex = i;
        const endTokenIndex = i + phraseLength - 1; // Correct end index of the match

        const snippetBounds = this.findSentenceBoundariesForSnippet(
          doc,
          startTokenIndex,
          endTokenIndex,
        );

        const tokensForSnippet = doc.positions
          .slice(snippetBounds.start, snippetBounds.end)
          .map((p) => ({ term: doc.vocab[p[0]] }));
        const snippetText = tokensForSnippet.map((t) => t.term).join(' ');

        const actualPhrase = sequence.map((t) => t.term).join(' ');
        const { text: highlightedText } = this.highlightTermsInSnippet(
          snippetText,
          [{ term: actualPhrase, originalWord: actualPhrase }],
        );

        const snippetHighlights = sequence.map((token, index) => ({
          term: searchTokens[index],
          originalWord: token.term,
          tokenIndex: token.position,
          charStart: token.charStart,
          charEnd: token.charEnd,
        }));

        // ✅ FIX: The top-level charStart/charEnd should refer to the MATCH, not the context.
        const matchStartToken = sequence[0];
        const matchEndToken = sequence[sequence.length - 1];

        snippets.push({
          context: highlightedText + '...',
          match: actualPhrase,
          // ✅ FIX: These properties now refer to the match itself.
          matchStartTokenIndex: startTokenIndex,
          matchEndTokenIndex: endTokenIndex,
          matchCharStart: matchStartToken.charStart,
          matchCharEnd: matchEndToken.charEnd,
          matchType: 'exact-phrase',
          confidence: 1.0,
          highlights: snippetHighlights,
        });

        // Skip past this match to avoid overlapping snippets
        i += phraseLength - 1;
      }
    }

    return this.removeDuplicateSnippets(snippets);
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

  /**
   * Process individual search result with proper error handling
   */
  private processSearchResult(
    docId: string,
    score: number,
    docCache: Map<string, DocumentIndex>,
    invertedIndex: Map<string, InvertedIndexEntry[]>,
    uniqueQueryTokens: string[],
    fuzzy: boolean,
    isPhrase: boolean,
    searchTokens: string[],
    snippetsLimit: number | 'ALL',
    matchPositions?: number[][], // STAGE 3: Receive match positions
  ): {
    doc: any;
    score: number;
    snippets: SnippetInfo[];
    highlights: HighlightInfo[];
  } {
    const doc = docCache.get(docId);
    let snippets: SnippetInfo[] = [];
    let highlights: HighlightInfo[] = [];

    if (doc) {
      try {
        // Extract highlights with character positions
        if (isPhrase && fuzzy) {
          // For fuzzy phrase, find all fuzzy matches
          searchTokens.forEach((queryToken) => {
            doc.positions.forEach((p, i) => {
              const docTokenTerm = doc.vocab[p[0]];
              const distance = levenshtein(
                docTokenTerm.toLowerCase(),
                queryToken,
              );
              if (distance <= 2) {
                // Use higher threshold for phrase fuzzy matching
                highlights.push({
                  term: queryToken,
                  originalWord: docTokenTerm,
                  charStart: p[1],
                  charEnd: p[2],
                  confidence:
                    distance === 0 ? 1.0 : Math.max(0.5, 1.0 - distance * 0.2),
                });
              }
            });
          });
        } else {
          // Regular highlight extraction for non-fuzzy phrase searches
          uniqueQueryTokens.forEach((queryToken) => {
            doc.positions.forEach((p) => {
              const docTokenTerm = doc.vocab[p[0]];
              const docTokenStem = this.textProcessor.stemWord(docTokenTerm);

              if (docTokenStem === queryToken) {
                highlights.push({
                  term: queryToken,
                  originalWord: docTokenTerm,
                  charStart: p[1],
                  charEnd: p[2],
                  confidence: fuzzy
                    ? this.calculateMatchConfidence(queryToken, docTokenStem)
                    : 1.0,
                });
              }
            });
          });
        }

        // ENHANCED: Extract rich snippets with position data
        if (isPhrase) {
          if (fuzzy) {
            // STAGE 3: Use pre-calculated match positions for snippet generation
            snippets = this.extractFuzzyPhraseSnippets(
              doc,
              searchTokens,
              matchPositions,
            );
          } else {
            snippets = this.extractPhraseSnippets(doc, searchTokens);
          }
        } else {
          snippets = this.extractTokenSnippets(
            doc,
            uniqueQueryTokens,
            invertedIndex,
          );
        }

        // Limit snippets if not 'ALL'
        if (snippetsLimit !== 'ALL' && typeof snippetsLimit === 'number') {
          snippets = snippets.slice(0, snippetsLimit);
        }
      } catch (error) {
        logger.error(
          `Error processing snippets for document ${doc.metadata.fileName}:`,
          error instanceof Error ? error.message : String(error),
        );
        // Continue with empty snippets rather than failing
      }
    } else {
      logger.warn(`Document not found in cache: "${docId}"`);
    }

    return {
      doc: doc?.metadata,
      score,
      snippets,
      highlights,
    };
  }

  /**
   * Extract snippets for token-based search - OPTIMIZED VERSION
   */
  private extractTokenSnippets(
    doc: DocumentIndex,
    uniqueQueryTokens: string[],
    invertedIndex: Map<string, InvertedIndexEntry[]>, // ✅ RECEIVE invertedIndex
  ): SnippetInfo[] {
    const snippets: SnippetInfo[] = [];
    const processedBounds = new Set<string>();

    // ✅ OPTIMIZATION: Use inverted index to find matches for this doc quickly
    const matchedTokenIndices = new Set<number>();

    // Single pass to find all matches
    doc.positions.forEach((p, tokenIndex) => {
      const docTokenTerm = doc.vocab[p[0]];
      // ✅ FIX: Stem the document token before checking for a match against stemmed query tokens.
      const docTokenStem = this.textProcessor.stemWord(docTokenTerm);

      if (uniqueQueryTokens.includes(docTokenStem)) {
        matchedTokenIndices.add(tokenIndex);
      }
    });

    // Process each match
    matchedTokenIndices.forEach((tokenIndex) => {
      // ✅ REFACTOR: Use getDocumentToken helper
      const docToken = this.getDocumentToken(doc, tokenIndex);
      if (!docToken) return;

      const docTokenStem = this.textProcessor.stemWord(docToken.term);
      const queryToken = uniqueQueryTokens.find((qt) => qt === docTokenStem);
      if (!queryToken) return;

      // Find which query token this matches
      // Create snippet with sentence boundary awareness
      const snippetBounds = this.findSentenceBoundariesForSnippet(
        doc,
        tokenIndex,
        tokenIndex,
      );

      // Avoid duplicate boundary calculations
      const boundsKey = `${snippetBounds.start}-${snippetBounds.end}`;
      if (processedBounds.has(boundsKey)) return;
      processedBounds.add(boundsKey);

      // BUG FIX: snippetText was not defined. It needs to be generated from the tokens within the bounds.
      const tokensForSnippet = doc.positions
        .slice(snippetBounds.start, snippetBounds.end)
        .map((p) => doc.vocab[p[0]]);
      const snippetText = tokensForSnippet.join(' ');

      // Highlight matched term
      const { text: highlightedText } = this.highlightTermsInSnippet(
        snippetText,
        [{ term: queryToken, originalWord: docToken.term }],
      );

      // ✅ FIX: The top-level charStart/charEnd should refer to the MATCH, not the context.
      const matchStartToken = this.getDocumentToken(doc, tokenIndex);
      const matchEndToken = this.getDocumentToken(doc, tokenIndex);

      const confidence = this.calculateMatchConfidence(
        queryToken,
        docTokenStem,
      );

      const snippetInfo: SnippetInfo = {
        context: highlightedText + '...',
        match: docToken.term,
        // ✅ FIX: These properties now refer to the match itself.
        matchStartTokenIndex: tokenIndex,
        matchEndTokenIndex: tokenIndex,
        matchCharStart: matchStartToken?.charStart,
        matchCharEnd: matchEndToken?.charEnd,
        matchType: 'token',
        confidence,
        highlights: [
          {
            term: queryToken,
            originalWord: docToken.term,
            tokenIndex,
            charStart: docToken.charStart,
            charEnd: docToken.charEnd,
          },
        ],
      };

      snippets.push(snippetInfo);
    });

    return this.removeDuplicateSnippets(snippets);
  }

  /**
   * NEW: Refactored helper to create a snippet from a sequence of tokens.
   * Used by both fuzzy and exact phrase snippet extractors.
   */
  private createSnippetFromSequence(
    doc: DocumentIndex,
    sequence: ProcessedSearchToken[],
    queryTokens: string[],
    matchType: 'exact-phrase' | 'fuzzy-phrase',
  ): SnippetInfo {
    const matchStartPos = sequence[0].position;
    const matchEndPos = sequence[sequence.length - 1].position;

    const snippetBounds = this.findSentenceBoundariesForSnippet(
      doc,
      matchStartPos,
      matchEndPos,
    );

    const tokensForSnippet = doc.positions
      .slice(snippetBounds.start, snippetBounds.end)
      .map((p) => doc.vocab[p[0]]);
    const snippetText = tokensForSnippet.join(' ');

    const termsToHighlight = sequence.map((match, index) => ({
      term: queryTokens[index],
      originalWord: match.term,
    }));

    const { text: highlightedText } = this.highlightTermsInSnippet(
      snippetText,
      termsToHighlight,
    );

    const snippetHighlights = sequence.map((match, index) => ({
      term: queryTokens[index],
      originalWord: match.term,
      tokenIndex: match.position,
      charStart: match.charStart,
      charEnd: match.charEnd,
    }));

    const matchStartToken = sequence[0];
    const matchEndToken = sequence[sequence.length - 1];

    let confidence = 1.0;
    if (matchType === 'fuzzy-phrase') {
      const totalDistance = sequence.reduce((sum, match, index) => {
        const queryToken = queryTokens[index];
        return sum + levenshtein(match.term.toLowerCase(), queryToken);
      }, 0);
      confidence = Math.max(
        0.3,
        1.0 - totalDistance / (queryTokens.length * 3),
      );
    }

    const matchedText = sequence.map((s) => s.term).join(' ');

    return {
      context: highlightedText + '...',
      match: matchedText,
      matchStartTokenIndex: matchStartPos,
      matchEndTokenIndex: matchEndPos,
      matchCharStart: matchStartToken?.charStart,
      matchCharEnd: matchEndToken?.charEnd,
      matchType,
      confidence,
      highlights: snippetHighlights,
    };
  }

  async testDocumentParsing(): Promise<void> {
    logger.info('Testing document parsing...');
    const startTime = Date.now();

    const files = await this.fileIndexer.discoverFiles();
    logger.info(`Found ${files.length} files to test`);

    for (const file of files.slice(0, 5)) {
      try {
        logger.info(`\n${'='.repeat(50)}`);
        logger.info(
          `Testing: ${file.fileName} (${(file.size / 1024).toFixed(1)} KB)`,
        );
        logger.info(`Original path: ${file.originalFilePath}`);
        if (file.textFilePath) {
          logger.info(`Text cache path: ${file.textFilePath}`);
        }

        const startTime = Date.now();
        // Use FileIndexer to get text - this uses the cached .txt if available
        // This ensures we are testing against the actual content used for indexing
        const text = await this.fileIndexer.extractTextFromFile(
          file.originalFilePath,
        );
        const extractionTime = Date.now() - startTime;

        logger.info(
          `Extracted ${text.length} characters in ${extractionTime}ms`,
        );

        if (text.length > 0) {
          const language = this.textProcessor.detectLanguage(text);
          logger.info(`Detected language: ${language}`);

          const preview = text.substring(0, 300).replace(/\s+/g, ' ');
          logger.info(`Preview: "${preview}${text.length > 300 ? '...' : ''}"`);

          const tokens = this.textProcessor.tokenize(text);
          logger.info(`Tokenized into ${tokens.length} tokens`);

          if (tokens.length > 0) {
            logger.info(
              `First 15 tokens: ${tokens
                .slice(0, 15)
                .map((t) => t.term)
                .join(', ')}`,
            );

            const uniqueTokens = new Set(tokens.map((t) => t.term));
            logger.info(`Unique tokens: ${uniqueTokens.size}`);

            if (this.config.ukrainianStemming) {
              const stemmedSample = tokens
                .slice(0, 5)
                .map(
                  (t) => `${t.term} -> ${this.textProcessor.stemWord(t.term)}`,
                );
              logger.info(`Stemming sample: ${stemmedSample.join(', ')}`);
            }

            const ukrainianTokens = tokens.filter((t) =>
              /[а-яїієґ]/.test(t.term),
            );
            const englishTokens = tokens.filter(
              (t) => /[a-z]/.test(t.term) && !/[а-яїієґ]/.test(t.term),
            );
            logger.info(
              `Language breakdown: ${ukrainianTokens.length} Ukrainian, ${englishTokens.length} English tokens`,
            );
          }
        } else {
          logger.info(
            '⚠️  No text extracted - this file might be corrupted or use unsupported encoding',
          );
        }
      } catch (error) {
        logger.error(
          `❌ Failed to parse ${file.fileName}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    logger.info(`\n${'='.repeat(50)}`);
    logger.info(
      `Document parsing test completed in ${Date.now() - startTime}ms`,
    );
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
        totalMatches: 0,
        resultsPerPage: pageSize,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
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
  const fileIndexer = new FileIndexer(finalConfig);
  return fileIndexer;
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
