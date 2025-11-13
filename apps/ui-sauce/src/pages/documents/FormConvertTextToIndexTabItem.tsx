import React from 'react';

import { fetchRequest } from '../../utils';
import { FileSystemAPIProcessor } from '../../utils/file-system-processor';
import { FormInputFileSelect, ProcessingButton } from './documents-components';

const FormConvertTextToIndexTabItem = ({
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
  const postConvertTextToIndex = React.useCallback(
    async (formDataJSON) => {
      return initFileSystemApiCallExecutor({
        formDataJSON,
        sourceHandle: sourceDirectoryHandle,
        destinationHandle: outputDirectoryHandle,
        processorFunction: FileSystemAPIProcessor.processDirectory,
        validationMessage:
          'Please select both source and output folders first.',
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
    },
    [
      initFileSystemApiCallExecutor,
      sourceDirectoryHandle,
      outputDirectoryHandle,
    ],
  );

  return (
    <form
      className="max-w-sm mx-auto"
      onSubmit={initSubmitHandler(postConvertTextToIndex)}
    >
      <FormInputFileSelect
        id="sourceTextFolder"
        name="sourceFolder"
        label="Початкова папка з текстовими файлами"
        onClick={handleSourceDirectorySelect}
        selectedItem={sourceDirectoryHandle}
        isFileSystemAccessSupported={isFileSystemAccessSupported}
        icon="folder"
      />
      <FormInputFileSelect
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
          : 'Обробити Текст в Індекси'}
      </ProcessingButton>
      <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        💡 Індекс файли будуть збережені в папці ".nlp-ninja/index" всередині
        вибраної папки.
      </div>
    </form>
  );
};

export { FormConvertTextToIndexTabItem };
