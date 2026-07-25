import React from 'react';
import { FileSystemItem } from 'toolkit--local/browser';

import { Checkbox, Select } from '../../../components';
import { fetchRequest } from '../../../utils';
import {
  FormInputFileSelect,
  ProcessingButton,
} from '../../process/process-page.components';
import type { FormPageSectionProps } from '../../process/process-page.types';
import {
  TableProcessedDocumentResults,
  calculateDynamicValues,
  getExtractedFieldOutputs,
} from './FormProcessDocumentTabItem.components';
import type {
  GroupedProcessedResults,
  ProcessDocumentsApiResponse,
  SearchResultItem,
} from './FormProcessDocumentTabItem.types';
import { FPDDirectoryTreeItem } from './components/FPDDirectoryTreeItem';
import {
  FPDModalParserConfigSettings,
  readStoredParserConfigs,
} from './components/FPDModalParserConfigSettings';
import {
  FPDModalSearchHistory,
  addSearchHistoryEntry,
} from './components/FPDModalSearchHistory';

const SELECTED_PARSER_CONFIG_NAME_STORAGE_KEY =
  'docNinja_selectedParserConfigName';

const FormProcessDocumentTabItem = ({
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
}: FormPageSectionProps) => {
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

  const [isSettingsExpanded, setIsSettingsExpanded] = React.useState(
    !!directoryData?.structure, // Check structure existence
  );

  const [isPageSizeAll, setIsPageSizeAll] = React.useState(false);
  const [pageSizeValue, setPageSizeValue] = React.useState('10');
  const [allowFuzzyMatch, setAllowFuzzyMatch] = React.useState(true);
  const [maxTypoDistance, setMaxTypoDistance] = React.useState('1');
  const [sortOrder, setSortOrder] = React.useState('desc');
  const [bulkNamesValue, setBulkNamesValue] = React.useState('');
  const [isSearchHistoryOpen, setIsSearchHistoryOpen] = React.useState(false);

  // Parser config: determines how the backend extracts fields from documents.
  // Reloaded from localStorage whenever parserConfigsVersion changes (i.e. after
  // the settings modal saves), same pattern as filterConfigs in TableProcessedDocumentResults.
  const [isParserConfigSettingsOpen, setIsParserConfigSettingsOpen] =
    React.useState(false);
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

  const handleParserConfigSettingsSave = () => {
    setIsParserConfigSettingsOpen(false);
    setParserConfigsVersion((v) => v + 1);
  };

  // The schema currently selected in the UI — used both to interpret results
  // already on screen (table columns, excel export) and, per-request, as the
  // default for postProcessDocuments below (which still allows an explicit
  // formDataJSON.parserConfigName override to take precedence).
  const selectedParserSchema = React.useMemo(
    () => parserConfigs.find((c: any) => c.name === selectedParserConfigName),
    [parserConfigs, selectedParserConfigName],
  );

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
          setIsSettingsExpanded(true); // Auto-expand settings when tree is loaded
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
                (acc: GroupedProcessedResults, item: any) => {
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
                  const existingDocGroup = acc[key].find((g: any) => {
                    // Check against the group's unique ID we store (we'll start storing it)
                    // Or check against stored search result path
                    const groupPath =
                      g.uniqueId || g.search?.doc?.originalFilePath;
                    return groupPath === docIdentifier;
                  });

                  const newItem = {
                    extracted: item,
                    search: searchResult,
                  };

                  if (existingDocGroup) {
                    (existingDocGroup as any).items.push(newItem);
                  } else {
                    acc[key].push({
                      docName: item.foundInDocument || 'Unknown', // Display name
                      uniqueId: docIdentifier, // Store unique ID for grouping check
                      items: [newItem],
                      // Use first result as the main search ref for file path/metadata
                      search: searchResult,
                    } as any);
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

  const postFilteredResultExport = React.useCallback(
    async (filteredResults: any) => {
      // Flatten the grouped structure back to individual extracted items for the backend
      const flattenedGroups = Object.values(filteredResults).flat();

      // 1. Load Filter Configs from localStorage for dynamic columns
      let filterConfigs: any[] = [];
      try {
        const saved = localStorage.getItem('docNinja_filterConfig');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) filterConfigs = parsed;
        }
        // Ensure IDs exist to prevent collisions, matching logic in components
        filterConfigs = filterConfigs.map((c, i) => ({
          ...c,
          id: c.id || `${c.labelFilterTitle}-${i}`,
        }));
      } catch (e) {
        console.warn('Failed to load filter config for export', e);
      }

      // 2. Define Columns (Base + Parser Schema SPREADSHEET fields + Filter Configs)
      const baseCols = [
        { header: 'Input Name', key: 'inputName', options: { wch: 25 } },
        {
          header: 'Found In Document',
          key: 'foundInDocument',
          options: { wch: 25 },
        },
        {
          header: 'Found Declension',
          key: 'foundDeclension',
          options: { wch: 25 },
        },
      ];

      const { spreadsheetFields, primaryFieldId } =
        getExtractedFieldOutputs(selectedParserSchema);

      const schemaCols = spreadsheetFields.map((field) => ({
        header: field.label,
        key: field.id,
        options: { wch: field.id === primaryFieldId ? 80 : 25 },
      }));

      const dynamicCols = filterConfigs.map((conf) => ({
        header: conf.labelFilterTitle,
        key: conf.id,
        options: { wch: 25 },
      }));

      const allColumns = [...baseCols, ...schemaCols, ...dynamicCols];

      // 3. Process Rows: Map standard fields & Calculate dynamic fields
      const processedRows = flattenedGroups.flatMap((group: any) => {
        // Unpack from the grouped wrapper structure
        const items =
          group.items && Array.isArray(group.items) ? group.items : [group];

        return items.map((item: any) => {
          const extracted = item.extracted || item;

          // Map standard fields matching BE Excel structure
          const row: any = {
            inputName: extracted.searchQuery,
            foundInDocument: extracted.foundInDocument,
            foundDeclension: extracted.matchedText,
          };

          spreadsheetFields.forEach((field) => {
            row[field.id] = extracted[field.id];
          });

          // Calculate dynamic fields using shared helper
          // The helper expects { extracted: ... } structure for consistency
          const dynamicValues = calculateDynamicValues(
            { extracted },
            filterConfigs,
            primaryFieldId,
          );

          return { ...row, ...dynamicValues };
        });
      });

      // Prepare unified payload for export
      const exportPayload = {
        columns: allColumns,
        rows: processedRows,
      };

      // Use FormData to send large payloads as a file
      const formData = new FormData();
      const jsonBlob = new Blob([JSON.stringify(exportPayload)], {
        type: 'application/json',
      });
      formData.append('file', jsonBlob, 'data.json');

      try {
        const resAsJson = await fetchRequest(
          '/api-local/process/generate-filtered-spreadsheet',
          {
            method: 'POST',
            body: formData,
          },
        );

        if (
          resAsJson &&
          resAsJson.processedFiles &&
          resAsJson.processedFiles.length > 0
        ) {
          const fileData = resAsJson.processedFiles[0];
          const fileName = fileData.name;
          const base64Content = fileData.content;

          // Convert Base64 to Blob
          const byteCharacters = atob(base64Content);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });

          // Save file using File System Access API if available
          if ('showSaveFilePicker' in window) {
            try {
              const handle = await (window as any).showSaveFilePicker({
                suggestedName: fileName,
                types: [
                  {
                    description: 'Excel File',
                    accept: {
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
                        ['.xlsx'],
                    },
                  },
                ],
              });
              const writable = await handle.createWritable();
              await writable.write(blob);
              await writable.close();
            } catch (err: any) {
              if (err.name !== 'AbortError') {
                console.error('Failed to save file:', err);
              }
            }
          } else {
            // Fallback for browsers without File System Access API
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
          }
        }
      } catch (error) {
        console.error('Failed to export filtered results:', error);
      }
    },
    [selectedParserSchema],
  );

  // const handleTextAreaOnChange = React.useCallback((e) => {
  //   // TODO: save value to localStorage
  // }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className="lg:col-span-1">
        <div
          className="flex rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800 flex-col"
          data-testid="flowbite-card"
        >
          <div className="flex h-full flex-col justify-center gap-4 p-6">
            {/*
            <h3 className="mb-4 text-xl font-bold dark:text-white">
              Пошук в документах
            </h3>
            */}
            <form onSubmit={initSubmitHandler(postProcessDocuments)}>
              <div
                className={`transition-all duration-500 ease-in-out ${
                  isSettingsExpanded
                    ? 'max-h-[1000px] opacity-100 pb-4'
                    : 'max-h-0 opacity-0 overflow-hidden'
                }`}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="bulkNamesTextArea"
                      className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
                    >
                      Перелік ПІБ для пошуку в документах
                    </label>
                    <textarea
                      id="bulkNamesTextArea"
                      name="bulkNames"
                      rows={4}
                      value={bulkNamesValue}
                      onChange={(e) => setBulkNamesValue(e.target.value)}
                      className="block p-2.5 w-full text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                      placeholder={`ПІБ 1\nПІБ 2\nПІБ 3\n...`}
                    />
                  </div>

                  {/* Max Typo Distance & Fuzzy Toggle */}
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="maxTypoDistanceNumber"
                      className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
                    >
                      К-сть символів одруківки
                    </label>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <input
                          id="maxTypoDistanceNumber"
                          type="number"
                          min="0"
                          value={maxTypoDistance}
                          onChange={(e) => setMaxTypoDistance(e.target.value)}
                          className="block w-full border bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                          placeholder="1"
                        />
                      </div>

                      <div className="flex items-center">
                        <Checkbox
                          theme="toggle"
                          checked={allowFuzzyMatch}
                          onChange={setAllowFuzzyMatch}
                          label={
                            <>
                              <span>Дозволити</span>
                              <span>співпадіння</span>
                            </>
                          }
                          labelClassName="flex flex-col justify-center leading-tight whitespace-nowrap"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Page Size & Toggle */}
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="pageSizeNumber"
                      className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
                    >
                      К-сть результатів запиту
                    </label>
                    <div className="flex items-center gap-4">
                      {/* Input - Swapped place with toggle */}
                      <div className="flex-1">
                        <input
                          id="pageSizeNumber"
                          type="number"
                          min="1"
                          value={pageSizeValue}
                          onChange={(e) => setPageSizeValue(e.target.value)}
                          disabled={isPageSizeAll}
                          className="block w-full border disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                          placeholder="10"
                        />
                        {/* Hidden input to send correct value to API */}
                        <input
                          type="hidden"
                          name="pageSize"
                          value={isPageSizeAll ? 'ALL' : pageSizeValue}
                        />
                      </div>

                      {/* Toggle - Swapped place with input */}
                      <div className="flex items-center">
                        <Checkbox
                          theme="toggle"
                          checked={isPageSizeAll}
                          onChange={setIsPageSizeAll}
                          label="Знайти все"
                          labelClassName="whitespace-nowrap"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Sort Order - Moved to new line */}
                  <div className="sm:col-span-2">
                    <Select
                      id="sortOrder"
                      name="sortOrder"
                      label="Сортування (дата)"
                      value={sortOrder}
                      onChange={setSortOrder}
                      options={[
                        { value: 'desc', label: 'Новіші спочатку' },
                        { value: 'asc', label: 'Старіші спочатку' },
                      ]}
                    />
                  </div>

                  <div className="sm:col-span-2 grid grid-cols-2 gap-4 pb-2">
                    <button
                      type="button"
                      onClick={() => setIsSearchHistoryOpen(true)}
                      className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-500 flex items-center justify-center cursor-pointer"
                    >
                      Історія пошуку
                    </button>

                    <ProcessingButton
                      type="submit"
                      isLoading={isProcessing}
                      disabled={!directoryData?.structure}
                    >
                      {/* {isProcessing ? 'Обробляю документи...' : 'Пошук збігів'} */}
                      Пошук
                    </ProcessingButton>
                  </div>
                </div>
              </div>

              <div className="relative flex items-center justify-center w-full mb-6 group">
                <hr className="w-full h-px bg-gray-200 border-0 dark:bg-gray-700 group-hover:bg-blue-200 dark:group-hover:bg-blue-900 transition-colors" />
                <button
                  type="button"
                  onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                  className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center w-8 h-8 rounded-full bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-500 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:border-blue-400 transition-all cursor-pointer z-10"
                  title={
                    isSettingsExpanded
                      ? 'Згорнути параметри'
                      : 'Показати параметри'
                  }
                >
                  <svg
                    className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform duration-300 ${
                      isSettingsExpanded ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
              </div>

              <div className="grid gap-4 mb-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <FormInputFileSelect
                    id="processDocumentsSourceFolder"
                    name="sourceDirectory"
                    label="Папка з документами для пошуку"
                    onClick={onSelectSourceDirectory}
                    selectedItem={sourceDirectory || directoryData}
                    isFileSystemAccessSupported={isFileSystemAccessSupported}
                    icon="folder"
                  />
                </div>

                {/* Parser Config Selection */}
                {directoryData?.structure && (
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="parserConfigName"
                      className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
                    >
                      Обробка знайденого тексту
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Select
                          id="parserConfigName"
                          name="parserConfigName"
                          value={selectedParserConfigName}
                          onChange={setSelectedParserConfigName}
                          options={[
                            { value: '', label: 'Без обробки' },
                            ...parserConfigs.map((c: any) => ({
                              value: c.name,
                              label: c.name,
                            })),
                          ]}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsParserConfigSettingsOpen(true)}
                        title="Налаштування парсера документів"
                        className="shrink-0 rounded-lg p-2.5 text-sm text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-700 cursor-pointer"
                      >
                        <svg
                          className="w-5 h-5"
                          aria-hidden="true"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth="2"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}

                {/* Directory Tree View */}
                {directoryData?.structure &&
                  directoryData.structure.fsNestedItems &&
                  directoryData.structure.fsNestedItems.length > 0 && (
                    <div className="sm:col-span-2 border border-gray-200 dark:border-gray-700 rounded-lg p-2 max-h-96 overflow-y-auto bg-gray-50 dark:bg-gray-900">
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase">
                        Папки для пошуку
                      </div>
                      {directoryData.structure.fsNestedItems.map(
                        (fsNestedItem: any) => (
                          <FPDDirectoryTreeItem
                            key={fsNestedItem.path}
                            fsNestedItem={fsNestedItem}
                            selectedPaths={selectedPaths}
                            onTogglePath={handleTogglePath}
                          />
                        ),
                      )}
                    </div>
                  )}
              </div>
            </form>
          </div>
        </div>

        <FPDModalParserConfigSettings
          isOpen={isParserConfigSettingsOpen}
          onClose={() => setIsParserConfigSettingsOpen(false)}
          onSave={handleParserConfigSettingsSave}
        />

        <FPDModalSearchHistory
          isOpen={isSearchHistoryOpen}
          onClose={() => setIsSearchHistoryOpen(false)}
          onSelectQuery={(query) => {
            setBulkNamesValue(query);
            setIsSearchHistoryOpen(false);
          }}
        />
      </div>

      <div className="lg:col-span-3">
        <TableProcessedDocumentResults
          results={processedResults}
          onBtnExportClick={postFilteredResultExport}
          parserSchema={selectedParserSchema}
        />
      </div>
    </div>
  );
};

export { FormProcessDocumentTabItem };
