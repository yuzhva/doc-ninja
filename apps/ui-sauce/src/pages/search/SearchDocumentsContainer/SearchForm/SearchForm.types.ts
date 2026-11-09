import type { UseDirectoryPicker } from '../../../../hooks/use-file-system';

/**
 * What the form asks to search for, as its fields stand when it's submitted.
 * Where to search — the folders and their ticks — isn't in it: those are kept
 * by searchSourcesStore, which the search rescans right before it runs.
 */
interface SearchRequest {
  /** One per entry, as typed: blank rows and padding are dropped on send. */
  queries: string[];
  /** Whether other forms of a query's words match too. */
  isInflectedWordFormsAllowed: boolean;
  /** How many typos a word may have and still match. */
  maxTypoDistance: number;
  /** How many documents each query brings back. */
  pageSize: number | 'ALL';
  sortOrder: 'asc' | 'desc';
}

/**
 * The form owns its fields, and shows and changes the folders through
 * searchSourcesStore: typing, ticking or folding renders the form alone,
 * never the container and the results beside it. Only a submit reaches the
 * container, as a SearchRequest.
 */
interface SearchFormProps {
  // Opens the folder picker, resolving to the folder picked (or null): the
  // form adds it to the folders searched.
  onSelectSourceDirectory: UseDirectoryPicker['selectDirectory'];
  isFileSystemAccessSupported: boolean;
  isProcessing: boolean;

  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;

  onSearch: (request: SearchRequest) => void;
}

export type { SearchFormProps, SearchRequest };
