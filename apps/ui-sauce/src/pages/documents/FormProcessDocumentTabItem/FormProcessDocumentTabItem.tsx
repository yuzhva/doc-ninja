import React from 'react';

import { fetchRequest } from '../../../utils';
import { FileSystemAPIProcessor } from '../../../utils/file-system-processor';
import { ProcessingButton } from '../documents-components';
import { TableProcessedDocumentResults } from './FormProcessDocumentTabItem.components';

const FormProcessDocumentTabItem = ({
  handleFileSelect,
  handleSourceDirectorySelect,
  handleOutputDirectorySelect,
  initFileSystemApiCallExecutor,
  initSubmitHandler,
  sourceDirectoryHandle,
  outputDirectoryHandle,
  selectedFileHandle,
  progress,
  isFileSystemAccessSupported,
  isProcessing,
}) => {
  const [processedResults, setProcessedResults] = React.useState({});

  const postProcessDocuments = React.useCallback(
    async (formDataJSON) => {
      return initFileSystemApiCallExecutor({
        formDataJSON,
        sourceHandle: selectedFileHandle,
        destinationHandle: outputDirectoryHandle,
        processorFunction: FileSystemAPIProcessor.processSingleFile,
        validationMessage: 'Please select an output folder.',
        successMessage: 'Document processing completed successfully!',
        isWritingFilesSkipped: true,
        // No subfolderPath specified - files will be saved in root
      })(async (batch, batchIndex, totalBatches, structure) => {
        return fetchRequest('/api-local/process/documents', {
          method: 'POST',
          body: JSON.stringify(formDataJSON),
        }).then((resAsJson) => {
          if (resAsJson && resAsJson.extractedResults) {
            const groupedResults = resAsJson.extractedResults.reduce(
              (acc, item) => {
                const key = item.searchQuery;
                if (!acc[key]) {
                  acc[key] = [];
                }
                acc[key].push(item);
                return acc;
              },
              {},
            );
            setProcessedResults(groupedResults);
          }
          return resAsJson;
        });
      });
    },
    [initFileSystemApiCallExecutor, selectedFileHandle, outputDirectoryHandle],
  );

  const postFilteredResultExport = React.useCallback(
    async (filteredResults: any) => {
      const filteredResultsPayload = Object.values(filteredResults).flat();

      // Use FormData to send large payloads as a file
      const formData = new FormData();
      const jsonBlob = new Blob([JSON.stringify(filteredResultsPayload)], {
        type: 'application/json',
      });
      formData.append('file', jsonBlob, 'data.json');

      try {
        const resAsJson = await fetchRequest(
          '/api-local/process/generate-filtered-spreadsheet',
          {
            method: 'POST',
            body: formData,
          },
        );

        if (
          resAsJson &&
          resAsJson.processedFiles &&
          resAsJson.processedFiles.length > 0
        ) {
          const fileData = resAsJson.processedFiles[0];
          const fileName = fileData.name;
          const base64Content = fileData.content;

          // Convert Base64 to Blob
          const byteCharacters = atob(base64Content);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });

          // Save file using File System Access API if available
          if ('showSaveFilePicker' in window) {
            try {
              const handle = await (window as any).showSaveFilePicker({
                suggestedName: fileName,
                types: [
                  {
                    description: 'Excel File',
                    accept: {
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
                        ['.xlsx'],
                    },
                  },
                ],
              });
              const writable = await handle.createWritable();
              await writable.write(blob);
              await writable.close();
            } catch (err: any) {
              if (err.name !== 'AbortError') {
                console.error('Failed to save file:', err);
              }
            }
          } else {
            // Fallback for browsers without File System Access API
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
          }
        }
      } catch (error) {
        console.error('Failed to export filtered results:', error);
      }
    },
    [],
  );

  // const handleTextAreaOnChange = React.useCallback((e) => {
  //   // TODO: save value to localStorage
  // }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className="lg:col-span-1">
        <div
          className="flex rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800 flex-col"
          data-testid="flowbite-card"
        >
          <div className="flex h-full flex-col justify-center gap-4 p-6">
            <h3 className="mb-4 text-xl font-bold dark:text-white">
              Пошук в документах
            </h3>
            <form onSubmit={initSubmitHandler(postProcessDocuments)}>
              <div className="grid gap-4 mb-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="bulkNamesTextArea"
                    className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
                  >
                    Перелік ПІБ для пошуку в документах
                  </label>
                  <textarea
                    id="bulkNamesTextArea"
                    name="bulkNames"
                    rows={4}
                    className="block p-2.5 w-full text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                    // onChange={handleTextAreaOnChange}
                    placeholder={`ПІБ 1\nПІБ 2\nПІБ 3\n...`}
                  />
                </div>

                <div className="sm:col-span-2 grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="pageSize"
                      className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
                    >
                      К-сть результатів
                    </label>
                    <input
                      id="pageSize"
                      name="pageSize"
                      className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                      placeholder="ALL"
                      type="text"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="sortOrder"
                      className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
                    >
                      Сортування (дата)
                    </label>
                    <select
                      id="sortOrder"
                      name="sortOrder"
                      className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                      defaultValue="desc"
                    >
                      <option value="desc">Новіші спочатку</option>
                      <option value="asc">Старіші спочатку</option>
                    </select>
                  </div>
                </div>

                {/*
                <div className="sm:col-span-2">
                  <FormInputFileSelect
                    id="processDocumentsOutputFolder"
                    name="outputFolder"
                    label="Папка для збереження результатів"
                    onClick={handleOutputDirectorySelect}
                    selectedItem={outputDirectoryHandle}
                    isFileSystemAccessSupported={isFileSystemAccessSupported}
                    icon="folder"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="outputFileName"
                    className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
                  >
                    Назва файлу результату (опціонально)
                  </label>
                  <input
                    id="outputFileName"
                    name="outputFileName"
                    className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                    placeholder="dis-report.xlsx"
                    type="text"
                  />
                </div>
                */}
              </div>

              <ProcessingButton
                type="submit"
                isLoading={isProcessing}
                // disabled={!outputDirectoryHandle}
              >
                {isProcessing ? 'Обробляю документ...' : 'Почати пошук збігів'}
              </ProcessingButton>
            </form>
          </div>
        </div>
      </div>

      <div className="lg:col-span-3">
        <TableProcessedDocumentResults
          results={processedResults}
          onBtnExportClick={postFilteredResultExport}
        />
      </div>
    </div>
  );
};

export { FormProcessDocumentTabItem };
