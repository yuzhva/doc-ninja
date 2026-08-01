import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Modal } from '../../../../../components';

const SEARCH_HISTORY_STORAGE_KEY = 'docNinja_searchHistory';
const SEARCH_HISTORY_MAX_SIZE_STORAGE_KEY = 'docNinja_searchHistoryMaxSize';
const DEFAULT_SEARCH_HISTORY_MAX_SIZE = 15;

const readSearchHistoryMaxSize = (): number => {
  try {
    const saved = localStorage.getItem(SEARCH_HISTORY_MAX_SIZE_STORAGE_KEY);
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_SEARCH_HISTORY_MAX_SIZE;
  } catch {
    return DEFAULT_SEARCH_HISTORY_MAX_SIZE;
  }
};

const readSearchHistory = (): string[] => {
  try {
    const saved = localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch (e) {
    console.warn('Failed to load search history from storage', e);
    return [];
  }
};

// Called whenever a search actually runs — most-recent-first, deduplicated,
// capped at whatever the user configured (or the default) in the history modal.
const addSearchHistoryEntry = (query: string) => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return;

  try {
    const maxSize = readSearchHistoryMaxSize();
    const withoutDuplicate = readSearchHistory().filter(
      (q) => q !== trimmedQuery,
    );
    const next = [trimmedQuery, ...withoutDuplicate].slice(0, maxSize);
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn('Failed to save search history', e);
  }
};

const FPDModalSearchHistory = ({
  isOpen,
  onClose,
  onSelectQuery,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuery: (query: string) => void;
}) => {
  const { t } = useTranslation();
  const [history, setHistory] = React.useState<string[]>([]);
  const [maxHistorySize, setMaxHistorySize] = React.useState(
    String(DEFAULT_SEARCH_HISTORY_MAX_SIZE),
  );
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setHistory(readSearchHistory());
    setMaxHistorySize(String(readSearchHistoryMaxSize()));
    setSelectedIndex(null);
  }, [isOpen]);

  const handleMaxHistorySizeChange = (value: string) => {
    setMaxHistorySize(value);

    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    try {
      localStorage.setItem(SEARCH_HISTORY_MAX_SIZE_STORAGE_KEY, String(parsed));
    } catch (e) {
      console.warn('Failed to save search history size to storage', e);
    }
  };

  const handleApply = () => {
    if (selectedIndex === null) return;
    onSelectQuery(history[selectedIndex]);
  };

  const handleDeleteEntry = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();

    const next = history.filter((_, i) => i !== index);
    setHistory(next);

    try {
      localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('Failed to save search history', err);
    }

    setSelectedIndex((prev) => {
      if (prev === null || prev === index) return null;
      return prev > index ? prev - 1 : prev;
    });
  };

  return (
    <Modal
      title={
        <Trans i18nKey="page.search.component.fpdModalSearchHistory.title" />
      }
      isOpen={isOpen}
      onBtnCloseClick={onClose}
      maxWidthClassName="max-w-lg"
      footer={
        <>
          <div className="flex items-center gap-2">
            <input
              id="searchHistoryMaxSize"
              type="number"
              min="1"
              value={maxHistorySize}
              onChange={(e) => handleMaxHistorySizeChange(e.target.value)}
              className="w-20 block border bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2 text-sm"
            />
            <label
              htmlFor="searchHistoryMaxSize"
              className="text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap"
            >
              <Trans i18nKey="page.search.component.fpdModalSearchHistory.maxSizeLabel" />
            </label>
          </div>
          <button
            type="button"
            onClick={handleApply}
            disabled={selectedIndex === null}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 cursor-pointer"
          >
            <Trans i18nKey="page.search.component.fpdModalSearchHistory.applyButton" />
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-500 dark:text-gray-400">
        <Trans i18nKey="page.search.component.fpdModalSearchHistory.description" />
      </p>

      {history.length === 0 ? (
        <div className="py-6 text-sm text-center text-gray-500 dark:text-gray-400">
          <Trans i18nKey="page.search.component.fpdModalSearchHistory.emptyState" />
        </div>
      ) : (
        <div className="-mx-4 md:-mx-6 max-h-80 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
          {history.map((query, index) => {
            const isSelected = index === selectedIndex;
            const inputId = `searchHistoryQuery-${index}`;

            return (
              <div
                key={index}
                onClick={() => setSelectedIndex(index)}
                className={`w-full flex items-center gap-3 px-4 md:px-6 py-2.5 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/30'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <input
                  id={inputId}
                  type="radio"
                  name="searchHistoryQuery"
                  checked={isSelected}
                  onChange={() => setSelectedIndex(index)}
                  className="w-4 h-4 shrink-0 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 dark:bg-gray-700 dark:border-gray-600"
                />
                <label
                  htmlFor={inputId}
                  className={`w-full select-none text-sm font-medium line-clamp-2 whitespace-pre-line cursor-pointer ${
                    isSelected
                      ? 'text-blue-700 dark:text-blue-400'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {query}
                </label>
                <button
                  type="button"
                  aria-label={t(
                    'page.search.component.fpdModalSearchHistory.deleteEntryAriaLabel',
                  )}
                  onClick={(e) => handleDeleteEntry(index, e)}
                  className="p-1 shrink-0 text-gray-400 rounded-lg cursor-pointer hover:text-red-600 hover:bg-red-50 dark:text-gray-500 dark:hover:text-red-400 dark:hover:bg-red-900/30 focus:outline-none"
                >
                  <svg
                    className="w-4 h-4"
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
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
};

export {
  FPDModalSearchHistory,
  SEARCH_HISTORY_STORAGE_KEY,
  readSearchHistory,
  addSearchHistoryEntry,
  readSearchHistoryMaxSize,
  DEFAULT_SEARCH_HISTORY_MAX_SIZE,
};
