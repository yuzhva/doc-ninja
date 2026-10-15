import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
  ButtonCopyToClipboard,
  Checkbox,
  Dropdown,
  Tooltip,
} from '../../../../components';
import type {
  ProcessedResultGroup as ResultGroup,
  RichProcessedResultItem,
  SearchQueryTotals,
} from '../../search-page.types';
import { ProcessedResultRow } from './ProcessedResultRow';
import type { DocmGeneratePayload } from './components/FPDDocmTemplatesDropdown';
import type { ExtractedTableField } from './result-helpers';
import {
  DOC_NAME_SORT_COLUMN_ID,
  FILE_PATH_SORT_COLUMN_ID,
} from './results-sorting';
import type { SortDirection } from './results-sorting';

const I18N_NS = 'page.search.component.processedResultGroup';

// Rows are identified by the path they were grouped under, so expand/collapse
// state sticks to a document rather than to a table position — re-sorting moves
// the rows around underneath it. The `#n` suffix only ever kicks in for results
// the BE sent no path for, where `docName` alone can repeat.
const buildRowIds = (items: ResultGroup[]): string[] => {
  const timesSeen = new Map<string, number>();

  return items.map((item, index) => {
    const base =
      item.uniqueId || item.search?.doc?.originalFilePath || item.docName;
    if (!base) return `row-${index}`;

    const seen = timesSeen.get(base) ?? 0;
    timesSeen.set(base, seen + 1);

    return seen === 0 ? base : `${base}#${seen}`;
  });
};

const getAriaSort = (
  columnId: string,
  sortColumnId: string,
  sortDirection: SortDirection,
) => {
  if (columnId !== sortColumnId) return 'none';
  return sortDirection === 'asc' ? 'ascending' : 'descending';
};

// Drawn only for the column currently doing the sorting — the arrow points up
// for ascending and is flipped for descending, so one glyph covers both.
const SortIcon = ({ direction }: { direction: SortDirection }) => (
  <svg
    className={`w-3.5 h-3.5 shrink-0 text-gray-800 dark:text-white transition-transform duration-200 ${
      direction === 'desc' ? 'rotate-180' : ''
    }`}
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    fill="none"
    viewBox="0 0 24 24"
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M12 6v13m0-13 4 4m-4-4-4 4"
    />
  </svg>
);

const SortableHeaderLabel = ({
  columnId,
  sortColumnId,
  sortDirection,
  onSortChange,
  children,
}: {
  columnId: string;
  sortColumnId: string;
  sortDirection: SortDirection;
  onSortChange: (columnId: string) => void;
  children: React.ReactNode;
}) => {
  const { t } = useTranslation();
  const isActive = columnId === sortColumnId;

  return (
    <button
      type="button"
      onClick={() => onSortChange(columnId)}
      title={t(
        isActive && sortDirection === 'asc'
          ? `${I18N_NS}.sortDescendingTitle`
          : `${I18N_NS}.sortAscendingTitle`,
      )}
      className="inline-flex items-center gap-1.5 cursor-pointer hover:text-gray-900 dark:hover:text-gray-200 transition-colors focus:outline-none"
    >
      {children}
      {isActive && <SortIcon direction={sortDirection} />}
    </button>
  );
};

const ProcessedResultGroup = ({
  searchQuery,
  items,
  totals,
  maxResults,
  onViewContent,
  filterConfigs, // Add prop
  tableFields,
  primaryFieldId,
  templateTagFieldIds,
  searchTerm,
  sortColumnId,
  sortDirection,
  onSortChange,
  isMatchSelectionEnabled,
  onMatchSelectionEnabledChange,
  selectedMatches,
  onMatchesSelectionChange,
  onBtnGenerateDocmClick,
  addToast,
}: {
  searchQuery: string;
  items: ResultGroup[];
  // Absent for a group the engine reported no pagination for — both counters
  // below are then hidden rather than guessed at.
  totals?: SearchQueryTotals;
  maxResults?: string;
  onViewContent: (item: ResultGroup) => void;
  filterConfigs: any[]; // Add prop type
  tableFields: ExtractedTableField[];
  primaryFieldId: string | null;
  templateTagFieldIds: string[];
  searchTerm: string;
  sortColumnId: string;
  sortDirection: SortDirection;
  onSortChange: (columnId: string) => void;
  // One setting for every table — flipping it from any table's cog shows or
  // hides the checkboxes in all of them.
  isMatchSelectionEnabled: boolean;
  onMatchSelectionEnabledChange: (isEnabled: boolean) => void;
  selectedMatches: Set<RichProcessedResultItem>;
  onMatchesSelectionChange: (
    matches: RichProcessedResultItem[],
    isSelected: boolean,
  ) => void;
  onBtnGenerateDocmClick: (payload: DocmGeneratePayload) => void;
  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(true);

  const rowIds = React.useMemo(() => buildRowIds(items), [items]);

  // Every match the table shows, taken from the rows as rendered — so a match
  // the results filter has narrowed away is never swept into a download the
  // user can't see.
  const tableMatches = React.useMemo(
    () => items.flatMap((item) => item.items),
    [items],
  );
  const selectedTableMatchCount = tableMatches.filter((match) =>
    selectedMatches.has(match),
  ).length;
  const areAllTableMatchesSelected =
    tableMatches.length > 0 && selectedTableMatchCount === tableMatches.length;

  // State to track expanded rows (keyed by document, not by table position)
  // Initialize with all expanded (true)
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(
    () => new Set(rowIds),
  );

  const areAllExpanded = expandedRows.size === items.length;

  const handleToggleAll = () => {
    if (areAllExpanded) {
      // Collapse all
      setExpandedRows(new Set());
    } else {
      // Expand all
      setExpandedRows(new Set(rowIds));
    }
  };

  const handleToggleRow = (rowId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
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
    // No `overflow-hidden` here, even though it would be the simplest way to
    // round the corners: it would also clip the settings dropdown, which hangs
    // below a collapsed table's header. The header and the table round their
    // own corners instead.
    <div className="relative shadow-md sm:rounded-lg border border-gray-200 dark:border-gray-700">
      <div
        className={`flex items-center justify-between bg-gray-50 px-6 py-3 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 sm:rounded-t-lg ${
          isOpen ? '' : 'sm:rounded-b-lg'
        }`}
      >
        <div>
          <div className="text-sm font-bold uppercase text-gray-700 dark:text-gray-200 flex items-center gap-2">
            <h3>
              <Trans i18nKey={`${I18N_NS}.resultsForLabel`} />
            </h3>
            <span className="text-blue-600 dark:text-blue-400">
              {searchQuery}
            </span>
            <Tooltip
              content={<Trans i18nKey={`${I18N_NS}.copyTooltip`} />}
              placement="bottom"
            >
              <ButtonCopyToClipboard
                textToCopy={searchQuery}
                placement="right"
              />
            </Tooltip>
            {/* ` items` is what survived the page cap, the filters and the
            max-results limit — i.e. exactly the rows rendered below, which
            neither of those inputs alone can tell the user. */}
            {totals && maxResults && (
              <span className="text-xs font-normal normal-case text-gray-500 dark:text-gray-400">
                {t(`${I18N_NS}.previewingFiles`, {
                  count: items.length,
                  total: totals.totalResults,
                })}
              </span>
            )}
          </div>
          <div>
            {totals && (
              <div className="text-xs italic text-gray-500 dark:text-gray-400">
                {t(`${I18N_NS}.matchesSummary`, {
                  count: totals.totalMatches,
                  files: t(`${I18N_NS}.matchesSummaryFiles`, {
                    count: totals.totalResults,
                  }),
                })}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Dropdown
            panelClassName="right-0 bg-white dark:bg-gray-800"
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                title={t(`${I18N_NS}.tableSettingsTitle`)}
                className="inline-flex items-center p-2 text-sm text-gray-500 rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600 cursor-pointer"
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
            )}
          >
            <Checkbox
              theme="toggle"
              checked={isMatchSelectionEnabled}
              onChange={onMatchSelectionEnabledChange}
              label={<Trans i18nKey={`${I18N_NS}.matchSelectionToggleLabel`} />}
              labelClassName="whitespace-nowrap"
            />
          </Dropdown>
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
      </div>
      {isOpen && (
        <div className="overflow-x-auto @container sm:rounded-b-lg">
          <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400 min-w-full divide-y divide-gray-200 dark:divide-gray-600">
            <thead className="bg-gray-50 text-xs uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-400 bg-gray-100 dark:bg-gray-700">
              <tr>
                {/* z-10 */}
                <th
                  className="sticky left-0 bg-gray-100 dark:bg-gray-700 shadow-[inset_-1px_0_0_0_#e5e7eb] dark:shadow-[inset_-1px_0_0_0_#4b5563] px-6 py-3 whitespace-nowrap"
                  aria-sort={getAriaSort(
                    DOC_NAME_SORT_COLUMN_ID,
                    sortColumnId,
                    sortDirection,
                  )}
                >
                  <div className="flex items-center gap-3">
                    {/* A partly selected table selects the rest, not none —
                        clearing is one more click away either way. */}
                    {isMatchSelectionEnabled && (
                      <Checkbox
                        shape="square"
                        checked={areAllTableMatchesSelected}
                        indeterminate={
                          selectedTableMatchCount > 0 &&
                          !areAllTableMatchesSelected
                        }
                        onChange={() =>
                          onMatchesSelectionChange(
                            tableMatches,
                            !areAllTableMatchesSelected,
                          )
                        }
                        title={t(`${I18N_NS}.selectAllForDownloadTitle`)}
                      />
                    )}
                    <button
                      type="button"
                      onClick={handleToggleAll}
                      className="p-1 rounded-full text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors focus:outline-none"
                      title={
                        areAllExpanded
                          ? t(`${I18N_NS}.collapseAllTitle`)
                          : t(`${I18N_NS}.expandAllTitle`)
                      }
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
                    <SortableHeaderLabel
                      columnId={DOC_NAME_SORT_COLUMN_ID}
                      sortColumnId={sortColumnId}
                      sortDirection={sortDirection}
                      onSortChange={onSortChange}
                    >
                      <Trans i18nKey={`${I18N_NS}.fileNameHeader`} />
                    </SortableHeaderLabel>
                  </div>
                </th>
                <th
                  className="px-6 py-3 whitespace-nowrap"
                  aria-sort={getAriaSort(
                    FILE_PATH_SORT_COLUMN_ID,
                    sortColumnId,
                    sortDirection,
                  )}
                >
                  <SortableHeaderLabel
                    columnId={FILE_PATH_SORT_COLUMN_ID}
                    sortColumnId={sortColumnId}
                    sortDirection={sortDirection}
                    onSortChange={onSortChange}
                  >
                    <Trans i18nKey={`${I18N_NS}.pathHeader`} />
                  </SortableHeaderLabel>
                </th>
                {/* Dynamic Headers based on Parser Schema TABLE fields */}
                {tableFields.map((field) => (
                  <th
                    key={field.id}
                    className="px-6 py-3 whitespace-nowrap w-px text-center"
                    aria-sort={getAriaSort(
                      field.id,
                      sortColumnId,
                      sortDirection,
                    )}
                  >
                    <SortableHeaderLabel
                      columnId={field.id}
                      sortColumnId={sortColumnId}
                      sortDirection={sortDirection}
                      onSortChange={onSortChange}
                    >
                      {field.label}
                    </SortableHeaderLabel>
                  </th>
                ))}
                {/* Dynamic Headers */}
                {filterConfigs.map((conf, idx) => (
                  <th
                    key={conf.id || idx}
                    className="px-6 py-3 whitespace-nowrap w-px text-center"
                    aria-sort={getAriaSort(
                      conf.id,
                      sortColumnId,
                      sortDirection,
                    )}
                  >
                    <SortableHeaderLabel
                      columnId={conf.id}
                      sortColumnId={sortColumnId}
                      sortDirection={sortDirection}
                      onSortChange={onSortChange}
                    >
                      {conf.labelFilterTitle}
                    </SortableHeaderLabel>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
              {items.map((result, index) => (
                <ProcessedResultRow
                  key={rowIds[index]}
                  result={result}
                  isExpanded={expandedRows.has(rowIds[index])}
                  onToggleExpand={() => handleToggleRow(rowIds[index])}
                  onOpenFile={handleOpenFile}
                  onViewContent={onViewContent}
                  filterConfigs={filterConfigs} // Pass config
                  tableFields={tableFields}
                  primaryFieldId={primaryFieldId}
                  templateTagFieldIds={templateTagFieldIds}
                  searchTerm={searchTerm}
                  isMatchSelectionEnabled={isMatchSelectionEnabled}
                  selectedMatches={selectedMatches}
                  onMatchesSelectionChange={onMatchesSelectionChange}
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

export { ProcessedResultGroup };
