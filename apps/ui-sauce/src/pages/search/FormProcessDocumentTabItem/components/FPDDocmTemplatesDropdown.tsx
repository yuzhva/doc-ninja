import React from 'react';
import type { FileSystemProcessedResult } from 'toolkit--local/browser';

import { Checkbox, Dropdown } from '../../../../components';
import {
  useDirectoryPicker,
  useFilePicker,
} from '../../../../hooks/use-file-system';
import type { WriteFilesViaDestinationHandle } from '../../../../utils/file-system-processor';
import type { StoredTemplateRecord } from '../../../../utils/template-store';
import {
  DocmTemplatesStore,
  isFileNotFoundError,
  useDocmTemplates,
  useSelectedDocmTemplateId,
  useSharedOutputDirectory,
  useUnavailableDocmTemplateIds,
} from './docm-templates-store';
import type { DocmTemplate } from './docm-templates-store';

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
const verifyOutputDirectoryIsWritable = async (
  handle: WriteFilesViaDestinationHandle,
): Promise<void> => {
  // queryPermission/requestPermission aren't in this project's TS DOM lib.
  const handleWithPermissions = handle as any;
  const currentPermission = await handleWithPermissions.queryPermission({
    mode: 'readwrite',
  });
  const permission =
    currentPermission === 'granted'
      ? currentPermission
      : await handleWithPermissions.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    throw new Error('Немає дозволу на запис у обрану папку.');
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

const describeDirectoryPickError = (error: any): string => {
  if (isPickerAlreadyActiveError(error)) {
    return (
      'Не вдалося обрати папку: попереднє вікно вибору, ймовірно, ще не ' +
      'закрилося (могло зависнути, якщо ви обрали кореневу папку Downloads, ' +
      'Desktop чи Documents). Оберіть підпапку замість кореневої, або ' +
      'перезапустіть застосунок.'
    );
  }
  return `Не вдалося обрати папку: ${error.message || error}`;
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
}: DropdownTriggerArgs) => (
  <button
    type="button"
    onClick={toggle}
    disabled={!hasResults}
    className={`flex items-center justify-center flex-shrink-0 px-3 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg focus:outline-none focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 ${!hasResults ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-100 hover:text-blue-700'}`}
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
    Зберегти .doc*
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

const FPDDocmTemplatesDropdown = ({
  items,
  templateTagFieldIds,
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
  onGenerate: (payload: DocmGeneratePayload) => void;
  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;
  renderTrigger?: (args: DropdownTriggerArgs) => React.ReactNode;
  openDirection?: 'down' | 'up';
}) => {
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
        description: 'Word Templates',
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

  const handleRemoveTemplate = (
    event: React.MouseEvent,
    templateId: string,
  ) => {
    event.stopPropagation();
    // Also clears the selection (in every dropdown instance) if it pointed
    // at this template — see DocmTemplatesStore.removeTemplate.
    DocmTemplatesStore.removeTemplate(templateId);
  };

  const handleGenerateClick = async () => {
    const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
    if (!selectedTemplate) return;

    // Reuse the folder from a previous generate — by any dropdown instance,
    // this session; only prompt the first time anywhere (or after "Змінити
    // папку") so a batch never asks the user to confirm a save location more
    // than once, and every instance agrees on where files are going.
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
        addToast('error', describeDirectoryPickError(error));
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
      await verifyOutputDirectoryIsWritable(outputDirectoryHandle);
    } catch (error: any) {
      outputDirPicker.reset();
      DocmTemplatesStore.setOutputDirectory(null);
      addToast('error', `${error.message || error} Оберіть іншу папку.`);
      return;
    }

    let templateFile: Blob;
    try {
      templateFile = await selectedTemplate.getFileContent(addToast);
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
          ? `Файл шаблону "${selectedTemplate.name}" не знайдено. Оберіть інший шаблон або додайте його ще раз.`
          : `Не вдалося прочитати шаблон "${selectedTemplate.name}": ${error.message || error}`,
      );
      return;
    }

    const jobs = items.map(({ extracted }, index) => ({
      id: String(extracted.position ?? index),
      fileName: buildJobFileName(extracted) || undefined,
      tags: templateTagFieldIds
        .filter((tag) => tag in extracted.extractedFieldById)
        .map((tag) => ({
          tag,
          value: String(extracted.extractedFieldById[tag] ?? ''),
        })),
    }));

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
      templateName: selectedTemplate.name,
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
      addToast('error', describeDirectoryPickError(error));
    }
  };

  return (
    <Dropdown
      panelClassName="w-80 right-0 bg-white dark:bg-gray-800"
      openDirection={openDirection}
      trigger={({ isOpen, toggle }) =>
        renderTrigger({ isOpen, toggle, hasResults })
      }
    >
      <div className="mb-3 flex items-center justify-between">
        <h6 className="text-sm font-medium text-gray-900 dark:text-white">
          Шаблони
        </h6>
        <button
          type="button"
          onClick={templateFilePicker.selectFile}
          disabled={!templateFilePicker.isSupported}
          title="Додати шаблон"
          className="flex items-center justify-center w-6 h-6 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          +
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="py-6 text-xs text-center text-gray-500 dark:text-gray-400">
          Немає шаблонів. Натисніть «+», щоб додати.
        </div>
      ) : (
        <div className="-mx-3 mb-3 divide-y divide-gray-100 dark:divide-gray-700">
          {templates.map((template) => {
            const isSelected = template.id === selectedTemplateId;
            const isUnavailable = unavailableTemplateIds.has(template.id);

            return (
              <button
                key={template.id}
                type="button"
                aria-current={isSelected}
                onClick={() => DocmTemplatesStore.selectTemplate(template.id)}
                title={
                  isUnavailable
                    ? 'Файл шаблону не знайдено на диску — спробуйте ще раз або оберіть інший'
                    : undefined
                }
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium cursor-pointer transition-colors focus:outline-none ${
                  isSelected
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <span
                  className={`truncate flex items-center gap-1.5 ${isUnavailable ? 'text-red-600 dark:text-red-400' : ''}`}
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
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {isSelected && (
                    <svg
                      className="w-5 h-5 text-green-500"
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="2.5"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m4.5 12.75 6 6 9-13.5"
                      />
                    </svg>
                  )}
                  <span
                    role="button"
                    onClick={(e) => handleRemoveTemplate(e, template.id)}
                    title="Видалити шаблон"
                    className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 14 14"
                    >
                      <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
                      />
                    </svg>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Meaningless with a single item — separate vs. merged both produce
          exactly one file, so skip asking and just leave the toggle at its
          default. */}
      {items.length > 1 && (
        <div className="mb-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <Checkbox
            theme="toggle"
            checked={generateSeparateFiles}
            onChange={setGenerateSeparateFiles}
            label="Створювати окремі файли"
          />
        </div>
      )}

      <button
        type="button"
        onClick={handleGenerateClick}
        disabled={!selectedTemplateId || !hasResults}
        className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 cursor-pointer"
      >
        Завантажити .doc*
      </button>

      {sharedOutputDirectory && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="truncate">
            Зберегти в: {sharedOutputDirectory.structure.name}
          </span>
          <button
            type="button"
            onClick={handleChangeOutputDirectory}
            className="shrink-0 text-blue-600 hover:underline dark:text-blue-500 cursor-pointer"
          >
            Змінити
          </button>
        </div>
      )}
    </Dropdown>
  );
};

export { FPDDocmTemplatesDropdown };
export type { DocmGeneratePayload, DocmTemplate };
