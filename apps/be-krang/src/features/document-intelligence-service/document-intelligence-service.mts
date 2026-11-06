import path from 'path';
import type { PaginatedSearchResult, SearchOptions } from 'toolkit--local/node';
import { MegaSearch, createMegaSearch } from 'toolkit--local/node';

import { runtimePathById } from '../../supplement/index.mjs';
import { MegaSearchEngines } from './mega-search-engines.mjs';

/**
 * Every request's search engines, one per source folder. Each watches its
 * folder, so a request lists the folder's files only after one changed.
 */
const engines = new MegaSearchEngines({
  createEngine: (rootDirectory) =>
    createMegaSearch({ rootDirectory, concurrency: 4, watchFiles: true }),
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
   * This folder's search engine, shared across requests and up to date with
   * the files on disk: a new engine indexes the folder as it's created, one
   * made earlier first picks up the documents added, edited or deleted
   * since. It lists the folder's files for that only when its watcher saw a
   * change, or a minute went by. Requests that come in together share that
   * refresh.
   */
  async getMegaSearchInstance(): Promise<MegaSearch> {
    const { megaSearch, isNew } = await engines.get(this.rootDirectory);
    if (!isNew) {
      try {
        await megaSearch.refresh();
      } catch (error) {
        // The index from before is a better answer than none
        console.error('Search index refresh failed:', error);
      }
    }
    return megaSearch;
  }

  async searchDocuments(
    queries: string[],
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const megaSearch = await this.getMegaSearchInstance();
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
   * Re-runs indexing for this instance's rootDirectory. Same incremental
   * engine that runs on first search (only new/changed files are
   * reprocessed, deleted files are pruned) — this just lets a caller
   * trigger it explicitly, independent of running a search.
   */
  async reindex(): Promise<void> {
    const { megaSearch, isNew } = await engines.get(this.rootDirectory);
    // A new engine has just indexed the folder
    if (!isNew) await megaSearch.reindex();
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
