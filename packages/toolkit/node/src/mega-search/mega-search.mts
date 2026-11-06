import path from 'path';
import * as v8 from 'v8';

import { SUPPORTED_EXTENSIONS } from '../document-extractor/index.mjs';
import { BM25Scorer } from './bm25-scorer.mjs';
import { FileIndexer } from './file-indexer/index.mjs';
import { LRUCache } from './lru-cache.mjs';
import { PhraseMatcher } from './mega-search.phrase-matcher.mjs';
import { SnippetGenerator } from './mega-search.snippet-generator.mjs';
import type { SnippetRequest } from './mega-search.snippet-generator.mjs';
import {
  TermMatcher,
  WordMatch,
  mergeMatchedWords,
} from './mega-search.term-matcher.mjs';
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

type QueryCacheEntry = {
  /** The query's normalized words, in order. */
  words: string[];
  isPhrase: boolean;
  timestamp: number;
};

// Shared output shape for the phrase-search and token-search scoring paths,
// so `search()` can treat them interchangeably regardless of which ran.
type ScoringResult = {
  filteredDocIds: string[];
  docScores: Map<string, number>;
  docMatchCounts: Map<string, number>;
  phraseMatches: Map<string, number[][]>;
};

type ScoringParams = {
  /** One match per query word, in query order. */
  words: WordMatch[];
  docCache: Map<string, DocumentIndex>;
  resolvedScopedPaths: string[];
  useBM25: boolean;
  docCount: number;
};

type PhraseScoringParams = ScoringParams & {
  /** Words allowed between consecutive phrase words (0 = adjacent). */
  maxWordsBetween: number;
  isFuzzy: boolean;
};

type PaginationBounds = {
  totalPages: number;
  startIndex: number;
  endIndex: number;
  effectivePageSize: number;
};

type BuildPaginatedResultsParams = {
  rawResults: [string, number][];
  docCache: Map<string, DocumentIndex>;
  snippetsLimit: number | 'ALL';
  phraseMatches: Map<string, number[][]>;
  includeHighlights: boolean;
  /** Everything but the per-document phrase sequences. */
  snippetRequest: Omit<SnippetRequest, 'phraseSequences'>;
};

class MegaSearch {
  private fileIndexer: FileIndexer;
  private textProcessor: UkrainianTextProcessor;
  private bm25Scorer: BM25Scorer;
  private termMatcher: TermMatcher;
  private phraseMatcher: PhraseMatcher;
  private snippetGenerator: SnippetGenerator;

  // Query preprocessing cache (tokenization is re-derived per unique
  // query + phrase-mode combination, so caching it avoids repeat work).
  private queryCache = new LRUCache<string, QueryCacheEntry>(1000);
  private readonly QUERY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Search result cache, keyed by query+options, to speed up repeat requests.
  private searchCache = new LRUCache<string, PaginatedSearchResult>(100);

  constructor(private config: SearchConfig) {
    this.fileIndexer = new FileIndexer(config);
    this.textProcessor = new UkrainianTextProcessor();
    this.termMatcher = new TermMatcher(this.textProcessor);
    this.phraseMatcher = new PhraseMatcher();
    this.snippetGenerator = new SnippetGenerator();

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
    logger.info(
      `Scoring method: ${this.config.useBM25 !== false ? this.bm25Scorer.getScoringMethod() : 'TF-IDF'}`,
    );

    const startTime = Date.now();

    await this.fileIndexer.buildFullIndex();
    await this.refreshDerivedState();

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
    await this.refreshDerivedState();
    logger.info(`Re-indexing completed in ${Date.now() - startTime}ms`);
  }

  /**
   * Brings everything derived from the index in line with it after a
   * (re)build: drops cached results (they may hold documents that changed or
   * are gone), recomputes the BM25 corpus statistics, and pre-warms the
   * indexer's search caches.
   */
  private async refreshDerivedState(): Promise<void> {
    this.searchCache.clear();

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
  }

  /**
   * Deletes the on-disk index cache and resets every in-memory cache
   * (query cache, search result cache, and the file indexer's own caches).
   * Use `MegaSearch.clearCacheFor` instead if you don't already have an
   * initialized instance — going through `createMegaSearch` first would
   * mean reading (and rebuilding from) the very cache being cleared.
   */
  async clearCache(): Promise<void> {
    await this.fileIndexer.clearCache();
    this.queryCache.clear();
    this.searchCache.clear();
  }

  /**
   * Clears a root directory's on-disk index cache without running a full
   * `initialize()`/`buildFullIndex()` first — useful to recover from a
   * corrupted cache, or simply to avoid paying for a rebuild you're about
   * to throw away.
   */
  static async clearCacheFor(
    rootDirectory: string,
    configOverrides: Partial<SearchConfig> = {},
  ): Promise<void> {
    const megaSearch = new MegaSearch({
      ...defaultConfig,
      ...configOverrides,
      rootDirectory,
    });
    await megaSearch.clearCache();
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
  private getFromQueryCache(key: string): QueryCacheEntry | null {
    const cached = this.queryCache.get(key);
    if (!cached) return null;

    // LRUCache.get() just promoted this key to most-recently-used before we
    // got a chance to check its age — if it's stale, undo that by evicting
    // it outright. Otherwise a repeatedly-queried-but-expired entry would
    // keep jumping the eviction queue forever, squatting on a slot a fresh
    // entry could use.
    if (Date.now() - cached.timestamp > this.QUERY_CACHE_TTL) {
      this.queryCache.delete(key);
      return null;
    }

    return cached;
  }

  /**
   * Set in query cache. Size limiting is handled by the underlying LRUCache.
   */
  private setInQueryCache(key: string, data: QueryCacheEntry): void {
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

  private resolveScopedPaths(searchScopedPaths: string[]): string[] {
    return searchScopedPaths.map((p) => {
      // If path is already absolute and within root, keep it. Otherwise treat
      // as relative to root: strip a leading slash so path.join treats it as
      // relative rather than re-rooting.
      const resolved =
        path.isAbsolute(p) && p.startsWith(this.config.rootDirectory)
          ? p
          : path.join(this.config.rootDirectory, p.replace(/^[/\\]/, ''));
      // Native separators and no trailing one, so isInScope can compare paths
      // and append exactly one separator.
      return path.normalize(resolved).replace(/[/\\]+$/, '');
    });
  }

  /**
   * Whether a document lies within one of the resolved scopes: the scope
   * itself (a file) or anything beneath it (a folder). A plain prefix check
   * would also let scope "orders" match the sibling folder "orders 2022".
   */
  private isInScope(filePath: string, resolvedScopedPaths: string[]): boolean {
    return resolvedScopedPaths.some(
      (scope) => filePath === scope || filePath.startsWith(scope + path.sep),
    );
  }

  /** BM25 (or TF-IDF) contribution of one query term to one document. */
  private scoreTerm(
    termFrequency: number,
    docLength: number,
    docFrequency: number,
    docCount: number,
    useBM25: boolean,
  ): number {
    return useBM25
      ? this.bm25Scorer.calculateScore(
          termFrequency,
          docLength,
          docFrequency,
          docCount,
        )
      : this.bm25Scorer.calculateTfIdfScore(
          termFrequency,
          docFrequency,
          docCount,
        );
  }

  /**
   * Resolve tokenization for a query, using the query cache when the same
   * query + phrase-mode combination was seen recently.
   */
  private getOrCreateQueryData(
    query: string,
    isPhraseProximityEnabled: boolean,
  ): QueryCacheEntry {
    // Proximity decides whether an unquoted query is a phrase, so it must be
    // part of the key — it once wasn't, and a query first searched without
    // proximity kept being searched word by word with it.
    const tokenizationCacheKey = `${query}|${isPhraseProximityEnabled}`;

    const cached = this.getFromQueryCache(tokenizationCacheKey);
    if (cached) return cached;

    const tokenizationStartTime = Date.now();

    // Phrase search: query is wrapped in quotes, or proximity search is on
    const phraseMatch = query.match(/^"(.*)"$/);
    const isPhrase = !!phraseMatch || isPhraseProximityEnabled;

    const queryData: QueryCacheEntry = {
      words: this.textProcessor
        .tokenize(phraseMatch ? phraseMatch[1] : query)
        .map((token) => token.term),
      isPhrase,
      timestamp: Date.now(),
    };

    this.setInQueryCache(tokenizationCacheKey, queryData);
    logger.debug(
      `Tokenization completed in ${Date.now() - tokenizationStartTime}ms`,
    );

    return queryData;
  }

  /**
   * Score + filter documents for a phrase query ("..." or proximity search).
   */
  private scorePhraseSearch(params: PhraseScoringParams): ScoringResult {
    const {
      words,
      maxWordsBetween,
      docCache,
      resolvedScopedPaths,
      isFuzzy,
      useBM25,
      docCount,
    } = params;

    const docScores = new Map<string, number>();
    const docMatchCounts = new Map<string, number>();

    const phraseFilterStartTime = Date.now();

    const phraseMatches = this.phraseMatcher.findPhrases(
      words,
      maxWordsBetween,
      docCache,
    );
    let filteredDocIds = Array.from(phraseMatches.keys());
    phraseMatches.forEach((sequences, docId) =>
      docMatchCounts.set(docId, sequences.length),
    );

    if (resolvedScopedPaths.length > 0) {
      filteredDocIds = filteredDocIds.filter((docId) => {
        const doc = docCache.get(docId);
        if (!doc) return false;
        return this.isInScope(
          doc.metadata.originalFilePath,
          resolvedScopedPaths,
        );
      });
    }

    logger.debug(
      `Phrase filtering completed in ${Date.now() - phraseFilterStartTime}ms. ${filteredDocIds.length} documents remaining.`,
    );

    // Term frequencies come from the matched positions, not
    // doc.termFrequency, which is emptied in memory once a document is
    // indexed (see DocumentProcessor) — reading it scored every phrase 0.
    const scoringWords = this.uniqueByQueryToken(words);

    for (const docId of filteredDocIds) {
      let score = 0;
      const doc = docCache.get(docId);
      if (!doc) continue;

      for (const word of scoringWords) {
        const tf = word.positionsIn(docId, doc).length;
        if (tf === 0) continue;

        score += this.scoreTerm(
          tf,
          doc.wordCount,
          word.documentCount,
          docCount,
          useBM25,
        );
      }

      // Exact-form phrase matches get a higher boost than fuzzy ones
      score *= isFuzzy ? 1.2 : 1.5;

      docScores.set(docId, score);
    }

    return {
      filteredDocIds,
      docScores,
      docMatchCounts,
      phraseMatches,
    };
  }

  /**
   * Query words that would score twice — "кошторис кошторису" with fuzzy
   * match on — count once.
   */
  private uniqueByQueryToken(words: WordMatch[]): WordMatch[] {
    return [...new Map(words.map((word) => [word.queryToken, word])).values()];
  }

  /**
   * Score + filter documents for a plain (non-phrase) token query.
   */
  private scoreTokenSearch(params: ScoringParams): ScoringResult {
    const { words, docCache, resolvedScopedPaths, useBM25, docCount } = params;

    const docScores = new Map<string, number>();
    const docMatchCounts = new Map<string, number>();

    for (const word of this.uniqueByQueryToken(words)) {
      for (const docId of word.documentIds()) {
        const doc = docCache.get(docId);
        if (!doc) continue;

        if (
          resolvedScopedPaths.length > 0 &&
          !this.isInScope(doc.metadata.originalFilePath, resolvedScopedPaths)
        ) {
          continue;
        }

        const tf = word.positionsIn(docId, doc).length;
        if (tf === 0) continue; // only other forms of the stem

        const score = this.scoreTerm(
          tf,
          doc.wordCount,
          word.documentCount,
          docCount,
          useBM25,
        );

        docScores.set(docId, (docScores.get(docId) || 0) + score);
        docMatchCounts.set(docId, (docMatchCounts.get(docId) || 0) + tf);
      }
    }

    return {
      filteredDocIds: Array.from(docScores.keys()),
      docScores,
      docMatchCounts,
      phraseMatches: new Map(),
    };
  }

  private calculatePaginationBounds(
    totalResults: number,
    page: number,
    pageSize: number | 'ALL',
  ): PaginationBounds {
    if (pageSize === 'ALL') {
      return {
        totalPages: 1,
        startIndex: 0,
        endIndex: totalResults,
        effectivePageSize: totalResults,
      };
    }

    const effectivePageSize = Number(pageSize) || 10;
    const totalPages = Math.ceil(totalResults / effectivePageSize);
    const startIndex = (page - 1) * effectivePageSize;
    const endIndex = startIndex + effectivePageSize;

    return { totalPages, startIndex, endIndex, effectivePageSize };
  }

  private sortFilteredDocIds(
    filteredDocIds: string[],
    docScores: Map<string, number>,
    docCache: Map<string, DocumentIndex>,
    sortBy: 'relevance' | 'date',
    sortOrder: 'asc' | 'desc',
    filenameDatePattern: string | undefined,
  ): [string, number][] {
    // Pre-calculate dates if sorting by date to avoid repeated regex parsing
    // inside sort (O(N) vs O(N log N)).
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

    return filteredDocIds
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

        // Default: Relevance. If scores are equal, sort by docId for stability.
        const scoreDiff =
          sortOrder === 'asc' ? scoreA - scoreB : scoreB - scoreA;
        return scoreDiff !== 0 ? scoreDiff : docIdA.localeCompare(docIdB);
      });
  }

  /**
   * Generate snippets/highlights for a page of scored results, yielding to
   * the event loop periodically so memory pressure can be checked during
   * heavy snippet generation.
   */
  private async buildPaginatedResults(
    params: BuildPaginatedResultsParams,
  ): Promise<PaginatedSearchResult['results']> {
    const {
      rawResults,
      docCache,
      snippetsLimit,
      phraseMatches,
      includeHighlights,
      snippetRequest,
    } = params;

    const paginatedResults: PaginatedSearchResult['results'] = [];

    for (let i = 0; i < rawResults.length; i++) {
      const [docId, score] = rawResults[i];
      paginatedResults.push(
        await this.processSearchResult(
          docId,
          score,
          docCache,
          { ...snippetRequest, phraseSequences: phraseMatches.get(docId) },
          snippetsLimit,
          includeHighlights,
        ),
      );

      // Check memory pressure every 5 documents during heavy snippet generation
      if (i % 5 === 0) {
        await this.manageMemoryPressure();
      }
    }

    return paginatedResults;
  }

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<PaginatedSearchResult> {
    const searchStartTime = Date.now();
    logger.info(`🔍 [START] Search request: "${query}"`);

    const {
      isTypoToleranceEnabled = true,
      maxTypoDistance = 1,
      isPhraseProximityEnabled = false,
      maxWordsInPhraseDistance = 0,
      snippetsLimit = 3,
      page = 1,
      pageSize = 10,
      sortBy = 'relevance',
      sortOrder = 'desc',
      filenameDatePattern,
      includeHighlights = false,
      snippetContextBefore = 0,
      snippetContextAfter = 30,
      searchScopedPaths = [],
    } = options;

    const resolvedScopedPaths = this.resolveScopedPaths(searchScopedPaths);

    // Cache key includes all options, so different option combos don't collide.
    const cacheKey = JSON.stringify({ query, options });

    const cachedResult = this.searchCache.get(cacheKey);
    if (cachedResult) {
      logger.info(`📋 Using cached search result for: "${query}"`);
      logger.info(
        `✅ [END] Search completed in ${Date.now() - searchStartTime}ms (from cache)`,
      );
      return cachedResult;
    }

    try {
      const queryData = this.getOrCreateQueryData(
        query,
        isPhraseProximityEnabled,
      );

      const dataFetchStart = Date.now();
      const { docCache, invertedIndex, stemDictionary } = this.getSearchData();
      logger.debug(`📊 Index data fetched in ${Date.now() - dataFetchStart}ms`);

      const docCount = docCache.size;
      if (docCount === 0) {
        logger.info('No documents found in index. Please run indexing first.');
        return this.createEmptyResult(page, pageSize);
      }

      if (queryData.words.length === 0) {
        logger.info(`No valid tokens found in query: "${query}"`);
        return this.createEmptyResult(page, pageSize);
      }

      const scoringStart = Date.now();
      const useBM25 = this.config.useBM25 !== false;

      // What each query word matches — every search mode below reads these.
      const words = queryData.words.map((word) =>
        this.termMatcher.match(
          word,
          { isFuzzy: isTypoToleranceEnabled, maxTypoDistance },
          { invertedIndex, stemDictionary },
        ),
      );
      logger.debug(
        `Query words matched in ${Date.now() - scoringStart}ms: ${words
          .map((word) => `${word.queryToken} → ${word.words.size} forms`)
          .join(', ')}`,
      );

      const scoringParams = {
        words,
        docCache,
        resolvedScopedPaths,
        useBM25,
        docCount,
      };
      const { filteredDocIds, docScores, docMatchCounts, phraseMatches } =
        queryData.isPhrase
          ? this.scorePhraseSearch({
              ...scoringParams,
              // A "quoted" phrase without proximity search is a strict one.
              maxWordsBetween: isPhraseProximityEnabled
                ? maxWordsInPhraseDistance
                : 0,
              isFuzzy: isTypoToleranceEnabled,
            })
          : this.scoreTokenSearch(scoringParams);

      logger.debug(
        `Scoring ${docScores.size} documents completed in ${Date.now() - scoringStart}ms`,
      );

      const totalResults = filteredDocIds.length;
      const totalMatches = filteredDocIds.reduce(
        (sum, docId) => sum + (docMatchCounts.get(docId) || 0),
        0,
      );

      logger.debug(
        `Found ${totalResults} documents with ${totalMatches} total matches for query: "${query}"`,
      );

      const { totalPages, startIndex, endIndex, effectivePageSize } =
        this.calculatePaginationBounds(totalResults, page, pageSize);

      const sortStartTime = Date.now();
      const sortedResults = this.sortFilteredDocIds(
        filteredDocIds,
        docScores,
        docCache,
        sortBy,
        sortOrder,
        filenameDatePattern,
      );
      logger.debug(
        `Sorting results by ${sortBy} (${sortOrder}) completed in ${Date.now() - sortStartTime}ms`,
      );

      const snippetGenerationStartTime = Date.now();
      const rawResults = sortedResults.slice(startIndex, endIndex);
      const paginatedResults = await this.buildPaginatedResults({
        rawResults,
        docCache,
        snippetsLimit,
        phraseMatches,
        includeHighlights,
        snippetRequest: {
          queryTokens: words.map((word) => word.queryToken),
          matchedWords: mergeMatchedWords(words),
          isFuzzy: isTypoToleranceEnabled,
          isPhrase: queryData.isPhrase,
          contextBefore: snippetContextBefore,
          contextAfter: snippetContextAfter,
        },
      });
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

      const result: PaginatedSearchResult = {
        results: paginatedResults,
        pagination,
      };

      // Size limiting handled by the underlying LRUCache
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
  private async processSearchResult(
    docId: string,
    score: number,
    docCache: Map<string, DocumentIndex>,
    snippetRequest: SnippetRequest,
    snippetsLimit: number | 'ALL',
    includeHighlights: boolean,
  ): Promise<{
    doc: any;
    score: number;
    snippets: SnippetInfo[];
    highlights: HighlightInfo[];
  }> {
    const start = Date.now(); // PERF
    const doc = docCache.get(docId);
    let snippets: SnippetInfo[] = [];
    let highlights: HighlightInfo[] = [];

    if (doc) {
      try {
        // Only generate full highlights if explicitly requested
        if (includeHighlights) {
          highlights = this.snippetGenerator.generateHighlights(
            doc,
            snippetRequest.matchedWords,
          );
        }

        // ENHANCED: Extract rich snippets with position data
        snippets = await this.snippetGenerator.generateSnippets(
          doc,
          snippetRequest,
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
    const overallStartTime = Date.now(); // ✅ Renamed to avoid shadowing

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

        const extractionStartTime = Date.now(); // ✅ Renamed for clarity
        // Use FileIndexer to get text - this uses the cached .txt if available
        // This ensures we are testing against the actual content used for indexing
        const text = await this.fileIndexer.extractTextFromFile(
          file.originalFilePath,
        );
        const extractionTime = Date.now() - extractionStartTime;

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
      `Document parsing test completed in ${Date.now() - overallStartTime}ms`,
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
  extensions: SUPPORTED_EXTENSIONS,
  maxFileSize: 50 * 1024 * 1024, // 50MB
  concurrency: 4,

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

export { createMegaSearch, defaultConfig, MegaSearch };

export type { SearchOptions };
