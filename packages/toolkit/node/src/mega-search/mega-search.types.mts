type SearchOptions = {
  /**
   * Max number of results to return (default: 50).
   * Used for internal scoring limits before pagination.
   */
  topN?: number;

  /**
   * Enable fuzzy matching for individual terms (default: true).
   * Allows finding "apple" when searching for "aple".
   */
  fuzzy?: boolean;

  /**
   * Max Levenshtein distance for fuzzy matching (default: 1).
   * 1 means one character difference (insertion, deletion, substitution).
   * Increase to 2 for longer words or more typos.
   */
  fuzzyThreshold?: number;

  /**
   * Number of snippets to generate per document (default: 3).
   * Set to 'ALL' to get all occurrences.
   */
  snippetsLimit?: number | 'ALL';

  /**
   * Page number for pagination (1-based, default: 1).
   */
  page?: number;

  /**
   * Number of results per page (default: 10).
   */
  pageSize?: number | 'ALL';

  /**
   * Enable fuzzy matching *within* phrase searches (default: false).
   * Essential for finding "richi cars" when searching "rich car".
   * If false, phrases require exact word matches (modulo stemming).
   */
  fuzzyPhrase?: boolean;

  /**
   * Max distance between words in a fuzzy phrase (default: 2).
   * 1 = Strict adjacency (words must be next to each other).
   * 2 = Allows 1 word in between (e.g. "richi [middle] cars").
   * To preserve strict order like "Word1 Word2", set this to 1.
   */
  fuzzyPhraseMaxDistance?: number;

  /**
   * Sort results by 'relevance' (default) or 'date' (from filename).
   */
  sortBy?: 'relevance' | 'date';

  /**
   * Sort order: 'asc' (oldest first) or 'desc' (newest first). Default: 'desc'.
   */
  sortOrder?: 'asc' | 'desc';

  /**
   * Regex pattern to extract date from filename.
   * Must have 3 capturing groups: (Day, Month, Year).
   * Default handles: DD.MM.YYYY, DD-MM-YY, etc.
   */
  filenameDatePattern?: string;

  /**
   * Include full list of highlight positions in the response (default: false).
   * Disabling this improves performance for large documents as it avoids
   * iterating through the entire document to find every match.
   */
  includeHighlights?: boolean;

  /**
   * Number of tokens to include before the match in the snippet (default: 0).
   */
  snippetContextBefore?: number;

  /**
   * Number of tokens to include after the match in the snippet (default: 30).
   */
  snippetContextAfter?: number;

  /**
   * List of paths to restrict the search to specific scopes (default: all indexed paths).
   * Useful for multi-tenant setups or when documents are organized in distinct folders.
   */
  searchScopedPaths?: string[];
};

// NEW: Enhanced snippet information with position data
interface SnippetInfo {
  context: string; // The snippet context with highlighting
  match: string; // The exact matched text from the document
  matchStartTokenIndex: number; // Starting token position of the match in the document
  matchEndTokenIndex: number; // Ending token position of the match in the document
  matchCharStart?: number; // Character position of the match in the original text (if available)
  matchCharEnd?: number; // End character position of the match in the original text (if available)
  matchType: 'token' | 'exact-phrase' | 'fuzzy-phrase'; // Type of match
  confidence: number; // Overall confidence score for this snippet
  highlights: Array<{
    term: string;
    originalWord: string;
    tokenIndex: number;
    charStart?: number;
    charEnd?: number;
  }>; // Highlight positions within this snippet
}

interface HighlightInfo {
  term: string; // Original query term (stemmed)
  originalWord: string; // Actual word found in document
  charStart: number; // Character position in original text
  charEnd: number; // End character position
  confidence: number; // Match confidence (1.0 for exact, lower for fuzzy)
}

type PaginatedSearchResult = {
  results: Array<{
    doc: any;
    score: number;
    snippets: SnippetInfo[];
    highlights: HighlightInfo[];
  }>;
  pagination: PaginationInfo;
};

type PaginationInfo = {
  currentPage: number;
  totalPages: number;
  totalResults: number;
  totalMatches: number;
  resultsPerPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type {
  HighlightInfo,
  PaginatedSearchResult,
  PaginationInfo,
  SearchOptions,
  SnippetInfo,
};
