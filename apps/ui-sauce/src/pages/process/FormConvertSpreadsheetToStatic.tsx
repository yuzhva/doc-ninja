import React from 'react';

import { fetchRequest } from '../../utils';
import {
  FormInputFileSelect,
  ProcessingButton,
} from './process-page.components';
import type { FormPageSectionProps } from './process-page.types';

const FormConvertSpreadsheetToStatic = ({
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
}: FormPageSectionProps) => {
  const postConvertSpreadsheetToStatic = React.useCallback<
    Parameters<typeof initSubmitHandler>[0]
  >(
    async (formDataJSON) => {
      return executeBatch(
        {
          formDataJSON,
          processedDir: selectedFile!,
          destinationHandle: outputDirectory?.browserFSAPIhandle!,
          validationMessage:
            'Please select both a spreadsheet file and an output folder.',
          successMessage: 'Successfully converted spreadsheet to static!',
          // subfolderPath: 'xlsx-static',
        },
        async (batchFiles) => {
          // Create file from the original file handle
          const file = batchFiles[0];

          // Create FormData with the actual file
          const formData = new FormData();
          // Use file.name directly to preserve encoding
          formData.append('file', file.contentAsBlob, file.name);

          console.log(
            '📤 Uploading file for static conversion via multipart:',
            file.name,
            'Size:',
            file.size,
          );

          return fetchRequest('/api-local/convert/spreadsheet-to-static', {
            method: 'POST',
            body: formData,
          });
        },
      );
    },
    [executeBatch, selectedFile, outputDirectory],
  );

  return (
    <div
      className="max-w-lg mx-auto flex rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800 flex-col"
      data-testid="flowbite-card"
    >
      <div className="flex h-full flex-col justify-center gap-4 p-6">
        <h3 className="mb-4 text-xl font-bold dark:text-white">
          Конвертувати .xlsx в cтатику
        </h3>
        <form onSubmit={initSubmitHandler(postConvertSpreadsheetToStatic)}>
          <div className="grid gap-4 mb-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormInputFileSelect
                id="spreadsheetFile"
                name="spreadsheetFile"
                label="Оберіть Excel файл"
                accept=".xlsx,.xlsm,.xls"
                onClick={onSelectFile}
                selectedItem={selectedFile}
                isFileSystemAccessSupported={isFileSystemAccessSupported}
                icon="file"
              />
            </div>
            <div className="sm:col-span-2">
              <FormInputFileSelect
                id="outputFolder"
                name="outputFolder"
                label="Кінцева папка для збереження"
                onClick={onSelectOutputDirectory}
                selectedItem={outputDirectory}
                isFileSystemAccessSupported={isFileSystemAccessSupported}
                icon="folder"
              />
            </div>
          </div>

          <div className="mt-8">
            <ProcessingButton
              type="submit"
              isLoading={isProcessing}
              disabled={!selectedFile || !outputDirectory}
            >
              {isProcessing ? 'Конвертую...' : 'Конвертувати в Статику'}
            </ProcessingButton>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              💡 Результат буде збережено у папці "static-spreadsheet" всередині
              вибраної папки.
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export { FormConvertSpreadsheetToStatic };
