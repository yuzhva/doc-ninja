import React from 'react';

import { Tabs } from '../../components';
import {
  FileSystemAPIProcessor,
  ProcessingResult,
} from '../../utils/file-system-processor';
import { FormChunkSpreadsheetTabItem } from './FormChunkSpreadsheetTabItem';
import { FormConvertDocToTextTabItem } from './FormConvertDocToTextTabItem';
import { FormConvertSpreadsheetToStatic } from './FormConvertSpreadsheetToStatic';
import { FormProcessDocumentTabItem } from './FormProcessDocumentTabItem/index';
import { LoadingSpinner } from './documents-components';

interface FileSystemApiCallOptions {
  formDataJSON: any;
  sourceHandle: FileSystemFileHandle | FileSystemDirectoryHandle | null;
  destinationHandle: FileSystemDirectoryHandle | null;
  processorFunction: (handle: any) => Promise<ProcessingResult>;
  validationMessage: string;
  successMessage: string;
  subfolderPath?: string; // Renamed from subfolderName to better reflect nested paths
  isWritingFilesSkipped?: boolean;
}

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

const DocumentsPage = () => {
  // Simplified state - only 3 handles needed
  const [sourceDirectoryHandle, setSourceDirectoryHandle] =
    React.useState<FileSystemDirectoryHandle | null>(null);
  const [outputDirectoryHandle, setOutputDirectoryHandle] =
    React.useState<FileSystemDirectoryHandle | null>(null);
  const [selectedFileHandle, setSelectedFileHandle] =
    React.useState<FileSystemFileHandle | null>(null);

  const [isProcessing, setIsProcessing] = React.useState(false);
  const [progress, setProgress] = React.useState({
    current: 0,
    total: 0,
    batch: 0,
  });

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

  const isFileSystemAccessSupported =
    typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  // General File System API handler factory
  const createFileSystemHandler = React.useCallback(
    (config: {
      type: 'file' | 'directory';
      mode?: 'read' | 'readwrite';
      types?: any[];
      setter: (handle: any) => void;
    }) => {
      return async (e: React.MouseEvent) => {
        if (isFileSystemAccessSupported) {
          e.preventDefault();
          try {
            let handle;
            if (config.type === 'directory') {
              handle = await window.showDirectoryPicker({
                mode: config.mode || 'read',
              });
            } else {
              const [fileHandle] = await window.showOpenFilePicker({
                types: config.types || [],
                multiple: false,
              });
              handle = fileHandle;
            }
            config.setter(handle);
          } catch (error) {
            if (error.name !== 'AbortError')
              console.error(`Error selecting ${config.type}:`, error);
          }
        }
      };
    },
    [isFileSystemAccessSupported],
  );

  // Simplified handlers - only 3 needed
  const handleFileSelect = createFileSystemHandler({
    type: 'file',
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
    ],
    setter: setSelectedFileHandle,
  });

  const handleSourceDirectorySelect = createFileSystemHandler({
    type: 'directory',
    mode: 'read',
    setter: setSourceDirectoryHandle,
  });

  const handleOutputDirectorySelect = createFileSystemHandler({
    type: 'directory',
    mode: 'readwrite',
    setter: setOutputDirectoryHandle,
  });

  // Refactored to handle all API response processing centrally
  const initFileSystemApiCallExecutor = React.useCallback(
    (options: FileSystemApiCallOptions) => {
      return async (
        makeApiCall: (
          batch: any[],
          batchIndex: number,
          totalBatches: number,
          structure: any,
        ) => Promise<any>,
      ) => {
        // Validation
        if (
          [
            options.formDataJSON.hasOwnProperty('sourceHandle')
              ? options.formDataJSON['sourceHandle']
              : true,
            options.formDataJSON.hasOwnProperty('destinationHandle')
              ? options.formDataJSON['destinationHandle']
              : true,
          ].includes(false)
        ) {
          const notificationContent = options.validationMessage;
          addToast('warning', notificationContent);
          if (window.document.hidden) new Notification(notificationContent);
          return;
        }

        setIsProcessing(true);
        setProgress({ current: 0, total: 0, batch: 0 });

        try {
          const result = await (options.sourceHandle
            ? options.processorFunction(options.sourceHandle)
            : { files: [{}] });

          console.log(`Processing ${result.files.length} files`);

          // Unified batching logic for both single file and directory
          const BATCH_SIZE = 50;
          const batches: any[][] = [];
          for (let i = 0; i < result.files.length; i += BATCH_SIZE) {
            batches.push(result.files.slice(i, i + BATCH_SIZE));
          }

          let totalProcessed = 0;
          let totalFailed = 0;
          const allErrors: any[] = [];

          for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const batchIndex = i + 1;

            setProgress({
              current: totalProcessed + totalFailed,
              total: result.files.length,
              batch: batchIndex,
            });

            try {
              const response = await makeApiCall(
                batch,
                batchIndex,
                batches.length,
                result.structure,
              );

              console.log(`Batch ${batchIndex} response:`, response);

              // Update the batch processing to handle directory creation correctly
              if (
                response.processedFiles?.length > 0 &&
                !options.isWritingFilesSkipped
              ) {
                await FileSystemAPIProcessor.writeProcessedFiles(
                  response.processedFiles,
                  options.destinationHandle,
                  options.subfolderPath,
                );
              }

              totalProcessed += response.processedFiles?.length || 0;
              if (response.failedFiles?.length > 0) {
                totalFailed += response.failedFiles.length;
                allErrors.push(...response.failedFiles);
              }
            } catch (error) {
              console.error(`Batch ${batchIndex} failed:`, error);
              totalFailed += batch.length;
              allErrors.push({ batch: batchIndex, error: error.message });
            }
          }
          const notificationContent =
            `✅ ${options.successMessage}\n` +
            `📄 Successfully processed: ${totalProcessed}\n` +
            `❌ Failed: ${totalFailed}\n` +
            `📁 Files saved to selected output folder${options.subfolderPath ? ` (subfolder: ${options.subfolderPath})` : ''}.`;

          addToast('success', notificationContent);

          if (window.document.hidden) new Notification(notificationContent);

          if (allErrors.length > 0) {
            console.warn('Processing errors:', allErrors);
          }
        } catch (error) {
          console.error('Processing failed:', error);

          const notificationContent =
            '❌ Processing failed. Check console for details.';
          addToast('error', notificationContent);
          if (window.document.hidden) new Notification(notificationContent);
        } finally {
          setIsProcessing(false);
        }
      };
    },
    [addToast],
  );

  const initSubmitHandler = React.useCallback(
    (apiCallFunction: () => void) => {
      return (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        const formDataJSON = {
          ...Object.fromEntries(formData || {}),
        };

        // Execute the passed API function
        apiCallFunction(formDataJSON);
      };
    },
    [sourceDirectoryHandle, outputDirectoryHandle, selectedFileHandle],
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

      {!isFileSystemAccessSupported && (
        <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded">
          ⚠️ File System Access API не підтримується. Використовуйте Chrome 86+
          або Edge 86+.
        </div>
      )}

      <Tabs aria-label="Tabs with icons">
        <Tabs.Item title="Конвертувати .xlsx в cтатику">
          <FormConvertSpreadsheetToStatic
            handleFileSelect={handleFileSelect}
            handleSourceDirectorySelect={handleSourceDirectorySelect}
            handleOutputDirectorySelect={handleOutputDirectorySelect}
            initFileSystemApiCallExecutor={initFileSystemApiCallExecutor}
            initSubmitHandler={initSubmitHandler}
            sourceDirectoryHandle={sourceDirectoryHandle}
            outputDirectoryHandle={outputDirectoryHandle}
            selectedFileHandle={selectedFileHandle}
            progress={progress}
            isFileSystemAccessSupported={isFileSystemAccessSupported}
            isProcessing={isProcessing}
          />
        </Tabs.Item>
        <Tabs.Item title="Нарізка таблиці">
          <FormChunkSpreadsheetTabItem
            handleFileSelect={handleFileSelect}
            handleSourceDirectorySelect={handleSourceDirectorySelect}
            handleOutputDirectorySelect={handleOutputDirectorySelect}
            initFileSystemApiCallExecutor={initFileSystemApiCallExecutor}
            initSubmitHandler={initSubmitHandler}
            sourceDirectoryHandle={sourceDirectoryHandle}
            outputDirectoryHandle={outputDirectoryHandle}
            selectedFileHandle={selectedFileHandle}
            progress={progress}
            isFileSystemAccessSupported={isFileSystemAccessSupported}
            isProcessing={isProcessing}
          />
        </Tabs.Item>
        <Tabs.Item title="Конвертувати Документи в Текст">
          <FormConvertDocToTextTabItem
            handleFileSelect={handleFileSelect}
            handleSourceDirectorySelect={handleSourceDirectorySelect}
            handleOutputDirectorySelect={handleOutputDirectorySelect}
            initFileSystemApiCallExecutor={initFileSystemApiCallExecutor}
            initSubmitHandler={initSubmitHandler}
            sourceDirectoryHandle={sourceDirectoryHandle}
            outputDirectoryHandle={outputDirectoryHandle}
            selectedFileHandle={selectedFileHandle}
            progress={progress}
            isFileSystemAccessSupported={isFileSystemAccessSupported}
            isProcessing={isProcessing}
          />
        </Tabs.Item>
        {/*
        <Tabs.Item title="Проіндексувати текстові файли">
          <FormConvertTextToIndexTabItem
            handleFileSelect={handleFileSelect}
            handleSourceDirectorySelect={handleSourceDirectorySelect}
            handleOutputDirectorySelect={handleOutputDirectorySelect}
            initFileSystemApiCallExecutor={initFileSystemApiCallExecutor}
            initSubmitHandler={initSubmitHandler}
            sourceDirectoryHandle={sourceDirectoryHandle}
            outputDirectoryHandle={outputDirectoryHandle}
            selectedFileHandle={selectedFileHandle}
            progress={progress}
            isFileSystemAccessSupported={isFileSystemAccessSupported}
            isProcessing={isProcessing}
          />
        </Tabs.Item>
        */}
        <Tabs.Item title="Пошук збігів в документах">
          <FormProcessDocumentTabItem
            handleFileSelect={handleFileSelect}
            handleSourceDirectorySelect={handleSourceDirectorySelect}
            handleOutputDirectorySelect={handleOutputDirectorySelect}
            initFileSystemApiCallExecutor={initFileSystemApiCallExecutor}
            initSubmitHandler={initSubmitHandler}
            sourceDirectoryHandle={sourceDirectoryHandle}
            outputDirectoryHandle={outputDirectoryHandle}
            selectedFileHandle={selectedFileHandle}
            progress={progress}
            isFileSystemAccessSupported={isFileSystemAccessSupported}
            isProcessing={isProcessing}
          />
        </Tabs.Item>
      </Tabs>
    </div>
  );
};

export { DocumentsPage };
