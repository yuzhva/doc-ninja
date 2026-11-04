import type { TFunction } from 'i18next';
import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { FileSystemProcessedResult } from 'toolkit--local/browser';

import { Checkbox, ConfirmModal, Dropdown } from '../../../../../components';
import {
  useDirectoryPicker,
  useFilePicker,
} from '../../../../../hooks/use-file-system';
import { DocxTemplateEngine } from '../../../../../utils/docx-template-engine';
import { FileSystemBridge } from '../../../../../utils/file-system-bridge';
import type { WriteFilesViaDestinationHandle } from '../../../../../utils/file-system-processor';
import type { StoredTemplateRecord } from '../../../../../utils/template-store';
import {
  DocmTemplatesStore,
  TemplatePermissionDeniedError,
  isFileNotFoundError,
  useDocmTemplates,
  useSelectedDocmTemplateId,
  useSharedOutputDirectory,
  useUnavailableDocmTemplateIds,
} from './docm-templates-store';
import type { DocmTemplate } from './docm-templates-store';

const I18N_NS = 'page.search.component.fpdDocmTemplatesDropdown';

interface DocmGeneratePayload {
  // Already-resolved bytes, not a lazy DocmTemplate — the read (and its
  // failure modes: missing file, denied permission) happens in
  // handleGenerateClick, right next to the template list state it may need
  // to flag as unavailable.
  templateFile: Blob;
  templateName: string;
  jobs: {
    id: string;
    fileName?: string;
    tags: { tag: string; value: string }[];
  }[];
  layout:
    | { mode: 'separate' }
    | { mode: 'merged'; jobBreak: 'page'; fileName?: string };
  // Files are written straight into this folder once generated — no per-file
  // save dialog, same "pick the folder once" pattern as FormConvertSpreadsheetToStatic.
  outputDirectoryHandle: WriteFilesViaDestinationHandle;
}

const createTemplateId = () =>
  `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// "01.05.2026 №123.docx" -> "01.05.2026 №123" (drop the source document's
// own extension so it doesn't collide with the generated output's).
const buildJobFileName = (extracted: any): string => {
  const originalFileName = String(extracted.foundInDocument ?? '').replace(
    /\.[^./\\]+$/,
    '',
  );
  const matchedText = String(extracted.matchedText ?? '');
  return [originalFileName, matchedText].filter(Boolean).join(' - ');
};

// Some folders (e.g. the root of macOS's Downloads) can be *picked*
// successfully but then refuse write access — verify up front, before
// spending time generating anything, so that failure surfaces as one clear
// message instead of a confusing error deep inside the write loop.
//
// This is also where a folder remembered across restarts (see
// docm-templates-store) earns its keep: the click that gets here is the user
// gesture Chromium requires to re-grant the permission it drops on every
// restart, so a returning user confirms one prompt at most instead of
// walking the folder tree again. The existence check right after covers the
// other half of that bargain — a folder remembered long enough can be gone
// by the time it's used again, and permission says nothing about that.
const verifyOutputDirectoryIsWritable = async (
  handle: WriteFilesViaDestinationHandle,
  t: TFunction,
): Promise<void> => {
  const hasPermission = await FileSystemBridge.ensurePermission(
    handle,
    'readwrite',
  );
  if (!hasPermission) {
    throw new Error(t(`${I18N_NS}.noWritePermissionError`));
  }

  const isReachable = await FileSystemBridge.isDirectoryReachable(handle);
  if (!isReachable) {
    throw new Error(
      t(`${I18N_NS}.outputFolderMissingError`, { name: handle.name }),
    );
  }
};

// Chromium blocks showDirectoryPicker({mode:'readwrite'}) on a handful of
// sensitive folders (home dir, Desktop, Documents, Downloads *roots*) and
// normally shows its own "choose another folder" prompt for it. Inside
// Electron's window that prompt currently has nowhere to render, so the
// call just hangs — the *next* click's picker call then fails fast with
// this exact "already active" message, since only one can be open at a
// time. Give that specific, recognizable failure an actionable message
// instead of the raw technical one.
const isPickerAlreadyActiveError = (error: any): boolean =>
  error?.name === 'NotAllowedError' &&
  /already active/i.test(String(error?.message ?? ''));

const describeDirectoryPickError = (error: any, t: TFunction): string => {
  if (isPickerAlreadyActiveError(error)) {
    return t(`${I18N_NS}.pickerAlreadyActiveError`);
  }
  return t(`${I18N_NS}.pickDirectoryFailedError`, {
    message: error.message || error,
  });
};

interface DropdownTriggerArgs {
  isOpen: boolean;
  toggle: () => void;
  hasResults: boolean;
}

const defaultRenderTrigger = ({
  isOpen,
  toggle,
  hasResults,
}: DropdownTriggerArgs) => {
  const dynamicClassName = !hasResults
    ? 'opacity-50 cursor-not-allowed'
    : 'cursor-pointer hover:bg-gray-100 hover:text-blue-700';

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!hasResults}
      className={`flex items-center justify-center flex-shrink-0 px-3 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg focus:outline-none focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 ${dynamicClassName}`}
    >
      <svg
        className="w-4 h-4 mr-2"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth="2"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10 3v4a1 1 0 0 1-1 1H5m4 8h6m-6-4h6m4-8v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1Z"
        />
      </svg>
      <Trans i18nKey={`${I18N_NS}.saveTriggerLabel`} />
      <svg
        className={`-mr-1 ml-1.5 w-5 h-5 transition-transform duration-200 ${
          isOpen ? 'rotate-180' : ''
        }`}
        fill="currentColor"
        viewBox="0 0 20 20"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          clipRule="evenodd"
          fillRule="evenodd"
          d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
        />
      </svg>
    </button>
  );
};

const FPDDocmTemplatesDropdown = ({
  items,
  templateTagFieldIds,
  primaryFieldId,
  onGenerate,
  addToast,
  renderTrigger = defaultRenderTrigger,
  openDirection = 'down',
}: {
  // Already-flattened extracted items to build jobs from — the whole table's
  // filtered results, or a single row's item, depending on where this is rendered.
  items: { extracted: any }[];
  // Schema-defined field ids only (see getExtractedFieldOutputs.allFieldIds)
  // — excludes the BE's structural search fields (searchQuery, position,
  // ...), which were never meant to be filled into a document template.
  templateTagFieldIds: string[];
  // The field whose text a row displays — what the built-in "no template"
  // document is filled with, so its output matches what's on screen.
  primaryFieldId: string | null;
  onGenerate: (payload: DocmGeneratePayload) => void;
  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;
  renderTrigger?: (args: DropdownTriggerArgs) => React.ReactNode;
  openDirection?: 'down' | 'up';
}) => {
  const { t } = useTranslation();
  const hasResults = items.length > 0;
  // All shared across every dropdown instance on the page (one per results
  // row, plus the toolbar one) — see docm-templates-store. There's exactly
  // one set of templates to choose from everywhere they're rendered, so the
  // selected template and any "failed to read last time" flags are single,
  // page-wide facts too, not per-instance UI state.
  const templates = useDocmTemplates();
  const selectedTemplateId = useSelectedDocmTemplateId();
  const unavailableTemplateIds = useUnavailableDocmTemplateIds();
  const sharedOutputDirectory = useSharedOutputDirectory();
  const [generateSeparateFiles, setGenerateSeparateFiles] =
    React.useState(false);

  const templateFilePicker = useFilePicker({
    types: [
      {
        description: t(`${I18N_NS}.wordTemplatesFileTypeDescription`),
        accept: {
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            ['.docx'],
          'application/vnd.ms-word.document.macroEnabled.12': ['.docm'],
        },
      },
    ],
    excludeAcceptAllOption: true,
  });

  const outputDirPicker = useDirectoryPicker({ mode: 'readwrite' });

  // useFilePicker only sets processedDir on a successful pick (cancel leaves
  // it untouched), so tracking the last-seen object identity is enough to
  // append exactly once per genuine pick, never on cancel or re-render.
  const lastAddedFileRef = React.useRef<FileSystemProcessedResult | null>(null);

  React.useEffect(() => {
    const picked = templateFilePicker.processedDir;
    if (!picked || picked === lastAddedFileRef.current) return;
    lastAddedFileRef.current = picked;

    const path = picked.structure.path;
    const existingTemplate = templates.find((t) => t.path === path);
    if (existingTemplate) {
      DocmTemplatesStore.selectTemplate(existingTemplate.id);
      return;
    }

    const id = createTemplateId();
    // FileSystemBridge.pickFile always returns a real handle now (Electron
    // included), so a template's record only ever carries browserFileHandle
    // — DocmTemplatesStore.addTemplate both adds it to the shared list
    // (visible to every dropdown instance immediately) and warms its cached
    // copy in IndexedDB, so there's nothing left for this component to do
    // with the bytes itself.
    const baseRecord: Omit<StoredTemplateRecord, 'cachedContent'> = {
      id,
      name: picked.structure.name,
      path,
      addedAt: Date.now(),
      browserFileHandle: picked.browserFSAPIhandle,
    };

    DocmTemplatesStore.addTemplate(baseRecord);
    DocmTemplatesStore.selectTemplate(id);
  }, [templateFilePicker.processedDir, templates]);

  // The template waiting for "Remove?" to be confirmed.
  const [pendingRemovalTemplate, setPendingRemovalTemplate] =
    React.useState<DocmTemplate | null>(null);
  const closeRemovalConfirm = React.useCallback(
    () => setPendingRemovalTemplate(null),
    [],
  );

  const handleRemoveTemplate = (
    event: React.MouseEvent,
    template: DocmTemplate,
  ) => {
    event.stopPropagation();
    setPendingRemovalTemplate(template);
  };

  const confirmRemoveTemplate = () => {
    // Also clears the selection (in every dropdown instance) if it pointed
    // at this template — see DocmTemplatesStore.removeTemplate.
    if (pendingRemovalTemplate) {
      DocmTemplatesStore.removeTemplate(pendingRemovalTemplate.id);
    }
    setPendingRemovalTemplate(null);
  };

  const handleGenerateClick = async () => {
    // No selection means the built-in plain-text document rather than a
    // blocked action — a template is an enhancement, not a prerequisite.
    const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
    if (!hasResults) return;

    // Reuse the folder from a previous generate — by any dropdown instance,
    // and (since it's remembered in IndexedDB) any previous run of the app
    // too; only show the picker when there's genuinely no folder to reuse, or
    // after "Змінити папку", so a batch never asks the user to confirm a save
    // location more than once and every instance agrees on where files go.
    const outputDirectory =
      sharedOutputDirectory ?? (await outputDirPicker.selectDirectory());
    const outputDirectoryHandle = outputDirectory?.browserFSAPIhandle;
    if (!outputDirectoryHandle) {
      // selectDirectory() never rejects (see useDirectoryPicker), so a null
      // result here means either the user cancelled (no error — stay quiet)
      // or picking itself genuinely failed, which IS worth surfacing.
      // Reading errorRef (not .error) matters here: .error is whatever this
      // closure's outputDirPicker was at the last render *before* this
      // click, so it'd show last attempt's failure, one click behind.
      const error = outputDirPicker.errorRef.current;
      if (error) {
        addToast('error', describeDirectoryPickError(error, t));
      }
      return;
    }
    // Only a freshly-picked directory needs sharing — reusing the already-
    // shared one (the sharedOutputDirectory ?? branch above short-circuited)
    // means every instance already agrees on it.
    if (outputDirectory !== sharedOutputDirectory) {
      DocmTemplatesStore.setOutputDirectory(outputDirectory);
    }

    // Some folders (e.g. the root of macOS's Downloads) can be picked
    // successfully but then refuse write access. Verifying up front — and
    // dropping the cached pick on failure (in every instance, not just this
    // one) — means a bad folder never gets stuck reused forever; the next
    // click, anywhere, always re-prompts.
    try {
      await verifyOutputDirectoryIsWritable(outputDirectoryHandle, t);
    } catch (error: any) {
      outputDirPicker.reset();
      DocmTemplatesStore.setOutputDirectory(null);
      addToast(
        'error',
        `${error.message || error} ${t(`${I18N_NS}.chooseAnotherFolderSuffix`)}`,
      );
      return;
    }

    let templateFile: Blob;
    if (selectedTemplate) {
      try {
        const content = await selectedTemplate.getFileContent();
        if (content.usedCachedFallback) {
          addToast(
            'warning',
            t(`${I18N_NS}.usedCachedTemplateWarning`, {
              name: selectedTemplate.name,
            }),
          );
        }
        templateFile = content.blob;
        // Reading succeeded — clear a stale "unavailable" flag from an
        // earlier failed attempt (the file may have come back), in every
        // dropdown instance showing this template, not just this one.
        DocmTemplatesStore.markTemplateUnavailable(selectedTemplate.id, false);
      } catch (error: any) {
        console.error('Failed to read docm template', error);
        DocmTemplatesStore.markTemplateUnavailable(selectedTemplate.id, true);
        addToast(
          'error',
          isFileNotFoundError(error)
            ? t(`${I18N_NS}.templateNotFoundError`, {
                name: selectedTemplate.name,
              })
            : error instanceof TemplatePermissionDeniedError
              ? t(`${I18N_NS}.templatePermissionDeniedError`, {
                  name: selectedTemplate.name,
                })
              : t(`${I18N_NS}.templateReadFailedError`, {
                  name: selectedTemplate.name,
                  message: error.message || error,
                }),
        );
        return;
      }
    } else {
      templateFile = await DocxTemplateEngine.createPlainTextTemplate();
    }

    const jobs = items.map(({ extracted }, index) => {
      const tags = templateTagFieldIds
        .filter((tag) => tag in extracted.extractedFieldById)
        .map((tag) => ({
          tag,
          value: String(extracted.extractedFieldById[tag] ?? ''),
        }));

      // The built-in template references one tag of its own, supplied here
      // rather than taken from the schema — so "no template" produces the
      // row's own text no matter how the parser config is set up.
      if (!selectedTemplate) {
        tags.push({
          tag: DocxTemplateEngine.PLAIN_TEXT_TAG,
          value: String(
            (primaryFieldId &&
              extracted.extractedFieldById?.[primaryFieldId]) ??
              '',
          ),
        });
      }

      return {
        id: String(extracted.position ?? index),
        fileName: buildJobFileName(extracted) || undefined,
        tags,
      };
    });

    // Merged output is named after the first item's own "doc - matchedText"
    // name, with a count suffix when it actually represents more than one.
    const firstItemFileName = buildJobFileName(items[0].extracted);
    const firstItemMatchedText = items[0].extracted.matchedText;
    const mergedFileName =
      items.length === 1
        ? firstItemFileName
        : `${firstItemMatchedText} - (${items.length})`;

    const layout: DocmGeneratePayload['layout'] = generateSeparateFiles
      ? { mode: 'separate' }
      : { mode: 'merged', jobBreak: 'page', fileName: mergedFileName };

    onGenerate({
      templateFile,
      // Only used to decide the output extension (.docm vs .docx) and as a
      // last-resort base name, so the built-in template names itself .docx.
      templateName: selectedTemplate?.name ?? 'DocNinja.docx',
      jobs,
      layout,
      outputDirectoryHandle,
    });
  };

  // "Змінити" — explicitly re-prompts even though a folder is already
  // shared, so this always goes through the picker rather than reusing
  // sharedOutputDirectory the way handleGenerateClick's first-pick path does.
  const handleChangeOutputDirectory = async () => {
    const picked = await outputDirPicker.selectDirectory();
    if (picked) {
      DocmTemplatesStore.setOutputDirectory(picked);
      return;
    }
    const error = outputDirPicker.errorRef.current;
    if (error) {
      addToast('error', describeDirectoryPickError(error, t));
    }
  };

  return (
    <>
      <Dropdown
        panelClassName="w-80 right-0 bg-white dark:bg-gray-800"
        openDirection={openDirection}
        trigger={({ isOpen, toggle }) =>
          renderTrigger({ isOpen, toggle, hasResults })
        }
      >
        <div className="mb-3 flex items-center justify-between">
          <h6 className="text-sm font-medium text-gray-900 dark:text-white">
            <Trans i18nKey={`${I18N_NS}.templatesHeading`} />
          </h6>
          <button
            type="button"
            onClick={templateFilePicker.selectFile}
            disabled={!templateFilePicker.isSupported}
            title={t(`${I18N_NS}.addTemplateTitle`)}
            className="flex items-center justify-center w-6 h-6 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            +
          </button>
        </div>

        <div className="-mx-3 mb-3 divide-y divide-gray-100 dark:divide-gray-700">
          {/* Always first, and selected until a template is picked — generating
            without one is a real choice, not an empty state. */}
          <div
            onClick={() => DocmTemplatesStore.selectTemplate(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
              !selectedTemplateId
                ? 'bg-blue-50 dark:bg-blue-900/30'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <input
              id="docmTemplate-none"
              type="radio"
              name="docmTemplate"
              checked={!selectedTemplateId}
              onChange={() => DocmTemplatesStore.selectTemplate(null)}
              className="w-4 h-4 shrink-0 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 dark:bg-gray-700 dark:border-gray-600"
            />
            <label
              htmlFor="docmTemplate-none"
              className={`w-full select-none text-sm font-medium cursor-pointer ${
                !selectedTemplateId
                  ? 'text-blue-700 dark:text-blue-400'
                  : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              <Trans i18nKey={`${I18N_NS}.noTemplateOptionLabel`} />
              <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                <Trans i18nKey={`${I18N_NS}.noTemplateOptionHint`} />
              </span>
            </label>
          </div>

          {templates.map((template) => {
            const isSelected = template.id === selectedTemplateId;
            const isUnavailable = unavailableTemplateIds.has(template.id);
            const inputId = `docmTemplate-${template.id}`;

            return (
              <div
                key={template.id}
                onClick={() => DocmTemplatesStore.selectTemplate(template.id)}
                title={
                  isUnavailable
                    ? t(`${I18N_NS}.templateUnavailableTitle`)
                    : undefined
                }
                className={`w-full flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/30'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <input
                  id={inputId}
                  type="radio"
                  name="docmTemplate"
                  checked={isSelected}
                  onChange={() =>
                    DocmTemplatesStore.selectTemplate(template.id)
                  }
                  className="w-4 h-4 shrink-0 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 dark:bg-gray-700 dark:border-gray-600"
                />
                <label
                  htmlFor={inputId}
                  className={`w-full truncate select-none text-sm font-medium cursor-pointer flex items-center gap-1.5 ${
                    isUnavailable
                      ? 'text-red-600 dark:text-red-400'
                      : isSelected
                        ? 'text-blue-700 dark:text-blue-400'
                        : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {isUnavailable && (
                    <svg
                      className="w-3.5 h-3.5 shrink-0"
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                      />
                    </svg>
                  )}
                  <span className="truncate">{template.name}</span>
                </label>
                <button
                  type="button"
                  aria-label={t(`${I18N_NS}.removeTemplateAriaLabel`)}
                  onClick={(e) => handleRemoveTemplate(e, template)}
                  className="p-1 shrink-0 text-gray-400 rounded-lg cursor-pointer hover:text-red-600 hover:bg-red-50 dark:text-gray-500 dark:hover:text-red-400 dark:hover:bg-red-900/30 focus:outline-none"
                >
                  <svg
                    className="w-4 h-4"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {/* Meaningless with a single item — separate vs. merged both produce
          exactly one file, so skip asking and just leave the toggle at its
          default. */}
        {items.length > 1 && (
          <div className="mb-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <Checkbox
              theme="toggle"
              checked={generateSeparateFiles}
              onChange={setGenerateSeparateFiles}
              label={
                <Trans i18nKey={`${I18N_NS}.generateSeparateFilesLabel`} />
              }
            />
          </div>
        )}

        <button
          type="button"
          onClick={handleGenerateClick}
          disabled={!hasResults}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 cursor-pointer"
        >
          <Trans i18nKey={`${I18N_NS}.generateButton`} />
        </button>

        {sharedOutputDirectory && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="truncate">
              <Trans
                i18nKey={`${I18N_NS}.savedToLabel`}
                values={{ name: sharedOutputDirectory.structure.name }}
              />
            </span>
            <button
              type="button"
              onClick={handleChangeOutputDirectory}
              className="shrink-0 text-blue-600 hover:underline dark:text-blue-500 cursor-pointer"
            >
              <Trans i18nKey={`${I18N_NS}.changeFolderButton`} />
            </button>
          </div>
        )}
      </Dropdown>

      {/* Outside the panel: clicking the modal closes the panel, and that
        must not take the modal down with it. */}
      <ConfirmModal
        isOpen={!!pendingRemovalTemplate}
        title={t(`${I18N_NS}.removeTemplateConfirmTitle`)}
        message={
          <Trans
            i18nKey={`${I18N_NS}.removeTemplateConfirmMessage`}
            values={{ name: pendingRemovalTemplate?.name ?? '' }}
            components={{
              strong: (
                <strong className="font-semibold text-gray-900 dark:text-white" />
              ),
            }}
          />
        }
        confirmLabel={t(`${I18N_NS}.removeTemplateConfirmButton`)}
        onConfirm={confirmRemoveTemplate}
        onCancel={closeRemovalConfirm}
      />
    </>
  );
};

export { FPDDocmTemplatesDropdown };
export type { DocmGeneratePayload, DocmTemplate };
