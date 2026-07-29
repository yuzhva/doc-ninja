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

// Represents an extracted information item (found in 'extractedResults').
// searchQuery/foundInDocument/matchedText/position are structural (always
// present, set by the BE regardless of schema); every schema-defined field
// (documentNumber, summary, ...) is nested under extractedFieldById instead
// of being spread onto this object, so it can't be typed as a fixed set of
// keys — see getExtractedFieldOutputs() in FormProcessDocumentTabItem.components.tsx
// for how the FE discovers which fields exist and where to show them.
interface ExtractedResultItem {
  searchQuery: string;
  foundInDocument: string;
  matchedText: string;
  originalFilePath?: string;
  position?: number;
  extractedFieldById: Record<string, string | number | null | undefined>;
}

// Container that holds both the NLP extraction and the raw search metadata
interface RichProcessedResultItem {
  extracted: ExtractedResultItem;
  search?: SearchResultItem | null;
}

// Alias for backward compatibility (used in reducers)
// Updated to use the Rich container
type ProcessedResultItem = RichProcessedResultItem;

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
type GroupedProcessedResults = Record<string, RichProcessedResultItem[]>;

export type {
  DocumentMetadata,
  ExtractedResultItem,
  GroupedProcessedResults,
  ProcessDocumentsApiResponse,
  ProcessedResultItem,
  RichProcessedResultItem,
  SearchResultItem,
  SearchResultSet,
  Snippet,
};
