import React from 'react';
import { FileSystemItem } from 'toolkit--local/browser';

import { fetchRequest } from '../../../utils';
import { FormInputFileSelect, ProcessingButton } from '../documents-components';
import type { FormPageSectionProps } from '../documents.types';
import { TableProcessedDocumentResults } from './FormProcessDocumentTabItem.components';

// Recursive Tree Item Component
const DirectoryTreeItem = ({
  fsNestedItem,
  selectedPaths,
  onTogglePath,
}: {
  fsNestedItem: FileSystemItem;
  selectedPaths: Set<string>;
  onTogglePath: (path: string, checked: boolean) => void;
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const isSelected = selectedPaths.has(fsNestedItem.path);
  const hasChildren =
    fsNestedItem.fsNestedItems && fsNestedItem.fsNestedItems.length > 0;
  const isDirectory = fsNestedItem.fsItemType === 'directory';

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onTogglePath(fsNestedItem.path, e.target.checked);
  };

  const handleContentClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onTogglePath(fsNestedItem.path, !isSelected);
  };

  return (
    <div className="w-full">
      <div className="flex items-center gap-x-0.5 w-full py-0.5">
        {/* Toggle Button */}
        <button
          type="button"
          className={`shrink-0 w-6 h-6 flex justify-center items-center hover:bg-gray-100 rounded-md focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:hover:bg-gray-700 dark:focus:bg-gray-700 ${!hasChildren ? 'invisible' : ''}`}
          onClick={handleToggleExpand}
        >
          <svg
            className={`w-4 h-4 text-gray-800 dark:text-gray-200 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        {/* Content */}
        <div className="grow flex items-center gap-x-2 px-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
          {/* Checkbox */}
          <input
            type="checkbox"
            checked={isSelected}
            onChange={handleCheckboxChange}
            className="shrink-0 w-4 h-4 bg-gray-100 border-gray-300 rounded text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
          />

          {/* Icon & Name */}
          <div
            className="flex items-center gap-x-2 cursor-pointer grow py-1"
            onClick={handleContentClick}
          >
            <svg
              className="shrink-0 w-4 h-4 text-gray-500 dark:text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isDirectory ? (
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>
              ) : (
                <>
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
                  <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
                </>
              )}
            </svg>
            <span className="text-sm text-gray-800 dark:text-gray-200 select-none">
              {fsNestedItem.name}{' '}
              {(fsNestedItem.fsFileCount || 0) > 0 && (
                <span className="text-xs text-gray-400">
                  ({fsNestedItem.fsFileCount})
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="pl-7 relative before:absolute before:top-0 before:left-3 before:w-0.5 before:-ml-px before:h-full before:bg-gray-100 dark:before:bg-gray-700">
          {fsNestedItem.fsNestedItems?.map((child: FileSystemItem) => (
            <DirectoryTreeItem
              key={child.path}
              fsNestedItem={child}
              selectedPaths={selectedPaths}
              onTogglePath={onTogglePath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FormProcessDocumentTabItem = ({
  // handleFileSelect,
  onSelectSourceDirectory,
  // onSelectOutputDirectory,
  executeBatch,
  initSubmitHandler,
  sourceDirectory,
  outputDirectory,
  selectedFile,
  // progress,
  isFileSystemAccessSupported,
  isProcessing,
}: FormPageSectionProps) => {
  const [processedResults, setProcessedResults] = React.useState({});
  const [directoryTree, setDirectoryTree] = React.useState<any>(null);
  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(
    new Set(),
  );
  const [isSettingsExpanded, setIsSettingsExpanded] = React.useState(false);

  const handleTogglePath = React.useCallback(
    (path: string, checked: boolean) => {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return next;
      });
    },
    [],
  );

  React.useEffect(() => {
    const buildTree = async () => {
      if (!sourceDirectory) return;

      try {
        // Use the structure already processed by FileSystemService
        const tree = sourceDirectory.structure;
        if (tree) {
          setDirectoryTree(tree);
          setSelectedPaths(new Set()); // Reset selection when source changes
          setIsSettingsExpanded(true); // Auto-expand settings when tree is loaded
          console.log('Directory tree built:', tree);
        }
      } catch (error) {
        console.error('Failed to build directory tree:', error);
      }
    };

    buildTree();
  }, [sourceDirectory]);

  const postProcessDocuments = React.useCallback<
    Parameters<typeof initSubmitHandler>[0]
  >(
    async (formDataJSON) => {
      const payload = {
        ...formDataJSON,
        sourcePath: sourceDirectory?.structure.path,
        searchScopedPaths: Array.from(selectedPaths),
      };

      return executeBatch(
        {
          formDataJSON: payload,
          processedDir: selectedFile!,
          destinationHandle: outputDirectory?.browserFSAPIhandle!,
          validationMessage: 'Please select an output folder.',
          successMessage: 'Document processing completed successfully!',
          isWritingFilesSkipped: true,
          isLocalFileSystemRequest: true,
          // No subfolderPath specified - files will be saved in root
        },
        async () => {
          return fetchRequest('/api-local/process/documents', {
            method: 'POST',
            body: JSON.stringify(payload),
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
        },
      );
    },
    [
      executeBatch,
      selectedFile,
      outputDirectory,
      sourceDirectory,
      selectedPaths,
    ],
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
              <div
                className={`transition-all duration-500 ease-in-out ${
                  isSettingsExpanded
                    ? 'max-h-[1000px] opacity-100 py-4'
                    : 'max-h-0 opacity-0 overflow-hidden'
                }`}
              >
                <div className="grid gap-4 sm:grid-cols-2">
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

                  <div className="sm:col-span-2 flex justify-end pb-2">
                    <ProcessingButton
                      type="submit"
                      isLoading={isProcessing}
                      disabled={!directoryTree}
                    >
                      {isProcessing
                        ? 'Обробляю документ...'
                        : 'Почати пошук збігів'}
                    </ProcessingButton>
                  </div>
                </div>
              </div>

              <div className="relative flex items-center justify-center w-full mb-6 group">
                <hr className="w-full h-px bg-gray-200 border-0 dark:bg-gray-700 group-hover:bg-blue-200 dark:group-hover:bg-blue-900 transition-colors" />
                <button
                  type="button"
                  onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                  className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center w-8 h-8 rounded-full bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-500 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:border-blue-400 transition-all cursor-pointer z-10"
                  title={
                    isSettingsExpanded
                      ? 'Згорнути параметри'
                      : 'Показати параметри'
                  }
                >
                  <svg
                    className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform duration-300 ${
                      isSettingsExpanded ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
              </div>

              <div className="grid gap-4 mb-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <FormInputFileSelect
                    id="processDocumentsSourceFolder"
                    name="sourceDirectory"
                    label="Папка з документами для пошуку"
                    onClick={onSelectSourceDirectory}
                    selectedItem={sourceDirectory}
                    isFileSystemAccessSupported={isFileSystemAccessSupported}
                    icon="folder"
                  />
                </div>

                {/* Directory Tree View */}
                {directoryTree &&
                  directoryTree.fsNestedItems &&
                  directoryTree.fsNestedItems.length > 0 && (
                    <div className="sm:col-span-2 border border-gray-200 dark:border-gray-700 rounded-lg p-2 max-h-96 overflow-y-auto bg-gray-50 dark:bg-gray-900">
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase">
                        Оберіть папки для пошуку
                      </div>
                      {directoryTree.fsNestedItems.map((fsNestedItem: any) => (
                        <DirectoryTreeItem
                          key={fsNestedItem.path}
                          fsNestedItem={fsNestedItem}
                          selectedPaths={selectedPaths}
                          onTogglePath={handleTogglePath}
                        />
                      ))}
                    </div>
                  )}
              </div>
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
