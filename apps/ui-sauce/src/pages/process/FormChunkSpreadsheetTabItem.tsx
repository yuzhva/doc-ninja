import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
  ButtonProcessing,
  Checkbox,
  FormFileDropzone,
  FormInputFileSelect,
  hasAllowedExtension,
} from '../../components';
import type { BatchFileProcessingSectionProps } from '../../hooks/use-batch-processor';
import { fetchRequest } from '../../utils';
import { ChunkSpreadsheetConfigsDropdown } from './chunk-spreadsheet/ChunkSpreadsheetConfigsDropdown';
import {
  DEFAULT_SUBFOLDER,
  useChunkSpreadsheetConfigs,
} from './chunk-spreadsheet/chunk-spreadsheet.store';
import type {
  AdditionalSheet,
  NumberField,
} from './chunk-spreadsheet/chunk-spreadsheet.store';

const I18N_NS = 'page.process.component.formChunkSpreadsheet';

// What both slicers (ExcelJS and the openpyxl script) can open.
const SUPPORTED_EXTENSIONS = ['.xlsx', '.xlsm'];

const INPUT_CLASS_NAME =
  'block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm';
const LABEL_CLASS_NAME =
  'block mb-2 text-sm font-medium text-gray-900 dark:text-white';
const COLUMN_LABEL_CLASS_NAME =
  'text-sm font-medium text-gray-900 dark:text-gray-300';
// Four number columns plus one for the toggle / row buttons — shared by
// every row so the columns line up.
const SHEET_ROW_CLASS_NAME = 'grid grid-cols-5 gap-4';

const toNumberField = (value: string): NumberField => parseInt(value) || '';

type AdditionalSheetField = keyof AdditionalSheet;

const FormChunkSpreadsheetTabItem = ({
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

  // Form data matching API format: the config selected in the dropdown next
  // to the title, saved to localStorage as it's edited.
  const chunkConfigs = useChunkSpreadsheetConfigs();
  const formState = chunkConfigs.selectedConfig;
  const setFormState = chunkConfigs.updateSelectedConfig;

  const selectedFileName = selectedFile?.structure?.name;
  const isSelectedFileSupported =
    !!selectedFileName &&
    hasAllowedExtension(selectedFileName, SUPPORTED_EXTENSIONS);
  // Opens the folder picker in the file's own folder — see
  // FormConvertSpreadsheetToStatic.
  const selectedFileHandle = selectedFile?.browserFSAPIhandle ?? null;
  const subfolder = formState.outputSubfolder || DEFAULT_SUBFOLDER;

  // Add new additional sheet function
  const addNewRow = () => {
    setFormState((prev) => ({
      ...prev,
      additionalSheets: [
        ...prev.additionalSheets,
        {
          sheetIndex: 0,
          headerRows: 0,
          filterColumnPosition: 0,
        },
      ],
    }));
  };

  // Remove additional sheet function
  const removeRow = (index: number) => {
    setFormState((prev) => ({
      ...prev,
      additionalSheets: prev.additionalSheets.filter((_, i) => i !== index),
    }));
  };

  // Update primary sheet data
  const updatePrimarySheet = <Field extends keyof typeof formState>(
    field: Field,
    value: (typeof formState)[Field],
  ) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Update additional sheet data
  const updateAdditionalSheet = (
    index: number,
    field: AdditionalSheetField,
    value: NumberField,
  ) => {
    setFormState((prev) => ({
      ...prev,
      additionalSheets: prev.additionalSheets.map((sheet, i) =>
        i === index ? { ...sheet, [field]: value } : sheet,
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
          validationMessage: t(`${I18N_NS}.validationMessage`),
          successMessage: t(`${I18N_NS}.successMessage`),
          subfolderPath: formState.outputSubfolder || DEFAULT_SUBFOLDER,
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

          // Prepare additional sheets data (only the fields the API knows)
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
    [executeBatch, selectedFile, outputDirectory, formState, t],
  );

  const sheetColumnLabels = {
    sheetIndex: t(`${I18N_NS}.sheetPositionLabel`),
    headerRows: t(`${I18N_NS}.headerRowsLabel`),
    filterColumnPosition: t(`${I18N_NS}.filterColumnLabel`),
    maxColumnsToInclude: t(`${I18N_NS}.lastColumnLabel`),
  };

  return (
    <div
      className="flex rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800 flex-col"
      data-testid="flowbite-card"
    >
      <div className="flex h-full flex-col justify-center gap-4 p-6">
        <form onSubmit={initSubmitHandler(postDocumentToChunk)}>
          {/* Start: what to slice and where the parts go (the same fields as
              "Convert .xlsx to static"). End: how to slice it. Side by side
              from `xl` up, stacked below. Each column opens with a title row
              of the same height, so both titles share one line. */}
          <div className="grid gap-8 xl:grid-cols-[24rem_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
              <h3 className="flex items-center min-h-10 text-xl font-bold dark:text-white">
                <Trans i18nKey={`${I18N_NS}.title`} />
              </h3>
              <FormFileDropzone
                id="chunkSpreadsheetFile"
                label={<Trans i18nKey={`${I18N_NS}.spreadsheetFileLabel`} />}
                extensions={SUPPORTED_EXTENSIONS}
                selectedItem={selectedFile}
                onClick={onSelectFile}
                onDropFile={(dataTransfer) => onDropFile?.(dataTransfer)}
                isFileSystemAccessSupported={isFileSystemAccessSupported}
              />
              <div>
                <FormInputFileSelect
                  id="outputChunksFolder"
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
                    💡{' '}
                    <Trans i18nKey={`${I18N_NS}.outputFolderNextToFileHint`} />
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="chunkFilenameSuffix"
                  className={LABEL_CLASS_NAME}
                >
                  <Trans i18nKey={`${I18N_NS}.filenameSuffixLabel`} />
                </label>
                <input
                  id="chunkFilenameSuffix"
                  className={INPUT_CLASS_NAME}
                  type="text"
                  name="filenameSuffix"
                  value={formState.filenameSuffix}
                  onChange={(e) =>
                    updatePrimarySheet('filenameSuffix', e.target.value)
                  }
                  placeholder={t(`${I18N_NS}.filenameSuffixPlaceholder`)}
                />
              </div>
              <div>
                <label
                  htmlFor="chunkOutputSubfolder"
                  className={LABEL_CLASS_NAME}
                >
                  <Trans i18nKey={`${I18N_NS}.subfolderLabel`} />
                </label>
                <input
                  id="chunkOutputSubfolder"
                  className={INPUT_CLASS_NAME}
                  type="text"
                  name="outputSubfolder"
                  value={formState.outputSubfolder}
                  onChange={(e) =>
                    updatePrimarySheet('outputSubfolder', e.target.value)
                  }
                  // Left empty, the parts go to the default subfolder.
                  placeholder={DEFAULT_SUBFOLDER}
                />
              </div>

              <div className="mt-4">
                <ButtonProcessing
                  type="submit"
                  isLoading={isProcessing}
                  disabled={!isSelectedFileSupported || !outputDirectory}
                >
                  {isProcessing
                    ? t(`${I18N_NS}.slicingButton`)
                    : t(`${I18N_NS}.sliceButton`)}
                </ButtonProcessing>
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  💡{' '}
                  {outputDirectory
                    ? t(`${I18N_NS}.resultInFolderHint`, {
                        folderName: outputDirectory.structure.name,
                        subfolder,
                      })
                    : t(`${I18N_NS}.resultHint`, { subfolder })}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-8 xl:border-s xl:border-gray-200 xl:ps-8 dark:xl:border-gray-700">
              <section>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-4 min-h-10">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
                    <Trans i18nKey={`${I18N_NS}.primarySheetTitle`} />
                  </h4>
                  <ChunkSpreadsheetConfigsDropdown
                    configs={chunkConfigs.configs}
                    selectedIndex={chunkConfigs.selectedIndex}
                    onConfigsChange={chunkConfigs.setConfigs}
                    onSelectedIndexChange={chunkConfigs.setSelectedIndex}
                  />
                </div>
                <div className={`${SHEET_ROW_CLASS_NAME} items-end mb-2`}>
                  <label
                    htmlFor="chunkSheetPosition"
                    className={COLUMN_LABEL_CLASS_NAME}
                  >
                    {sheetColumnLabels.sheetIndex}
                  </label>
                  <label
                    htmlFor="chunkHeaderRows"
                    className={COLUMN_LABEL_CLASS_NAME}
                  >
                    {sheetColumnLabels.headerRows}
                  </label>
                  <label
                    htmlFor="chunkFilterColumn"
                    className={COLUMN_LABEL_CLASS_NAME}
                  >
                    {sheetColumnLabels.filterColumnPosition}
                  </label>
                  <label
                    htmlFor="chunkLastColumn"
                    className={COLUMN_LABEL_CLASS_NAME}
                  >
                    {sheetColumnLabels.maxColumnsToInclude}
                  </label>
                </div>
                <div className={SHEET_ROW_CLASS_NAME}>
                  <input
                    id="chunkSheetPosition"
                    className={INPUT_CLASS_NAME}
                    type="number"
                    name="sheetToChunkPosition"
                    value={formState.sheetToChunkPosition}
                    onChange={(e) =>
                      updatePrimarySheet(
                        'sheetToChunkPosition',
                        toNumberField(e.target.value),
                      )
                    }
                    required
                  />
                  <input
                    id="chunkHeaderRows"
                    className={INPUT_CLASS_NAME}
                    type="number"
                    name="headerRows"
                    value={formState.headerRows}
                    onChange={(e) =>
                      updatePrimarySheet(
                        'headerRows',
                        toNumberField(e.target.value),
                      )
                    }
                    required
                  />
                  <input
                    id="chunkFilterColumn"
                    className={INPUT_CLASS_NAME}
                    type="number"
                    name="splitColumnPosition"
                    value={formState.splitColumnPosition}
                    onChange={(e) =>
                      updatePrimarySheet(
                        'splitColumnPosition',
                        toNumberField(e.target.value),
                      )
                    }
                    required
                  />
                  <input
                    id="chunkLastColumn"
                    className={INPUT_CLASS_NAME}
                    type="number"
                    name="maxColumnsToInclude"
                    value={formState.maxColumnsToInclude}
                    onChange={(e) =>
                      updatePrimarySheet(
                        'maxColumnsToInclude',
                        toNumberField(e.target.value),
                      )
                    }
                    required
                  />
                  <div className="flex items-center h-[42px]">
                    <Checkbox
                      theme="toggle"
                      name="isFasterLessStyledChunkerUsed"
                      checked={formState.isFasterLessStyledChunkerUsed}
                      onChange={(checked) =>
                        updatePrimarySheet(
                          'isFasterLessStyledChunkerUsed',
                          checked,
                        )
                      }
                      label={
                        <span className="flex flex-col leading-tight">
                          <span>
                            <Trans i18nKey={`${I18N_NS}.fastSlicingLabel`} />
                          </span>
                          <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                            <Trans i18nKey={`${I18N_NS}.fastSlicingHint`} />
                          </span>
                        </span>
                      }
                    />
                  </div>
                </div>
              </section>

              <section>
                <h4 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
                  <Trans i18nKey={`${I18N_NS}.additionalSheetsTitle`} />
                </h4>
                {formState.additionalSheets.length > 0 && (
                  <div
                    className={`${SHEET_ROW_CLASS_NAME} items-end mb-2`}
                    aria-hidden="true"
                  >
                    <span className={COLUMN_LABEL_CLASS_NAME}>
                      {sheetColumnLabels.sheetIndex}
                    </span>
                    <span className={COLUMN_LABEL_CLASS_NAME}>
                      {sheetColumnLabels.headerRows}
                    </span>
                    <span className={COLUMN_LABEL_CLASS_NAME}>
                      {sheetColumnLabels.filterColumnPosition}
                    </span>
                    <span className={COLUMN_LABEL_CLASS_NAME}>
                      {sheetColumnLabels.maxColumnsToInclude}
                    </span>
                  </div>
                )}

                {formState.additionalSheets.map((sheet, index) => {
                  // One shared header row, so each input names itself.
                  const fieldLabel = (field: string) =>
                    t(`${I18N_NS}.additionalSheetFieldLabel`, {
                      field,
                      number: index + 1,
                    });
                  const numberInput = (
                    field: AdditionalSheetField,
                    label: string,
                    isRequired = true,
                  ) => (
                    <input
                      className={INPUT_CLASS_NAME}
                      type="number"
                      name={`${field}_${index}`}
                      aria-label={fieldLabel(label)}
                      value={sheet[field] ?? ''}
                      onChange={(e) =>
                        updateAdditionalSheet(
                          index,
                          field,
                          toNumberField(e.target.value),
                        )
                      }
                      required={isRequired}
                    />
                  );

                  return (
                    // Index keys are enough: every input is controlled, so
                    // a row holds no state of its own to mix up.
                    <div key={index} className={`${SHEET_ROW_CLASS_NAME} mb-4`}>
                      {numberInput('sheetIndex', sheetColumnLabels.sheetIndex)}
                      {numberInput('headerRows', sheetColumnLabels.headerRows)}
                      {numberInput(
                        'filterColumnPosition',
                        sheetColumnLabels.filterColumnPosition,
                      )}
                      {numberInput(
                        'maxColumnsToInclude',
                        sheetColumnLabels.maxColumnsToInclude,
                        false,
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => removeRow(index)}
                          className="flex items-center justify-center w-10 h-10 text-white bg-red-600 hover:bg-red-700 focus:ring-4 focus:ring-red-300 font-medium rounded-lg text-sm dark:bg-red-600 dark:hover:bg-red-700 dark:focus:ring-red-800 cursor-pointer"
                          title={t(`${I18N_NS}.removeSheetTitle`)}
                          aria-label={t(`${I18N_NS}.removeSheetLabel`, {
                            number: index + 1,
                          })}
                        >
                          −
                        </button>
                        {index === formState.additionalSheets.length - 1 && (
                          <button
                            type="button"
                            onClick={addNewRow}
                            className="flex items-center justify-center w-10 h-10 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 cursor-pointer"
                            title={t(`${I18N_NS}.addSheetTitle`)}
                            aria-label={t(`${I18N_NS}.addSheetTitle`)}
                          >
                            +
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Add button when no additional sheets */}
                {formState.additionalSheets.length === 0 && (
                  <button
                    type="button"
                    onClick={addNewRow}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-transparent border border-blue-600 rounded-lg hover:bg-blue-600 hover:text-white focus:ring-4 focus:outline-none focus:ring-blue-300 dark:text-blue-400 dark:border-blue-500 dark:hover:bg-blue-600 dark:hover:text-white dark:focus:ring-blue-800 cursor-pointer transition-colors"
                  >
                    + <Trans i18nKey={`${I18N_NS}.addSheetButton`} />
                  </button>
                )}
              </section>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export { FormChunkSpreadsheetTabItem };
