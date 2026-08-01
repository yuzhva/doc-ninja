import React from 'react';
import { FileSystemItem } from 'toolkit--local/browser';

import type { BatchFileProcessingSectionProps } from '../../../hooks/use-batch-processor';
import { fetchRequest } from '../../../utils';
import type {
  ExtractedResultItem,
  GroupedProcessedResults,
  ProcessDocumentsApiResponse,
  ProcessedResultGroup,
  SearchResultItem,
} from '../search-page.types';
import { SearchForm } from './SearchForm/SearchForm';
import { readStoredParserConfigs } from './SearchForm/components/FPDModalParserConfigSettings';
import { addSearchHistoryEntry } from './SearchForm/components/FPDModalSearchHistory';
import { SearchResults } from './SearchResults/SearchResults';

const SELECTED_PARSER_CONFIG_NAME_STORAGE_KEY =
  'docNinja_selectedParserConfigName';

const SearchDocumentsContainer = ({
  onSelectSourceDirectory,
  // onSelectOutputDirectory,
  executeBatch,
  initSubmitHandler,
  sourceDirectory,
  outputDirectory,
  selectedFile,
  // progress,
  isFileSystemAccessSupported,
  isProcessing,
  addToast,
}: BatchFileProcessingSectionProps & {
  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;
}) => {
  const [processedResults, setProcessedResults] =
    React.useState<GroupedProcessedResults>({});

  // Initialize from LocalStorage if available
  // Store the entire processed result object instead of just the structure
  const [directoryData, setDirectoryData] = React.useState<any>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem('docNinja_directoryData'); // Renamed key
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = localStorage.getItem('docNinja_selectedPaths');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [allowFuzzyMatch, setAllowFuzzyMatch] = React.useState(true);
  const [maxTypoDistance, setMaxTypoDistance] = React.useState('1');

  // Parser config: determines how the backend extracts fields from documents.
  // Reloaded from localStorage whenever parserConfigsVersion changes (i.e. after
  // the settings modal saves), same pattern as filterConfigs in SearchResults.
  const [parserConfigsVersion, setParserConfigsVersion] = React.useState(0);
  const parserConfigs: any[] = React.useMemo(() => {
    return readStoredParserConfigs();
  }, [parserConfigsVersion]);

  const [selectedParserConfigName, setSelectedParserConfigName] =
    React.useState(() => {
      if (typeof window === 'undefined') return '';
      try {
        return (
          localStorage.getItem(SELECTED_PARSER_CONFIG_NAME_STORAGE_KEY) || ''
        );
      } catch {
        return '';
      }
    });

  // Keep the selection valid whenever the parser config list changes
  // (e.g. an entry was renamed or removed via the settings modal).
  // An empty selection ('') represents the "none" option and is always valid.
  React.useEffect(() => {
    if (parserConfigs.length === 0 || selectedParserConfigName === '') return;

    const stillExists = parserConfigs.some(
      (c: any) => c.name === selectedParserConfigName,
    );

    if (!stillExists) {
      setSelectedParserConfigName('');
    }
  }, [parserConfigs, selectedParserConfigName]);

  React.useEffect(() => {
    try {
      if (selectedParserConfigName) {
        localStorage.setItem(
          SELECTED_PARSER_CONFIG_NAME_STORAGE_KEY,
          selectedParserConfigName,
        );
      } else {
        localStorage.removeItem(SELECTED_PARSER_CONFIG_NAME_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('Failed to save selected parser config to storage', e);
    }
  }, [selectedParserConfigName]);

  const handleParserConfigsSaved = React.useCallback(() => {
    setParserConfigsVersion((v) => v + 1);
  }, []);

  // Persist state changes
  React.useEffect(() => {
    try {
      if (directoryData) {
        localStorage.setItem(
          'docNinja_directoryData', // Renamed key
          JSON.stringify(directoryData),
        );
      } else {
        localStorage.removeItem('docNinja_directoryData');
      }
    } catch (e) {
      console.warn('Failed to save directory data to storage', e);
    }
  }, [directoryData]);

  React.useEffect(() => {
    try {
      localStorage.setItem(
        'docNinja_selectedPaths',
        JSON.stringify(Array.from(selectedPaths)),
      );
    } catch (e) {}
  }, [selectedPaths]);

  // Build lookup maps for efficient recursive selection
  const { parentMap, childrenMap } = React.useMemo(() => {
    const parentMap = new Map<string, string | null>();
    const childrenMap = new Map<string, string[]>();

    if (!directoryData?.structure) return { parentMap, childrenMap }; // Check structure existence

    const traverse = (node: FileSystemItem, parent: string | null) => {
      parentMap.set(node.path, parent);
      const kids = node.fsNestedItems?.map((c) => c.path) || [];
      childrenMap.set(node.path, kids);
      node.fsNestedItems?.forEach((child) => traverse(child, node.path));
    };
    traverse(directoryData.structure, null); // Use structure from stored data
    return { parentMap, childrenMap };
  }, [directoryData]);

  const handleTogglePath = React.useCallback(
    (path: string, checked: boolean) => {
      setSelectedPaths((prev) => {
        const next = new Set(prev);

        // 1. Cascade DOWN: Select/Deselect all children/descendants
        const toggleChildren = (p: string, state: boolean) => {
          if (state) next.add(p);
          else next.delete(p);

          const kids = childrenMap.get(p);
          kids?.forEach((k) => toggleChildren(k, state));
        };
        toggleChildren(path, checked);

        // 2. Cascade UP: Update parents based on children state
        if (!checked) {
          // If unchecking a child, uncheck all parents immediately
          let curr = parentMap.get(path);
          while (curr && parentMap.has(curr)) {
            // Add check for existence in map to be safe
            next.delete(curr);
            curr = parentMap.get(curr);
          }
        } else {
          // If checking, check parent ONLY if all its children are now checked
          let curr = parentMap.get(path);
          while (curr && parentMap.has(curr)) {
            // Add check for existence in map to be safe
            const siblings = childrenMap.get(curr) || [];
            const allChecked = siblings.every((s) => next.has(s));
            if (allChecked) {
              next.add(curr);
              curr = parentMap.get(curr);
            } else {
              break; // Parent not fully selected, stop walking up
            }
          }
        }

        return next;
      });
    },
    [childrenMap, parentMap], // Dependencies remain the same
  );

  React.useEffect(() => {
    const buildTree = async () => {
      if (!sourceDirectory) return;

      try {
        // Use the structure already processed by FileSystemService
        if (sourceDirectory) {
          setDirectoryData(sourceDirectory); // Store the full object
          setSelectedPaths(new Set()); // Reset selection when source changes explicitly
          console.log('Directory tree built:', sourceDirectory.structure);
        }
      } catch (error) {
        console.error('Failed to build directory tree:', error);
      }
    };

    buildTree();
  }, [sourceDirectory]);

  const postProcessDocuments = React.useCallback<
    Parameters<typeof initSubmitHandler>[0]
  >(
    async (formDataJSON) => {
      addSearchHistoryEntry(String(formDataJSON.bulkNames || ''));

      const selectedParserConfig = parserConfigs.find(
        (c: any) =>
          c.name ===
          (formDataJSON.parserConfigName || selectedParserConfigName),
      );

      const payload = {
        ...formDataJSON,
        sourcePath:
          sourceDirectory?.structure?.path ||
          directoryData?.structure?.path ||
          '',
        searchScopedPaths: Array.from(selectedPaths),
        isTypoToleranceEnabled: allowFuzzyMatch,
        maxTypoDistance: Number(maxTypoDistance),
        // Sent to the backend so it knows which pipelines/compounds to
        // parse the matched documents with. API wiring TBD server-side.
        extractorSchema: selectedParserConfig,
      };

      return executeBatch(
        {
          formDataJSON: payload,
          processedDir: selectedFile!,
          destinationHandle: outputDirectory?.browserFSAPIhandle!,
          validationMessage: 'Please select an output folder.',
          successMessage: 'Document processing completed successfully!',
          isWritingFilesSkipped: true,
          isLocalFileSystemRequest: true,
          // No subfolderPath specified - files will be saved in root
        },
        async () => {
          return fetchRequest('/api-local/process/documents', {
            method: 'POST',
            body: JSON.stringify(payload),
          }).then((resAsJson: ProcessDocumentsApiResponse) => {
            if (resAsJson && resAsJson.extractedResults) {
              // 1. Create a lookup map for search results by originalFilePath (unique)
              // This allows us to link the extracted results with full file metadata accurately
              const searchResultLookup = new Map<string, SearchResultItem>();

              // Handle nested structure: results is an array of SearchResultSet (one per query term)
              if (Array.isArray(resAsJson.results)) {
                for (const resultSet of resAsJson.results) {
                  if (resultSet.results && Array.isArray(resultSet.results)) {
                    for (const searchResult of resultSet.results) {
                      // Use originalFilePath as key if available
                      const key = searchResult.doc?.originalFilePath;

                      if (key) {
                        searchResultLookup.set(key, searchResult);
                      }
                    }
                  }
                }
              }

              const groupedResults = resAsJson.extractedResults.reduce(
                (acc: GroupedProcessedResults, item: ExtractedResultItem) => {
                  const key = item.searchQuery;
                  if (!acc[key]) {
                    acc[key] = [];
                  }

                  // 2. Wrap in RichProcessedResultItem container
                  // Find corresponding search result if available using unique path
                  let searchResult: SearchResultItem | null = null;

                  // Use originalFilePath from BE (Added in update) as the primary identifier
                  const docIdentifier = item.originalFilePath;

                  if (docIdentifier) {
                    searchResult =
                      searchResultLookup.get(docIdentifier) || null;

                    // Fallback try: if docIdentifier was just a name, but map is keyed by path?
                    // Or if item.originalFilePath is missing, we only have name. Map keys might be paths.
                    // This mismatch is handled if BE provides item.originalFilePath matching searchResult.doc.originalFilePath.
                  }

                  // Group by docIdentifier (unique path) to squash duplicates correctly
                  // Check existing group by the unique identifier we derived
                  const existingDocGroup = acc[key].find(
                    (g: ProcessedResultGroup) => {
                      // Check against the group's unique ID we store (we'll start storing it)
                      // Or check against stored search result path
                      const groupPath =
                        g.uniqueId || g.search?.doc?.originalFilePath;
                      return groupPath === docIdentifier;
                    },
                  );

                  const newItem = {
                    extracted: item,
                    search: searchResult,
                  };

                  if (existingDocGroup) {
                    existingDocGroup.items.push(newItem);
                  } else {
                    acc[key].push({
                      docName: item.foundInDocument || 'Unknown', // Display name
                      uniqueId: docIdentifier, // Store unique ID for grouping check
                      items: [newItem],
                      // Use first result as the main search ref for file path/metadata
                      search: searchResult,
                    });
                  }
                  return acc;
                },
                {} as GroupedProcessedResults,
              );
              setProcessedResults(groupedResults);
            }
            return resAsJson;
          });
        },
      );
    },
    [
      executeBatch,
      selectedFile,
      outputDirectory,
      sourceDirectory,
      directoryData, // Updated dependency
      selectedPaths,
      allowFuzzyMatch,
      maxTypoDistance,
      parserConfigs,
      selectedParserConfigName,
    ],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <SearchForm
        onSelectSourceDirectory={onSelectSourceDirectory}
        initSubmitHandler={initSubmitHandler}
        sourceDirectory={sourceDirectory}
        isFileSystemAccessSupported={isFileSystemAccessSupported}
        isProcessing={isProcessing}
        directoryData={directoryData}
        selectedPaths={selectedPaths}
        onTogglePath={handleTogglePath}
        allowFuzzyMatch={allowFuzzyMatch}
        onAllowFuzzyMatchChange={setAllowFuzzyMatch}
        maxTypoDistance={maxTypoDistance}
        onMaxTypoDistanceChange={setMaxTypoDistance}
        parserConfigs={parserConfigs}
        selectedParserConfigName={selectedParserConfigName}
        onSelectedParserConfigNameChange={setSelectedParserConfigName}
        onParserConfigsSaved={handleParserConfigsSaved}
        addToast={addToast}
        onSubmit={postProcessDocuments}
      />

      <SearchResults
        results={processedResults}
        parserConfigs={parserConfigs}
        selectedParserConfigName={selectedParserConfigName}
        addToast={addToast}
      />
    </div>
  );
};

export { SearchDocumentsContainer };
