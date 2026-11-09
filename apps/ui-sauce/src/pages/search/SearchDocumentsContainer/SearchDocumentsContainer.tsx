import React from 'react';
import { useTranslation } from 'react-i18next';
import { FileSystemItem } from 'toolkit--local/browser';

import type { BatchFileProcessingSectionProps } from '../../../hooks/use-batch-processor';
import { fetchRequest } from '../../../utils';
import type {
  ExtractedResultItem,
  GroupedProcessedResults,
  ProcessDocumentsApiResponse,
  ProcessedResultGroup,
  SearchQueryTotals,
  SearchResultItem,
} from '../search-page.types';
import { SearchForm } from './SearchForm/SearchForm';
import { readStoredParserConfigs } from './SearchForm/components/FPDModalParserConfigSettings';
import { addSearchHistoryEntry } from './SearchForm/components/FPDModalSearchHistory';
import { SearchResults } from './SearchResults/SearchResults';
import { getExtractedFieldOutputs } from './SearchResults/result-helpers';
import {
  getDirectoryStructureFingerprint,
  isRescannableDirectoryPath,
  rescanDirectoryStructure,
} from './directory-structure';
import { joinSearchQueries, normalizeSearchQueries } from './search-queries';
import {
  buildSearchSourcesPayload,
  collectFolderPaths,
  findOverlappingSource,
  isPathWithin,
  isSamePath,
  readStoredSearchSources,
  readStoredSelectedPaths,
  reconcileSelectedPathsAcross,
  storeSearchSources,
  storeSelectedPaths,
  withFullPaths,
} from './search-sources';
import type { SearchSource, SearchSourceChanges } from './search-sources';

const I18N_NS = 'page.search.container.searchDocumentsContainer';

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
  addToast: (
    type: 'success' | 'error' | 'warning',
    content: React.ReactNode,
  ) => void;
}) => {
  const { t } = useTranslation();

  const [processedResults, setProcessedResults] =
    React.useState<GroupedProcessedResults>({});

  // What the engine found per query, kept beside the grouped results: the
  // groups below are built from `extractedResults`, which is already capped by
  // `pageSize` and so cannot report the real totals.
  const [searchTotalsByQuery, setSearchTotalsByQuery] = React.useState<
    Record<string, SearchQueryTotals>
  >({});

  // The parser configs the results on screen were extracted with — the folders'
  // as they were when searched, since what was extracted can't follow a later
  // change of one. They decide the results' columns.
  const [searchedParserConfigNames, setSearchedParserConfigNames] =
    React.useState<string[]>([]);

  // The folders searched in, each with its own parser config. Ticked folders
  // (`selectedPaths`) span all of their trees: with none ticked, every folder
  // is searched whole.
  const [sources, setSources] = React.useState<SearchSource[]>(
    readStoredSearchSources,
  );

  // Read before the folders are stored for the first time: carrying over the
  // single-folder version's ticks takes its folder, which that store drops
  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(
    readStoredSelectedPaths,
  );

  // One query per entry — the payload sends them as an array, which is why
  // they're held here rather than read back out of the form's FormData.
  const [searchQueries, setSearchQueries] = React.useState<string[]>(['']);

  const [allowFuzzyMatch, setAllowFuzzyMatch] = React.useState(true);
  const [maxTypoDistance, setMaxTypoDistance] = React.useState('1');

  // Parser config: determines how the backend extracts fields from documents.
  // Reloaded from localStorage whenever parserConfigsVersion changes (i.e. after
  // the settings modal saves), same pattern as filterConfigs in SearchResults.
  const [parserConfigsVersion, setParserConfigsVersion] = React.useState(0);
  const parserConfigs: any[] = React.useMemo(() => {
    return readStoredParserConfigs();
  }, [parserConfigsVersion]);

  // Keep each folder's parser config valid whenever the list changes (e.g. an
  // entry was renamed or removed via the settings modal). '' stands for the
  // "none" option and is always valid.
  React.useEffect(() => {
    if (parserConfigs.length === 0) return;

    const configNames = new Set(parserConfigs.map((c: any) => c.name));
    const isStale = (source: SearchSource) =>
      source.parserConfigName !== '' &&
      !configNames.has(source.parserConfigName);

    setSources((prev) =>
      prev.some(isStale)
        ? prev.map((source) =>
            isStale(source) ? { ...source, parserConfigName: '' } : source,
          )
        : prev,
    );
  }, [parserConfigs]);

  const handleParserConfigsSaved = React.useCallback(() => {
    setParserConfigsVersion((v) => v + 1);
  }, []);

  // Persist state changes
  React.useEffect(() => {
    storeSearchSources(sources);
  }, [sources]);

  React.useEffect(() => {
    storeSelectedPaths(selectedPaths);
  }, [selectedPaths]);

  // Build lookup maps for efficient recursive selection. Each source folder is
  // a root of its own: ticking all of one's subfolders ticks it, and never
  // reaches another folder.
  const { parentMap, childrenMap } = React.useMemo(() => {
    const parentMap = new Map<string, string | null>();
    const childrenMap = new Map<string, string[]>();

    const traverse = (node: FileSystemItem, parent: string | null) => {
      parentMap.set(node.path, parent);
      const kids = node.fsNestedItems?.map((c) => c.path) || [];
      childrenMap.set(node.path, kids);
      node.fsNestedItems?.forEach((child) => traverse(child, node.path));
    };
    sources.forEach((source) => traverse(source.structure, null));
    return { parentMap, childrenMap };
  }, [sources]);

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

  // The stored trees are snapshots of the moment each folder was picked, so
  // they go stale as soon as anything changes on disk. These refs let the
  // async code below read current values without re-creating itself (and thus
  // re-running the effects that call it) on every state change.
  const sourcesRef = React.useRef(sources);
  const selectedPathsRef = React.useRef(selectedPaths);
  const pendingRefreshRef = React.useRef<Promise<{
    sources: SearchSource[];
    selectedPaths: Set<string>;
  }> | null>(null);

  React.useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  React.useEffect(() => {
    selectedPathsRef.current = selectedPaths;
  }, [selectedPaths]);

  // A folder just picked (useDirectoryPicker hands over a new result for each
  // pick) joins the folders searched. Picked again, it's read anew and keeps
  // its parser config and ticks.
  React.useEffect(() => {
    const pickedStructure: FileSystemItem | undefined =
      sourceDirectory?.structure;
    if (!pickedStructure?.path) return;
    const structure = withFullPaths(pickedStructure);

    const currentSources = sourcesRef.current;
    const pickedAgain = currentSources.find((source) =>
      isSamePath(source.structure.path, structure.path),
    );

    if (pickedAgain) {
      // Opened, like a folder just added: it's the one being looked at
      const nextSources = currentSources.map((source) =>
        source === pickedAgain
          ? { ...source, structure, isCollapsed: false }
          : source,
      );
      setSources(nextSources);
      setSelectedPaths((prev) =>
        reconcileSelectedPathsAcross(prev, nextSources),
      );
      return;
    }

    const overlapping = findOverlappingSource(currentSources, structure.path);
    if (overlapping) {
      addToast(
        'warning',
        t(`${I18N_NS}.sourceFolderOverlapsWarning`, {
          name: structure.name,
          other: overlapping.structure.name,
        }),
      );
      return;
    }

    setSources((prev) => [
      ...prev,
      {
        structure,
        // Folders added one after another tend to hold the same kind of
        // documents, so the last one's parser config is the likeliest guess
        parserConfigName: prev[prev.length - 1]?.parserConfigName ?? '',
      },
    ]);

    // With some folders ticked, only those are searched: the folder was added
    // to be searched, so it's ticked too. With none, every folder is already.
    setSelectedPaths((prev) =>
      prev.size === 0
        ? prev
        : new Set([...prev, ...collectFolderPaths(structure)]),
    );
    // Only a new pick should run this — not every toast or translation change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceDirectory]);

  const handleRemoveSource = React.useCallback((sourcePath: string) => {
    setSources((prev) =>
      prev.filter((source) => source.structure.path !== sourcePath),
    );
    setSelectedPaths((prev) => {
      const next = new Set(
        [...prev].filter((path) => !isPathWithin(path, sourcePath)),
      );
      return next.size === prev.size ? prev : next;
    });
  }, []);

  const handleSourceChange = React.useCallback(
    (sourcePath: string, changes: SearchSourceChanges) => {
      setSources((prev) =>
        prev.map((source) =>
          source.structure.path === sourcePath
            ? { ...source, ...changes }
            : source,
        ),
      );
    },
    [],
  );

  /**
   * Re-reads every source folder and swaps in the trees whose fingerprint
   * moved, carrying the selection over to them.
   *
   * Returns the folders and selection in effect afterwards, so the search
   * submit can use them in the same tick rather than waiting for the state
   * update to land.
   */
  const refreshSearchSources = React.useCallback(async (): Promise<{
    sources: SearchSource[];
    selectedPaths: Set<string>;
  }> => {
    // Overlapping runs (the mount refresh still in flight when the user hits
    // Search) would scan twice and race over the same state — join instead.
    if (pendingRefreshRef.current) return pendingRefreshRef.current;

    const refreshTask = (async () => {
      try {
        const rescanned = await Promise.all(
          sourcesRef.current.map(async ({ structure: { path } }) => {
            if (!isRescannableDirectoryPath(path)) return null;

            try {
              const { structure } = await rescanDirectoryStructure(path);
              return [path, withFullPaths(structure)] as const;
            } catch (error) {
              // A folder that was moved, deleted or became unreadable must not
              // block the search: the request that follows reports that far
              // better than a toast raised out of a background refresh would.
              console.warn('Failed to refresh directory structure:', error);
              return null;
            }
          }),
        );

        // Folders added or removed while the scans ran are as they are now:
        // only the trees of the ones still there are swapped in
        const changedStructureByPath = new Map(
          rescanned.filter(
            (entry): entry is NonNullable<typeof entry> =>
              !!entry &&
              sourcesRef.current.some(
                (source) =>
                  source.structure.path === entry[0] &&
                  getDirectoryStructureFingerprint(source.structure) !==
                    getDirectoryStructureFingerprint(entry[1]),
              ),
          ),
        );

        if (changedStructureByPath.size === 0) {
          return {
            sources: sourcesRef.current,
            selectedPaths: selectedPathsRef.current,
          };
        }

        const withChangedStructures = (current: SearchSource[]) =>
          current.map((source) => {
            const structure = changedStructureByPath.get(source.structure.path);
            return structure ? { ...source, structure } : source;
          });

        const nextSources = withChangedStructures(sourcesRef.current);
        const nextSelectedPaths = reconcileSelectedPathsAcross(
          selectedPathsRef.current,
          nextSources,
        );

        setSources(withChangedStructures);
        setSelectedPaths(nextSelectedPaths);

        return { sources: nextSources, selectedPaths: nextSelectedPaths };
      } finally {
        pendingRefreshRef.current = null;
      }
    })();

    pendingRefreshRef.current = refreshTask;

    return refreshTask;
  }, []);

  // Refresh the trees restored from localStorage once on mount. Picking a
  // folder scans it fresh anyway, so this never competes with the effect above.
  React.useEffect(() => {
    refreshSearchSources();
  }, [refreshSearchSources]);

  const postProcessDocuments = React.useCallback<
    Parameters<typeof initSubmitHandler>[0]
  >(
    async (formDataJSON) => {
      // History is stored as the one multi-line string the textarea shows, so
      // restoring an entry drops straight back into either editor.
      addSearchHistoryEntry(joinSearchQueries(searchQueries));

      // Pick up folders created/removed since the trees were last read, so the
      // scope sent below matches what is actually on disk right now.
      const effective = await refreshSearchSources();

      // Each folder with where in it to search, and the parser config the
      // backend parses what it finds there with
      const searchSources = buildSearchSourcesPayload(
        effective.sources,
        effective.selectedPaths,
        parserConfigs,
      );

      // The body text a match shows is its own parser config's primary field,
      // which differs between folders parsed with different configs
      const primaryFieldIdBySourcePath = new Map(
        searchSources.map((source) => [
          source.sourcePath,
          getExtractedFieldOutputs(
            source.extractorSchema ? [source.extractorSchema] : [],
          ).primaryFieldId,
        ]),
      );

      const payload = {
        ...formDataJSON,
        // Blank rows and stray padding are the user's editing leftovers, not
        // queries — the request carries only what's actually searchable.
        bulkNames: normalizeSearchQueries(searchQueries),
        sources: searchSources,
        isInflectedWordFormsAllowed: allowFuzzyMatch,
        maxTypoDistance: Number(maxTypoDistance),
      };

      return executeBatch(
        {
          formDataJSON: payload,
          processedDir: selectedFile!,
          destinationHandle: outputDirectory?.browserFSAPIhandle!,
          validationMessage: t(`${I18N_NS}.validationMessage`),
          successMessage: t(`${I18N_NS}.successMessage`),
          cancelledMessage: t(`${I18N_NS}.cancelledMessage`),
          isWritingFilesSkipped: true,
          isLocalFileSystemRequest: true,
          // No subfolderPath specified - files will be saved in root
        },
        async (_batchFiles, _batchIndex, _totalBatches, _structure, signal) => {
          return fetchRequest('/api-local/process/documents', {
            method: 'POST',
            body: JSON.stringify(payload),
            // The Cancel button in SearchPage's progress footer
            signal,
          }).then((resAsJson: ProcessDocumentsApiResponse) => {
            if (resAsJson && resAsJson.extractedResults) {
              // 1. Create a lookup map for search results by originalFilePath (unique)
              // This allows us to link the extracted results with full file metadata accurately
              const searchResultLookup = new Map<string, SearchResultItem>();

              // Engine totals per query, collected in the same pass — they are
              // reported to the user as "N of M", so they have to come from
              // pagination rather than from the (page-capped) result arrays.
              const totalsByQuery: Record<string, SearchQueryTotals> = {};

              // Handle nested structure: results is an array of SearchResultSet (one per query term)
              if (Array.isArray(resAsJson.results)) {
                for (const resultSet of resAsJson.results) {
                  // A query the engine failed on comes back with a stub
                  // pagination that has no totalMatches, so both counts are
                  // checked — a half-known total would render as a literal
                  // "{{count}}" in the summary.
                  if (
                    resultSet.query &&
                    typeof resultSet.pagination?.totalMatches === 'number' &&
                    typeof resultSet.pagination?.totalResults === 'number'
                  ) {
                    totalsByQuery[resultSet.query] = {
                      totalMatches: resultSet.pagination.totalMatches,
                      totalResults: resultSet.pagination.totalResults,
                    };
                  }

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
                    extracted: item.sourcePath
                      ? {
                          ...item,
                          primaryFieldId:
                            primaryFieldIdBySourcePath.get(item.sourcePath) ??
                            undefined,
                        }
                      : item,
                    search: searchResult,
                  };

                  if (existingDocGroup) {
                    existingDocGroup.items.push(newItem);
                  } else {
                    acc[key].push({
                      docName: item.foundInDocument, // Display name
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
              setSearchTotalsByQuery(totalsByQuery);
              setSearchedParserConfigNames([
                ...new Set(
                  searchSources.flatMap((source) =>
                    source.extractorSchema ? [source.extractorSchema.name] : [],
                  ),
                ),
              ]);
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
      refreshSearchSources,
      searchQueries,
      allowFuzzyMatch,
      maxTypoDistance,
      parserConfigs,
      t,
    ],
  );

  return (
    // `min-h-0` stops the grid row from being sized by its content, which is
    // what lets both columns scroll internally instead of stretching the page.
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:flex-1 lg:min-h-0">
      <SearchForm
        onSelectSourceDirectory={onSelectSourceDirectory}
        initSubmitHandler={initSubmitHandler}
        isFileSystemAccessSupported={isFileSystemAccessSupported}
        isProcessing={isProcessing}
        sources={sources}
        onRemoveSource={handleRemoveSource}
        onSourceChange={handleSourceChange}
        selectedPaths={selectedPaths}
        onTogglePath={handleTogglePath}
        searchQueries={searchQueries}
        onSearchQueriesChange={setSearchQueries}
        allowFuzzyMatch={allowFuzzyMatch}
        onAllowFuzzyMatchChange={setAllowFuzzyMatch}
        maxTypoDistance={maxTypoDistance}
        onMaxTypoDistanceChange={setMaxTypoDistance}
        parserConfigs={parserConfigs}
        onParserConfigsSaved={handleParserConfigsSaved}
        addToast={addToast}
        onSubmit={postProcessDocuments}
      />

      <SearchResults
        results={processedResults}
        totalsByQuery={searchTotalsByQuery}
        parserConfigs={parserConfigs}
        parserConfigNames={searchedParserConfigNames}
        isProcessing={isProcessing}
        isSourceDirectorySelected={sources.length > 0}
        addToast={addToast}
      />
    </div>
  );
};

export { SearchDocumentsContainer };
