import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ConfirmModal, Dropdown } from '../../../components';
import { FileSystemBridge } from '../../../utils/file-system-bridge';
import {
  createDefaultChunkSpreadsheetConfig,
  mergeImportedChunkSpreadsheetConfigs,
  parseImportedChunkSpreadsheetConfigs,
} from './chunk-spreadsheet.store';
import type { ChunkSpreadsheetConfig } from './chunk-spreadsheet.store';

const I18N_NS = 'page.process.component.chunkSpreadsheetConfigsDropdown';

const EXPORT_FILE_NAME = 'doc-ninja-chunk-spreadsheet-config.json';

const ICON_BUTTON_CLASS_NAME =
  'p-1 shrink-0 text-gray-400 rounded-lg cursor-pointer hover:text-gray-900 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-white dark:hover:bg-gray-700 focus:outline-none';

const SECONDARY_BUTTON_CLASS_NAME =
  'flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 whitespace-nowrap text-xs font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:outline-none focus:ring-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 dark:focus:ring-gray-700 cursor-pointer transition-colors';

const ICON_PATHS = {
  adjustments:
    'M20 6H10m0 0a2 2 0 1 0-4 0m4 0a2 2 0 1 1-4 0m0 0H4m16 6h-2m0 0a2 2 0 1 0-4 0m4 0a2 2 0 1 1-4 0m0 0H4m16 6H10m0 0a2 2 0 1 0-4 0m4 0a2 2 0 1 1-4 0m0 0H4',
  import: 'M4 15v2a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-2M12 4v12m0-12 4 4m-4-4L8 8',
  export: 'M4 15v2a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-2m-8 1V4m0 12-4-4m4 4 4-4',
  rename:
    'm14.304 4.844 2.852 2.852M7 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4.5m2.409-9.91a2.017 2.017 0 0 1 0 2.853l-6.844 6.844L8 14l.713-3.565 6.844-6.844a2.015 2.015 0 0 1 2.852 0Z',
  apply: 'M5 11.917 9.724 16.5 19 7.5',
  remove: 'M6 18 18 6M6 6l12 12',
};

const Icon = ({
  name,
  className = 'w-4 h-4',
}: {
  name: keyof typeof ICON_PATHS;
  className?: string;
}) => (
  <svg
    className={className}
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={ICON_PATHS[name]} />
  </svg>
);

/**
 * Picks the config the slicing form edits, and manages the list: add,
 * rename, remove, import from / download as JSON. The same look as the
 * templates dropdown of the search results (FPDDocmTemplatesDropdown).
 */
const ChunkSpreadsheetConfigsDropdown = ({
  configs,
  selectedIndex,
  onConfigsChange,
  onSelectedIndexChange,
}: {
  configs: ChunkSpreadsheetConfig[];
  selectedIndex: number;
  onConfigsChange: (configs: ChunkSpreadsheetConfig[]) => void;
  onSelectedIndexChange: (index: number) => void;
}) => {
  const { t } = useTranslation();
  // The config whose name is being edited, and the name typed so far.
  const [renaming, setRenaming] = React.useState<{
    index: number;
    name: string;
  } | null>(null);
  // The config waiting for "Delete?" to be confirmed.
  const [pendingRemovalIndex, setPendingRemovalIndex] = React.useState<
    number | null
  >(null);

  const displayName = (config: ChunkSpreadsheetConfig) =>
    config.name || t(`${I18N_NS}.untitledConfigName`);
  const nameClassName = (config: ChunkSpreadsheetConfig) =>
    config.name ? '' : 'italic';

  const handleAddConfig = () => {
    onConfigsChange([...configs, createDefaultChunkSpreadsheetConfig()]);
    onSelectedIndexChange(configs.length);
    setRenaming({ index: configs.length, name: '' });
  };

  const applyRename = () => {
    if (!renaming) return;
    onConfigsChange(
      configs.map((config, index) =>
        index === renaming.index
          ? { ...config, name: renaming.name.trim() }
          : config,
      ),
    );
    setRenaming(null);
  };

  const handleRemoveConfig = (event: React.MouseEvent, index: number) => {
    event.stopPropagation();
    setPendingRemovalIndex(index);
  };

  const removeConfig = (index: number) => {
    const next = configs.filter((_, i) => i !== index);
    // The form always has a config to edit.
    onConfigsChange(
      next.length ? next : [createDefaultChunkSpreadsheetConfig()],
    );
    // The selection stays on its config; when that's the one removed, the
    // next one (or the previous, if it was last) takes its place.
    if (index < selectedIndex || selectedIndex === next.length) {
      onSelectedIndexChange(Math.max(selectedIndex - 1, 0));
    }
    setRenaming(null);
  };

  const handleImport = async () => {
    try {
      const picked = await FileSystemBridge.pickFile({
        types: [
          {
            description: t(`${I18N_NS}.jsonFileTypeDescription`),
            accept: { 'application/json': ['.json'] },
          },
        ],
        excludeAcceptAllOption: true,
      });
      if (!picked) return;

      const file = await picked.browserFSAPIhandle.getFile();
      const imported = parseImportedChunkSpreadsheetConfigs(
        JSON.parse(await file.text()),
      );
      const next = mergeImportedChunkSpreadsheetConfigs(configs, imported);
      onConfigsChange(next);
      onSelectedIndexChange(next.indexOf(imported[0]));
      setRenaming(null);
    } catch (error) {
      console.error('Import failed', error);
      alert(t(`${I18N_NS}.importErrorAlert`));
    }
  };

  const handleExport = async () => {
    const blob = new Blob([JSON.stringify(configs, null, 2)], {
      type: 'application/json',
    });
    try {
      if ('showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: EXPORT_FILE_NAME,
          types: [
            {
              description: t(`${I18N_NS}.jsonFileTypeDescription`),
              accept: { 'application/json': ['.json'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = EXPORT_FILE_NAME;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error('Export failed', error);
        alert(t(`${I18N_NS}.exportErrorAlert`));
      }
    }
  };

  const selectedConfig = configs[selectedIndex];

  const pendingRemovalConfig =
    pendingRemovalIndex === null ? null : configs[pendingRemovalIndex];
  const closeRemovalConfirm = React.useCallback(
    () => setPendingRemovalIndex(null),
    [],
  );

  return (
    <>
      <Dropdown
        // Wide enough for both JSON buttons side by side, in either language.
        panelClassName="w-96 end-0 bg-white dark:bg-gray-800"
        // A name left half-typed is dropped with the panel, like Escape.
        onOpenChange={(isOpen) => !isOpen && setRenaming(null)}
        trigger={({ isOpen, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            title={t(`${I18N_NS}.triggerTitle`)}
            aria-expanded={isOpen}
            className="flex items-center max-w-72 px-3 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100 hover:text-blue-700 focus:outline-none focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700"
          >
            <Icon name="adjustments" className="w-4 h-4 me-2 shrink-0" />
            <span className={`truncate ${nameClassName(selectedConfig)}`}>
              {displayName(selectedConfig)}
            </span>
            <svg
              className={`-me-1 ms-1.5 w-5 h-5 shrink-0 transition-transform duration-200 ${
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
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h6 className="text-sm font-medium text-gray-900 dark:text-white">
            <Trans i18nKey={`${I18N_NS}.heading`} />
          </h6>
          <button
            type="button"
            onClick={handleAddConfig}
            title={t(`${I18N_NS}.addConfigTitle`)}
            aria-label={t(`${I18N_NS}.addConfigTitle`)}
            className="flex items-center justify-center w-6 h-6 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 cursor-pointer"
          >
            +
          </button>
        </div>

        <div className="-mx-3 divide-y divide-gray-100 dark:divide-gray-700">
          {configs.map((config, index) => {
            const isSelected = index === selectedIndex;
            const rowClassName = `w-full flex items-center gap-2 px-3 py-2 transition-colors ${
              isSelected
                ? 'bg-blue-50 dark:bg-blue-900/30'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700'
            }`;

            if (renaming?.index === index) {
              return (
                <div key={index} className={rowClassName}>
                  <input
                    type="text"
                    autoFocus
                    value={renaming.name}
                    onChange={(e) =>
                      setRenaming({ index, name: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        // Not the slicing form's submit, which this sits in.
                        e.preventDefault();
                        applyRename();
                      }
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    placeholder={t(`${I18N_NS}.untitledConfigName`)}
                    aria-label={t(`${I18N_NS}.configNameLabel`)}
                    className="block w-full min-w-0 px-2 py-1 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
                  />
                  <button
                    type="button"
                    onClick={applyRename}
                    title={t(`${I18N_NS}.applyNameTitle`)}
                    aria-label={t(`${I18N_NS}.applyNameTitle`)}
                    className={`${ICON_BUTTON_CLASS_NAME} text-blue-600 dark:text-blue-500`}
                  >
                    <Icon name="apply" />
                  </button>
                </div>
              );
            }

            const inputId = `chunkSpreadsheetConfig-${index}`;
            return (
              <div
                key={index}
                onClick={() => onSelectedIndexChange(index)}
                className={`${rowClassName} cursor-pointer`}
              >
                <input
                  id={inputId}
                  type="radio"
                  name="chunkSpreadsheetConfig"
                  checked={isSelected}
                  onChange={() => onSelectedIndexChange(index)}
                  className="w-4 h-4 shrink-0 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 dark:bg-gray-700 dark:border-gray-600"
                />
                <label
                  htmlFor={inputId}
                  className={`w-full truncate select-none text-sm font-medium cursor-pointer ${nameClassName(config)} ${
                    isSelected
                      ? 'text-blue-700 dark:text-blue-400'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {displayName(config)}
                </label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenaming({ index, name: config.name });
                  }}
                  title={t(`${I18N_NS}.renameConfigTitle`)}
                  aria-label={t(`${I18N_NS}.renameConfigTitle`)}
                  className={ICON_BUTTON_CLASS_NAME}
                >
                  <Icon name="rename" />
                </button>
                <button
                  type="button"
                  onClick={(e) => handleRemoveConfig(e, index)}
                  title={t(`${I18N_NS}.removeConfigTitle`)}
                  aria-label={t(`${I18N_NS}.removeConfigTitle`)}
                  className="p-1 shrink-0 text-gray-400 rounded-lg cursor-pointer hover:text-red-600 hover:bg-red-50 dark:text-gray-500 dark:hover:text-red-400 dark:hover:bg-red-900/30 focus:outline-none"
                >
                  <Icon name="remove" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleImport}
              className={SECONDARY_BUTTON_CLASS_NAME}
            >
              <Icon name="import" className="w-3.5 h-3.5 shrink-0" />
              <Trans i18nKey={`${I18N_NS}.importButton`} />
            </button>
            <button
              type="button"
              onClick={handleExport}
              className={SECONDARY_BUTTON_CLASS_NAME}
            >
              <Icon name="export" className="w-3.5 h-3.5 shrink-0" />
              <Trans i18nKey={`${I18N_NS}.exportButton`} />
            </button>
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            <Trans i18nKey={`${I18N_NS}.autosaveHint`} />
          </p>
        </div>
      </Dropdown>

      {/* Outside the panel: clicking the modal closes the panel, and that
        must not take the modal down with it. */}
      <ConfirmModal
        isOpen={!!pendingRemovalConfig}
        title={t(`${I18N_NS}.removeConfigConfirmTitle`)}
        message={
          <Trans
            i18nKey={`${I18N_NS}.removeConfigConfirmMessage`}
            values={{
              name: pendingRemovalConfig
                ? displayName(pendingRemovalConfig)
                : '',
            }}
            components={{
              strong: (
                <strong className="font-semibold text-gray-900 dark:text-white" />
              ),
            }}
          />
        }
        confirmLabel={t(`${I18N_NS}.removeConfigConfirmButton`)}
        onConfirm={() => {
          removeConfig(pendingRemovalIndex!);
          setPendingRemovalIndex(null);
        }}
        onCancel={closeRemovalConfirm}
      />
    </>
  );
};

export { ChunkSpreadsheetConfigsDropdown };
