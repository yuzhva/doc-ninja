interface SearchResult<T = any> {
  results: T[];
  pagination: PaginationInfo;
  metadata: SearchMetadata;
}

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalResults: number;
  resultsPerPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface SearchMetadata {
  query: string;
  executionTime: number;
  searchType: 'exact' | 'fuzzy' | 'phrase';
  scoringMethod: string;
}

interface SearchableDocument {
  id: string;
  filePath: string;
  fileName: string;
  content: string;
  language: 'ukrainian' | 'english' | 'mixed';
  lastModified: Date;
}

interface SearchEngine<T = SearchableDocument> {
  search(query: string, options?: SearchOptions): Promise<SearchResult<T>>;
  getStats(): SearchStats;
  reindex(): Promise<void>;
}

interface SearchOptions {
  topN?: number;
  fuzzy?: boolean;
  fuzzyThreshold?: number;
  snippetsLimit?: number | 'ALL';
  page?: number;
  pageSize?: number;
  filters?: SearchFilter[];
}

interface SearchFilter {
  field: string;
  value: any;
  operator: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'range';
}

interface SearchStats {
  documentsCount: number;
  termsCount: number;
  totalTokens: number;
  averageDocumentLength: number;
  indexSize: number;
}

export {
  PaginationInfo,
  SearchableDocument,
  SearchEngine,
  SearchFilter,
  SearchMetadata,
  SearchOptions,
  SearchResult,
  SearchStats,
};
