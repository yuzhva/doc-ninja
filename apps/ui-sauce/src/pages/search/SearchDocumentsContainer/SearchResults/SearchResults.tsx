import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Badge, BadgeCounter, FilterDropdown } from '../../../../components';
import { fetchRequest } from '../../../../utils';
import { DocxTemplateEngine } from '../../../../utils/docx-template-engine';
import type { ProcessedResultGroup as ResultGroup } from '../../search-page.types';
import type { RichProcessedResultItem } from '../../search-page.types';
import { FormProcessDocumentSideOver } from './FormProcessDocumentSideOver';
import { ProcessedResultGroup } from './ProcessedResultGroup';
import type { SearchResultsProps } from './SearchResults.types';
import type { DocmGeneratePayload } from './components/FPDDocmTemplatesDropdown';
import { FPDDocmTemplatesDropdown } from './components/FPDDocmTemplatesDropdown';
import { FPDModalFilterSettings } from './components/FPDModalFilterSettings';
import {
  calculateDynamicValues,
  flattenGroupedResults,
  getExtractedFieldOutputs,
  truncateRowForXlsx,
} from './result-helpers';

const I18N_NS = 'page.search.container.searchResults';

const SearchResults = ({
  results,
  parserConfigs,
  selectedParserConfigName,
  addToast,
}: SearchResultsProps) => {
  const { t } = useTranslation();
  // The schema currently selected in the UI — derived locally since nothing
  // outside this pane (table columns, excel export, .docm template tags)
  // needs it; the container only needs the raw selection for its own
  // override-precedence check when building the search payload.
  const parserSchema = React.useMemo(
    () => parserConfigs.find((c: any) => c.name === selectedParserConfigName),
    [parserConfigs, selectedParserConfigName],
  );
  // Removed internal filter open/close state logic as it is now inside FilterDropdown
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);

  // Trigger re-read of config when settings modal closes (in case of save)
  const [configVersion, setConfigVersion] = React.useState(0);

  // Search/Filter states
  const [searchTerm, setSearchTerm] = React.useState('');
  const [maxResults, setMaxResults] = React.useState<string>('');

  // Map of filter Title -> Array of selected items
  const [selectedFilters, setSelectedFilters] = React.useState<
    Record<string, string[]>
  >({});

  // State for FormProcessDocumentSideOver
  const [previewItem, setPreviewItem] = React.useState<ResultGroup | null>(
    null,
  );

  // Read configuration dynamically
  const filterConfigs = React.useMemo(() => {
    let config: any[] = [];
    try {
      // Try local storage first
      const saved = window.localStorage.getItem('docNinja_filterConfig');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          config = parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load filter config from storage', e);
    }

    // Ensure IDs exist to prevent collisions
    return config.map((c, i) => ({
      ...c,
      id: c.id || `${c.labelFilterTitle}-${i}`,
    }));
  }, [configVersion]); // Re-run when version changes

  const { tableFields, primaryFieldId, allFieldIds } = React.useMemo(
    () => getExtractedFieldOutputs(parserSchema),
    [parserSchema],
  );

  // Filtering logic
  const filteredResults = React.useMemo(() => {
    if (!results) return {};

    const filtered: Record<string, ResultGroup[]> = {};

    Object.entries(results).forEach(([searchQuery, items]) => {
      // 1. Filter by Search Term (on keys/searchQuery)
      const searchTermLower = searchTerm.toLowerCase();
      const matchesKey =
        !searchTerm || searchQuery.toLowerCase().includes(searchTermLower);

      // 2. Filter items within the group
      let filteredItems = items
        .map((group) => {
          const groupItems = group.items;

          // 1b. If the document name/key didn't match the search term,
          // narrow the group down to only the sub-items whose own content
          // (the schema's primary field) actually contains it.
          if (searchTerm && !matchesKey) {
            const matchingGroupItems = groupItems.filter(
              (item: RichProcessedResultItem) =>
                (
                  (primaryFieldId &&
                    item.extracted?.extractedFieldById[primaryFieldId]) ??
                  ''
                )
                  .toLowerCase()
                  .includes(searchTermLower),
            );

            if (matchingGroupItems.length === 0) return null;

            return { ...group, items: matchingGroupItems };
          }

          return group;
        })
        .filter((group): group is ResultGroup => group !== null)
        .filter((group) => {
          const groupItems = group.items;

          // Dynamic Filter Loop
          const matchesAllFilters = filterConfigs.every((conf) => {
            // Use 'id' from config as both the State Key and the Data Field Key
            const filterStateId = conf.id;
            const selectedOptions = selectedFilters[filterStateId];

            // If no options selected for this filter, skip (pass)
            if (!selectedOptions || selectedOptions.length === 0) return true;

            // Check if ANY item in the group has a matching property value
            // Value is calculated dynamically on the frontend now using helper
            const hasMatch = groupItems.some(
              (item: RichProcessedResultItem) => {
                const vals = calculateDynamicValues(
                  item,
                  filterConfigs,
                  primaryFieldId,
                );
                const dynamicVal = vals[conf.id];
                return dynamicVal && selectedOptions.includes(dynamicVal);
              },
            );

            return hasMatch;
          });

          return matchesAllFilters;
        });

      // 3. Limit results per group
      if (maxResults !== '' && !isNaN(Number(maxResults))) {
        const limit = Number(maxResults);
        if (limit > 0) {
          filteredItems = filteredItems.slice(0, limit);
        }
      }

      if (filteredItems.length > 0) {
        filtered[searchQuery] = filteredItems;
      }
    });

    return filtered;
  }, [
    results,
    searchTerm,
    selectedFilters,
    maxResults,
    filterConfigs,
    primaryFieldId,
  ]);

  const hasResults = filteredResults && Object.keys(filteredResults).length > 0;

  // Shared by the table-level export dropdown and (per-row) the individual
  // download button — both just need the flat item list, not the grouping.
  const flattenedItems = React.useMemo(
    () => flattenGroupedResults(filteredResults),
    [filteredResults],
  );

  const handleFilterChange = (filterId: string, item: string) => {
    setSelectedFilters((prev) => {
      const next = { ...prev };
      const current = next[filterId] || [];

      if (current.includes(item)) {
        // Deselecting an item
        next[filterId] = current.filter((i) => i !== item);
      } else {
        // Selecting an item
        next[filterId] = [...current, item];
      }

      return next;
    });
  };

  const handleIncrementMaxResults = () => {
    setMaxResults((prev) => {
      const val = parseInt(prev || '0', 10);
      return (val + 1).toString();
    });
  };

  const handleDecrementMaxResults = () => {
    setMaxResults((prev) => {
      const val = parseInt(prev || '0', 10);
      return val > 1 ? (val - 1).toString() : '';
    });
  };

  const handleButtonExportClick = async () => {
    // 1. Load Filter Configs from localStorage for dynamic columns
    let exportFilterConfigs: any[] = [];
    try {
      const saved = localStorage.getItem('docNinja_filterConfig');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) exportFilterConfigs = parsed;
      }
      // Ensure IDs exist to prevent collisions, matching logic in components
      exportFilterConfigs = exportFilterConfigs.map((c, i) => ({
        ...c,
        id: c.id || `${c.labelFilterTitle}-${i}`,
      }));
    } catch (e) {
      console.warn('Failed to load filter config for export', e);
    }

    // 2. Define Columns (Base + Parser Schema SPREADSHEET fields + Filter Configs)
    const baseCols = [
      {
        header: t(`${I18N_NS}.inputNameColumnHeader`),
        key: 'inputName',
        options: { wch: 25 },
      },
      {
        header: t(`${I18N_NS}.foundInDocumentColumnHeader`),
        key: 'foundInDocument',
        options: { wch: 25 },
      },
      {
        header: t(`${I18N_NS}.foundDeclensionColumnHeader`),
        key: 'foundDeclension',
        options: { wch: 25 },
      },
    ];

    const { spreadsheetFields, primaryFieldId: exportPrimaryFieldId } =
      getExtractedFieldOutputs(parserSchema);

    // The primary field is always shown in the UI (see the `?? 'summary'`
    // fallback in getExtractedFieldOutputs) even when the schema never
    // opts it into the SPREADSHEET destination — e.g. "Без обробки", which
    // has no fields/compounds at all. Exporting less than what's visible
    // on screen would be surprising, so guarantee it a column here too.
    const exportedSpreadsheetFields =
      !exportPrimaryFieldId ||
      spreadsheetFields.some((field) => field.id === exportPrimaryFieldId)
        ? spreadsheetFields
        : [
            ...spreadsheetFields,
            {
              id: exportPrimaryFieldId,
              label: t(`${I18N_NS}.summaryColumnHeader`),
            },
          ];

    const schemaCols = exportedSpreadsheetFields.map((field) => ({
      header: field.label,
      key: field.id,
      options: { wch: field.id === exportPrimaryFieldId ? 80 : 25 },
    }));

    const dynamicCols = exportFilterConfigs.map((conf) => ({
      header: conf.labelFilterTitle,
      key: conf.id,
      options: { wch: 25 },
    }));

    const allColumns = [...baseCols, ...schemaCols, ...dynamicCols];

    // 3. Process Rows: Map standard fields & Calculate dynamic fields
    const processedRows = flattenGroupedResults(filteredResults).map(
      ({ extracted }) => {
        // Map standard fields matching BE Excel structure
        const row: any = {
          inputName: extracted.searchQuery,
          foundInDocument: extracted.foundInDocument,
          foundDeclension: extracted.matchedText,
        };

        exportedSpreadsheetFields.forEach((field) => {
          row[field.id] = extracted.extractedFieldById[field.id];
        });

        // Calculate dynamic fields using shared helper
        // The helper expects { extracted: ... } structure for consistency
        const dynamicValues = calculateDynamicValues(
          { extracted },
          exportFilterConfigs,
          exportPrimaryFieldId,
        );

        return truncateRowForXlsx({ ...row, ...dynamicValues });
      },
    );

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
                  description: t(`${I18N_NS}.excelFileTypeDescription`),
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
  };

  const handleGenerateDocm = async (payload: DocmGeneratePayload) => {
    try {
      const result = await DocxTemplateEngine.generateBatch({
        template: {
          file: payload.templateFile,
          fileName: payload.templateName,
        },
        jobs: payload.jobs,
        layout: payload.layout,
      });

      for (const file of result.files) {
        const fileHandle = await payload.outputDirectoryHandle.getFileHandle(
          file.fileName,
          { create: true },
        );
        const writable = await fileHandle.createWritable();
        await writable.write(file.blob);
        await writable.close();
      }

      addToast(
        'success',
        t(`${I18N_NS}.generateSuccessToast`, { count: result.files.length }),
      );
    } catch (error: any) {
      console.error('Failed to generate .doc* files', error);
      addToast(
        'error',
        t(`${I18N_NS}.generateFailedToast`, {
          message: error.message || error,
        }),
      );
    }
  };

  const handleViewContent = (item: ResultGroup) => {
    setPreviewItem(item);
  };

  const closePreview = () => {
    setPreviewItem(null);
  };

  // Preview needs to know about dynamic fields to render them
  // We'll calculate them on the fly in the render below
  const previewDynamicValues = React.useMemo(() => {
    if (!previewItem || !filterConfigs) return [];
    return previewItem.items.map((item) => {
      const vals = calculateDynamicValues(item, filterConfigs, primaryFieldId);
      return { item, vals };
    });
  }, [previewItem, filterConfigs, primaryFieldId]);

  const handleSaveSettings = () => {
    setIsSettingsOpen(false);
    // Reload config from LS
    setConfigVersion((v) => v + 1);
  };

  return (
    <div className="lg:col-span-3 lg:h-full lg:min-h-0">
      <div className="relative bg-white shadow-md dark:bg-gray-800 sm:rounded-lg h-full flex flex-col lg:min-h-0">
        {/* Sideover for Content Preview */}
        <FormProcessDocumentSideOver
          isOpen={!!previewItem}
          onClose={closePreview}
          title={previewItem?.docName || t(`${I18N_NS}.documentDetailsTitle`)}
          textFilePath={
            previewItem?.search?.doc?.textFilePath ||
            previewItem?.items[0]?.search?.doc?.textFilePath
          }
          highlightPhrases={
            previewItem?.items.map((i) => i.extracted.matchedText) ?? []
          }
        >
          {previewItem && (
            <div className="space-y-4">
              {/* Header / Metadata only - context removed to avoid duplication */}
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  <Trans i18nKey={`${I18N_NS}.queryLabel`} />{' '}
                  {previewItem.items[0]?.extracted?.searchQuery}
                </div>

                {/* Show Status/Type for each match if available */}
                <div className="mt-2 space-y-2">
                  {previewDynamicValues.map(({ item, vals }, idx: number) => (
                    <div
                      key={idx}
                      className="p-2 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-100 dark:border-gray-700"
                    >
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        <Trans
                          i18nKey={`${I18N_NS}.matchLabel`}
                          values={{ number: idx + 1 }}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {filterConfigs.map((conf) => {
                          const val = vals[conf.id];

                          return (
                            val && (
                              <Badge
                                key={conf.id}
                                label={conf.labelFilterTitle}
                                value={val}
                                variant="blue"
                              />
                            )
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </FormProcessDocumentSideOver>

        <FPDModalFilterSettings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveSettings}
        />

        {/* Toolbar - Row 1: Search, Max Results, Export */}
        <div className="flex flex-wrap items-center gap-2 p-4">
          {/* Search Input */}
          <form
            className="flex items-center w-full sm:w-auto"
            onSubmit={(e) => e.preventDefault()}
          >
            <label htmlFor="simple-search" className="sr-only">
              <Trans i18nKey={`${I18N_NS}.filterLabel`} />
            </label>
            <div className="relative w-full sm:w-64 md:w-72">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 text-gray-500 dark:text-gray-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <input
                type="text"
                id="simple-search"
                className="block w-full p-2 pl-10 text-sm text-gray-900 border border-gray-300 rounded-lg bg-gray-50 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                placeholder={t(`${I18N_NS}.filterLabel`)}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white focus:outline-none"
                  onClick={() => setSearchTerm('')}
                >
                  <svg
                    className="w-3 h-3"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 14 14"
                  >
                    <path
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
                    />
                  </svg>
                  <span className="sr-only">
                    <Trans i18nKey={`${I18N_NS}.clearSearchLabel`} />
                  </span>
                </button>
              )}
              {searchTerm && (
                <BadgeCounter
                  count={1}
                  variant="red"
                  size="md"
                  bordered
                  className="absolute -top-2 -end-2"
                />
              )}
            </div>
          </form>

          {/* Max Results Counter */}
          <div className="relative flex items-center max-w-[8rem]">
            <button
              type="button"
              id="decrement-button"
              onClick={handleDecrementMaxResults}
              className="bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 dark:border-gray-600 hover:bg-gray-200 border border-gray-300 rounded-s-lg p-3 h-10 focus:ring-gray-100 dark:focus:ring-gray-700 focus:ring-2 focus:outline-none cursor-pointer transition-colors"
            >
              <svg
                className="w-3 h-3 text-gray-900 dark:text-white"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 18 2"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M1 1h16"
                />
              </svg>
            </button>
            <input
              type="text"
              id="max-results-input"
              className="bg-gray-50 border-x-0 border-gray-300 h-10 text-center text-gray-900 text-sm focus:ring-blue-500 focus:border-blue-500 block w-full py-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
              placeholder={t(`${I18N_NS}.allResultsPlaceholder`)}
              value={maxResults}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || /^\d+$/.test(val)) {
                  setMaxResults(val);
                }
              }}
            />
            <button
              type="button"
              id="increment-button"
              onClick={handleIncrementMaxResults}
              className="bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 dark:border-gray-600 hover:bg-gray-200 border border-gray-300 rounded-e-lg p-3 h-10 focus:ring-gray-100 dark:focus:ring-gray-700 focus:ring-2 focus:outline-none cursor-pointer transition-colors"
            >
              <svg
                className="w-3 h-3 text-gray-900 dark:text-white"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 18 18"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 1v16M1 9h16"
                />
              </svg>
            </button>
            {maxResults !== '' && (
              <BadgeCounter
                count={1}
                variant="red"
                size="md"
                bordered
                className="absolute -top-2 -end-2"
              />
            )}
          </div>

          <div className="flex-grow" />

          {/* Export Button */}
          <FPDDocmTemplatesDropdown
            items={flattenedItems}
            templateTagFieldIds={allFieldIds}
            onGenerate={handleGenerateDocm}
            addToast={addToast}
          />

          <button
            type="button"
            className={`flex items-center justify-center flex-shrink-0 px-3 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg focus:outline-none focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 ${!hasResults ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-100 hover:text-blue-700'}`}
            onClick={handleButtonExportClick}
            disabled={!hasResults}
          >
            <svg
              className="w-4 h-4 mr-2"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 3v4a1 1 0 0 1-1 1H5m8-2h3m-3 3h3m-4 3v6m4-3H8M19 4v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1ZM8 12v6h8v-6H8Z"
              />
            </svg>
            <Trans i18nKey={`${I18N_NS}.saveXlsxButton`} />
          </button>
        </div>

        {/* Divider */}
        <hr className="h-px bg-gray-200 border-0 dark:bg-gray-700" />

        {/* Toolbar - Row 2: Filters */}
        <div className="flex flex-wrap items-center gap-2 p-2 px-4 bg-gray-50/50 dark:bg-gray-700/20">
          {filterConfigs.length === 0 ? (
            <>
              <div className="flex-grow" />
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="relative flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg md:w-auto focus:outline-none hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 cursor-pointer"
              >
                <svg
                  className="mr-2 w-4 h-4 text-gray-400"
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
                <Trans i18nKey={`${I18N_NS}.addFiltersButton`} />
              </button>
            </>
          ) : (
            <>
              <div className="flex-grow" />

              {/* Settings cog - rendered as the first item in the filters cluster */}
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="rounded-lg p-2.5 text-sm text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-700 cursor-pointer"
              >
                <svg
                  className="w-4 h-4 text-gray-400"
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

              {/* Dynamic Filters rendering */}
              {filterConfigs.map((config, index) => {
                // Extract unique options from rules
                const uniqueOptions = Array.from(
                  new Set<string>(
                    config.filterRules
                      ?.map((r: any) => r.labelOption)
                      .filter(Boolean) || [],
                  ),
                );

                if (uniqueOptions.length === 0) return null;

                // Use config.id as the stable key for state
                // Fallback to title-index only if id is missing (though filtering won't work without id)
                const filterId =
                  config.id || `${config.labelFilterTitle}-${index}`;

                return (
                  <FilterDropdown
                    key={filterId}
                    label={config.labelFilterTitle}
                    dropdownTitle={config.labelFilterDescription}
                    items={uniqueOptions.sort()}
                    selectedItems={selectedFilters[filterId] || []}
                    onItemChange={(item) => handleFilterChange(filterId, item)}
                    idPrefix={`filter-${filterId}`}
                  />
                );
              })}
            </>
          )}
        </div>

        {/* Divider */}
        <hr className="h-px bg-gray-200 border-0 dark:bg-gray-700" />

        {/* Content Area — the only part of the results card that scrolls, so
            the toolbars above stay put while the list moves. */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {!hasResults ? (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
              {results && Object.keys(results).length > 0 ? (
                <Trans i18nKey={`${I18N_NS}.noResultsForFiltersMessage`} />
              ) : (
                <Trans i18nKey={`${I18N_NS}.resultsPlaceholderMessage`} />
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(filteredResults).map(
                ([searchQuery, items], filteredResultIndex) => (
                  <ProcessedResultGroup
                    key={searchQuery}
                    searchQuery={searchQuery}
                    items={items}
                    onViewContent={handleViewContent}
                    filterConfigs={filterConfigs} // Pass config
                    tableFields={tableFields}
                    primaryFieldId={primaryFieldId}
                    templateTagFieldIds={allFieldIds}
                    onBtnGenerateDocmClick={handleGenerateDocm}
                    addToast={addToast}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export { SearchResults };
