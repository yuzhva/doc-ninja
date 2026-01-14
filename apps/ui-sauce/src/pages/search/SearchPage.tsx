import React from 'react';

import { LoadingSpinner } from '../../components';
import { useDirectoryPicker, useFilePicker } from '../../hooks/use-file-system';
import { FormPageSectionProps } from '../process/process-page.types';
import { useBatchProcessor } from '../process/use-batch-processor';
import { FormProcessDocumentTabItem } from './FormProcessDocumentTabItem/index';

interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'warning';
  content: string;
}

const Toast = ({
  id,
  type,
  content,
  onClose,
}: ToastMessage & { onClose: (id: number) => void }) => {
  const icon =
    type === 'success' ? (
      <div className="inline-flex items-center justify-center shrink-0 w-8 h-8 text-green-500 bg-green-100 rounded-lg dark:bg-green-800 dark:text-green-200">
        <svg
          className="w-5 h-5"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M5 11.917 9.724 16.5 19 7.5"
          />
        </svg>
        <span className="sr-only">Check icon</span>
      </div>
    ) : type === 'error' ? (
      <div className="inline-flex items-center justify-center shrink-0 w-8 h-8 text-red-500 bg-red-100 rounded-lg dark:bg-red-800 dark:text-red-200">
        <svg
          className="w-5 h-5"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M6 18 17.94 6M18 18 6.06 6"
          />
        </svg>
        <span className="sr-only">Error icon</span>
      </div>
    ) : (
      <div className="inline-flex items-center justify-center shrink-0 w-8 h-8 text-orange-500 bg-orange-100 rounded-lg dark:bg-orange-700 dark:text-orange-200">
        <svg
          className="w-5 h-5"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 13V8m0 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
        <span className="sr-only">Warning icon</span>
      </div>
    );

  return (
    <div
      className="flex items-center w-full max-w-sm p-4 text-gray-500 bg-white rounded-lg shadow dark:text-gray-400 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 mb-4"
      role="alert"
    >
      {icon}
      <div className="ms-3 text-sm font-normal whitespace-pre-wrap">
        {content}
      </div>
      <button
        type="button"
        className="ms-auto -mx-1.5 -my-1.5 bg-white text-gray-400 hover:text-gray-900 rounded-lg focus:ring-2 focus:ring-gray-300 p-1.5 hover:bg-gray-100 inline-flex items-center justify-center h-8 w-8 dark:text-gray-500 dark:hover:text-white dark:bg-gray-800 dark:hover:bg-gray-700"
        aria-label="Close"
        onClick={() => onClose(id)}
      >
        <span className="sr-only">Close</span>
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
      </button>
    </div>
  );
};

const SearchPage = () => {
  // --- Toast Management ---
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);
  const addToast = React.useCallback(
    (type: 'success' | 'error' | 'warning', content: string) => {
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
      apiCallFunction: Parameters<FormPageSectionProps['initSubmitHandler']>[0],
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
    if (Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);

  return (
    <div>
      {/* Toast Container */}
      <div className="fixed top-5 right-5 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <Toast key={t.id} {...t} onClose={removeToast} />
        ))}
      </div>

      {/* Progress indicator */}
      {isProcessing && (
        <div className="mb-4 p-3 bg-blue-100 border border-blue-400 text-blue-700 rounded">
          <div className="flex items-center">
            <LoadingSpinner />
            📊 Processing batch {progress.batch}... ({progress.current}/
            {progress.total} files)
          </div>
        </div>
      )}

      {!sourceDir.isSupported && (
        <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded">
          ⚠️ File System Access API не підтримується. Використовуйте Chrome 86+
          або Edge 86+.
        </div>
      )}

      <FormProcessDocumentTabItem
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
      />
    </div>
  );
};

export { SearchPage };
