import path from 'path';
import { setImmediate as nextTurn } from 'timers/promises';
import type { PaginatedSearchResult, SearchOptions } from 'toolkit--local/node';
import { MegaSearch, createMegaSearch } from 'toolkit--local/node';
import v8 from 'v8';
import vm from 'vm';

import { runtimePathById } from '../../supplement/index.mjs';
import { MegaSearchEngines } from './mega-search-engines.mjs';
import { untilAborted } from './until-aborted.mjs';

/**
 * Every request's search engines, one per source folder. Each watches its
 * folder, so a request lists the folder's files only after one changed.
 * A new one indexes nothing yet: each search brings the folders it searches
 * up to date (see getMegaSearchInstance).
 */
const engines = new MegaSearchEngines({
  createEngine: (rootDirectory) =>
    createMegaSearch(
      { rootDirectory, concurrency: 4, watchFiles: true },
      { indexFolder: false },
    ),
  clearCacheOf: (rootDirectory) => MegaSearch.clearCacheFor(rootDirectory),
  // An index update a cancelled search left running holds the engine until
  // it's over: what the engine held is garbage only then
  closeEngine: (megaSearch) => {
    void megaSearch.close().then(collectGarbageSoon);
  },
});

/**
 * V8's garbage collector, callable. The backend runs in an Electron utility
 * process, and --expose-gc given to one doesn't reach its scripts: switched on
 * here instead, the flag gives gc() to every context created after it.
 */
const collectGarbage: () => void = (() => {
  v8.setFlagsFromString('--expose-gc');
  return vm.runInNewContext('gc');
})();

/**
 * Collects the garbage a second from now — the engine just let go, which
 * holds about three times its folder's text, once nothing refers to it any
 * more. An idle Electron utility process collects nothing by itself, and kept
 * that memory until the next search. Plain Node collects on its own; this
 * only makes it sooner.
 */
const collectGarbageSoon = (): void => {
  setTimeout(collectGarbage, 1000).unref();
};

interface SearchResult {
  query: string;
  success: boolean;
  error?: string;
  results: PaginatedSearchResult['results'];
  pagination: {
    totalResults: number;
    currentPage?: number;
    totalPages?: number;
    resultsPerPage?: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  };
}

class DocumentIntelligenceService {
  private rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = path.isAbsolute(rootDirectory)
      ? rootDirectory
      : // NOTE: "workaround" for "Browser dev mode"
        // Docker container - does NOT have access to Local File System, so we are resolving to assets folder
        path.join(runtimePathById.assets, rootDirectory);
  }

  /**
   * This folder's search engine, shared across requests, with what a search
   * in `searchScopedPaths` reads up to date with the files on disk: the
   * documents in those folders, or in all of them when none are given. It
   * picks up the documents added, edited or deleted there since — all of
   * them, the first time a folder is searched — and lists the folders'
   * files for that only when its watcher saw a change, or a minute went by.
   * Requests that come in together share that refresh.
   *
   * Once `signal` aborts it stops waiting for the refresh, which goes on:
   * other requests may wait for it too, and the documents it indexes are
   * saved for the next search rather than indexed by it all over again.
   */
  async getMegaSearchInstance(
    searchScopedPaths?: string[],
    signal?: AbortSignal,
  ): Promise<MegaSearch> {
    const { megaSearch } = await engines.get(this.rootDirectory);
    const refreshed = megaSearch.refresh(searchScopedPaths).catch((error) => {
      // The index from before is a better answer than none — if there is one
      if (megaSearch.getStats().documentsCount === 0) throw error;
      console.error('Search index refresh failed:', error);
    });
    await untilAborted(refreshed, signal);
    return megaSearch;
  }

  /**
   * Searches each of `queries` in turn. Once `options.signal` aborts it stops
   * — between queries, or between documents within one (see
   * SearchOptions.signal) — and rejects with the signal's reason.
   */
  async searchDocuments(
    queries: string[],
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const { signal } = options;
    const megaSearch = await this.getMegaSearchInstance(
      options.searchScopedPaths,
      signal,
    );
    const results: SearchResult[] = [];

    for (const query of queries) {
      // Lets an abort in: scoring a query runs in one go, and one with its
      // results cached reads nothing from disk, so queries alone never would
      if (signal) await nextTurn();
      signal?.throwIfAborted();

      try {
        const searchResult = await megaSearch.search(query, {
          maxTypoDistance: 1,
          isPhraseProximityEnabled: true,
          maxWordsInPhraseDistance: 1, // one word may sit between phrase words
          snippetsLimit: 'ALL',
          sortBy: 'date',
          ...options, // Merge passed options, overriding defaults if provided
        });

        results.push({
          query,
          success: true,
          results: searchResult.results,
          pagination: searchResult.pagination,
        });
      } catch (error: Error | any) {
        // Cancelled, not failed: no query after it is searched either
        signal?.throwIfAborted();
        results.push({
          query,
          success: false,
          error: error.message,
          results: [],
          pagination: { totalResults: 0 },
        });
      }
    }

    return results;
  }

  /**
   * Re-runs indexing for this instance's rootDirectory, all its folders.
   * Same incremental engine a search runs (only new/changed files are
   * reprocessed, deleted files are pruned) — this just lets a caller
   * trigger it explicitly, independent of running a search.
   */
  async reindex(): Promise<void> {
    const { megaSearch } = await engines.get(this.rootDirectory);
    await megaSearch.reindex();
  }

  /**
   * Deletes the index cache for this instance's rootDirectory, on disk and
   * in the folder's engine: the next search indexes the folder anew. Never
   * creates an engine for it — that would read the very cache being deleted
   * (see MegaSearchEngines.clearCache).
   */
  async clearCache(): Promise<void> {
    await engines.clearCache(this.rootDirectory);
  }
}

// Singleton instance
export { DocumentIntelligenceService };
export type { SearchResult };
