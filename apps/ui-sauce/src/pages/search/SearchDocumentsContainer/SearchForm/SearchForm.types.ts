import type { BatchFileProcessingSectionProps } from '../../../../hooks/use-batch-processor';

interface SearchFormProps {
  onSelectSourceDirectory: BatchFileProcessingSectionProps['onSelectSourceDirectory'];
  initSubmitHandler: BatchFileProcessingSectionProps['initSubmitHandler'];
  sourceDirectory: BatchFileProcessingSectionProps['sourceDirectory'];
  isFileSystemAccessSupported: boolean;
  isProcessing: boolean;

  // Directory tree — data/selection live in the container (shared with the
  // search request payload), the form only renders and toggles it.
  directoryData: any;
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

  // Parser config — the selected schema also feeds the container's submit
  // handler (override-precedence check), so the list/selection are owned there.
  parserConfigs: any[];
  selectedParserConfigName: string;
  onSelectedParserConfigNameChange: (name: string) => void;
  onParserConfigsSaved: () => void;

  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;

  onSubmit: Parameters<BatchFileProcessingSectionProps['initSubmitHandler']>[0];
}

export type { SearchFormProps };
