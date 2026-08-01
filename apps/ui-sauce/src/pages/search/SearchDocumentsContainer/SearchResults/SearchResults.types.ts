import type { GroupedProcessedResults } from '../../search-page.types';

interface SearchResultsProps {
  results: GroupedProcessedResults;
  // Raw shared state (also read by the container's submit handler) — the
  // schema itself is derived locally from these, since nothing outside this
  // pane needs the derived value.
  parserConfigs: any[];
  selectedParserConfigName: string;
  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;
}

export type { SearchResultsProps };
