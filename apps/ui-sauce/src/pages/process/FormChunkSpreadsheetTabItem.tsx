import React from 'react';

import { ButtonProcessing, FormInputFileSelect } from '../../components';
import type { BatchFileProcessingSectionProps } from '../../hooks/use-batch-processor';
import { fetchRequest } from '../../utils';

const FormChunkSpreadsheetTabItem = ({
  onSelectFile,
  // onSelectSourceDirectory,
  onSelectOutputDirectory,
  executeBatch,
  initSubmitHandler,
  // sourceDirectory,
  outputDirectory,
  selectedFile,
  // progress,
  isFileSystemAccessSupported,
  isProcessing,
}: BatchFileProcessingSectionProps) => {
  // Monotonic counter for additional sheet ids — Date.now() can return the
  // same value across two synchronous calls, which previously caused rows
  // to share an id and edits to leak between them.
  const nextRowId = React.useRef(0);
  const createRowId = () => nextRowId.current++;

  // State for form data matching API format
  const [formState, setFormState] = React.useState(() => ({
    sheetToChunkPosition: 2,
    headerRows: 5,
    splitColumnPosition: 11,
    maxColumnsToInclude: 17,
    filenameSuffix: '',
    outputSubfolder: 'chunks',
    isFasterLessStyledChunkerUsed: true,
    additionalSheets: [
      {
        id: createRowId(),
        sheetIndex: 3,
        headerRows: 2,
        filterColumnPosition: 15,
      },
      {
        id: createRowId(),
        sheetIndex: 9,
        headerRows: 3,
        filterColumnPosition: 19,
      },
      {
        id: createRowId(),
        sheetIndex: 10,
        headerRows: 2,
        filterColumnPosition: 6,
      },
    ],
  }));

  // Add new additional sheet function
  const addNewRow = () => {
    setFormState((prev) => ({
      ...prev,
      additionalSheets: [
        ...prev.additionalSheets,
        {
          id: createRowId(),
          sheetIndex: 0,
          headerRows: 0,
          filterColumnPosition: 0,
        },
      ],
    }));
  };

  // Remove additional sheet function
  const removeRow = (id) => {
    if (formState.additionalSheets.length > 0) {
      setFormState((prev) => ({
        ...prev,
        additionalSheets: prev.additionalSheets.filter(
          (sheet) => sheet.id !== id,
        ),
      }));
    }
  };

  // Update primary sheet data
  const updatePrimarySheet = (field, value) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Update additional sheet data
  const updateAdditionalSheet = (id, field, value) => {
    setFormState((prev) => ({
      ...prev,
      additionalSheets: prev.additionalSheets.map((sheet) =>
        sheet.id === id ? { ...sheet, [field]: value } : sheet,
      ),
    }));
  };

  const postDocumentToChunk = React.useCallback<
    Parameters<typeof initSubmitHandler>[0]
  >(
    async (formDataJSON) => {
      return executeBatch(
        {
          formDataJSON,
          processedDir: selectedFile!,
          destinationHandle: outputDirectory?.browserFSAPIhandle!,
          validationMessage: 'Please select a spreadsheet file first.',
          successMessage: 'Spreadsheet slicing completed successfully!',
          subfolderPath: formState.outputSubfolder || 'chunks',
        },
        async (batchFiles) => {
          // Create file from the original file handle
          const file = batchFiles[0];

          // Create FormData with the actual file and parameters
          const formData = new FormData();
          // Use file.name directly to preserve encoding
          formData.append('file', file.contentAsBlob, file.name);

          // Add form parameters to FormData
          formData.append(
            'sheetToChunkPosition',
            formState.sheetToChunkPosition.toString(),
          );
          formData.append('headerRows', formState.headerRows.toString());
          formData.append(
            'splitColumnPosition',
            formState.splitColumnPosition.toString(),
          );
          formData.append(
            'maxColumnsToInclude',
            formState.maxColumnsToInclude.toString(),
          );
          formData.append('filenameSuffix', formState.filenameSuffix);
          formData.append(
            'isFasterLessStyledChunkerUsed',
            formState.isFasterLessStyledChunkerUsed.toString(),
          );

          // Prepare additional sheets data (remove id field for API)
          const apiAdditionalSheets = formState.additionalSheets.map(
            (sheet) => ({
              sheetIndex: sheet.sheetIndex,
              headerRows: sheet.headerRows,
              filterColumnPosition: sheet.filterColumnPosition,
              maxColumnsToInclude: sheet.maxColumnsToInclude,
            }),
          );
          formData.append(
            'additionalSheets',
            JSON.stringify(apiAdditionalSheets),
          );

          console.log(
            '📤 Uploading file via multipart:',
            file.name,
            'Size:',
            file.size,
          );
          console.log('Form parameters:', {
            sheetToChunkPosition: formState.sheetToChunkPosition,
            headerRows: formState.headerRows,
            splitColumnPosition: formState.splitColumnPosition,
            maxColumnsToInclude: formState.maxColumnsToInclude,
            filenameSuffix: formState.filenameSuffix,
            isFasterLessStyledChunkerUsed:
              formState.isFasterLessStyledChunkerUsed,
            additionalSheets: apiAdditionalSheets,
          });

          return fetchRequest('/api-local/spreadsheet/slice', {
            method: 'POST',
            body: formData,
          });
        },
      );
    },
    [executeBatch, selectedFile, outputDirectory, formState],
  );

  return (
    <div
      className="flex rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800 flex-col"
      data-testid="flowbite-card"
    >
      <div className="flex h-full flex-col justify-center gap-4 p-6">
        <h3 className="mb-4 text-xl font-bold dark:text-white">
          Нарізка таблиці
        </h3>
        <form onSubmit={initSubmitHandler(postDocumentToChunk)}>
          <div className="grid grid-cols-2 gap-4">
            <FormInputFileSelect
              id="spreadsheetFile"
              name="spreadsheetFile"
              label="Оберіть файл котрий буде нарізано"
              accept=".xlsx,.xlsm,.xlsb,.xls"
              onClick={onSelectFile}
              selectedItem={selectedFile}
              isFileSystemAccessSupported={isFileSystemAccessSupported}
              icon="file"
            />
            <FormInputFileSelect
              id="outputChunksFolder"
              name="outputFolder"
              label="Папка для збереження нарізаних частин"
              onClick={onSelectOutputDirectory}
              selectedItem={outputDirectory}
              isFileSystemAccessSupported={isFileSystemAccessSupported}
              icon="folder"
            />

            <div className="col-span-2 grid grid-cols-2 gap-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">
                  Суфікс назви файлу (за замовчуванням: дата)
                </label>
                <input
                  className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                  type="text"
                  name="filenameSuffix"
                  value={formState.filenameSuffix}
                  onChange={(e) =>
                    updatePrimarySheet('filenameSuffix', e.target.value)
                  }
                  placeholder="напр. v1"
                />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">
                  Назва підпапки
                </label>
                <input
                  className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                  type="text"
                  name="outputSubfolder"
                  value={formState.outputSubfolder}
                  onChange={(e) =>
                    updatePrimarySheet('outputSubfolder', e.target.value)
                  }
                  required
                />
              </div>
            </div>

            {/* Dynamic rows with 5 columns */}
            <div className="mt-6 col-span-2">
              {/* Headers for primary sheet */}
              <div className="grid grid-cols-5 gap-4 mb-2">
                <label className="text-sm font-medium text-gray-900 dark:text-gray-300">
                  Позиція головного аркуша
                </label>
                <label className="text-sm font-medium text-gray-900 dark:text-gray-300">
                  Кількість рядків заголовку
                </label>
                <label className="text-sm font-medium text-gray-900 dark:text-gray-300">
                  Позиція колонки-фільтру
                </label>
                <label className="text-sm font-medium text-gray-900 dark:text-gray-300">
                  Індекс останньої колонки
                </label>
                {/*
                <label className="text-sm font-medium text-gray-900 dark:text-gray-300">
                  Режим
                </label>
                */}
              </div>

              {/* Primary sheet row */}
              <div className="grid grid-cols-5 gap-4 mb-6">
                <input
                  className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                  type="number"
                  name="sheetToChunkPosition"
                  value={formState.sheetToChunkPosition}
                  onChange={(e) =>
                    updatePrimarySheet(
                      'sheetToChunkPosition',
                      parseInt(e.target.value) || '',
                    )
                  }
                  required
                />
                <input
                  className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                  type="number"
                  name="headerRows"
                  value={formState.headerRows}
                  onChange={(e) =>
                    updatePrimarySheet(
                      'headerRows',
                      parseInt(e.target.value) || '',
                    )
                  }
                  required
                />
                <input
                  className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                  type="number"
                  name="splitColumnPosition"
                  value={formState.splitColumnPosition}
                  onChange={(e) =>
                    updatePrimarySheet(
                      'splitColumnPosition',
                      parseInt(e.target.value) || '',
                    )
                  }
                  required
                />
                <input
                  className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                  type="number"
                  name="maxColumnsToInclude"
                  value={formState.maxColumnsToInclude}
                  onChange={(e) =>
                    updatePrimarySheet(
                      'maxColumnsToInclude',
                      parseInt(e.target.value) || '',
                    )
                  }
                  required
                />
                <div className="flex items-center h-[42px] w-full">
                  <label
                    className="relative inline-flex items-center cursor-pointer"
                    title="Використовувати Python для нарізки (ExcelJS альтернатива)"
                  >
                    <input
                      type="checkbox"
                      name="isFasterLessStyledChunkerUsed"
                      checked={formState.isFasterLessStyledChunkerUsed}
                      onChange={(e) =>
                        updatePrimarySheet(
                          'isFasterLessStyledChunkerUsed',
                          e.target.checked,
                        )
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                  </label>
                  <div className="flex flex-col ml-3">
                    <div className="text-sm font-medium text-gray-900 dark:text-white leading-tight">
                      Швидка нарізка
                    </div>
                    <div className="text-xs font-normal text-gray-500 dark:text-gray-400 leading-tight">
                      менше стилів
                    </div>
                  </div>
                </div>
              </div>

              {/* Additional sheets section */}
              {formState.additionalSheets.length > 0 && (
                <>
                  <div className="mb-4">
                    <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      Додаткові аркуші
                    </h4>
                  </div>

                  {/* Headers for additional sheets */}
                  <div className="grid grid-cols-5 gap-4 mb-2">
                    <label className="text-sm font-medium text-gray-900 dark:text-gray-300">
                      Позиція додаткового аркуша
                    </label>
                    <label className="text-sm font-medium text-gray-900 dark:text-gray-300">
                      Кількість рядків заголовку
                    </label>
                    <label className="text-sm font-medium text-gray-900 dark:text-gray-300">
                      Позиція колонки-фільтру
                    </label>
                    <label className="text-sm font-medium text-gray-900 dark:text-gray-300">
                      Індекс останньої колонки
                    </label>
                    {/*
                    <label className="text-sm font-medium text-gray-900 dark:text-gray-300">
                      Дії
                    </label>
                    */}
                  </div>
                </>
              )}

              {/* Additional sheets rows */}
              {formState.additionalSheets.map((sheet, index) => (
                <div key={sheet.id} className="grid grid-cols-5 gap-4 mb-4">
                  <input
                    className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                    type="number"
                    name={`sheetIndex_${sheet.id}`}
                    value={sheet.sheetIndex}
                    onChange={(e) =>
                      updateAdditionalSheet(
                        sheet.id,
                        'sheetIndex',
                        parseInt(e.target.value) || '',
                      )
                    }
                    required
                  />
                  <input
                    className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                    type="number"
                    name={`headerRows_${sheet.id}`}
                    value={sheet.headerRows}
                    onChange={(e) =>
                      updateAdditionalSheet(
                        sheet.id,
                        'headerRows',
                        parseInt(e.target.value) || '',
                      )
                    }
                    required
                  />
                  <input
                    className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                    type="number"
                    name={`filterColumnPosition_${sheet.id}`}
                    value={sheet.filterColumnPosition}
                    onChange={(e) =>
                      updateAdditionalSheet(
                        sheet.id,
                        'filterColumnPosition',
                        parseInt(e.target.value) || '',
                      )
                    }
                    required
                  />
                  <input
                    className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                    type="number"
                    name={`maxColumnsToInclude_${sheet.id}`}
                    value={sheet.maxColumnsToInclude}
                    onChange={(e) =>
                      updateAdditionalSheet(
                        sheet.id,
                        'maxColumnsToInclude',
                        parseInt(e.target.value) || '',
                      )
                    }
                    // required
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => removeRow(sheet.id)}
                      className="flex items-center justify-center w-10 h-10 text-white bg-red-600 hover:bg-red-700 focus:ring-4 focus:ring-red-300 font-medium rounded-lg text-sm dark:bg-red-600 dark:hover:bg-red-700 dark:focus:ring-red-800"
                      title="Видалити додатковий аркуш"
                    >
                      −
                    </button>
                    {index === formState.additionalSheets.length - 1 && (
                      <button
                        type="button"
                        onClick={addNewRow}
                        className="flex items-center justify-center w-10 h-10 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
                        title="Додати додатковий аркуш"
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Add button when no additional sheets */}
              {formState.additionalSheets.length === 0 && (
                <div className="flex justify-start mb-4">
                  <button
                    type="button"
                    onClick={addNewRow}
                    className="flex items-center gap-2 px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
                  >
                    + Додати додатковий аркуш
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-8">
            <ButtonProcessing
              type="submit"
              isLoading={isProcessing}
              disabled={!selectedFile || !outputDirectory}
            >
              {isProcessing
                ? 'Нарізаю таблицю...'
                : 'Нарізати табличку частинами'}
            </ButtonProcessing>
          </div>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            💡 Нарізані частини будуть збережені в папці "
            {formState.outputSubfolder || 'chunks'}" всередині вибраної папки
          </div>
        </form>
      </div>
    </div>
  );
};

export { FormChunkSpreadsheetTabItem };
