type SearchOptions = {
  /**
   * Max number of results to return (default: 50).
   * Used for internal scoring limits before pagination.
   */
  topN?: number;

  /**
   * "Allow fuzzy match" in the UI (default: true). Despite its name it does
   * not control typos — maxTypoDistance does, in both modes:
   * - true:  any inflected form of a query word matches: "Євгена" finds
   *          "Євген", "Євгену", "Євгеній"; "parked" finds "parking", "parks".
   * - false: only the form typed (letter case aside): "Євгена" finds "Євгена".
   */
  isTypoToleranceEnabled?: boolean;

  /**
   * Max character edits allowed per word (default: 1; 0 = no typos), with
   * fuzzy match on and off alike: "єгена" finds "Євгена" either way — and,
   * with fuzzy match on, the other forms of "Євген" too.
   * 1 = one character difference (insertion, deletion, substitution)
   * Example: "apple" matches "apply" (1 substitution: e→y)
   * Example: "search" matches "serach" (1 transposition)
   * Increase to 2 for longer words or more typos.
   */
  maxTypoDistance?: number;

  // Word-level phrase proximity
  /**
   * Search every multi-word query as a phrase (default: false), quoted or
   * not: its words in order, at most maxWordsInPhraseDistance words apart.
   * Without it, only a "quoted" query is a phrase, and a strict one.
   * Example: "rich car" matches "rich expensive car" with maxWordsInPhraseDistance=1
   */
  isPhraseProximityEnabled?: boolean;

  /**
   * Max words allowed between phrase terms (default: 0 for strict adjacency).
   * 0 = Words must be adjacent: "rich car" → "rich car" only
   * 1 = Allow 1 word gap: "rich car" → "rich expensive car"
   * 2 = Allow 2 word gap: "rich car" → "rich very expensive car"
   * Example: "san francisco" matches "san jose to francisco" with maxWordsInPhraseDistance=2
   */
  maxWordsInPhraseDistance?: number;

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
