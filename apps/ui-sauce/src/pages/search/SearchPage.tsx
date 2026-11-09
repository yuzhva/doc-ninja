import React from 'react';
import { useTranslation } from 'react-i18next';

import { LoadingSpinner, Toast } from '../../components';
import type { ToastMessage } from '../../components';
import { useDirectoryPicker } from '../../hooks/use-file-system';
import { NotificationBridge } from '../../utils/notification-bridge';
import { SearchDocumentsContainer } from './SearchDocumentsContainer';
import { useSearchRun } from './use-search-run';

const I18N_NS = 'page.search';

const SearchPage = () => {
  const { t } = useTranslation();

  // --- Toast Management ---
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);
  const addToast = React.useCallback(
    (type: 'success' | 'error' | 'warning', content: React.ReactNode) => {
      const id = Date.now();
      setToasts((prev) => [...prev, { id, type, content }]);
    },
    [],
  );
  const removeToast = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // The folders to search are picked with this
  const sourceDir = useDirectoryPicker({ mode: 'read' });

  // The search running, if any — the footer below cancels it
  const search = useSearchRun(addToast);

  React.useEffect(() => {
    NotificationBridge.requestPermission();
  }, []);

  return (
    // Fills the height the Layout reserves so the form/results columns can own
    // their own scrollbars instead of scrolling the whole page.
    <div className="lg:flex lg:h-full lg:flex-col">
      {/* Toast Container */}
      <div className="fixed bottom-12 right-5 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <Toast key={t.id} {...t} onClose={removeToast} />
        ))}
      </div>

      {!sourceDir.isSupported && (
        <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded">
          ⚠️ {t(`${I18N_NS}.fileSystemNotSupportedWarning`)}
        </div>
      )}

      <SearchDocumentsContainer
        onSelectSourceDirectory={sourceDir.selectDirectory}
        isFileSystemAccessSupported={sourceDir.isSupported}
        runSearch={search.run}
        isSearching={search.isSearching}
        addToast={addToast}
      />

      {/* Progress footer — always mounted so the slide transition can play;
          hidden below the viewport via translate-y-full when idle. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 transform transition-transform duration-300 ease-in-out ${
          search.isSearching ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="py-3 px-4 bg-yellow-300 border-t border-yellow-400 text-gray-900 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] dark:bg-yellow-200 dark:border-yellow-300">
          <div className="flex items-center justify-start text-sm font-semibold">
            <LoadingSpinner className="text-gray-900" />
            {t(`${I18N_NS}.processingMessage`)}
            {/* Disabled while the footer is hidden, so Tab never lands on it */}
            <button
              type="button"
              onClick={search.cancel}
              disabled={!search.isSearching}
              className="ml-auto rounded-lg border border-gray-900/40 px-3 py-1 text-sm font-semibold text-gray-900 hover:bg-yellow-400 focus:outline-none focus:ring-2 focus:ring-gray-900/40 dark:hover:bg-yellow-300"
            >
              {t(`${I18N_NS}.cancelButton`)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export { SearchPage };
