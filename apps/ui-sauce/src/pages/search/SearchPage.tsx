import React from 'react';
import { useTranslation } from 'react-i18next';

import { LoadingSpinner, Toast } from '../../components';
import type { ToastMessage } from '../../components';
import { useBatchProcessor } from '../../hooks/use-batch-processor';
import type { BatchFileProcessingSectionProps } from '../../hooks/use-batch-processor';
import { useDirectoryPicker, useFilePicker } from '../../hooks/use-file-system';
import { NotificationBridge } from '../../utils/notification-bridge';
import { SearchDocumentsContainer } from './SearchDocumentsContainer';

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

  // --- File System Hooks ---
  const sourceDir = useDirectoryPicker({ mode: 'read' });
  const outputDir = useDirectoryPicker({ mode: 'readwrite' });

  const filePicker = useFilePicker({
    types: [
      {
        description: 'Excel files',
        accept: {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
            '.xlsx',
          ],
          'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm', '.xlsb'],
          'application/vnd.ms-excel': ['.xls'],
        },
      },
      {
        description: 'JSON Config',
        accept: {
          'application/json': ['.json'],
        },
      },
    ],
  });

  // --- Batch Processor Hook ---
  const { execute, isProcessing, progress } = useBatchProcessor(addToast);

  const initSubmitHandler = React.useCallback(
    (
      apiCallFunction: Parameters<
        BatchFileProcessingSectionProps['initSubmitHandler']
      >[0],
    ) => {
      return (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const formDataJSON = { ...Object.fromEntries(formData || {}) };
        return apiCallFunction(formDataJSON);
      };
    },
    [],
  );

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
        onSelectFile={filePicker.selectFile}
        onSelectSourceDirectory={sourceDir.selectDirectory}
        onSelectOutputDirectory={outputDir.selectDirectory}
        executeBatch={execute}
        initSubmitHandler={initSubmitHandler}
        sourceDirectory={sourceDir.processedDir}
        outputDirectory={outputDir.processedDir}
        selectedFile={filePicker.processedDir}
        progress={progress}
        isFileSystemAccessSupported={sourceDir.isSupported}
        isProcessing={isProcessing}
        addToast={addToast}
      />

      {/* Progress footer — always mounted so the slide transition can play;
          hidden below the viewport via translate-y-full when idle. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 transform transition-transform duration-300 ease-in-out ${
          isProcessing ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="py-3 px-4 bg-yellow-300 border-t border-yellow-400 text-gray-900 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] dark:bg-yellow-200 dark:border-yellow-300">
          <div className="flex items-center justify-start text-sm font-semibold">
            <LoadingSpinner className="text-gray-900" />
            {t(`${I18N_NS}.processingMessage`)}
          </div>
        </div>
      </div>
    </div>
  );
};

export { SearchPage };
