import path from 'path';

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
import { createAbortCheck } from './mega-search.utils.mjs';
import {
  compareRankedResults,
  dateFromFileName,
} from './search-result-order.mjs';
import type { RankedResult } from './search-result-order.mjs';
import { createLogger } from './shared/logger.mjs';
import {
  UkrainianTextProcessor,
  findJoints,
  isFunctionWord,
} from './text-processor.mjs';
import type { DocumentIndex, SearchConfig, SearchSnapshot } from './types.mjs';

const logger = createLogger('MegaSearch');

type QueryCacheEntry = {
  /** The query's normalized words and numbers, in order. */
  words: string[];
  /**
   * What glues a word to the one before it, by the word's index, where the
   * query writes a number glued together ("22.12.2024", "вх№36088",
   * "248/9240"). The tokenizer splits such numbers into parts, and this puts
   * them back together: a part with a joint is found only right after the
   * word before it, glued by the same characters. Otherwise "22.12.2024"
   * would match any text holding 22, 12 and 2024 — "12.01.2024, 22 особи",
   * "22/12/2024". See findJoints.
   */
  joints: Record<number, string>;
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
  /** The documents searched: all, or those in the folders searched. */
  docCache: ReadonlyMap<string, DocumentIndex>;
  useBM25: boolean;
  /** Of all documents, whichever are searched. */
  docCount: number;
};

type PhraseScoringParams = ScoringParams & {
  /** Words allowed between consecutive phrase words (0 = adjacent). */
  maxWordsBetween: number;
  /** See QueryCacheEntry.joints. */
  joints: Record<number, string>;
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
  docCache: ReadonlyMap<string, DocumentIndex>;
  snippetsLimit: number | 'ALL';
  phraseMatches: Map<string, number[][]>;
  includeHighlights: boolean;
  /** Everything but the per-document phrase sequences. */
  snippetRequest: Omit<SnippetRequest, 'phraseSequences'>;
  /** Stops it between documents (see SearchOptions.signal). */
  signal?: AbortSignal;
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

  // Search result cache, keyed by query+options and the index generation
  // searched, to speed up repeat requests. Kept by size, not by count: all
  // results with all snippets of a common word run to tens of thousands of
  // snippets, ~1.4 KB each — a hundred such results held GBs. One bigger
  // than the whole cache isn't kept.
  private searchCache = new LRUCache<string, PaginatedSearchResult>(
    20_000,
    ({ results }) =>
      results.reduce(
        (size, { snippets, highlights }) =>
          size + 1 + (snippets?.length ?? 0) + (highlights?.length ?? 0),
        0,
      ),
  );
  // The index generation the cached results were last tidied for.
  private searchCacheGeneration = -1;
  // The index generation BM25's average document length was computed for.
  private scorerIndexGeneration = -1;
  // The documents of the folders searched lately (see documentsInScope), and
  // the index generation they were picked from.
  private scopedDocuments = new LRUCache<
    string,
    ReadonlyMap<string, DocumentIndex>
  >(10);
  private scopedDocumentsGeneration = -1;

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

  async initialize(): Promise<void> {
    logger.info('Initializing Mega Search system...');
    logger.info(`Root directory: ${this.config.rootDirectory}`);
    logger.debug(`Supported extensions: ${this.config.extensions.join(', ')}`);
    logger.info(
      `Scoring method: ${this.config.useBM25 !== false ? this.bm25Scorer.getScoringMethod() : 'TF-IDF'}`,
    );

    const startTime = Date.now();

    await this.fileIndexer.buildFullIndex();
    this.dropStaleResults();

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
    this.dropStaleResults();
    logger.info(`Re-indexing completed in ${Date.now() - startTime}ms`);
  }

  /**
   * Brings the index up to date with the files, as reindex() does — but with
   * `watchFiles` on, it lists them only when the folder watcher saw a change
   * since, or `rescanAfterMs` went by in case it missed one. Otherwise it
   * waits for an update running, if any. Cheap enough to run before every
   * search: a change is in the searches after the watcher reports it, a
   * moment after the file is saved.
   *
   * With `searchScopedPaths`, as search() takes them, only the files in
   * those folders: what a search in them reads. The other folders' files
   * aren't even listed, and theirs stay in the index as they were — a
   * search in one folder of a large one, first of all, waits for that
   * folder's documents to be indexed, not for all of them.
   */
  async refresh(searchScopedPaths: string[] = []): Promise<void> {
    await this.fileIndexer.refreshIfChanged(
      this.resolveScopedPaths(searchScopedPaths),
    );
    this.dropStaleResults();
  }

  /**
   * Stops watching the folder (see `watchFiles`): for an instance no longer
   * in use. Searches still work, and refresh() lists the files every time.
   * @returns when the index update running, if any, is over — one a search
   * stopped waiting for goes on to its end, and holds the instance until
   * then. Never rejects.
   */
  close(): Promise<void> {
    return this.fileIndexer.close();
  }

  /**
   * Drops cached results, and the documents picked per folder, after an
   * update went in. They're keyed by the index generation, so no search can
   * reach them any more: this only gives their memory back. A refresh that
   * found nothing to change keeps them, so a repeated search stays an
   * instant one. Searches don't wait for it — they key what they derive
   * from the index by its generation (see syncScorerWithIndex).
   */
  private dropStaleResults(): void {
    const generation = this.fileIndexer.indexGeneration;
    if (generation === this.searchCacheGeneration) return;
    this.searchCache.clear();
    this.scopedDocuments.clear();
    this.searchCacheGeneration = generation;
  }

  /**
   * Recomputes BM25's average document length when the index searched is of
   * another generation than the last one computed for.
   */
  private syncScorerWithIndex(
    docCache: ReadonlyMap<string, DocumentIndex>,
    indexGeneration: number,
  ): void {
    if (this.scorerIndexGeneration === indexGeneration) return;
    this.bm25Scorer.calculateAverageDocLength(docCache);
    this.scorerIndexGeneration = indexGeneration;
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
    this.dropStaleResults();
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
   * The index as it is now, read in place (no copy) — the same version for
   * as long as the search runs, whatever update goes in meanwhile.
   */
  private getSearchData(): SearchSnapshot {
    try {
      const snapshot = this.fileIndexer.getSearchSnapshot();
      const { docCache, invertedIndex, stemDictionary } = snapshot;

      if (!docCache || !invertedIndex || !stemDictionary) {
        throw new Error('Search indexes not properly initialized');
      }

      return snapshot;
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

  /**
   * The documents a search in `resolvedScopedPaths` reads: `docCache` itself
   * when that's every folder, those in the folders otherwise — picked once
   * per index generation, and kept for the next search in the same folders.
   */
  private documentsInScope(
    docCache: ReadonlyMap<string, DocumentIndex>,
    resolvedScopedPaths: string[],
    indexGeneration: number,
  ): ReadonlyMap<string, DocumentIndex> {
    if (resolvedScopedPaths.length === 0) return docCache;

    if (this.scopedDocumentsGeneration !== indexGeneration) {
      this.scopedDocuments.clear();
      this.scopedDocumentsGeneration = indexGeneration;
    }
    const key = [...resolvedScopedPaths].sort().join('\n');
    let documents = this.scopedDocuments.get(key);
    if (!documents) {
      documents = new Map(
        [...docCache].filter(([, doc]) =>
          this.isInScope(doc.metadata.originalFilePath, resolvedScopedPaths),
        ),
      );
      this.scopedDocuments.set(key, documents);
    }
    return documents;
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
    const text = phraseMatch ? phraseMatch[1] : query;
    const tokens = this.textProcessor.tokenize(text);
    const joints = findJoints(text, tokens);
    // A query that is one glued number is searched as one, even word by word
    const isOneNumber =
      tokens.length > 1 &&
      tokens.every((_, i) => i === 0 || joints[i] !== undefined);

    const queryData: QueryCacheEntry = {
      words: tokens.map((token) => token.term),
      joints,
      isPhrase: !!phraseMatch || isPhraseProximityEnabled || isOneNumber,
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
      joints,
      docCache,
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
      joints,
    );
    const filteredDocIds = Array.from(phraseMatches.keys());
    phraseMatches.forEach((sequences, docId) =>
      docMatchCounts.set(docId, sequences.length),
    );

    logger.debug(
      `Phrase filtering completed in ${Date.now() - phraseFilterStartTime}ms. ${filteredDocIds.length} documents remaining.`,
    );

    // Term frequencies come from the matched positions: a document keeps no
    // others (it once kept them empty in memory, and every phrase scored 0).
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
    const { words, docCache, useBM25, docCount } = params;

    const docScores = new Map<string, number>();
    const docMatchCounts = new Map<string, number>();

    for (const word of this.uniqueByQueryToken(words)) {
      for (const docId of word.documentIds()) {
        const doc = docCache.get(docId);
        if (!doc) continue;

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
    docCache: ReadonlyMap<string, DocumentIndex>,
    sortBy: 'relevance' | 'date',
    sortOrder: 'asc' | 'desc',
    filenameDatePattern: string | undefined,
  ): [string, number][] {
    // Dates are read once per document, not once per comparison. The order
    // itself is shared with mergeSearchResults, which puts several folders'
    // results together as one search over all of them would.
    const ranked: RankedResult[] = filteredDocIds.map((docId) => {
      const doc = sortBy === 'date' ? docCache.get(docId) : undefined;
      return {
        id: docId,
        score: docScores.get(docId) || 0,
        date: doc
          ? dateFromFileName(doc.metadata.fileName, filenameDatePattern)
          : 0,
      };
    });

    return ranked
      .sort((a, b) => compareRankedResults(a, b, sortBy, sortOrder))
      .map(({ id, score }) => [id, score] as [string, number]);
  }

  /** Generate snippets/highlights for a page of scored results. */
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
      signal,
    } = params;

    const paginatedResults: PaginatedSearchResult['results'] = [];
    // A page of every result makes snippets for thousands of documents
    const checkAborted = createAbortCheck(signal);

    for (let i = 0; i < rawResults.length; i++) {
      await checkAborted();
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
    }

    return paginatedResults;
  }

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<PaginatedSearchResult> {
    const searchStartTime = Date.now();
    // Search text holds people's names: out of the info log
    logger.debug(`🔍 [START] Search request: "${query}"`);

    const {
      isInflectedWordFormsAllowed = true,
      isRelatedWordsAllowed = true,
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
      signal,
    } = options;

    signal?.throwIfAborted();

    const resolvedScopedPaths = this.resolveScopedPaths(searchScopedPaths);

    // Cache key includes all options, so different option combos don't
    // collide, and the index generation, so an update can't serve results
    // of the index before it. The signal changes no result: out of the key.
    const indexGeneration = this.fileIndexer.indexGeneration;
    const cacheKey = JSON.stringify({
      query,
      options: { ...options, signal: undefined },
      indexGeneration,
    });

    const cachedResult = this.searchCache.get(cacheKey);
    if (cachedResult) {
      logger.debug(`📋 Using cached search result for: "${query}"`);
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

      // The same version as indexGeneration: nothing came in between
      const { docCache, invertedIndex, stemDictionary } = this.getSearchData();

      const docCount = docCache.size;
      if (docCount === 0) {
        logger.info('No documents found in index. Please run indexing first.');
        return this.createEmptyResult(page, pageSize);
      }

      if (queryData.words.length === 0) {
        logger.debug(`No valid tokens found in query: "${query}"`);
        return this.createEmptyResult(page, pageSize);
      }

      const scoringStart = Date.now();
      const useBM25 = this.config.useBM25 !== false;
      // Scoring below runs without a pause, so no update gets in between
      if (useBM25) this.syncScorerWithIndex(docCache, indexGeneration);

      // The documents searched — those in the folders searched, if any. Only
      // theirs are read: a search in one folder of many costs about what one
      // in that folder alone would, not what one in all of them would.
      const searched = this.documentsInScope(
        docCache,
        resolvedScopedPaths,
        indexGeneration,
      );

      // What each query word matches — every search mode below reads these.
      // A phrase holds its function words as written; a search word by word
      // skips them, unless they're all the query holds — "наказ про
      // відпустку" would find nearly every document by "про" alone.
      const queryWords =
        queryData.isPhrase || queryData.words.every(isFunctionWord)
          ? queryData.words
          : queryData.words.filter((word) => !isFunctionWord(word));
      const words = queryWords.map((word) =>
        this.termMatcher.match(
          word,
          {
            isFuzzy: isInflectedWordFormsAllowed,
            isRelatedWordsAllowed,
            maxTypoDistance,
          },
          {
            invertedIndex,
            stemDictionary,
            documents: searched === docCache ? undefined : searched,
          },
        ),
      );
      logger.debug(
        `Query words matched in ${Date.now() - scoringStart}ms: ${words
          .map((word) => `${word.queryToken} → ${word.words.size} forms`)
          .join(', ')}`,
      );

      const scoringParams = { words, docCache: searched, useBM25, docCount };
      const { filteredDocIds, docScores, docMatchCounts, phraseMatches } =
        queryData.isPhrase
          ? this.scorePhraseSearch({
              ...scoringParams,
              // A "quoted" phrase without proximity search is a strict one.
              maxWordsBetween: isPhraseProximityEnabled
                ? maxWordsInPhraseDistance
                : 0,
              joints: queryData.joints,
              isFuzzy: isInflectedWordFormsAllowed,
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
          isFuzzy: isInflectedWordFormsAllowed,
          isPhrase: queryData.isPhrase,
          contextBefore: snippetContextBefore,
          contextAfter: snippetContextAfter,
        },
        signal,
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
      // Cancelled, not failed: the caller looks for the abort's own reason
      signal?.throwIfAborted();
      logger.error(
        'Search failed:',
        error instanceof Error ? error.message : String(error),
      );
      logger.debug(`Failed search: "${query}"`);
      throw new Error(
        `Search operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Process individual search result with proper error handling
   */
  private async processSearchResult(
    docId: string,
    score: number,
    docCache: ReadonlyMap<string, DocumentIndex>,
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

        // The first snippetsLimit, generated only: the rest would be dropped
        snippets = await this.snippetGenerator.generateSnippets(
          doc,
          snippetRequest,
          typeof snippetsLimit === 'number' ? snippetsLimit : Infinity,
        );
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
      logger.debug(
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
/**
 * A search engine for the folder `config.rootDirectory`, with every file in
 * it indexed. With `indexFolder: false` it indexes nothing yet: refresh()
 * then indexes what each search reads — first of all, the folders searched
 * in, not the whole folder.
 */
async function createMegaSearch(
  config: Partial<SearchConfig> = {},
  { indexFolder = true }: { indexFolder?: boolean } = {},
): Promise<MegaSearch> {
  const finalConfig = { ...defaultConfig, ...config };
  const megaSearch = new MegaSearch(finalConfig);

  if (indexFolder) await megaSearch.initialize();
  return megaSearch;
}

export { createMegaSearch, defaultConfig, MegaSearch };

export type { SearchOptions };
