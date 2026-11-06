import type { TokenPositions } from './token-positions.mjs';

interface DocumentMetadata {
  fileName: string;
  /** Absolute path to the original source file (e.g. .doc, .docx) */
  originalFilePath: string;
  /**
   * Absolute path to the converted plain text file in the cache.
   * This file contains the actual text content used for indexing and snippet generation.
   * Use this file for reading content based on charStart/charEnd positions.
   */
  textFilePath?: string;
  lastModified: number;
  size: number;
  indexed: boolean;
  indexedAt?: number;
  language: 'ukrainian' | 'english' | 'mixed' | 'unknown';
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
  vocab: string[]; // Array of unique words in the document
  /** Each token's vocab index and the characters it spans, in text order. */
  positions: TokenPositions;
  /**
   * What glues a token to the one before it, by the token's position, where
   * one of the two is a number: "22.12.2024" → "." at 12 and at 2024. See
   * findJoints.
   */
  joints: Record<number, string>;
  termFrequency: Map<string, number>;
  /** Words only: the numbers among `positions` don't count. */
  wordCount: number;
  paragraphs?: ParagraphInfo[]; // Add paragraph structure
}

interface InvertedIndexEntry {
  documentId: string;
  frequency: number;
  positions: number[];
}

/** What a search reads from the inverted index. */
interface PostingsReader {
  /** The term's postings, one per document holding it; undefined if none does. */
  get(term: string): InvertedIndexEntry[] | undefined;
}

/**
 * One version of the index, as a search reads it: in place, never copied
 * (FileIndexer.getSearchSnapshot). Nothing in it changes once searches can
 * read it, so a search reads the same version from start to end.
 */
interface SearchSnapshot {
  /** The version: see FileIndexer.indexGeneration. */
  generation: number;
  docCache: ReadonlyMap<string, DocumentIndex>;
  invertedIndex: PostingsReader;
  /** Stem → its words. Words only: a number is its own term, with no forms. */
  stemDictionary: ReadonlyMap<string, ReadonlySet<string>>;
}

interface GlobalIndex {
  invertedIndex: Map<string, InvertedIndexEntry[]>;
  documentCache: Map<string, DocumentIndex>;
  stemDictionary: Map<string, string[]>;
}

interface SearchConfig {
  /** The root directory to scan for documents. */
  rootDirectory: string;
  /** An array of file extensions to include in the index (e.g., ['.txt', '.docx']). */
  extensions: string[];
  /** The maximum file size in bytes to process. Files larger than this will be skipped. */
  maxFileSize: number; // in bytes
  /** DEPRECATED. Use globalIndexPath instead. */
  indexPath?: string;
  /** The number of concurrent workers to use for parallel processing tasks. */
  concurrency: number;
  /** The root directory for all cache files. Defaults to '.cache' inside rootDirectory. */
  cacheRoot?: string;
  /** The subdirectory within cacheRoot for storing extracted text files. Defaults to 'txt'. */
  txtCacheSubdir?: string;
  /** The subdirectory within cacheRoot for storing individual document index files. Defaults to 'index'. */
  indexCacheSubdir?: string;
  /** The full path to the compressed global index file. Defaults to '.cache/global-inverted-index.json.gz'. */
  globalIndexPath?: string;

  // BM25 scoring parameters
  /** BM25 k1 parameter. Controls term frequency saturation. Good values are between 1.2 and 2.0. Default: 1.2. */
  bm25K1?: number;
  /** BM25 b parameter. Controls document length normalization. Good values are around 0.75. Default: 0.75. */
  bm25B?: number;
  /** Whether to use BM25 scoring. If false, TF-IDF is used. Default: true. */
  useBM25?: boolean;

  // Index rebuild threshold configuration
  /**
   * The share of indexed documents that need re-indexing to rebuild the
   * inverted index from every document. Fewer changes update it for the
   * changed documents only, which reads no other document from disk. Either
   * way every change is applied, in the next search. A lower value means
   * more frequent full rebuilds. Default: 0.2 (a fifth).
   */
  indexRebuildThreshold?: number;
  /**
   * The minimum number of re-indexed files for a full rebuild, whatever the
   * threshold. Default: 1.
   */
  minFilesForRebuild?: number;
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
  GlobalIndex,
  PostingsReader,
  SearchConfig,
  SearchSnapshot,
  SearchMatch,
  SearchResult,
  SearchToken,
  ProcessedSearchToken, // Export the new type
  ParagraphInfo, // Export new type
  SafeSearchResult, // Export error handling type
};
