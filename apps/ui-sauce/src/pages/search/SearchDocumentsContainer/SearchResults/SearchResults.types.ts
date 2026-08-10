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
  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;
}

export type { SearchResultsProps };
