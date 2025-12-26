import path from 'path';
import type {
  MegaSearch,
  PaginatedSearchResult,
  SearchOptions,
} from 'toolkit--local/node';
import { createMegaSearch } from 'toolkit--local/node';

import { runtimePathById } from '../../supplement/index.mjs';

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
  private megaSearchInstance: MegaSearch | null = null;
  private rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = path.isAbsolute(rootDirectory)
      ? rootDirectory
      : // NOTE: "workaround" for "Browser dev mode"
        // Docker container - does NOT have access to Local File System, so we are resolving to assets folder
        path.join(runtimePathById.assets, rootDirectory);
  }

  async getMegaSearchInstance(): Promise<MegaSearch> {
    if (!this.megaSearchInstance) {
      this.megaSearchInstance = await createMegaSearch({
        rootDirectory: this.rootDirectory,
        concurrency: 4,
      });
    }
    return this.megaSearchInstance;
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
          fuzzyPhrase: true,
          fuzzyThreshold: 1,
          fuzzyPhraseMaxDistance: 1,
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
}

// Singleton instance
export { DocumentIntelligenceService };
export type { SearchResult };
