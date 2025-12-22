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

  async getMegaSearchInstance(): Promise<MegaSearch> {
    if (!this.megaSearchInstance) {
      const sourcePath = path.join(runtimePathById.assets, 'docs-for-nlp');
      this.megaSearchInstance = await createMegaSearch({
        rootDirectory: sourcePath,
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
