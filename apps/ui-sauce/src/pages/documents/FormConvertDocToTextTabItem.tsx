import React from 'react';

import { fetchRequest } from '../../utils';
import { FileSystemAPIProcessor } from '../../utils/file-system-processor';
import { FormInputFileSelect, ProcessingButton } from './documents-components';

const FormConvertDocToTextTabItem = ({
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
  const postConvertDocToText = React.useCallback(
    async (formDataJSON) => {
      return initFileSystemApiCallExecutor({
        formDataJSON,
        sourceHandle: sourceDirectoryHandle,
        destinationHandle: outputDirectoryHandle,
        processorFunction: FileSystemAPIProcessor.processDirectory,
        validationMessage:
          'Please select both source and output folders first.',
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
      onSubmit={initSubmitHandler(postConvertDocToText)}
    >
      <FormInputFileSelect
        id="sourceFolder"
        name="sourceFolder"
        label="Початкова папка з документами"
        onClick={handleSourceDirectorySelect}
        selectedItem={sourceDirectoryHandle}
        isFileSystemAccessSupported={isFileSystemAccessSupported}
        icon="folder"
      />
      <FormInputFileSelect
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
  );
};

export { FormConvertDocToTextTabItem };
