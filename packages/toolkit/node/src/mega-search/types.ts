interface DocumentMetadata {
  filePath: string;
  fileName: string;
  lastModified: number;
  size: number;
  indexed: boolean;
  indexedAt?: number;
  language: 'ukrainian' | 'english' | 'mixed';
}

interface SearchToken {
  term: string;
  position: number;
  normalized: string;
  charStart: number; // Character start position in original text
  charEnd: number; // Character end position in original text
}

// Add a more specific token type for better type safety
interface ProcessedSearchToken {
  term: string;
  position: number;
  normalized: string;
  charStart: number;
  charEnd: number;
}

interface ParagraphInfo {
  content: string;
  startPos: number;
  endPos: number;
  tokenStart: number;
  tokenEnd: number;
}

interface DocumentIndex {
  metadata: DocumentMetadata;
  tokens: ProcessedSearchToken[]; // Use more specific type
  termFrequency: Map<string, number>;
  wordCount: number;
  originalText: string; // Store original text for highlighting
  paragraphs?: ParagraphInfo[]; // Add paragraph structure
}

interface HighlightInfo {
  term: string; // Original query term (stemmed)
  originalWord: string; // Actual word found in document
  charStart: number; // Character position in original text
  charEnd: number; // End character position
  confidence: number; // Match confidence (1.0 for exact, lower for fuzzy)
}

interface InvertedIndexEntry {
  documentId: string;
  frequency: number;
  positions: number[];
}

interface SearchConfig {
  rootDirectory: string;
  extensions: string[];
  maxFileSize: number; // in bytes
  indexPath?: string;
  concurrency: number;
  ukrainianStemming: boolean;
  cacheRoot?: string;
  txtCacheSubdir?: string;
  indexCacheSubdir?: string;
  globalIndexPath?: string; // <-- add this line

  // BM25 scoring parameters
  bm25K1?: number; // Default: 1.2 (term frequency saturation parameter)
  bm25B?: number; // Default: 0.75 (length normalization parameter)
  useBM25?: boolean; // Default: true (use BM25 instead of TF-IDF)

  // Index rebuild threshold configuration
  indexRebuildThreshold?: number; // Default: 0.001 (0.1%)
  minFilesForRebuild?: number; // Default: 1 (minimum files to trigger rebuild)
}

interface SearchResult {
  documentId: string;
  score: number;
  matches: SearchMatch[];
}

interface SearchMatch {
  term: string;
  positions: number[];
  context: string;
}

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalResults: number;
  resultsPerPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface PaginatedSearchResult {
  results: Array<{
    doc: any;
    score: number;
    snippets: string[];
    highlights: HighlightInfo[];
  }>;
  pagination: PaginationInfo;
}

// Add error handling wrapper type
interface SafeSearchResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type {
  DocumentIndex,
  DocumentMetadata,
  InvertedIndexEntry,
  SearchConfig,
  SearchMatch,
  SearchResult,
  SearchToken,
  ProcessedSearchToken, // Export the new type
  ParagraphInfo, // Export new type
  HighlightInfo,
  PaginationInfo,
  PaginatedSearchResult,
  SafeSearchResult, // Export error handling type
};
