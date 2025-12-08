import React from 'react';

import PROCESS_DOCUMENT__CONFIG from './process-document.config.json';

const ProcessedResultGroup = ({
  searchQuery,
  items,
}: {
  searchQuery: string;
  items: any[];
}) => {
  const [isOpen, setIsOpen] = React.useState(true);

  return (
    <div className="relative overflow-x-auto shadow-md sm:rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between bg-gray-50 px-6 py-3 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
        <h3 className="text-sm font-bold uppercase text-gray-700 dark:text-gray-200">
          Результати для:{' '}
          <span className="text-blue-600 dark:text-blue-400">
            {searchQuery}
          </span>
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
              <th className="px-6 py-3 whitespace-nowrap">Документ</th>
              <th className="px-6 py-3 w-1/2">Підсумок</th>
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
              <tr
                key={index}
                className="hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <div className="font-medium text-gray-900 dark:text-white">
                    {result.foundInDocument}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {result.matchedText}
                  </div>
                </td>
                <td className="px-6 py-4 align-top">
                  <div className="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
                    {result.summary}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top text-center">
                  {result.status || '---'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top text-center">
                  {result.commandType}
                </td>
              </tr>
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
      let filteredItems = (items as any[]).filter((item) => {
        // Status Filter
        if (selectedStatuses.length > 0) {
          if (!item.status || !selectedStatuses.includes(item.status)) {
            return false;
          }
        }

        // Command Type Filter
        if (selectedCommandTypes.length > 0) {
          if (
            !item.commandType ||
            !selectedCommandTypes.includes(item.commandType)
          ) {
            return false;
          }
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

  return (
    <div className="relative bg-white shadow-md dark:bg-gray-800 sm:rounded-lg h-full flex flex-col">
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
              className="flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg md:w-auto focus:outline-none hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 cursor-pointer"
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
              Статус{' '}
              {selectedStatuses.length > 0 && `(${selectedStatuses.length})`}
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
            </button>
            {isFilterOpen && (
              <div
                id="filterDropdown"
                className="absolute right-0 z-10 w-64 p-3 mt-2 bg-white rounded-lg shadow-lg dark:bg-gray-700 max-h-96 overflow-y-auto"
              >
                <h6 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">
                  Статуси
                </h6>
                <ul className="space-y-2 text-sm">
                  {PROCESS_DOCUMENT__CONFIG.FILTER_STATUSES.map((status) => (
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
              className="flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg md:w-auto focus:outline-none hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 cursor-pointer"
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
              Тип наказу{' '}
              {selectedCommandTypes.length > 0 &&
                `(${selectedCommandTypes.length})`}
            </button>
            {isActionsOpen && (
              <div
                id="actionsDropdown"
                className="absolute right-0 z-10 w-64 p-3 mt-2 bg-white rounded-lg shadow-lg dark:bg-gray-700 max-h-96 overflow-y-auto"
              >
                <h6 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">
                  Типи наказів
                </h6>
                <ul className="space-y-2 text-sm">
                  {PROCESS_DOCUMENT__CONFIG.ACTION_COMMAND_TYPES.map((cmd) => (
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
              ([searchQuery, items]) => (
                <ProcessedResultGroup
                  key={searchQuery}
                  searchQuery={searchQuery}
                  items={items}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export { TableProcessedDocumentResults };
