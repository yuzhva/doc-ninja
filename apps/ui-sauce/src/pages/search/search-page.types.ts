interface Snippet {
  content: string;
  page?: number;
  score?: number;
}

interface DocumentMetadata {
  fileName: string;
  originalFilePath: string;
  fileSize: number;
  modifiedAt?: string;
  [key: string]: any;
}

// Represents a raw search result item (found in 'results.results')
interface SearchResultItem {
  doc: DocumentMetadata;
  score: number;
  snippets: Snippet[];
  highlights?: any[];
}

interface SearchResultSet {
  // The query this set answers — the BE sends one set per query term
  // (DocumentIntelligenceService.searchDocuments), which is what lets the FE
  // match a set back to its group.
  query: string;
  success?: boolean;
  results: SearchResultItem[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalResults: number;
    totalMatches: number;
    resultsPerPage: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// What the engine actually found for a query, as opposed to what came back in
// the response: `pageSize` caps the returned documents, so these totals are the
// only way the UI can say "showing N of M".
interface SearchQueryTotals {
  /** Individual matches across all documents. */
  totalMatches: number;
  /** Documents containing at least one match. */
  totalResults: number;
}

// Represents an extracted information item (found in 'extractedResults').
// searchQuery/foundInDocument/matchedText/position are structural (always
// present, set by the BE regardless of schema); every schema-defined field
// (documentNumber, summary, ...) is nested under extractedFieldById instead
// of being spread onto this object, so it can't be typed as a fixed set of
// keys — see getExtractedFieldOutputs() in
// SearchDocumentsContainer/SearchResults/result-helpers.ts for how the FE
// discovers which fields exist and where to show them.
interface ExtractedResultItem {
  searchQuery: string;
  foundInDocument: string;
  matchedText: string;
  originalFilePath?: string;
  // The source folder searched that the document is in, as the request named
  // it — several can be searched at once, each with its own parser config.
  sourcePath?: string;
  position?: number;
  // Always string|null — mirrors information-extractor.mts's ExtractedFields.
  // Every pipeline rule and compound resolves to text (or null), never a number.
  extractedFieldById: Record<string, string | null | undefined>;
  // Not from the BE: the field of `extractedFieldById` holding this match's
  // body text, as its folder's parser config marks it — stamped on when the
  // response comes in (see SearchDocumentsContainer, getPrimaryText).
  primaryFieldId?: string | null;
}

// Container that holds both the NLP extraction and the raw search metadata
interface RichProcessedResultItem {
  extracted: ExtractedResultItem;
  search?: SearchResultItem | null;
}

// One doc-identifier-deduped group of matches within a search query — the
// actual per-key array element built by the reducer in
// SearchDocumentsContainer.tsx (never a bare RichProcessedResultItem).
interface ProcessedResultGroup {
  docName: string;
  uniqueId?: string;
  items: RichProcessedResultItem[];
  search?: SearchResultItem | null;
}

// Represents the full response from the backend
interface ProcessDocumentsApiResponse {
  batchIndex: number;
  totalBatches: number;
  processedFiles: string[]; // List of processed file paths/names
  failedFiles: { path: string; error: string }[] | any[];
  summary: {
    processed: number;
    failed: number;
  };
  // Raw search results from the engine - Array of result sets (one per query)
  results: SearchResultSet[];
  // Intelligent extraction results
  extractedResults: ExtractedResultItem[];
}

// Represents the state in the UI (grouped by name/query)
type GroupedProcessedResults = Record<string, ProcessedResultGroup[]>;

export type {
  DocumentMetadata,
  ExtractedResultItem,
  GroupedProcessedResults,
  ProcessDocumentsApiResponse,
  ProcessedResultGroup,
  RichProcessedResultItem,
  SearchQueryTotals,
  SearchResultItem,
  SearchResultSet,
  Snippet,
};
