import React from 'react';

import { fetchRequest } from '../../utils';
import {
  FormInputFileSelect,
  ProcessingButton,
} from './process-page.components';
import type { FormPageSectionProps } from './process-page.types';

const FormConvertDocToTextTabItem = ({
  // handleFileSelect,
  onSelectSourceDirectory,
  onSelectOutputDirectory,
  executeBatch,
  initSubmitHandler,
  sourceDirectory,
  outputDirectory,
  selectedFile,
  // selectedFileHandle,
  progress,
  isFileSystemAccessSupported,
  isProcessing,
}: FormPageSectionProps) => {
  const [subFolderPath, setSubFolderPath] = React.useState('doc-to-text');

  const postConvertDocToText = React.useCallback<
    Parameters<typeof initSubmitHandler>[0]
  >(
    async (formDataJSON) => {
      return executeBatch(
        {
          formDataJSON,
          processedDir: selectedFile!,
          destinationHandle: outputDirectory?.browserFSAPIhandle!,
          validationMessage:
            'Please select both source and output folders first.',
          successMessage: 'Successfully converted documents to text!',
          subfolderPath: formDataJSON.subfolderPath || 'doc-to-text',
        },
        async (batchFiles, batchIndex, totalBatches, structure) => {
          const formData = new FormData();
          formData.append('batchIndex', String(batchIndex));
          formData.append('totalBatches', String(totalBatches));
          formData.append('structure', JSON.stringify(structure));

          // Process files in parallel to get content (Lazy Loading)
          await Promise.all(
            batchFiles.map(async (f) => {
              formData.append('files', f.contentAsBlob, f.name);
            }),
          );

          return fetchRequest('/api-local/convert/doc-to-text', {
            method: 'POST',
            body: formData,
          });
        },
      );
    },
    [executeBatch, sourceDirectory, outputDirectory],
  );

  return (
    <div
      className="max-w-lg mx-auto flex rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800 flex-col"
      data-testid="flowbite-card"
    >
      <div className="flex h-full flex-col justify-center gap-4 p-6">
        <h3 className="mb-4 text-xl font-bold dark:text-white">
          Конвертація Документів в Текст
        </h3>
        <form onSubmit={initSubmitHandler(postConvertDocToText)}>
          <div className="grid gap-4 mb-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormInputFileSelect
                id="sourceFolder"
                name="sourceFolder"
                label="Початкова папка з документами"
                onClick={onSelectSourceDirectory}
                selectedItem={sourceDirectory}
                isFileSystemAccessSupported={isFileSystemAccessSupported}
                icon="folder"
              />
            </div>
            <div className="sm:col-span-2">
              <FormInputFileSelect
                id="outputFolder"
                name="outputFolder"
                label="Кінцева папка для збереження текстових файлів"
                onClick={onSelectOutputDirectory}
                selectedItem={outputDirectory}
                isFileSystemAccessSupported={isFileSystemAccessSupported}
                icon="folder"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="subfolderPath"
                className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
              >
                Назва підпапки
              </label>
              <input
                id="subfolderPath"
                name="subfolderPath"
                className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                placeholder="doc-to-text"
                value={subFolderPath}
                onChange={(e) => setSubFolderPath(e.target.value)}
                type="text"
              />
            </div>
          </div>

          <div className="mt-8">
            <ProcessingButton
              type="submit"
              isLoading={isProcessing}
              disabled={!sourceDirectory || !outputDirectory}
            >
              {isProcessing
                ? `Конвертую... (${progress.current}/${progress.total})`
                : 'Конвертувати Документи в Текст'}
            </ProcessingButton>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              💡 Конвертовані файли будуть збережені в папці "{subFolderPath}"
              всередині вибраної папки.
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export { FormConvertDocToTextTabItem };
