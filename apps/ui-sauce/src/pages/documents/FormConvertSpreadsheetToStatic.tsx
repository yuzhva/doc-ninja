import React from 'react';

import { fetchRequest } from '../../utils';
import { FileSystemAPIProcessor } from '../../utils/file-system-processor';
import { FormInputFileSelect, ProcessingButton } from './documents-components';

const FormConvertSpreadsheetToStatic = ({
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
  const postConvertSpreadsheetToStatic = React.useCallback(
    async (formDataJSON) => {
      return initFileSystemApiCallExecutor({
        formDataJSON,
        sourceHandle: selectedFileHandle,
        destinationHandle: outputDirectoryHandle,
        processorFunction: FileSystemAPIProcessor.processSingleFile,
        validationMessage:
          'Please select both a spreadsheet file and an output folder.',
        successMessage: 'Successfully converted spreadsheet to static!',
        // subfolderPath: 'xlsx-static',
      })(async (batch, batchIndex, totalBatches, structure) => {
        // Create file from the original file handle
        const file = await selectedFileHandle.getFile();

        // Create FormData with the actual file
        const formData = new FormData();
        // Use file.name directly to preserve encoding
        formData.append('file', file, file.name);

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
      });
    },
    [initFileSystemApiCallExecutor, selectedFileHandle, outputDirectoryHandle],
  );

  return (
    <form
      className="max-w-sm mx-auto"
      onSubmit={initSubmitHandler(postConvertSpreadsheetToStatic)}
    >
      <FormInputFileSelect
        id="spreadsheetFile"
        name="spreadsheetFile"
        label="Оберіть Excel файл"
        accept=".xlsx,.xlsm,.xls"
        onClick={handleFileSelect}
        selectedItem={selectedFileHandle}
        isFileSystemAccessSupported={isFileSystemAccessSupported}
        icon="file"
      />
      <FormInputFileSelect
        id="outputFolder"
        name="outputFolder"
        label="Кінцева папка для збереження"
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
        {isProcessing ? 'Конвертую...' : 'Конвертувати в Статику'}
      </ProcessingButton>
      <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        💡 Результат буде збережено у папці "static-spreadsheet" всередині
        вибраної папки.
      </div>
    </form>
  );
};

export { FormConvertSpreadsheetToStatic };
