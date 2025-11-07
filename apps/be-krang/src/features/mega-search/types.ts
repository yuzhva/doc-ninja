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
