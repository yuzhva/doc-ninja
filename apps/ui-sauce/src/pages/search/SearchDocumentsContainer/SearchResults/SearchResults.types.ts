import type {
  GroupedProcessedResults,
  SearchQueryTotals,
} from '../../search-page.types';

interface SearchResultsProps {
  results: GroupedProcessedResults;
  // Engine totals keyed by search query — what was found, as opposed to
  // `results`, which holds only what the response returned and the filters kept.
  totalsByQuery: Record<string, SearchQueryTotals>;
  // The names of the parser configs the results were extracted with — one per
  // folder searched, so possibly several. The schemas are looked up locally,
  // since nothing outside this pane needs them.
  parserConfigNames: string[];
  // Drives the pane's loading state: the toolbars and the result rows are
  // replaced by skeletons for as long as a search is in flight.
  isProcessing: boolean;
  addToast: (
    type: 'success' | 'error' | 'warning',
    content: React.ReactNode,
  ) => void;
}

export type { SearchResultsProps };
