import React from 'react';

import { Tabs } from '../../components';
import { fetchRequest } from '../../utils';
import {
  FileSystemAPIProcessor,
  ProcessingResult,
} from '../../utils/file-system-processor';

const FileSelectInput = ({
  id,
  name,
  type = 'file',
  accept,
  onClick,
  selectedItem,
  webkitdirectory,
  directory,
  isFileSystemAccessSupported,
  label,
  icon = 'file', // "file" or "folder"
}) => {
  const displayName = React.useMemo(() => {
    if (!selectedItem) return 'Click to select...';

    const name = selectedItem.name;
    const kind = selectedItem.kind;

    return `${kind}://${name}`;
  }, [selectedItem]);

  const FileIcon = () => (
    <svg
      className="w-4 h-4 text-gray-500 dark:text-gray-400"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 20 16"
    >
      <path
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M8 8v1h4V8m4 7H4a1 1 0 0 1-1-1V5h14v9a1 1 0 0 1-1 1ZM2 1h16a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Z"
      />
    </svg>
  );

  const FolderIcon = () => (
    <svg
      className="w-4 h-4 text-gray-500 dark:text-gray-400"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      viewBox="0 0 20 16"
    >
      <path d="M19 0H1a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V1a1 1 0 0 0-1-1ZM2 6v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6H2Zm11 3a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 2 0h2a1 1 0 0 1 2 0v1Z" />
    </svg>
  );

  return (
    <div className="mb-5">
      <label
        className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
        htmlFor={id}
      >
        {label}
      </label>
      <div className="flex">
        <span className="inline-flex items-center px-3 text-sm text-gray-900 bg-gray-200 border rounded-e-0 border-gray-300 border-e-0 rounded-s-md dark:bg-gray-600 dark:text-gray-400 dark:border-gray-600">
          {icon === 'folder' ? <FolderIcon /> : <FileIcon />}
        </span>
        <button
          type="button"
          onClick={onClick}
          disabled={!isFileSystemAccessSupported}
          className="rounded-none rounded-e-lg bg-gray-50 border text-gray-900 focus:ring-blue-500 focus:border-blue-500 block flex-1 min-w-0 w-full text-sm border-gray-300 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 disabled:opacity-50 text-left cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
        >
          {displayName}
        </button>
        {/* Hidden input for fallback */}
        <input
          id={id}
          name={name}
          type={type}
          accept={accept}
          className="hidden"
          webkitdirectory={webkitdirectory}
          directory={directory}
        />
      </div>
    </div>
  );
};

interface FileSystemApiCallOptions {
  sourceHandle: FileSystemFileHandle | FileSystemDirectoryHandle | null;
  destinationHandle: FileSystemDirectoryHandle | null;
  processorFunction: (handle: any) => Promise<ProcessingResult>;
  validationMessage: string;
  successMessage: string;
  subfolderPath?: string; // Renamed from subfolderName to better reflect nested paths
}

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
          'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
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
        if (!options.sourceHandle || !options.destinationHandle) {
          alert(options.validationMessage);
          return;
        }

        setIsProcessing(true);
        setProgress({ current: 0, total: 0, batch: 0 });

        try {
          const result = await options.processorFunction(options.sourceHandle);

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
              if (response.processedFiles?.length > 0) {
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

          alert(
            `✅ ${options.successMessage}\n` +
              `📄 Successfully processed: ${totalProcessed}\n` +
              `❌ Failed: ${totalFailed}\n` +
              `📁 Files saved to selected output folder${options.subfolderPath ? ` (subfolder: ${options.subfolderPath})` : ''}.`,
          );

          if (allErrors.length > 0) {
            console.warn('Processing errors:', allErrors);
          }
        } catch (error) {
          console.error('Processing failed:', error);
          alert(`❌ Processing failed. Check console for details.`);
        } finally {
          setIsProcessing(false);
        }
      };
    },
    [],
  );

  // Simplified API call functions using unified fetchRequest
  const postConvertDocToText = React.useCallback(async () => {
    return initFileSystemApiCallExecutor({
      sourceHandle: sourceDirectoryHandle,
      destinationHandle: outputDirectoryHandle,
      processorFunction: FileSystemAPIProcessor.processDirectory,
      validationMessage: 'Please select both source and output folders first.',
      successMessage: 'Successfully converted documents to text!',
      subfolderPath: '.nlp-ninja/txt',
    })(async (batch, batchIndex, totalBatches, structure) => {
      return fetchRequest('/api-local/convert/doc-to-text', {
        method: 'POST',
        body: JSON.stringify({
          batchIndex,
          totalBatches,
          structure,
          files: batch.map((f) => ({
            path: f.item.path,
            name: f.item.name,
            content: f.content,
            size: f.item.size,
            modifiedAt: f.item.modifiedAt,
          })),
        }),
      });
    });
  }, [
    initFileSystemApiCallExecutor,
    sourceDirectoryHandle,
    outputDirectoryHandle,
  ]);

  const postConvertTextToIndex = React.useCallback(async () => {
    return initFileSystemApiCallExecutor({
      sourceHandle: sourceDirectoryHandle,
      destinationHandle: outputDirectoryHandle,
      processorFunction: FileSystemAPIProcessor.processDirectory,
      validationMessage: 'Please select both source and output folders first.',
      successMessage: 'Successfully indexed text files!',
      subfolderPath: '.nlp-ninja/index',
    })(async (batch, batchIndex, totalBatches, structure) => {
      return fetchRequest('/api-local/convert/text-to-index', {
        method: 'POST',
        body: JSON.stringify({
          batchIndex,
          totalBatches,
          structure,
          files: batch.map((f) => ({
            path: f.item.path,
            name: f.item.name,
            content: f.content,
            size: f.item.size,
            modifiedAt: f.item.modifiedAt,
          })),
        }),
      });
    });
  }, [
    initFileSystemApiCallExecutor,
    sourceDirectoryHandle,
    outputDirectoryHandle,
  ]);

  const postProcessDocuments = React.useCallback(async () => {
    return initFileSystemApiCallExecutor({
      sourceHandle: selectedFileHandle,
      destinationHandle: outputDirectoryHandle,
      processorFunction: FileSystemAPIProcessor.processSingleFile,
      validationMessage:
        'Please select both an input file and an output folder.',
      successMessage: 'Document processing completed successfully!',
      // No subfolderPath specified - files will be saved in root
    })(async (batch, batchIndex, totalBatches, structure) => {
      return fetchRequest('/api-local/process/documents', {
        method: 'POST',
        /*
        body: JSON.stringify({
          structure,
          files: batch.map((f) => ({
            path: f.item.path,
            name: f.item.name,
            content: f.content,
            size: f.item.size,
            modifiedAt: f.item.modifiedAt,
          })),
        }),
        */
      });
    });
  }, [
    initFileSystemApiCallExecutor,
    selectedFileHandle,
    outputDirectoryHandle,
  ]);

  const postDocumentToChunk = React.useCallback(async () => {
    return initFileSystemApiCallExecutor({
      sourceHandle: selectedFileHandle,
      destinationHandle: outputDirectoryHandle,
      processorFunction: FileSystemAPIProcessor.processSingleFile,
      validationMessage: 'Please select a spreadsheet file first.',
      successMessage: 'Spreadsheet slicing completed successfully!',
      subfolderPath: 'chunks',
    })(async (batch, batchIndex, totalBatches, structure) => {
      const fileData = batch[0];

      // Create file from the original file handle
      const file = await selectedFileHandle.getFile();

      // Create FormData with the actual file
      const formData = new FormData();
      formData.append('file', file, fileData.name);

      console.log(
        '📤 Uploading file via multipart:',
        fileData.name,
        'Size:',
        file.size,
      );

      return fetchRequest('/api-local/spreadsheet/slice', {
        method: 'POST',
        body: formData,
      });
    });
  }, [
    initFileSystemApiCallExecutor,
    selectedFileHandle,
    outputDirectoryHandle,
  ]);

  const initSubmitHandler = React.useCallback(
    (apiCallFunction: () => void) => {
      return (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        const data = {
          sourceFolder: formData.get('sourceFolder'),
          outputFolder: formData.get('outputFolder'),
          inputFile: formData.get('inputFile'),
          spreadsheetFile: formData.get('spreadsheetFile'),
        };

        console.log('Form data:', { data });
        console.log('Selected handles:', {
          sourceDirectoryHandle,
          outputDirectoryHandle,
          selectedFileHandle,
        });

        // Execute the passed API function
        apiCallFunction();
      };
    },
    [sourceDirectoryHandle, outputDirectoryHandle, selectedFileHandle],
  );

  // Loading spinner component
  const LoadingSpinner = () => (
    <svg
      className="animate-spin -ml-1 mr-3 h-4 w-4 text-white"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );

  // Button component with loading state
  const ProcessingButton = ({ children, isLoading, ...props }) => (
    <button
      {...props}
      disabled={isLoading || props.disabled}
      className={`
        cursor-pointer text-white font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center
        focus:ring-4 focus:outline-none
        ${
          isLoading || props.disabled
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-blue-700 hover:bg-blue-800 focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800'
        }
        flex items-center justify-center
      `}
    >
      {isLoading && <LoadingSpinner />}
      {children}
    </button>
  );

  return (
    <div>
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
        <Tabs.Item title="Нарізка таблиці">
          <form
            className="max-w-sm mx-auto"
            onSubmit={initSubmitHandler(postDocumentToChunk)}
          >
            <FileSelectInput
              id="spreadsheetFile"
              name="spreadsheetFile"
              label="Оберіть файл котрий буде нарізано"
              accept=".xlsx,.xlsm,.xls"
              onClick={handleFileSelect}
              selectedItem={selectedFileHandle}
              isFileSystemAccessSupported={isFileSystemAccessSupported}
              icon="file"
            />
            <FileSelectInput
              id="outputChunksFolder"
              name="outputFolder"
              label="Папка для збереження нарізаних частин"
              onClick={handleOutputDirectorySelect}
              selectedItem={outputDirectoryHandle}
              isFileSystemAccessSupported={isFileSystemAccessSupported}
              icon="folder"
            />
            <ProcessingButton
              type="submit"
              isLoading={isProcessing}
              disabled={!selectedFileHandle || !outputDirectoryHandle}
            >
              {isProcessing
                ? 'Нарізаю таблицю...'
                : 'Нарізати табличку частинами'}
            </ProcessingButton>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              💡 Нарізані частини будуть збережені в папці "chunks" всередині
              вибраної папки
            </div>
          </form>
        </Tabs.Item>
        <Tabs.Item title="Конвертувати Документи в Текст">
          <form
            className="max-w-sm mx-auto"
            onSubmit={initSubmitHandler(postConvertDocToText)}
          >
            <FileSelectInput
              id="sourceFolder"
              name="sourceFolder"
              label="Початкова папка з документами"
              onClick={handleSourceDirectorySelect}
              selectedItem={sourceDirectoryHandle}
              isFileSystemAccessSupported={isFileSystemAccessSupported}
              icon="folder"
            />
            <FileSelectInput
              id="outputFolder"
              name="outputFolder"
              label="Кінцева папка для збереження текстових файлів"
              onClick={handleOutputDirectorySelect}
              selectedItem={outputDirectoryHandle}
              isFileSystemAccessSupported={isFileSystemAccessSupported}
              icon="folder"
            />
            <ProcessingButton
              type="submit"
              isLoading={isProcessing}
              disabled={!sourceDirectoryHandle || !outputDirectoryHandle}
            >
              {isProcessing
                ? `Конвертую... (${progress.current}/${progress.total})`
                : 'Конвертувати Документи в Текст'}
            </ProcessingButton>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              💡 Конвертовані файли будуть збережені в папці ".nlp-ninja/txt"
              всередині вибраної папки.
            </div>
          </form>
        </Tabs.Item>
        {/*
        <Tabs.Item title="Проіндексувати текстові файли">
          <form
            className="max-w-sm mx-auto"
            onSubmit={initSubmitHandler(postConvertTextToIndex)}
          >
            <FileSelectInput
              id="sourceTextFolder"
              name="sourceFolder"
              label="Початкова папка з текстовими файлами"
              onClick={handleSourceDirectorySelect}
              selectedItem={sourceDirectoryHandle}
              isFileSystemAccessSupported={isFileSystemAccessSupported}
              icon="folder"
            />
            <FileSelectInput
              id="outputIndexFolder"
              name="outputFolder"
              label="Кінцева папка для збереження індексований документів"
              onClick={handleOutputDirectorySelect}
              selectedItem={outputDirectoryHandle}
              isFileSystemAccessSupported={isFileSystemAccessSupported}
              icon="folder"
            />
            <ProcessingButton
              type="submit"
              isLoading={isProcessing}
              disabled={!sourceDirectoryHandle || !outputDirectoryHandle}
            >
              {isProcessing
                ? `Індексую... (${progress.current}/${progress.total})`
                : 'Конвертувати Текст в Індекси'}
            </ProcessingButton>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              💡 Індекс файли будуть збережені в папці ".nlp-ninja/index"
              всередині вибраної папки.
            </div>
          </form>
        </Tabs.Item>
        */}
        <Tabs.Item title="Пошук збігів в документах">
          <form
            className="max-w-sm mx-auto"
            onSubmit={initSubmitHandler(postProcessDocuments)}
          >
            <FileSelectInput
              id="processDocumentsInputFile"
              name="inputFile"
              label="Файл з вхідними данними"
              onClick={handleFileSelect}
              selectedItem={selectedFileHandle}
              isFileSystemAccessSupported={isFileSystemAccessSupported}
              icon="file"
            />
            <FileSelectInput
              id="processDocumentsOutputFolder"
              name="outputFolder"
              label="Папка для збереження результатів"
              onClick={handleOutputDirectorySelect}
              selectedItem={outputDirectoryHandle}
              isFileSystemAccessSupported={isFileSystemAccessSupported}
              icon="folder"
            />
            <ProcessingButton
              type="submit"
              isLoading={isProcessing}
              disabled={!selectedFileHandle || !outputDirectoryHandle}
            >
              {isProcessing ? 'Обробляю документ...' : 'Почати пошук збігів'}
            </ProcessingButton>
          </form>
        </Tabs.Item>
      </Tabs>
    </div>
  );
};

export { DocumentsPage };
