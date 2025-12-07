import React from 'react';

import { fetchRequest } from '../../utils';
import { FileSystemAPIProcessor } from '../../utils/file-system-processor';
import { FormInputFileSelect, ProcessingButton } from './documents-components';

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
      <div
        className="flex items-center justify-between bg-gray-50 px-6 py-3 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h3 className="text-sm font-bold uppercase text-gray-700 dark:text-gray-200">
          Результати для:{' '}
          <span className="text-blue-600 dark:text-blue-400">
            {searchQuery}
          </span>
        </h3>
        <button
          type="button"
          className="inline-flex items-center p-2 text-sm text-gray-500 rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
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

const TableProcessedDocumentResults = ({ results }) => {
  const hasResults = results && Object.keys(results).length > 0;

  if (!hasResults) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px] p-8 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-md">
        Результати пошуку з'являться тут...
      </div>
    );
  }

  return (
    <div className="space-y-6 h-full overflow-y-auto">
      {(Object.entries(results) as [string, any[]][]).map(
        ([searchQuery, items]) => (
          <ProcessedResultGroup
            key={searchQuery}
            searchQuery={searchQuery}
            items={items}
          />
        ),
      )}
    </div>
  );
};

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

  const handleTextAreaOnChange = React.useCallback((e) => {
    // TODO: save value to localStorage
  }, []);

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
                    onChange={handleTextAreaOnChange}
                    placeholder={`ПІБ 1\nПІБ 2\nПІБ 3\n...`}
                  />
                </div>

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
              </div>

              <ProcessingButton
                type="submit"
                isLoading={isProcessing}
                disabled={!outputDirectoryHandle}
              >
                {isProcessing ? 'Обробляю документ...' : 'Почати пошук збігів'}
              </ProcessingButton>
            </form>
          </div>
        </div>
      </div>

      <div className="lg:col-span-3">
        <TableProcessedDocumentResults results={processedResults} />
      </div>
    </div>
  );
};

export { FormProcessDocumentTabItem };
