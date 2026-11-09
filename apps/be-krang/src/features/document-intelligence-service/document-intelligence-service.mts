import path from 'path';
import { setImmediate as nextTurn } from 'timers/promises';
import type { PaginatedSearchResult, SearchOptions } from 'toolkit--local/node';
import {
  MegaSearch,
  createMegaSearch,
  mergeSearchResults,
  pageOptionsForMerge,
} from 'toolkit--local/node';
import v8 from 'v8';
import vm from 'vm';

import { runtimePathById } from '../../supplement/index.mjs';
import { MegaSearchEngines, folderKey } from './mega-search-engines.mjs';
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

/**
 * One thing found, and the source folder it was found in — as the request
 * named that folder, so a caller can tell which of its folders it came from.
 */
type SearchResultItem = PaginatedSearchResult['results'][number] & {
  sourcePath: string;
};

interface SearchResult {
  query: string;
  success: boolean;
  error?: string;
  results: SearchResultItem[];
  pagination: {
    totalResults: number;
    totalMatches?: number;
    currentPage?: number;
    totalPages?: number;
    resultsPerPage?: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  };
}

/** A source folder to search, and where in it. */
interface SearchFolder {
  /** As the client knows it: absolute, or relative to the assets folder. */
  sourcePath: string;
  /** Folders (or files) within it to search; all of it when empty. */
  searchScopedPaths?: string[];
}

const SEARCH_DEFAULTS: SearchOptions = {
  maxTypoDistance: 1,
  isPhraseProximityEnabled: true,
  maxWordsInPhraseDistance: 1, // one word may sit between phrase words
  snippetsLimit: 'ALL',
  sortBy: 'date',
};

/**
 * Where a source folder is on disk. A relative one is the "browser dev mode"
 * workaround: that backend runs in a Docker container with no access to the
 * local file system, so it reads the folder from its assets instead.
 */
const resolveRootDirectory = (sourcePath: string): string =>
  path.isAbsolute(sourcePath)
    ? sourcePath
    : path.join(runtimePathById.assets, sourcePath);

/**
 * The folder's engine with what a search in `searchScopedPaths` reads up to
 * date with the files on disk: the documents in those folders, or in all of
 * them when none are given. It picks up the documents added, edited or
 * deleted there since — all of them, the first time a folder is searched —
 * and lists the folders' files for that only when its watcher saw a change,
 * or a minute went by. Requests that come in together share that refresh.
 *
 * Once `signal` aborts it stops waiting for the refresh, which goes on:
 * other requests may wait for it too, and the documents it indexes are
 * saved for the next search rather than indexed by it all over again.
 */
const refreshForSearch = async (
  megaSearch: MegaSearch,
  searchScopedPaths: string[] | undefined,
  signal: AbortSignal | undefined,
): Promise<void> => {
  const refreshed = megaSearch.refresh(searchScopedPaths).catch((error) => {
    // The index from before is a better answer than none — if there is one
    if (megaSearch.getStats().documentsCount === 0) throw error;
    console.error('Search index refresh failed:', error);
  });
  await untilAborted(refreshed, signal);
};

class DocumentIntelligenceService {
  private sourcePath: string;
  private rootDirectory: string;

  constructor(sourcePath: string) {
    this.sourcePath = sourcePath;
    this.rootDirectory = resolveRootDirectory(sourcePath);
  }

  /**
   * This folder's search engine, shared across requests, brought up to date
   * for a search in `searchScopedPaths` (see refreshForSearch).
   */
  async getMegaSearchInstance(
    searchScopedPaths?: string[],
    signal?: AbortSignal,
  ): Promise<MegaSearch> {
    const { megaSearch } = await engines.get(this.rootDirectory);
    await refreshForSearch(megaSearch, searchScopedPaths, signal);
    return megaSearch;
  }

  /** searchFolders() over this one folder. */
  async searchDocuments(
    queries: string[],
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    return DocumentIntelligenceService.searchFolders(
      [
        {
          sourcePath: this.sourcePath,
          searchScopedPaths: options.searchScopedPaths,
        },
      ],
      queries,
      options,
    );
  }

  /**
   * Searches each of `queries` in turn, in every one of `folders` (each
   * where its `searchScopedPaths` says, not `options.searchScopedPaths`),
   * as one search: each query's results ordered and cut to the page across
   * all of them, with the totals of all of them (mergeSearchResults). Each
   * result says which folder it came from.
   *
   * Every folder's engine is kept while they're searched together (see
   * MegaSearchEngines.getAll), so their memory adds up, as it would for one
   * folder holding them all.
   *
   * Once `options.signal` aborts it stops — between folders or queries, or
   * between documents within one (see SearchOptions.signal) — and rejects
   * with the signal's reason.
   */
  static async searchFolders(
    foldersNamed: SearchFolder[],
    queries: string[],
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const { signal } = options;
    const searchOptions = { ...SEARCH_DEFAULTS, ...options };

    // A folder named twice would find everything twice: searched once, as
    // first named
    const folderKeys = new Set<string>();
    const folders = foldersNamed.filter((folder) => {
      const key = folderKey(resolveRootDirectory(folder.sourcePath));
      if (folderKeys.has(key)) return false;
      folderKeys.add(key);
      return true;
    });

    const folderEngines = await engines.getAll(
      folders.map((folder) => resolveRootDirectory(folder.sourcePath)),
    );
    // One at a time: refreshing indexes documents, and each folder's indexer
    // takes the CPU it's given already
    for (const [index, folder] of folders.entries()) {
      await refreshForSearch(
        folderEngines[index].megaSearch,
        folder.searchScopedPaths,
        signal,
      );
    }

    const results: SearchResult[] = [];

    for (const query of queries) {
      // Lets an abort in: scoring a query runs in one go, and one with its
      // results cached reads nothing from disk, so queries alone never would
      if (signal) await nextTurn();
      signal?.throwIfAborted();

      try {
        const resultsPerFolder: PaginatedSearchResult[] = [];

        for (const [index, folder] of folders.entries()) {
          const found = await folderEngines[index].megaSearch.search(query, {
            ...searchOptions,
            ...pageOptionsForMerge(searchOptions),
            searchScopedPaths: folder.searchScopedPaths ?? [],
          });

          // New objects: the engine caches the ones it returned
          resultsPerFolder.push({
            ...found,
            results: found.results.map((item) => ({
              ...item,
              sourcePath: folder.sourcePath,
            })),
          });
        }

        const merged = mergeSearchResults(resultsPerFolder, searchOptions);

        results.push({
          query,
          success: true,
          results: merged.results as SearchResultItem[],
          pagination: merged.pagination,
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
export type { SearchFolder, SearchResult, SearchResultItem };
