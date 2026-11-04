import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { FileSystemService } from 'toolkit--local/browser';

import {
  ButtonProcessing,
  Checkbox,
  FormConfigSelect,
  FormInputFileSelect,
} from '../../components';
import type { BatchFileProcessingSectionProps } from '../../hooks/use-batch-processor';
import { fetchRequest } from '../../utils';
import { DocRegexDocumentViewer } from './doc-regex-parser/components/DocRegexDocumentViewer';
import type { DocRegexDocumentStatusFilter } from './doc-regex-parser/components/DocRegexDocumentViewer';
import { DocRegexModalConfigSettings } from './doc-regex-parser/components/DocRegexModalConfigSettings';
import {
  DOC_REGEX_SECONDARY_BUTTON_CLASS_NAME,
  DocRegexResultsTable,
} from './doc-regex-parser/components/DocRegexResultsTable';
import type {
  DocRegexResultsTableColumn,
  DocRegexResultsTableRow,
} from './doc-regex-parser/components/DocRegexResultsTable';
import { DocRegexParser } from './doc-regex-parser/doc-regex-parser.engine';
import { formatDocRegexIssue } from './doc-regex-parser/doc-regex-parser.issues';
import { buildDocRegexResults } from './doc-regex-parser/doc-regex-parser.results';
import type { DocRegexDocumentStatus } from './doc-regex-parser/doc-regex-parser.results';
import {
  docRegexSessionStore,
  readSelectedDocRegexConfigName,
  readStoredDocRegexConfigs,
  useDocRegexSession,
  usePersistedFlag,
  writeSelectedDocRegexConfigName,
} from './doc-regex-parser/doc-regex-parser.store';
import type { DocRegexSourceDocument } from './doc-regex-parser/doc-regex-parser.store';
import type { DocRegexConfig } from './doc-regex-parser/doc-regex-parser.types';

const I18N_NS = 'page.process.component.formParseDocsByRegex';

// Can't clash with a config id: ids are letters, digits and "_" only, and
// none of the engine's own values start with "__".
const FILE_COLUMN_ID = '__file';

const STATUS_CHIP_CLASSES: Record<DocRegexDocumentStatus, string> = {
  MATCHED:
    'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800',
  SKIPPED:
    'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600',
  NO_TEXT:
    'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:hover:bg-amber-800',
  FAILED:
    'bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800',
};

const hasExtension = (fileName: string, extensions: string[]) => {
  const lowerName = fileName.toLowerCase();
  return extensions.some((extension) => lowerName.endsWith(extension));
};

const saveBlobAs = async (
  blob: Blob,
  fileName: string,
  typeDescription: string,
) => {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: typeDescription,
            accept: { [blob.type]: [`.${fileName.split('.').pop()}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (err: any) {
      if (err?.name !== 'AbortError') throw err;
    }
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const FormParseDocsByRegexTabItem = ({
  onSelectSourceDirectory,
  executeBatch,
  sourceDirectory,
  progress,
  isFileSystemAccessSupported,
  isProcessing,
}: BatchFileProcessingSectionProps) => {
  const { t } = useTranslation();
  const session = useDocRegexSession();

  const [configs, setConfigs] = React.useState<DocRegexConfig[]>(() =>
    readStoredDocRegexConfigs(),
  );
  const [selectedConfigName, setSelectedConfigName] = React.useState(
    () => readSelectedDocRegexConfigName() ?? '',
  );
  const [isConfigModalOpen, setIsConfigModalOpen] = React.useState(false);
  const [viewerState, setViewerState] = React.useState<{
    documentIndex: number;
    statusFilter: DocRegexDocumentStatusFilter;
  } | null>(null);
  const [isExporting, setIsExporting] = React.useState(false);

  const [isIntermediateShown, setIsIntermediateShown] = usePersistedFlag(
    'docNinja_docRegexParser_isIntermediateShown',
    false,
  );
  const [isFileColumnShown, setIsFileColumnShown] = usePersistedFlag(
    'docNinja_docRegexParser_isFileColumnShown',
    false,
  );
  const [isHeaderCopied, setIsHeaderCopied] = usePersistedFlag(
    'docNinja_docRegexParser_isHeaderCopied',
    false,
  );

  // A stored name that no longer exists (renamed/deleted in the editor)
  // falls back to the first config rather than to nothing.
  const activeConfig =
    configs.find((config) => config?.name === selectedConfigName) ??
    configs[0] ??
    null;

  const activeConfigIssues = React.useMemo(
    () => (activeConfig ? DocRegexParser.validateConfig(activeConfig) : []),
    [activeConfig],
  );

  const parser = React.useMemo(
    () =>
      activeConfig && activeConfigIssues.length === 0
        ? new DocRegexParser(activeConfig)
        : null,
    [activeConfig, activeConfigIssues],
  );

  const fileExtensions = React.useMemo(
    () => (activeConfig ? DocRegexParser.getFileExtensions(activeConfig) : []),
    [activeConfig],
  );

  const candidateFiles = React.useMemo(
    () =>
      (sourceDirectory?.files ?? []).filter(
        (file) =>
          hasExtension(file.name, fileExtensions) &&
          !FileSystemService.shouldSkipFile(file.name, file.size),
      ),
    [sourceDirectory, fileExtensions],
  );

  // Only the texts read for this very pick — a new pick (even of the same
  // folder) starts empty until the documents are processed again.
  const sessionDocuments =
    sourceDirectory && session.source === sourceDirectory
      ? session.documents
      : [];

  const visibleDocuments = React.useMemo(() => {
    const candidatePaths = new Set(candidateFiles.map((file) => file.path));
    return sessionDocuments.filter((document) =>
      candidatePaths.has(document.path),
    );
  }, [sessionDocuments, candidateFiles]);

  // Files the last run didn't read — e.g. after switching to a config for
  // other file types.
  const unreadFilesCount = React.useMemo(() => {
    const readPaths = new Set(
      sessionDocuments.map((document) => document.path),
    );
    return candidateFiles.filter((file) => !readPaths.has(file.path)).length;
  }, [sessionDocuments, candidateFiles]);

  const results = React.useMemo(
    () => (parser ? buildDocRegexResults(parser, visibleDocuments) : null),
    [parser, visibleDocuments],
  );

  const tableColumns = React.useMemo<DocRegexResultsTableColumn[]>(() => {
    if (!activeConfig || !parser) return [];

    const values = DocRegexParser.listValues(activeConfig);
    const labelById = new Map(values.map((value) => [value.id, value.label]));
    const columns: DocRegexResultsTableColumn[] = [];

    if (isFileColumnShown) {
      columns.push({
        id: FILE_COLUMN_ID,
        label: t(`${I18N_NS}.fileColumnLabel`),
        isFile: true,
      });
    }
    for (const id of activeConfig.columns) {
      columns.push({ id, label: labelById.get(id) ?? id });
    }
    // After the final columns, never between them — so a copy of the
    // result keeps the column order the config promises.
    if (isIntermediateShown) {
      for (const value of values) {
        if (!activeConfig.columns.includes(value.id)) {
          columns.push({
            id: value.id,
            label: value.label,
            isIntermediate: true,
          });
        }
      }
    }

    return columns;
  }, [activeConfig, parser, isFileColumnShown, isIntermediateShown, t]);

  const tableRows = React.useMemo<DocRegexResultsTableRow[]>(() => {
    if (!results) return [];

    let documentParity: 0 | 1 = 0;
    let previousDocumentIndex = -1;

    return results.rows.map((row, rowIndex) => {
      const isFirstOfDocument = row.documentIndex !== previousDocumentIndex;
      if (isFirstOfDocument && rowIndex > 0) {
        documentParity = documentParity === 0 ? 1 : 0;
      }
      previousDocumentIndex = row.documentIndex;

      return {
        key: row.key,
        documentIndex: row.documentIndex,
        isFirstOfDocument,
        documentParity,
        cells: tableColumns.map((column) =>
          column.isFile
            ? results.outcomes[row.documentIndex].document.path
            : (row.values[column.id] ?? null),
        ),
      };
    });
  }, [results, tableColumns]);

  const rowsWithGapsCount = React.useMemo(
    () =>
      results && activeConfig
        ? results.rows.filter((row) =>
            activeConfig.columns.some((id) => !row.values[id]),
          ).length
        : 0,
    [results, activeConfig],
  );

  const handleSelectConfig = (name: string) => {
    setSelectedConfigName(name);
    writeSelectedDocRegexConfigName(name);
  };

  const handleConfigsSaved = (savedConfigs: DocRegexConfig[]) => {
    setConfigs(savedConfigs);
    setIsConfigModalOpen(false);
  };

  /**
   * Always reads every document of the pick from scratch — nothing from an
   * earlier run is reused, so the table can only ever show what the files
   * say right now. Parsing itself happens in the browser (see
   * buildDocRegexResults), which is what keeps config edits instant.
   */
  const readDocuments = async () => {
    if (!sourceDirectory) return;

    // Captured up front: the user may pick another folder while this runs,
    // and these texts must then stay attached to the pick they came from.
    const source = sourceDirectory;
    const filesToRead = candidateFiles;
    const readByPath = new Map<
      string,
      { text: string | null; error: string | null }
    >();

    if (filesToRead.length > 0) {
      await executeBatch(
        {
          formDataJSON: {},
          processedDir: {
            structure: source.structure,
            files: filesToRead,
          },
          // Never written to — see isWritingFilesSkipped.
          destinationHandle: null!,
          validationMessage: t(`${I18N_NS}.validationMessage`),
          successMessage: t(`${I18N_NS}.successMessage`),
          isWritingFilesSkipped: true,
        },
        async (batchFiles, batchIndex, totalBatches) => {
          const formData = new FormData();
          formData.append('batchIndex', String(batchIndex));
          formData.append('totalBatches', String(totalBatches));
          // Lets the backend hand each text back under the file's own
          // path, so same-named files in different subfolders stay apart.
          formData.append(
            'filePaths',
            JSON.stringify(batchFiles.map((file) => file.path)),
          );
          batchFiles.forEach((file) =>
            formData.append('files', file.contentAsBlob, file.name),
          );

          const response = await fetchRequest(
            '/api-local/convert/doc-to-text',
            { method: 'POST', body: formData },
          );

          for (const processedFile of response?.processedFiles ?? []) {
            readByPath.set(processedFile.originalPath, {
              text: processedFile.content ?? '',
              error: null,
            });
          }
          for (const failedFile of response?.failedFiles ?? []) {
            readByPath.set(failedFile.path, {
              text: null,
              error: failedFile.error || t(`${I18N_NS}.readFailedError`),
            });
          }

          return response;
        },
      );
    }

    const documents: DocRegexSourceDocument[] = filesToRead.map((file) => {
      const read = readByPath.get(file.path);
      return {
        path: file.path,
        name: file.name,
        // A batch whose request failed as a whole reports nothing per file.
        text: read?.text ?? null,
        error: read ? read.error : t(`${I18N_NS}.readFailedError`),
      };
    });

    docRegexSessionStore.setState({
      source,
      documents: documents.sort((a, b) => a.path.localeCompare(b.path, 'uk')),
    });
  };

  const handleOpenDocument = React.useCallback(
    (documentIndex: number) =>
      setViewerState({ documentIndex, statusFilter: 'ALL' }),
    [],
  );

  const handleOpenStatus = (status: DocRegexDocumentStatus) => {
    const documentIndex =
      results?.outcomes.findIndex((outcome) => outcome.status === status) ?? -1;
    if (documentIndex === -1) return;
    setViewerState({ documentIndex, statusFilter: status });
  };

  const handleDownloadXlsx = async () => {
    if (!results || tableColumns.length === 0) return;
    setIsExporting(true);

    try {
      const payload = {
        columns: tableColumns.map((column) => ({
          header: column.label,
          key: column.id,
          options: { wch: column.isFile ? 60 : 20 },
        })),
        rows: tableRows.map((row) =>
          Object.fromEntries(
            tableColumns.map((column, index) => [
              column.id,
              row.cells[index] ?? '',
            ]),
          ),
        ),
      };
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([JSON.stringify(payload)], { type: 'application/json' }),
        'data.json',
      );
      formData.append(
        'outputFileName',
        `${activeConfig?.name || 'doc-ninja'} ${new Date().toISOString().slice(0, 10)}`,
      );

      const response = await fetchRequest(
        '/api-local/process/generate-filtered-spreadsheet',
        { method: 'POST', body: formData },
      );
      const fileData = response?.processedFiles?.[0];
      if (!fileData) throw new Error('No spreadsheet in the response');

      const bytes = Uint8Array.from(atob(fileData.content), (char) =>
        char.charCodeAt(0),
      );
      await saveBlobAs(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        fileData.name,
        t(`${I18N_NS}.excelFileTypeDescription`),
      );
    } catch (error) {
      console.error('Failed to export results to .xlsx', error);
      alert(t(`${I18N_NS}.exportErrorAlert`));
    } finally {
      setIsExporting(false);
    }
  };

  const configOptions = configs.map((config, index) => ({
    value: config?.name ?? '',
    label: config?.name || t(`${I18N_NS}.unnamedConfig`, { number: index + 1 }),
  }));

  const statusChips: DocRegexDocumentStatus[] = [
    'MATCHED',
    'SKIPPED',
    'NO_TEXT',
    'FAILED',
  ];

  return (
    <div
      className="flex rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800 flex-col"
      data-testid="flowbite-card"
    >
      <div className="flex h-full flex-col justify-center gap-6 p-6">
        <h3 className="text-xl font-bold dark:text-white">
          <Trans i18nKey={`${I18N_NS}.title`} />
        </h3>

        {/* One row from `lg` up: folder, config, then the action at the end.
            Bottom-aligned so the button lines up with the inputs, not with
            their labels. */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] items-end gap-4">
          <FormInputFileSelect
            id="docRegexSourceFolder"
            name="docRegexSourceFolder"
            label={<Trans i18nKey={`${I18N_NS}.sourceFolderLabel`} />}
            onClick={onSelectSourceDirectory}
            selectedItem={sourceDirectory}
            isFileSystemAccessSupported={isFileSystemAccessSupported}
            icon="folder"
          />
          <FormConfigSelect
            id="docRegexConfig"
            label={<Trans i18nKey={`${I18N_NS}.configLabel`} />}
            value={activeConfig?.name ?? ''}
            onChange={handleSelectConfig}
            options={configOptions}
            settingsTitle={t(`${I18N_NS}.configSettingsTitle`)}
            onSettingsClick={() => setIsConfigModalOpen(true)}
          />
          {/* `justify-self-start` keeps the button's own width when it wraps
              under the inputs (between `md` and `lg`). */}
          <div className="justify-self-start flex items-center gap-4 max-sm:w-full">
            {/* Sets the action apart from the config's ⚙ — only while they
                share the line. */}
            <span
              aria-hidden="true"
              className="hidden lg:block w-px h-8 bg-gray-200 dark:bg-gray-600"
            />
            <ButtonProcessing
              type="button"
              onClick={readDocuments}
              isLoading={isProcessing}
              disabled={
                !sourceDirectory || !parser || candidateFiles.length === 0
              }
              // The transparent border makes it exactly as tall as the
              // (bordered) inputs beside it.
              className="border border-transparent whitespace-nowrap"
            >
              {isProcessing
                ? t(`${I18N_NS}.processingButton`, {
                    current: progress.current,
                    total: progress.total,
                  })
                : t(`${I18N_NS}.processButton`)}
            </ButtonProcessing>
          </div>
        </div>
        <div className="-mt-3 text-sm text-gray-600 dark:text-gray-400">
          {!activeConfig ? (
            // Nothing to count files by yet: the config decides which file
            // types are read.
            <>
              💡 <Trans i18nKey={`${I18N_NS}.noConfigHint`} />
            </>
          ) : sourceDirectory ? (
            <>
              💡{' '}
              {t(`${I18N_NS}.candidateFilesHint`, {
                count: candidateFiles.length,
                extensions: fileExtensions.join(', '),
              })}
              {sessionDocuments.length > 0 && unreadFilesCount > 0 && (
                <>
                  {' '}
                  {t(`${I18N_NS}.unreadFilesHint`, { count: unreadFilesCount })}
                </>
              )}
            </>
          ) : (
            <>
              💡 <Trans i18nKey={`${I18N_NS}.noFolderHint`} />
            </>
          )}
        </div>

        {activeConfigIssues.length > 0 && (
          <div className="p-3 rounded-lg border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/30">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              <Trans i18nKey={`${I18N_NS}.invalidConfigMessage`} />
            </p>
            <ul className="mt-2 space-y-0.5">
              {activeConfigIssues.slice(0, 5).map((issue, index) => (
                <li
                  key={index}
                  className="text-xs text-red-700 dark:text-red-300"
                >
                  <code>{issue.path}</code> — {formatDocRegexIssue(t, issue)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {results && visibleDocuments.length > 0 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-gray-700 dark:text-gray-300">
                {t(`${I18N_NS}.documentsReadSummary`, {
                  count: visibleDocuments.length,
                })}
              </span>
              {statusChips.map((status) =>
                results.countByStatus[status] > 0 ? (
                  <button
                    key={status}
                    type="button"
                    onClick={() => handleOpenStatus(status)}
                    title={t(`${I18N_NS}.statusChipTitle`)}
                    className={`px-2 py-0.5 rounded text-xs font-medium cursor-pointer transition-colors ${STATUS_CHIP_CLASSES[status]}`}
                  >
                    {t(`${I18N_NS}.statusChip.${status}`, {
                      count: results.countByStatus[status],
                    })}
                  </button>
                ) : null,
              )}
              <span className="text-gray-400">·</span>
              <span className="text-gray-700 dark:text-gray-300">
                {t(`${I18N_NS}.rowsSummary`, { count: results.rows.length })}
              </span>
              {rowsWithGapsCount > 0 && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                  {t(`${I18N_NS}.rowsWithGapsSummary`, {
                    count: rowsWithGapsCount,
                  })}
                </span>
              )}
              <button
                type="button"
                onClick={() =>
                  setViewerState({ documentIndex: 0, statusFilter: 'ALL' })
                }
                className="ms-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400 cursor-pointer"
              >
                <Trans i18nKey={`${I18N_NS}.openViewerButton`} />
              </button>
            </div>

            {results.rows.length === 0 ? (
              <p className="p-4 text-sm text-gray-600 dark:text-gray-400 rounded-lg bg-gray-50 dark:bg-gray-700/40">
                <Trans i18nKey={`${I18N_NS}.noRowsMessage`} />
              </p>
            ) : (
              <DocRegexResultsTable
                columns={tableColumns}
                rows={tableRows}
                isHeaderCopied={isHeaderCopied}
                onOpenDocument={handleOpenDocument}
                toolbarStart={
                  <>
                    <Checkbox
                      theme="toggle"
                      checked={isFileColumnShown}
                      onChange={setIsFileColumnShown}
                      label={<Trans i18nKey={`${I18N_NS}.fileColumnToggle`} />}
                    />
                    <Checkbox
                      theme="toggle"
                      checked={isIntermediateShown}
                      onChange={setIsIntermediateShown}
                      label={
                        <Trans i18nKey={`${I18N_NS}.intermediateToggle`} />
                      }
                    />
                    <Checkbox
                      theme="toggle"
                      checked={isHeaderCopied}
                      onChange={setIsHeaderCopied}
                      label={<Trans i18nKey={`${I18N_NS}.copyHeaderToggle`} />}
                    />
                  </>
                }
                toolbarActions={
                  <button
                    type="button"
                    onClick={handleDownloadXlsx}
                    disabled={isExporting}
                    className={`${DOC_REGEX_SECONDARY_BUTTON_CLASS_NAME} disabled:cursor-wait`}
                  >
                    <svg
                      className="w-4 h-4"
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"
                      />
                    </svg>
                    {isExporting
                      ? t(`${I18N_NS}.downloadXlsxProgress`)
                      : t(`${I18N_NS}.downloadXlsxButton`)}
                  </button>
                }
              />
            )}
          </div>
        )}
      </div>

      <DocRegexModalConfigSettings
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        onSave={handleConfigsSaved}
      />
      {results && activeConfig && viewerState && (
        <DocRegexDocumentViewer
          isOpen
          onClose={() => setViewerState(null)}
          outcomes={results.outcomes}
          config={activeConfig}
          documentIndex={viewerState.documentIndex}
          onDocumentIndexChange={(documentIndex) =>
            setViewerState((prev) => (prev ? { ...prev, documentIndex } : prev))
          }
          initialStatusFilter={viewerState.statusFilter}
        />
      )}
    </div>
  );
};

export { FormParseDocsByRegexTabItem };
