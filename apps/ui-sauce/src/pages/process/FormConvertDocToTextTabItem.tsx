import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ButtonProcessing, FormInputFileSelect } from '../../components';
import type { BatchFileProcessingSectionProps } from '../../hooks/use-batch-processor';
import { fetchRequest } from '../../utils';

const I18N_NS = 'page.process.component.formConvertDocToText';

const DEFAULT_SUBFOLDER = 'doc-to-text';

const FormConvertDocToTextTabItem = ({
  onSelectSourceDirectory,
  onSelectOutputDirectory,
  executeBatch,
  initSubmitHandler,
  sourceDirectory,
  outputDirectory,
  selectedFile,
  progress,
  isFileSystemAccessSupported,
  isProcessing,
}: BatchFileProcessingSectionProps) => {
  const { t } = useTranslation();
  const [subFolderPath, setSubFolderPath] = React.useState(DEFAULT_SUBFOLDER);

  const postConvertDocToText = React.useCallback<
    Parameters<typeof initSubmitHandler>[0]
  >(
    async (formDataJSON) => {
      return executeBatch(
        {
          formDataJSON,
          processedDir: sourceDirectory!,
          destinationHandle: outputDirectory?.browserFSAPIhandle!,
          validationMessage: t(`${I18N_NS}.validationMessage`),
          successMessage: t(`${I18N_NS}.successMessage`),
          subfolderPath: formDataJSON.subfolderPath || DEFAULT_SUBFOLDER,
        },
        async (batchFiles, batchIndex, totalBatches /*, structure */) => {
          const formData = new FormData();
          formData.append('batchIndex', String(batchIndex));
          formData.append('totalBatches', String(totalBatches));
          // NOTE: the whole folder tree (4th argument of this callback) is no
          // longer sent — the backend never needed more than each file's path
          // (`filePaths` below). Kept as a breadcrumb for a possible
          // FE-only conversion, which would build on that tree:
          // formData.append('structure', JSON.stringify(structure));
          //
          // Keeps subfolders (and same-named files in different ones) apart
          // in the output — see postDocumentToText.
          formData.append(
            'filePaths',
            JSON.stringify(batchFiles.map((f) => f.path)),
          );

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
    [executeBatch, sourceDirectory, outputDirectory, t],
  );

  return (
    <div
      className="max-w-lg mx-auto flex rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800 flex-col"
      data-testid="flowbite-card"
    >
      <div className="flex h-full flex-col justify-center gap-4 p-6">
        <h3 className="mb-4 text-xl font-bold dark:text-white">
          <Trans i18nKey={`${I18N_NS}.title`} />
        </h3>
        <form onSubmit={initSubmitHandler(postConvertDocToText)}>
          <div className="grid gap-4 mb-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormInputFileSelect
                id="sourceFolder"
                name="sourceFolder"
                label={<Trans i18nKey={`${I18N_NS}.sourceFolderLabel`} />}
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
                label={<Trans i18nKey={`${I18N_NS}.outputFolderLabel`} />}
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
                <Trans i18nKey={`${I18N_NS}.subfolderLabel`} />
              </label>
              <input
                id="subfolderPath"
                name="subfolderPath"
                className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                placeholder={DEFAULT_SUBFOLDER}
                value={subFolderPath}
                onChange={(e) => setSubFolderPath(e.target.value)}
                type="text"
              />
            </div>
          </div>

          <div className="mt-8">
            <ButtonProcessing
              type="submit"
              isLoading={isProcessing}
              disabled={!sourceDirectory || !outputDirectory}
            >
              {isProcessing
                ? t(`${I18N_NS}.convertingButton`, {
                    current: progress.current,
                    total: progress.total,
                  })
                : t(`${I18N_NS}.convertButton`)}
            </ButtonProcessing>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              💡{' '}
              {t(`${I18N_NS}.resultHint`, {
                subfolder: subFolderPath || DEFAULT_SUBFOLDER,
              })}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export { FormConvertDocToTextTabItem };
