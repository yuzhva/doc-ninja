import path from 'path';
import type { PaginatedSearchResult, SearchOptions } from 'toolkit--local/node';
import { MegaSearch, createMegaSearch } from 'toolkit--local/node';

import { runtimePathById } from '../../supplement/index.mjs';
import { MegaSearchEngines } from './mega-search-engines.mjs';

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
  closeEngine: (megaSearch) => megaSearch.close(),
});

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
   */
  async getMegaSearchInstance(
    searchScopedPaths?: string[],
  ): Promise<MegaSearch> {
    const { megaSearch } = await engines.get(this.rootDirectory);
    try {
      await megaSearch.refresh(searchScopedPaths);
    } catch (error) {
      // The index from before is a better answer than none — if there is one
      if (megaSearch.getStats().documentsCount === 0) throw error;
      console.error('Search index refresh failed:', error);
    }
    return megaSearch;
  }

  async searchDocuments(
    queries: string[],
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const megaSearch = await this.getMegaSearchInstance(
      options.searchScopedPaths,
    );
    const results: SearchResult[] = [];

    for (const query of queries) {
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
