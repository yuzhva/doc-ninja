import React from 'react';
import { FileSystemItem } from 'toolkit--local/browser';

import { FormProcessDocumentSideOver } from './FormProcessDocumentSideOver';
import PROCESS_DOCUMENT__CONFIG from './process-document.config.json';

// Shared component for metadata badges (Status, Command Type, etc.)
const MetadataBadge = ({
  label,
  value,
  variant = 'blue',
  hideLabel = false,
}: {
  label: string;
  value?: string | null;
  variant?: 'blue' | 'purple';
  hideLabel?: boolean;
}) => {
  const displayValue = value || '---';

  const variantClasses = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800/50',
    purple:
      'bg-purple-50 text-purple-700 border-purple-100 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800/50',
  };

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded border ${variantClasses[variant]}`}
    >
      {!hideLabel && (
        <span className="text-[10px] uppercase font-bold opacity-60">
          {label}:
        </span>
      )}
      <span className="text-xs font-medium">{displayValue}</span>
    </div>
  );
};

// Helper component to highlight text safely without dangerous HTML
const HighlightedText = ({
  text,
  highlight,
}: {
  text: string;
  highlight: string;
}) => {
  if (!highlight || !text) return <>{text}</>;

  // Escape regex special characters to prevent errors
  const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Split text by highlight term (capture group () keeps the delimiter in the result array)
  const parts = text.split(new RegExp(`(${escapedHighlight})`, 'gi'));

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <span
            key={i}
            className="bg-yellow-300 text-red-600 dark:bg-yellow-300 dark:text-red-600 font-semibold"
            data-highlight="true"
          >
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
};

// Component for individual expandable row
const ProcessedResultRow = ({
  result,
  isExpanded,
  onToggleExpand,
  onOpenFile,
  onViewContent,
}: {
  result: any;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenFile: (result: any) => void;
  onViewContent: (result: any) => void;
}) => {
  // Aggregate data from items in the group
  const items = result.items || [result];
  const firstItem = items[0];
  const docName = result.docName || firstItem?.extracted?.foundInDocument;
  const filePath = result.search?.doc?.originalFilePath;

  // Collect unique statuses and command types
  const statuses = Array.from(
    new Set(items.map((i: any) => i.extracted.status).filter((s: any) => !!s)),
  );
  const commandTypes = Array.from(
    new Set(
      items.map((i: any) => i.extracted.commandType).filter((c: any) => !!c),
    ),
  );

  return (
    <React.Fragment>
      <tr className="bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
        <td className="px-6 py-4 whitespace-nowrap align-middle">
          <div className="flex items-center gap-3">
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

        <td className="px-6 py-4 whitespace-nowrap align-middle text-center">
          {statuses.length > 0 ? (
            <div className="flex flex-col gap-1 items-center">
              {statuses.map((s: any, idx) => (
                <MetadataBadge
                  key={idx}
                  label="Статус"
                  value={s}
                  variant="blue"
                  hideLabel
                />
              ))}
            </div>
          ) : (
            '---'
          )}
        </td>
        <td className="px-6 py-4 whitespace-nowrap align-middle text-center">
          {commandTypes.length > 0 ? (
            <div className="flex flex-col gap-1 items-center">
              {commandTypes.map((c: any, idx) => (
                <MetadataBadge
                  key={idx}
                  label="Тип наказу"
                  value={c}
                  variant="purple"
                  hideLabel
                />
              ))}
            </div>
          ) : (
            '---'
          )}
        </td>
      </tr>

      {/* Expanded Content Row */}
      {isExpanded && (
        <tr className="bg-gray-50 dark:bg-gray-900/40 border-b dark:border-gray-700">
          <td colSpan={4} className="px-6 py-4">
            <div className="pl-10 text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
              {items.map((item: any, idx: number) => (
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
                        <span className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 flex items-center justify-center text-xs font-bold">
                          {idx + 1}
                        </span>

                        <MetadataBadge
                          label="Статус"
                          value={item.extracted.status}
                          variant="blue"
                        />

                        <MetadataBadge
                          label="Тип наказу"
                          value={item.extracted.commandType}
                          variant="purple"
                        />
                      </>
                    )}
                  </div>

                  <HighlightedText
                    text={item.extracted.summary}
                    highlight={item.extracted.matchedText}
                  />
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
  onViewContent, // New prop
}: {
  searchQuery: string;
  items: any[];
  onViewContent: (item: any) => void;
}) => {
  const [isOpen, setIsOpen] = React.useState(true);
  const [showCopied, setShowCopied] = React.useState(false);

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

  const handleCopyQuery = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent toggling the group
    try {
      await navigator.clipboard.writeText(searchQuery);
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000); // Hide after 2 seconds
    } catch (err) {
      console.error('Failed to copy query', err);
    }
  };

  const handleOpenFile = async (result: any) => {
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
    <div className="relative overflow-x-auto shadow-md sm:rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between bg-gray-50 px-6 py-3 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
        <h3 className="text-sm font-bold uppercase text-gray-700 dark:text-gray-200 flex items-center gap-2">
          <span>Результати для:</span>
          <span className="text-blue-600 dark:text-blue-400">
            {searchQuery}
          </span>
          <div className="relative flex items-center">
            <button
              type="button"
              onClick={handleCopyQuery}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none transition-colors"
              title="Скопіювати запит"
            >
              {showCopied ? (
                <svg
                  className="w-4 h-4 text-green-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              )}
            </button>
            {showCopied && (
              <span className="absolute left-full ml-2 whitespace-nowrap bg-green-100 text-green-800 text-xs font-medium px-1.5 py-0.5 rounded dark:bg-green-900 dark:text-green-100 animate-fade-in transition-opacity duration-300">
                Скопійовано!
              </span>
            )}
          </div>
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
        <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400 min-w-full divide-y divide-gray-200 dark:divide-gray-600">
          <thead className="bg-gray-50 text-xs uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-400 bg-gray-100 dark:bg-gray-700">
            <tr>
              <th className="px-6 py-3 whitespace-nowrap">
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
              <th className="px-6 py-3 whitespace-nowrap w-px text-center">
                Статус
              </th>
              <th className="px-6 py-3 whitespace-nowrap w-px text-center">
                Тип наказу
              </th>
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
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const TableProcessedDocumentResults = ({ results, onBtnExportClick }) => {
  const [isFilterOpen, setIsFilterOpen] = React.useState(false);
  const [isActionsOpen, setIsActionsOpen] = React.useState(false);

  // Search states for dropdowns
  const [statusFilterText, setStatusFilterText] = React.useState('');
  const [commandTypeFilterText, setCommandTypeFilterText] = React.useState('');

  const filterRef = React.useRef<HTMLDivElement>(null);
  const actionsRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        filterRef.current &&
        !filterRef.current.contains(event.target as Node)
      ) {
        setIsFilterOpen(false);
      }
      if (
        actionsRef.current &&
        !actionsRef.current.contains(event.target as Node)
      ) {
        setIsActionsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Filter states
  const [searchTerm, setSearchTerm] = React.useState('');
  const [maxResults, setMaxResults] = React.useState<string>('');
  const [selectedStatuses, setSelectedStatuses] = React.useState<string[]>([]);
  const [selectedCommandTypes, setSelectedCommandTypes] = React.useState<
    string[]
  >([]);

  // State for FormProcessDocumentSideOver
  const [previewItem, setPreviewItem] = React.useState<any | null>(null);

  // Derived state for dropdown options
  const visibleStatuses = React.useMemo(() => {
    return PROCESS_DOCUMENT__CONFIG.FILTER_STATUSES.filter((status) =>
      status.toLowerCase().includes(statusFilterText.toLowerCase()),
    );
  }, [statusFilterText]);

  const visibleCommandTypes = React.useMemo(() => {
    return PROCESS_DOCUMENT__CONFIG.ACTION_COMMAND_TYPES.filter((cmd) =>
      cmd.toLowerCase().includes(commandTypeFilterText.toLowerCase()),
    );
  }, [commandTypeFilterText]);

  // Filtering logic
  const filteredResults = React.useMemo(() => {
    if (!results) return {};

    const filtered: Record<string, any[]> = {};

    Object.entries(results).forEach(([searchQuery, items]) => {
      // 1. Filter by Search Term (on keys/searchQuery)
      if (
        searchTerm &&
        !searchQuery.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return;
      }

      // 2. Filter items within the group
      let filteredItems = (items as any[]).filter((group) => {
        const groupItems = group.items || [group];

        // Status Filter
        if (selectedStatuses.length > 0) {
          const hasMatchingStatus = groupItems.some(
            (item: any) =>
              item.extracted.status &&
              selectedStatuses.includes(item.extracted.status),
          );
          if (!hasMatchingStatus) return false;
        }

        // Command Type Filter
        if (selectedCommandTypes.length > 0) {
          const hasMatchingCommand = groupItems.some(
            (item: any) =>
              item.extracted.commandType &&
              selectedCommandTypes.includes(item.extracted.commandType),
          );
          if (!hasMatchingCommand) return false;
        }

        return true;
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
  }, [results, searchTerm, selectedStatuses, selectedCommandTypes, maxResults]);

  const hasResults = filteredResults && Object.keys(filteredResults).length > 0;

  const handleStatusChange = (status: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status],
    );
  };

  const handleCommandTypeChange = (cmd: string) => {
    setSelectedCommandTypes((prev) =>
      prev.includes(cmd) ? prev.filter((c) => c !== cmd) : [...prev, cmd],
    );
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

  const handleViewContent = (item: any) => {
    setPreviewItem(item);
  };

  const closePreview = () => {
    setPreviewItem(null);
  };

  return (
    <div className="relative bg-white shadow-md dark:bg-gray-800 sm:rounded-lg h-full flex flex-col">
      {/* Sideover for Content Preview */}
      <FormProcessDocumentSideOver
        isOpen={!!previewItem}
        onClose={closePreview}
        title={
          previewItem?.docName ||
          previewItem?.extracted?.foundInDocument ||
          'Деталі документу'
        }
        textFilePath={
          previewItem?.search?.doc?.textFilePath ||
          previewItem?.items?.[0]?.search?.doc?.textFilePath
        }
        highlightPhrases={
          previewItem?.items
            ? previewItem.items.map((i: any) => i.extracted.matchedText)
            : [previewItem?.extracted?.matchedText]
        }
      >
        {previewItem && (
          <div className="space-y-4">
            {/* Header / Metadata only - context removed to avoid duplication */}
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Запит: {previewItem.items?.[0]?.extracted?.searchQuery}
              </div>

              {/* Show Status/Type for each match if available */}
              <div className="mt-2 space-y-2">
                {previewItem.items?.map((item: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-2 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-100 dark:border-gray-700"
                  >
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Збіг #{idx + 1}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <MetadataBadge
                        label="Статус"
                        value={item.extracted.status}
                        variant="blue"
                      />
                      <MetadataBadge
                        label="Тип наказу"
                        value={item.extracted.commandType}
                        variant="purple"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </FormProcessDocumentSideOver>

      {/* Toolbar */}
      <div className="flex flex-col items-center justify-between p-4 space-y-3 md:flex-row md:space-y-0 md:space-x-4 border-b border-gray-200 dark:border-gray-700">
        <div className="w-full md:w-1/2 flex items-center space-x-2">
          <form
            className="flex items-center flex-1"
            onSubmit={(e) => e.preventDefault()}
          >
            <label htmlFor="simple-search" className="sr-only">
              Пошук
            </label>
            <div className="relative w-full">
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
                placeholder="Пошук"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </form>
        </div>
        <div className="flex flex-col items-stretch justify-end flex-shrink-0 w-full space-y-2 md:w-auto md:flex-row md:space-y-0 md:items-center md:space-x-3">
          {/* Max Results Counter */}
          <div className="relative flex items-center max-w-[8rem]">
            <button
              type="button"
              id="decrement-button"
              onClick={handleDecrementMaxResults}
              className="bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 dark:border-gray-600 hover:bg-gray-200 border border-gray-300 rounded-s-lg p-3 h-10 focus:ring-gray-100 dark:focus:ring-gray-700 focus:ring-2 focus:outline-none"
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
              className="bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 dark:border-gray-600 hover:bg-gray-200 border border-gray-300 rounded-e-lg p-3 h-10 focus:ring-gray-100 dark:focus:ring-gray-700 focus:ring-2 focus:outline-none"
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
          </div>
          {/* Filter Dropdown (Statuses) */}
          <div className="relative" ref={filterRef}>
            <button
              id="filterDropdownButton"
              onClick={() => {
                setIsFilterOpen(!isFilterOpen);
                setIsActionsOpen(false);
              }}
              className="relative flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg md:w-auto focus:outline-none hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 cursor-pointer"
              type="button"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                className="w-4 h-4 mr-2 text-gray-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z"
                  clipRule="evenodd"
                />
              </svg>
              Статус
              <svg
                className={`-mr-1 ml-1.5 w-5 h-5 transition-transform duration-200 ${isFilterOpen ? 'rotate-180' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  clipRule="evenodd"
                  fillRule="evenodd"
                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                />
              </svg>
              {selectedStatuses.length > 0 && (
                <div className="absolute inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-red-500 border-2 border-white rounded-full -top-2 -end-2 dark:border-gray-800">
                  {selectedStatuses.length}
                </div>
              )}
            </button>
            {isFilterOpen && (
              <div
                id="filterDropdown"
                className="absolute right-0 z-10 w-64 p-3 mt-2 bg-white rounded-lg shadow-lg dark:bg-gray-700 max-h-96 overflow-y-auto"
              >
                <h6 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">
                  Статуси
                </h6>
                <div className="mb-3">
                  <input
                    type="text"
                    value={statusFilterText}
                    onChange={(e) => setStatusFilterText(e.target.value)}
                    placeholder="Фільтрувати..."
                    className="block w-full p-2 text-xs text-gray-900 border border-gray-300 rounded-lg bg-gray-50 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-600 dark:border-gray-500 dark:placeholder-gray-400 dark:text-white"
                  />
                </div>
                <ul className="space-y-2 text-sm">
                  {visibleStatuses.map((status) => (
                    <li key={status} className="flex items-center">
                      <input
                        id={`filter-${status}`}
                        type="checkbox"
                        value={status}
                        checked={selectedStatuses.includes(status)}
                        onChange={() => handleStatusChange(status)}
                        className="w-4 h-4 bg-gray-100 border-gray-300 rounded text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-700 focus:ring-2 dark:bg-gray-600 dark:border-gray-500"
                      />
                      <label
                        htmlFor={`filter-${status}`}
                        className="ml-2 text-sm font-medium text-gray-900 dark:text-gray-100"
                      >
                        {status}
                      </label>
                    </li>
                  ))}
                  {visibleStatuses.length === 0 && (
                    <li className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">
                      Нічого не знайдено
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* Actions Dropdown (Command Types) */}
          <div className="relative" ref={actionsRef}>
            <button
              id="actionsDropdownButton"
              onClick={() => {
                setIsActionsOpen(!isActionsOpen);
                setIsFilterOpen(false);
              }}
              className="relative flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg md:w-auto focus:outline-none hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 cursor-pointer"
              type="button"
            >
              <svg
                className={`-ml-1 mr-1.5 w-5 h-5 transition-transform duration-200 ${isActionsOpen ? 'rotate-180' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  clipRule="evenodd"
                  fillRule="evenodd"
                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                />
              </svg>
              Тип наказу
              {selectedCommandTypes.length > 0 && (
                <div className="absolute inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-red-500 border-2 border-white rounded-full -top-2 -end-2 dark:border-gray-800">
                  {selectedCommandTypes.length}
                </div>
              )}
            </button>
            {isActionsOpen && (
              <div
                id="actionsDropdown"
                className="absolute right-0 z-10 w-64 p-3 mt-2 bg-white rounded-lg shadow-lg dark:bg-gray-700 max-h-96 overflow-y-auto"
              >
                <h6 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">
                  Типи наказів
                </h6>
                <div className="mb-3">
                  <input
                    type="text"
                    value={commandTypeFilterText}
                    onChange={(e) => setCommandTypeFilterText(e.target.value)}
                    placeholder="Фільтрувати..."
                    className="block w-full p-2 text-xs text-gray-900 border border-gray-300 rounded-lg bg-gray-50 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-600 dark:border-gray-500 dark:placeholder-gray-400 dark:text-white"
                  />
                </div>
                <ul className="space-y-2 text-sm">
                  {visibleCommandTypes.map((cmd) => (
                    <li key={cmd} className="flex items-center">
                      <input
                        id={`action-${cmd}`}
                        type="checkbox"
                        value={cmd}
                        checked={selectedCommandTypes.includes(cmd)}
                        onChange={() => handleCommandTypeChange(cmd)}
                        className="w-4 h-4 bg-gray-100 border-gray-300 rounded text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-700 focus:ring-2 dark:bg-gray-600 dark:border-gray-500"
                      />
                      <label
                        htmlFor={`action-${cmd}`}
                        className="ml-2 text-sm font-medium text-gray-900 dark:text-gray-100"
                      >
                        {cmd}
                      </label>
                    </li>
                  ))}
                  {visibleCommandTypes.length === 0 && (
                    <li className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">
                      Нічого не знайдено
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* Export Button */}
          <button
            type="button"
            className={`flex items-center justify-center flex-shrink-0 px-3 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg focus:outline-none focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 ${!hasResults ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-100 hover:text-blue-700'}`}
            onClick={handleButtonExportClick}
            disabled={!hasResults}
          >
            <svg
              className="w-4 h-4 mr-2"
              // className="w-4 h-4 mr-2 rotate-180"
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
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            Зберегти .xlsx
          </button>
        </div>
      </div>

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
            {(Object.entries(filteredResults) as [string, any[]][]).map(
              ([searchQuery, items], filteredResultIndex) => (
                <ProcessedResultGroup
                  key={searchQuery}
                  searchQuery={searchQuery}
                  items={items}
                  onViewContent={handleViewContent}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const DirectoryTreeItem = ({
  fsNestedItem,
  selectedPaths,
  onTogglePath,
}: {
  fsNestedItem: FileSystemItem;
  selectedPaths: Set<string>;
  onTogglePath: (path: string, checked: boolean) => void;
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const isSelected = selectedPaths.has(fsNestedItem.path);
  const hasChildren =
    fsNestedItem.fsNestedItems && fsNestedItem.fsNestedItems.length > 0;
  const isDirectory = fsNestedItem.fsItemType === 'directory';

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onTogglePath(fsNestedItem.path, e.target.checked);
  };

  const handleContentClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onTogglePath(fsNestedItem.path, !isSelected);
  };

  return (
    <div className="w-full">
      <div className="flex items-center gap-x-0.5 w-full py-0.5">
        {/* Toggle Button */}
        <button
          type="button"
          className={`shrink-0 w-6 h-6 flex justify-center items-center hover:bg-gray-100 rounded-md focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:hover:bg-gray-700 dark:focus:bg-gray-700 ${!hasChildren ? 'invisible' : ''}`}
          onClick={handleToggleExpand}
        >
          <svg
            className={`w-4 h-4 text-gray-800 dark:text-gray-200 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        {/* Content */}
        <div className="grow flex items-center gap-x-2 px-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
          {/* Checkbox */}
          <input
            type="checkbox"
            checked={isSelected}
            onChange={handleCheckboxChange}
            className="shrink-0 w-4 h-4 bg-gray-100 border-gray-300 rounded text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
          />

          {/* Icon & Name */}
          <div
            className="flex items-center gap-x-2 cursor-pointer grow py-1"
            onClick={handleContentClick}
          >
            <svg
              className="shrink-0 w-4 h-4 text-gray-500 dark:text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isDirectory ? (
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>
              ) : (
                <>
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
                  <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
                </>
              )}
            </svg>
            <span className="text-sm text-gray-800 dark:text-gray-200 select-none">
              {fsNestedItem.name}{' '}
              {(fsNestedItem.fsFileCount || 0) > 0 && (
                <span className="text-xs text-gray-400">
                  ({fsNestedItem.fsFileCount})
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="pl-7 relative before:absolute before:top-0 before:left-3 before:w-0.5 before:-ml-px before:h-full before:bg-gray-100 dark:before:bg-gray-700">
          {fsNestedItem.fsNestedItems?.map((child: FileSystemItem) => (
            <DirectoryTreeItem
              key={child.path}
              fsNestedItem={child}
              selectedPaths={selectedPaths}
              onTogglePath={onTogglePath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export { DirectoryTreeItem, TableProcessedDocumentResults };
