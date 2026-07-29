import React from 'react';

import {
  Badge,
  ButtonCopyToClipboard,
  FilterDropdown,
} from '../../../components';
import {
  FormProcessDocumentSideOver,
  HighlightedText,
} from './FormProcessDocumentSideOver';
import type {
  GroupedProcessedResults,
  // Aliased — this file already has a local `ProcessedResultGroup` component.
  ProcessedResultGroup as ResultGroup,
  RichProcessedResultItem,
} from './FormProcessDocumentTabItem.types';
import type { DocmGeneratePayload } from './components/FPDDocmTemplatesDropdown';
import { FPDDocmTemplatesDropdown } from './components/FPDDocmTemplatesDropdown';
import { FPDModalFilterSettings } from './components/FPDModalFilterSettings';
import { FrontendInformationExtractor } from './frontend-information-extractor';

// Helper to calculate dynamic values including legacy dependencies
const calculateDynamicValues = (
  item: RichProcessedResultItem,
  filterConfigs: any[],
  primaryFieldId: string | null,
) => {
  const dynamicValues: Record<string, string | null> = {};
  const primaryText = primaryFieldId
    ? item.extracted?.extractedFieldById[primaryFieldId]
    : undefined;

  filterConfigs.forEach((conf) => {
    dynamicValues[conf.id] = FrontendInformationExtractor.determineValue(
      primaryText,
      conf,
    );
  });

  return dynamicValues;
};

// A field/compound is only relevant to a given FE surface if it opted into
// that destination (or was marked as the primary search-result text) — every
// other detail of the parser schema (regex, scan direction, ...) is a BE
// concern the FE never needs to know about.
type ExtractedTableField = { id: string; label: string };

const getExtractedFieldOutputs = (
  parserSchema: any,
): {
  tableFields: ExtractedTableField[];
  spreadsheetFields: ExtractedTableField[];
  primaryFieldId: string | null;
  // Every schema-defined field id, regardless of TABLE/SPREADSHEET useIn —
  // this is the set that follows the {{fieldId}} template-tag convention
  // (see FPDModalParserConfigSettings' hint text), unlike the BE's
  // structural search fields (searchQuery/foundInDocument/matchedText/...)
  // which were never meant to be filled into a document template.
  allFieldIds: string[];
} => {
  const pipelines = Array.isArray(parserSchema?.config?.pipelines)
    ? parserSchema.config.pipelines
    : [];
  const compounds = Array.isArray(parserSchema?.config?.compounds)
    ? parserSchema.config.compounds
    : [];
  const allFields = [...pipelines, ...compounds];

  const fieldsForDestination = (destination: string): ExtractedTableField[] =>
    allFields
      .filter((field: any) =>
        field?.output?.useIn?.some((dest: any) => dest?.type === destination),
      )
      .map((field: any) => ({
        id: field.id,
        label: field.output?.label || field.id,
      }));

  // BE always emits a 'summary' compound (see DEFAULT_EXTRACTOR_SCHEMA), so
  // fall back to it whenever no field in the schema was explicitly marked
  // primary — otherwise no-template/default-template searches show no content.
  const primaryFieldId =
    allFields.find((field: any) => field?.output?.isPrimarySearchResponseText)
      ?.id ?? 'summary';

  return {
    tableFields: fieldsForDestination('TABLE'),
    spreadsheetFields: fieldsForDestination('SPREADSHEET'),
    primaryFieldId,
    allFieldIds: allFields.map((field: any) => field.id),
  };
};

// Shared by the xlsx export and the .docm generation dropdown — unwraps the
// grouped-by-document-with-duplicates structure into individual extracted items.
const flattenGroupedResults = (
  filteredResults: Record<string, any[]>,
): { extracted: any }[] => {
  const flattenedGroups = Object.values(filteredResults).flat();

  return flattenedGroups.flatMap((group: any) => {
    const items =
      group.items && Array.isArray(group.items) ? group.items : [group];
    return items.map((item: any) => ({ extracted: item.extracted || item }));
  });
};

// Component for individual expandable row
const ProcessedResultRow = ({
  result,
  isExpanded,
  onToggleExpand,
  onOpenFile,
  onViewContent,
  filterConfigs, // Add prop
  tableFields,
  primaryFieldId,
  templateTagFieldIds,
  onBtnGenerateDocmClick,
  addToast,
}: {
  result: ResultGroup;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenFile: (result: ResultGroup) => void;
  onViewContent: (result: ResultGroup) => void;
  filterConfigs: any[]; // Add type
  tableFields: ExtractedTableField[];
  primaryFieldId: string | null;
  templateTagFieldIds: string[];
  onBtnGenerateDocmClick: (payload: DocmGeneratePayload) => void;
  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;
}) => {
  // Aggregate data from items in the group
  const items = result.items;
  const firstItem = items[0];
  const docName = result.docName || firstItem?.extracted?.foundInDocument;
  const filePath = result.search?.doc?.originalFilePath;

  // Pre-calculate dynamic values for each item in this group
  // Returns: [ { item: item, dynamicValues: { [filterId]: string | null } }, ... ]
  const enrichedItems = React.useMemo(() => {
    return items.map((item) => {
      const dynamicValues = calculateDynamicValues(
        item,
        filterConfigs,
        primaryFieldId,
      );
      return { item, dynamicValues };
    });
  }, [items, filterConfigs, primaryFieldId]);

  // Aggregate unique values for the closed row view (e.g. show all statuses found in group)
  const aggregatedValues = React.useMemo(() => {
    const agg: Record<string, Set<string>> = {};
    filterConfigs.forEach((conf) => {
      agg[conf.id] = new Set();
    });

    enrichedItems.forEach(({ dynamicValues }) => {
      Object.entries(dynamicValues).forEach(([id, val]) => {
        if (val) agg[id]?.add(val as string);
      });
    });

    return agg;
  }, [enrichedItems, filterConfigs]);

  return (
    <React.Fragment>
      <tr className="group bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
        <td className="sticky left-0 z-10 bg-white dark:bg-gray-800 group-hover:bg-gray-100 dark:group-hover:bg-gray-700 shadow-[inset_-1px_0_0_0_#e5e7eb] dark:shadow-[inset_-1px_0_0_0_#374151] transition-colors whitespace-nowrap align-middle">
          <div className="flex items-center gap-3 mx-6 my-4">
            {/* Collapse/Expand Toggle */}
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1 rounded-full text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors focus:outline-none"
              title={isExpanded ? 'Згорнути' : 'Розгорнути'}
            >
              <svg
                className={`w-4 h-4 transition-transform duration-200 ${
                  isExpanded ? 'rotate-0' : '-rotate-90'
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

            <div className="flex flex-col">
              {/* Document Name - Toggle SideOver */}
              <div
                className="flex items-center text-blue-600 dark:text-blue-400 cursor-pointer hover:underline font-medium"
                onClick={() => onViewContent(result)}
                title="Переглянути контекст"
              >
                <span>{docName}</span>
                {items.length > 1 && (
                  <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-yellow-900 bg-yellow-400 rounded-full shadow-sm">
                    {items.length}
                  </span>
                )}
              </div>
            </div>
          </div>
        </td>

        {/* Path Column - Open File */}
        <td className="px-6 py-4 align-middle max-w-xs">
          <div
            className={`${
              window.electronAPI
                ? 'text-gray-600 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 cursor-pointer underline decoration-dotted'
                : 'text-gray-600 dark:text-gray-400 cursor-pointer'
            } text-xs truncate dir-rtl`}
            onClick={() => onOpenFile(result)}
            title={filePath || 'File path'}
            style={{ direction: 'rtl', textAlign: 'left' }} // RTL trick for left truncation
          >
            {/* Force LTR inside so text reads correctly but truncates from the left */}
            <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>
              {filePath || '---'}
            </span>
          </div>
        </td>

        {/* Dynamic Columns based on Parser Schema TABLE fields */}
        {tableFields.map((field) => (
          <td
            key={field.id}
            className="px-6 py-4 whitespace-nowrap align-middle text-center text-sm text-gray-700 dark:text-gray-300 font-medium"
          >
            {firstItem?.extracted?.extractedFieldById[field.id] || '---'}
          </td>
        ))}

        {/* Dynamic Columns based on Filter Configs */}
        {filterConfigs.map((conf, index) => {
          const uniqueVals = Array.from(aggregatedValues[conf.id] || []);
          return (
            <td
              key={conf.id || index}
              className="px-6 py-4 whitespace-nowrap align-middle text-center"
            >
              {uniqueVals.length > 0 ? (
                <div className="flex flex-col gap-1 items-center">
                  {uniqueVals.map((val, idx) => (
                    <Badge
                      key={idx}
                      label={conf.labelFilterTitle}
                      value={val}
                      variant="blue"
                      hideLabel
                    />
                  ))}
                </div>
              ) : (
                '---'
              )}
            </td>
          );
        })}
      </tr>

      {/* Expanded Content Row */}
      {isExpanded && (
        <tr className="bg-gray-50 dark:bg-gray-900/40 border-b dark:border-gray-700">
          <td colSpan={2 + tableFields.length + filterConfigs.length}>
            <div className="sticky left-0 z-10 w-[100cqw] bg-gray-50 dark:bg-gray-900/40 py-4 pl-10 pr-6 text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
              {enrichedItems.map(({ item, dynamicValues }, idx: number) => (
                <div
                  key={idx}
                  className={
                    idx > 0
                      ? 'mt-4 pt-4 border-t border-gray-200 dark:border-gray-700'
                      : ''
                  }
                >
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    {items.length > 1 && (
                      <>
                        {enrichedItems.length > 1 && (
                          <span className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 flex items-center justify-center text-xs font-bold">
                            {idx + 1}
                          </span>
                        )}

                        {/* Dynamic Badges for item */}
                        {filterConfigs.map((conf) => {
                          const val = dynamicValues[conf.id];
                          if (!val) return null;
                          return (
                            <Badge
                              key={conf.id}
                              label={conf.labelFilterTitle}
                              value={val}
                              // variant="purple"
                              variant="blue"
                            />
                          );
                        })}
                      </>
                    )}
                  </div>

                  <div className="relative group">
                    <HighlightedText
                      text={
                        (primaryFieldId &&
                          item.extracted.extractedFieldById[primaryFieldId]) ??
                        ''
                      }
                      highlights={[item.extracted.matchedText]}
                    />
                    <div className="flex items-center justify-end gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <FPDDocmTemplatesDropdown
                        items={[item]}
                        templateTagFieldIds={templateTagFieldIds}
                        onGenerate={onBtnGenerateDocmClick}
                        addToast={addToast}
                        openDirection="up"
                        renderTrigger={({ toggle }) => (
                          <button
                            type="button"
                            onClick={toggle}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none transition-colors p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                            title="Зберегти .doc*"
                          >
                            <svg
                              className="w-4 h-4"
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
                                d="M10 3v4a1 1 0 0 1-1 1H5m4 8h6m-6-4h6m4-8v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1Z"
                              />
                            </svg>
                          </button>
                        )}
                      />
                      <ButtonCopyToClipboard
                        textToCopy={
                          (primaryFieldId &&
                            item.extracted.extractedFieldById[
                              primaryFieldId
                            ]) ??
                          ''
                        }
                        placement="left"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
};

const ProcessedResultGroup = ({
  searchQuery,
  items,
  onViewContent,
  filterConfigs, // Add prop
  tableFields,
  primaryFieldId,
  templateTagFieldIds,
  onBtnGenerateDocmClick,
  addToast,
}: {
  searchQuery: string;
  items: ResultGroup[];
  onViewContent: (item: ResultGroup) => void;
  filterConfigs: any[]; // Add prop type
  tableFields: ExtractedTableField[];
  primaryFieldId: string | null;
  templateTagFieldIds: string[];
  onBtnGenerateDocmClick: (payload: DocmGeneratePayload) => void;
  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;
}) => {
  const [isOpen, setIsOpen] = React.useState(true);

  // State to track expanded rows (using index as key for simplicity in this context)
  // Initialize with all expanded (true)
  const [expandedRows, setExpandedRows] = React.useState<Set<number>>(
    () => new Set(items.map((_, i) => i)),
  );

  const areAllExpanded = expandedRows.size === items.length;

  const handleToggleAll = () => {
    if (areAllExpanded) {
      // Collapse all
      setExpandedRows(new Set());
    } else {
      // Expand all
      setExpandedRows(new Set(items.map((_, i) => i)));
    }
  };

  const handleToggleRow = (index: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleOpenFile = async (result: ResultGroup) => {
    // Attempt to resolve file path from result metadata (now nested in .search.doc)
    const filePath = result.search?.doc?.originalFilePath;

    if (!filePath) {
      console.warn('No file path found for result', result);
      return;
    }

    if (window.electronAPI?.openPath) {
      // Electron environment: Open file directly
      try {
        const error = await window.electronAPI.openPath(filePath);
        if (error) {
          console.error('Electron openPath failed:', error);
          alert(`Failed to open file: ${error}`);
        }
      } catch (e) {
        console.error('Failed to open file via Electron', e);
        alert('Error invoking openPath via Electron bridge.');
      }
    } else {
      // Browser fallback: Copy path to clipboard with explanatory message
      try {
        await navigator.clipboard.writeText(filePath);
        alert(
          `Opening local files is only supported in the Desktop application.\n\nPath copied to clipboard:\n${filePath}`,
        );
      } catch (err) {
        console.error('Failed to copy path', err);
      }
    }
  };

  return (
    <div className="relative overflow-hidden shadow-md sm:rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between bg-gray-50 px-6 py-3 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
        <h3 className="text-sm font-bold uppercase text-gray-700 dark:text-gray-200 flex items-center gap-2">
          <span>Результати для:</span>
          <span className="text-blue-600 dark:text-blue-400">
            {searchQuery}
          </span>
          <ButtonCopyToClipboard textToCopy={searchQuery} placement="right" />
        </h3>
        <button
          type="button"
          className="inline-flex items-center p-2 text-sm text-gray-500 rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600 cursor-pointer"
          onClick={() => setIsOpen(!isOpen)}
        >
          <svg
            className={`w-6 h-6 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            ></path>
          </svg>
        </button>
      </div>
      {isOpen && (
        <div className="overflow-x-auto @container">
          <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400 min-w-full divide-y divide-gray-200 dark:divide-gray-600">
            <thead className="bg-gray-50 text-xs uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-400 bg-gray-100 dark:bg-gray-700">
              <tr>
                <th className="sticky left-0 z-20 bg-gray-100 dark:bg-gray-700 shadow-[inset_-1px_0_0_0_#e5e7eb] dark:shadow-[inset_-1px_0_0_0_#4b5563] px-6 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleToggleAll}
                      className="p-1 rounded-full text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors focus:outline-none"
                      title={areAllExpanded ? 'Згорнути всі' : 'Розгорнути всі'}
                    >
                      <svg
                        className={`w-4 h-4 transition-transform duration-200 ${
                          areAllExpanded ? 'rotate-0' : '-rotate-90'
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
                    Документ
                  </div>
                </th>
                <th className="px-6 py-3 whitespace-nowrap">Шлях</th>
                {/* Dynamic Headers based on Parser Schema TABLE fields */}
                {tableFields.map((field) => (
                  <th
                    key={field.id}
                    className="px-6 py-3 whitespace-nowrap w-px text-center"
                  >
                    {field.label}
                  </th>
                ))}
                {/* Dynamic Headers */}
                {filterConfigs.map((conf, idx) => (
                  <th
                    key={conf.id || idx}
                    className="px-6 py-3 whitespace-nowrap w-px text-center"
                  >
                    {conf.labelFilterTitle}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
              {items.map((result, index) => (
                <ProcessedResultRow
                  key={index}
                  result={result}
                  isExpanded={expandedRows.has(index)}
                  onToggleExpand={() => handleToggleRow(index)}
                  onOpenFile={handleOpenFile}
                  onViewContent={onViewContent}
                  filterConfigs={filterConfigs} // Pass config
                  tableFields={tableFields}
                  primaryFieldId={primaryFieldId}
                  templateTagFieldIds={templateTagFieldIds}
                  onBtnGenerateDocmClick={onBtnGenerateDocmClick}
                  addToast={addToast}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const TableProcessedDocumentResults = ({
  results,
  onBtnExportClick,
  onBtnGenerateDocmClick,
  parserSchema,
  addToast,
}: {
  results: GroupedProcessedResults;
  onBtnExportClick: (filteredResults: GroupedProcessedResults) => void;
  onBtnGenerateDocmClick: (payload: DocmGeneratePayload) => void;
  parserSchema?: any;
  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;
}) => {
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

  // parserSchema is owned by the parent (it also decides what gets sent to
  // the BE) — derive only the FE-relevant projection of it here.
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

  const handleButtonExportClick = () => {
    if (onBtnExportClick) {
      onBtnExportClick(filteredResults);
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
    <div className="relative bg-white shadow-md dark:bg-gray-800 sm:rounded-lg h-full flex flex-col">
      {/* Sideover for Content Preview */}
      <FormProcessDocumentSideOver
        isOpen={!!previewItem}
        onClose={closePreview}
        title={previewItem?.docName || 'Деталі документу'}
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
                Запит: {previewItem.items[0]?.extracted?.searchQuery}
              </div>

              {/* Show Status/Type for each match if available */}
              <div className="mt-2 space-y-2">
                {previewDynamicValues.map(({ item, vals }, idx: number) => (
                  <div
                    key={idx}
                    className="p-2 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-100 dark:border-gray-700"
                  >
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Збіг #{idx + 1}
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
            Фільтр
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
              placeholder="Фільтр"
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
                <span className="sr-only">Clear search</span>
              </button>
            )}
            {searchTerm && (
              <div className="absolute inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-red-500 border-2 border-white rounded-full -top-2 -end-2 dark:border-gray-800">
                1
              </div>
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
            placeholder="Всі"
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
            <div className="absolute inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-red-500 border-2 border-white rounded-full -top-2 -end-2 dark:border-gray-800">
              1
            </div>
          )}
        </div>

        <div className="flex-grow" />

        {/* Export Button */}
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
          Зберегти .xlsx
        </button>

        <FPDDocmTemplatesDropdown
          items={flattenedItems}
          templateTagFieldIds={allFieldIds}
          onGenerate={onBtnGenerateDocmClick}
          addToast={addToast}
        />
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
              Додайте фільтри
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

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {!hasResults ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            {results && Object.keys(results).length > 0
              ? 'Нічого не знайдено за обраними фільтрами'
              : "Результати пошуку з'являться тут..."}
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
                  onBtnGenerateDocmClick={onBtnGenerateDocmClick}
                  addToast={addToast}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export {
  calculateDynamicValues,
  flattenGroupedResults,
  getExtractedFieldOutputs,
  TableProcessedDocumentResults,
};
export type { ExtractedTableField };
