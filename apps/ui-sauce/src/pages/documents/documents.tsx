import React from 'react';

import { Tabs } from '../../components';
import {
  FileSystemAPIProcessor,
  ProcessingResult,
} from '../../utils/file-system-processor';
import { FormChunkSpreadsheetTabItem } from './FormChunkSpreadsheetTabItem';
import { FormConvertDocToTextTabItem } from './FormConvertDocToTextTabItem';
import { FormConvertTextToIndexTabItem } from './FormConvertTextToIndexTabItem';
import { FormProcessDocumentTabItem } from './FormProcessDocumentTabItem';
import { LoadingSpinner } from './documents-components';

interface FileSystemApiCallOptions {
  formDataJSON: any;
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
          alert(options.validationMessage);
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
