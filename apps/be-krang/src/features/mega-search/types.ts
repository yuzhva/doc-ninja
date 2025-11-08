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
}

interface DocumentIndex {
  metadata: DocumentMetadata;
  tokens: SearchToken[];
  termFrequency: Map<string, number>;
  wordCount: number;
}

interface InvertedIndexEntry {
  documentId: string;
  frequency: number;
  positions: number[];
}

export interface SearchConfig {
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

export type {
  DocumentIndex,
  DocumentMetadata,
  InvertedIndexEntry,
  SearchConfig,
  SearchMatch,
  SearchResult,
  SearchToken,
};
