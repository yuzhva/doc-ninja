import type { BatchFileProcessingSectionProps } from '../../../../hooks/use-batch-processor';
import type { SearchSource, SearchSourceChanges } from '../search-sources';

interface SearchFormProps {
  // Opens the folder picker; the folder picked joins `sources` (see the
  // container).
  onSelectSourceDirectory: BatchFileProcessingSectionProps['onSelectSourceDirectory'];
  initSubmitHandler: BatchFileProcessingSectionProps['initSubmitHandler'];
  isFileSystemAccessSupported: boolean;
  isProcessing: boolean;

  // The folders searched, each with its parser config — owned by the
  // container, which builds the search request out of them.
  sources: SearchSource[];
  onRemoveSource: (sourcePath: string) => void;
  onSourceChange: (sourcePath: string, changes: SearchSourceChanges) => void;

  // Directory trees — the selection lives in the container (shared with the
  // search request payload), the form only renders and toggles it.
  selectedPaths: Set<string>;
  onTogglePath: (path: string, checked: boolean) => void;

  // One search query per entry. Owned by the container because the payload
  // sends it as an array, and FormData can't carry one through the
  // Object.fromEntries() the submit handler builds `formDataJSON` with.
  searchQueries: string[];
  onSearchQueriesChange: (queries: string[]) => void;

  // Typo tolerance — read directly from state (not FormData) when building
  // the search payload, so the container owns it.
  allowFuzzyMatch: boolean;
  onAllowFuzzyMatchChange: (value: boolean) => void;
  maxTypoDistance: string;
  onMaxTypoDistanceChange: (value: string) => void;

  // Every parser config there is, for each folder to pick from.
  parserConfigs: any[];
  onParserConfigsSaved: () => void;

  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;

  onSubmit: Parameters<BatchFileProcessingSectionProps['initSubmitHandler']>[0];
}

export type { SearchFormProps };
