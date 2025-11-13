import React from 'react';

import { fetchRequest } from '../../utils';
import { FileSystemAPIProcessor } from '../../utils/file-system-processor';
import { FormInputFileSelect, ProcessingButton } from './documents-components';

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
  const postProcessDocuments = React.useCallback(
    async (formDataJSON) => {
      return initFileSystemApiCallExecutor({
        formDataJSON,
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
          body: JSON.stringify(formDataJSON),
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
    },
    [initFileSystemApiCallExecutor, selectedFileHandle, outputDirectoryHandle],
  );

  const handleTextAreaOnChange = React.useCallback((e) => {
    // TODO: save value to localStorage
  }, []);

  return (
    <form
      className="max-w-sm mx-auto"
      onSubmit={initSubmitHandler(postProcessDocuments)}
    >
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
        placeholder={`ПІБ 1
ПІБ 2
ПІБ 3
...
        `}
      />

      <p
        className="mt-1 mb-5 text-sm text-gray-500 dark:text-gray-300"
        id="file_input_help"
      >
        {/* Description placeholder */}
      </p>

      {/*
        <FormInputFileSelect
          id="processDocumentsInputFile"
          name="inputFile"
          label="Файл з вхідними данними"
          onClick={handleFileSelect}
          selectedItem={selectedFileHandle}
          isFileSystemAccessSupported={isFileSystemAccessSupported}
          icon="file"
        />
      */}
      <FormInputFileSelect
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
        disabled={!outputDirectoryHandle}
      >
        {isProcessing ? 'Обробляю документ...' : 'Почати пошук збігів'}
      </ProcessingButton>
    </form>
  );
};

export { FormProcessDocumentTabItem };
