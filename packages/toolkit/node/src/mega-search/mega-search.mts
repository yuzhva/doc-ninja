import * as v8 from 'v8';

import { BM25Scorer } from './bm25-scorer.mjs';
import { FileIndexer } from './file-indexer/index.mjs';
import { levenshtein } from './fuzzy.mjs';
import { PhraseMatcher } from './mega-search.phrase-matcher.mjs';
import { SnippetGenerator } from './mega-search.snippet-generator.mjs';
import type {
  HighlightInfo,
  PaginatedSearchResult,
  PaginationInfo,
  SearchOptions,
  SnippetInfo,
} from './mega-search.types.mjs';
import { createLogger } from './shared/logger.mjs';
import { UkrainianTextProcessor } from './text-processor.mjs';
import { DocumentIndex, InvertedIndexEntry, SearchConfig } from './types.mjs';

const logger = createLogger('MegaSearch');

class MegaSearch {
  private fileIndexer: FileIndexer;
  private textProcessor: UkrainianTextProcessor;
  private bm25Scorer: BM25Scorer;
  private phraseMatcher: PhraseMatcher;
  private snippetGenerator: SnippetGenerator;
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
    this.phraseMatcher = new PhraseMatcher(this.textProcessor);
    this.snippetGenerator = new SnippetGenerator(this.textProcessor);

    // Initialize BM25 scorer with config or defaults
    this.bm25Scorer = new BM25Scorer({
      k1: config.bm25K1 ?? 1.2,
      b: config.bm25B ?? 0.75,
    });
  }

  /**
   * Monitors memory usage and pauses execution if heap usage is high.
   * Prevents OOM during heavy search operations.
   */
  private async manageMemoryPressure(): Promise<void> {
    const heapUsed = process.memoryUsage().heapUsed;
    const heapLimit = v8.getHeapStatistics().heap_size_limit;
    const usageRatio = heapUsed / heapLimit;

    if (usageRatio > 0.9) {
      logger.warn(
        `⚠️ Critical memory usage (${(usageRatio * 100).toFixed(1)}%) during search. Pausing...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else if (usageRatio > 0.8) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Mega Search system...');
    logger.info(`Root directory: ${this.config.rootDirectory}`);
    logger.debug(`Supported extensions: ${this.config.extensions.join(', ')}`);
    logger.debug(
      `Ukrainian stemming: ${this.config.ukrainianStemming ? 'enabled' : 'disabled'}`,
    );
    logger.info(
      `Scoring method: ${this.config.useBM25 !== false ? this.bm25Scorer.getScoringMethod() : 'TF-IDF'}`,
    );

    const startTime = Date.now();

    await this.fileIndexer.buildFullIndex();

    // Optimization: Run post-indexing tasks in parallel
    const postIndexTasks: Promise<void>[] = [];

    // 1. Calculate average document length for BM25
    if (this.config.useBM25 !== false) {
      postIndexTasks.push(
        (async () => {
          const docCache = this.fileIndexer.getDocumentCache();
          this.bm25Scorer.calculateAverageDocLength(docCache);
        })(),
      );
    }

    // 2. Pre-warm search caches
    postIndexTasks.push(
      (async () => {
        try {
          if (
            this.fileIndexer.preWarmSearchCaches &&
            typeof this.fileIndexer.preWarmSearchCaches === 'function'
          ) {
            await this.fileIndexer.preWarmSearchCaches();
          }
        } catch (error) {
          logger.warn('⚠️ Failed to pre-warm search caches:', error);
        }
      })(),
    );

    await Promise.all(postIndexTasks);

    const stats = this.fileIndexer.getStats();
    const indexTime = Date.now() - startTime;

    logger.info(
      `✅ Indexing complete: ${stats.documentsCount} documents, ${stats.termsCount} unique terms (${indexTime}ms)`,
    );

    // ✅ NEW: Explicitly log that the system is ready for search
    logger.info(
      `🚀 MegaSearch is ready! Startup time does not affect search latency.`,
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
    logger.info(`🔍 [START] Search request: "${query}"`);

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
      includeHighlights = false,
      snippetContextBefore = 0, // Default to 0 as requested
      snippetContextAfter = 30, // Reduced default from 50 to 30 (~250 chars)
    } = opts;

    // ✅ FIX: Create a comprehensive cache key that includes all options.
    const cacheKey = JSON.stringify({ query, options });

    // CHECK search result cache
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      logger.info(`📋 Using cached search result for: "${query}"`);
      logger.info(
        `✅ [END] Search completed in ${Date.now() - searchStartTime}ms (from cache)`,
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
      const dataFetchStart = Date.now();
      const { docCache, invertedIndex, stemDictionary } = this.getSearchData();
      logger.debug(`📊 Index data fetched in ${Date.now() - dataFetchStart}ms`);

      const docCount = docCache.size;

      if (docCount === 0) {
        logger.info('No documents found in index. Please run indexing first.');
        return this.createEmptyResult(page, pageSize);
      }

      // Score documents using BM25 or TF-IDF (always use stemmed tokens for scoring)
      const scoringStart = Date.now();
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
          const matches = this.phraseMatcher.findDocsWithFuzzyPhrase(
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
          // Use a much faster token-based check instead of string matching.
          const candidateDocIds = this.phraseMatcher.getCandidateDocsForPhrase(
            queryData.queryTokens, // ✅ FIXED: Use stemmed tokens
            invertedIndex,
          );
          filteredDocIds = candidateDocIds.filter((docId) => {
            const doc = docCache.get(docId);
            if (!doc) return false;

            // ✅ Use countExactPhrase to get accurate match count
            const count = this.phraseMatcher.countExactPhrase(
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
        // const scoringStartTime = Date.now(); // Removed local var to use shared scoringStart
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
        // logger.debug( ... ); // Moved logging to after if/else block
      } else {
        // Original logic for non-phrase search
        // const scoringStartTime = Date.now(); // Removed local var to use shared scoringStart
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
        filteredDocIds = Array.from(docScores.keys());
      }

      logger.debug(
        `Scoring ${docScores.size} documents completed in ${Date.now() - scoringStart}ms`,
      );

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

      let totalPages: number;
      let startIndex: number;
      let endIndex: number;
      let effectivePageSize: number;

      if (pageSize === 'ALL') {
        totalPages = 1;
        startIndex = 0;
        endIndex = totalResults;
        effectivePageSize = totalResults;
      } else {
        effectivePageSize = Number(pageSize) || 10;
        totalPages = Math.ceil(totalResults / effectivePageSize);
        startIndex = (page - 1) * effectivePageSize;
        endIndex = startIndex + effectivePageSize;
      }

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

      // Optimization: Process results in chunks to check memory pressure
      const paginatedResults = [];
      const rawResults = sortedResults.slice(startIndex, endIndex);

      for (let i = 0; i < rawResults.length; i++) {
        const [docId, score] = rawResults[i];
        paginatedResults.push(
          this.processSearchResult(
            docId,
            score,
            docCache,
            invertedIndex,
            queryData.uniqueQueryTokens,
            fuzzy,
            queryData.isPhrase,
            fuzzyPhrase ? queryData.originalTokens : queryData.queryTokens,
            snippetsLimit,
            phraseMatches.get(docId),
            includeHighlights,
            snippetContextBefore,
            snippetContextAfter,
          ),
        );

        // Check memory pressure every 5 documents during heavy snippet generation
        if (i % 5 === 0) {
          await this.manageMemoryPressure();
        }
      }

      logger.debug(
        `Snippet generation for ${paginatedResults.length} results completed in ${Date.now() - snippetGenerationStartTime}ms`,
      );

      const pagination: PaginationInfo = {
        currentPage: page,
        totalPages,
        totalResults,
        totalMatches,
        resultsPerPage: effectivePageSize,
        hasNextPage: pageSize === 'ALL' ? false : page < totalPages,
        hasPreviousPage: pageSize === 'ALL' ? false : page > 1,
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

      logger.info(
        `✅ [END] Search completed in ${Date.now() - searchStartTime}ms`,
      );
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
    matchPositions?: number[][],
    includeHighlights: boolean = false,
    snippetContextBefore: number = 0,
    snippetContextAfter: number = 50,
  ): {
    doc: any;
    score: number;
    snippets: SnippetInfo[];
    highlights: HighlightInfo[];
  } {
    const start = Date.now(); // PERF
    const doc = docCache.get(docId);
    let snippets: SnippetInfo[] = [];
    let highlights: HighlightInfo[] = [];

    if (doc) {
      try {
        // Only generate full highlights if explicitly requested
        if (includeHighlights) {
          highlights = this.snippetGenerator.generateHighlights(
            docId,
            doc,
            searchTokens,
            uniqueQueryTokens,
            isPhrase,
            fuzzy,
          );
        }

        // ENHANCED: Extract rich snippets with position data
        snippets = this.snippetGenerator.generateSnippets(
          doc,
          uniqueQueryTokens,
          invertedIndex,
          isPhrase,
          fuzzy,
          searchTokens,
          matchPositions,
          snippetContextBefore,
          snippetContextAfter,
        );

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

    const totalDuration = Date.now() - start; // PERF
    if (totalDuration > 20) {
      logger.info(
        `[PERF] processSearchResult for ${doc?.metadata.fileName || docId}: ${totalDuration}ms`,
      );
    }

    return {
      doc: doc?.metadata,
      score,
      snippets,
      highlights,
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
    pageSize: number | 'ALL',
  ): PaginatedSearchResult {
    return {
      results: [],
      pagination: {
        currentPage: page,
        totalPages: 0,
        totalResults: 0,
        totalMatches: 0,
        resultsPerPage: pageSize === 'ALL' ? 0 : Number(pageSize) || 10,
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
