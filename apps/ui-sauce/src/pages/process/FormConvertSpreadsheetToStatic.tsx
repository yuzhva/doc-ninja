import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
  ButtonProcessing,
  FormFileDropzone,
  FormInputFileSelect,
  hasAllowedExtension,
} from '../../components';
import type { BatchFileProcessingSectionProps } from '../../hooks/use-batch-processor';
import { fetchRequest } from '../../utils';

const I18N_NS = 'page.process.component.formConvertSpreadsheetToStatic';

// What the conversion script (openpyxl) can open — .xls and .xlsb can't be.
const SUPPORTED_EXTENSIONS = ['.xlsx', '.xlsm'];
// The backend always saves the static copy as a macro-enabled workbook.
const RESULT_EXTENSION = '.xlsm';

const FormConvertSpreadsheetToStatic = ({
  onSelectFile,
  onDropFile,
  // onSelectSourceDirectory,
  onSelectOutputDirectory,
  onSelectOutputDirectoryStartingIn,
  executeBatch,
  initSubmitHandler,
  // sourceDirectory,
  outputDirectory,
  selectedFile,
  // progress,
  isFileSystemAccessSupported,
  isProcessing,
}: BatchFileProcessingSectionProps) => {
  const { t } = useTranslation();
  const [fileNameSuffix, setFileNameSuffix] = React.useState('_без_формул');

  const selectedFileName = selectedFile?.structure?.name;
  const isSelectedFileSupported =
    !!selectedFileName &&
    hasAllowedExtension(selectedFileName, SUPPORTED_EXTENSIONS);
  // A browser can't hand the page the file's folder, but it can open the
  // folder picker right there — so choosing it is a single confirmation.
  const selectedFileHandle = selectedFile?.browserFSAPIhandle ?? null;

  const previewFileName = React.useMemo(() => {
    if (!selectedFileName || !isSelectedFileSupported) return;

    const extensionStart = selectedFileName.lastIndexOf('.');
    const baseName =
      extensionStart > 0
        ? selectedFileName.slice(0, extensionStart)
        : selectedFileName;
    return `${baseName}${fileNameSuffix}${RESULT_EXTENSION}`;
  }, [selectedFileName, isSelectedFileSupported, fileNameSuffix]);

  const postConvertSpreadsheetToStatic = React.useCallback<
    Parameters<typeof initSubmitHandler>[0]
  >(
    async (formDataJSON) => {
      return executeBatch(
        {
          formDataJSON,
          processedDir: selectedFile!,
          destinationHandle: outputDirectory?.browserFSAPIhandle!,
          validationMessage: t(`${I18N_NS}.validationMessage`),
          successMessage: t(`${I18N_NS}.successMessage`),
          // subfolderPath: 'xlsx-static',
        },
        async (batchFiles) => {
          // Create file from the original file handle
          const file = batchFiles[0];

          // Create FormData with the actual file
          const formData = new FormData();
          // Use file.name directly to preserve encoding
          formData.append('file', file.contentAsBlob, file.name);

          if (formDataJSON.filenameSuffix) {
            formData.append('filenameSuffix', formDataJSON.filenameSuffix);
          }

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
    [executeBatch, selectedFile, outputDirectory, t],
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
        <form onSubmit={initSubmitHandler(postConvertSpreadsheetToStatic)}>
          <div className="grid gap-4 mb-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormFileDropzone
                id="spreadsheetFile"
                label={<Trans i18nKey={`${I18N_NS}.spreadsheetFileLabel`} />}
                extensions={SUPPORTED_EXTENSIONS}
                selectedItem={selectedFile}
                onClick={onSelectFile}
                onDropFile={(dataTransfer) => onDropFile?.(dataTransfer)}
                isFileSystemAccessSupported={isFileSystemAccessSupported}
              />
            </div>
            <div className="sm:col-span-2">
              <FormInputFileSelect
                id="outputFolder"
                name="outputFolder"
                label={<Trans i18nKey={`${I18N_NS}.outputFolderLabel`} />}
                onClick={() =>
                  onSelectOutputDirectoryStartingIn
                    ? onSelectOutputDirectoryStartingIn(selectedFileHandle)
                    : onSelectOutputDirectory()
                }
                selectedItem={outputDirectory}
                isFileSystemAccessSupported={isFileSystemAccessSupported}
                icon="folder"
              />
              {selectedFileHandle && !outputDirectory && (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  💡 <Trans i18nKey={`${I18N_NS}.outputFolderNextToFileHint`} />
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="filenameSuffix"
                className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
              >
                <Trans i18nKey={`${I18N_NS}.filenameSuffixLabel`} />
              </label>
              <input
                id="filenameSuffix"
                name="filenameSuffix"
                className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                placeholder="_без_формул"
                value={fileNameSuffix}
                onChange={(e) => setFileNameSuffix(e.target.value)}
                type="text"
              />
            </div>
          </div>

          <div className="mt-8">
            <ButtonProcessing
              type="submit"
              isLoading={isProcessing}
              disabled={!isSelectedFileSupported || !outputDirectory}
            >
              {isProcessing
                ? t(`${I18N_NS}.convertingButton`)
                : t(`${I18N_NS}.convertButton`)}
            </ButtonProcessing>
            {previewFileName && (
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                💡{' '}
                {t(`${I18N_NS}.resultFileHint`, { fileName: previewFileName })}
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export { FormConvertSpreadsheetToStatic };
