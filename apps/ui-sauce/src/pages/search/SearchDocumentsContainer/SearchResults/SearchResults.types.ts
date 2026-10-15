import type {
  GroupedProcessedResults,
  SearchQueryTotals,
} from '../../search-page.types';

interface SearchResultsProps {
  results: GroupedProcessedResults;
  // Engine totals keyed by search query — what was found, as opposed to
  // `results`, which holds only what the response returned and the filters kept.
  totalsByQuery: Record<string, SearchQueryTotals>;
  // Raw shared state (also read by the container's submit handler) — the
  // schema itself is derived locally from these, since nothing outside this
  // pane needs the derived value.
  parserConfigs: any[];
  selectedParserConfigName: string;
  // Drives the pane's loading state: the toolbars and the result rows are
  // replaced by skeletons for as long as a search is in flight.
  isProcessing: boolean;
  // Whether a source folder is configured at all — derived from
  // `directoryData` (the persisted selection), not the raw `sourceDirectory`
  // file-picker result, which is session-only and would read false on every
  // reload even when a folder is already set. Same signal SearchForm uses to
  // disable its own submit button.
  isSourceDirectorySelected: boolean;
  addToast: (
    type: 'success' | 'error' | 'warning',
    content: React.ReactNode,
  ) => void;
}

export type { SearchResultsProps };
