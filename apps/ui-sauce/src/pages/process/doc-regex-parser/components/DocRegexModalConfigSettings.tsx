import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Modal, Tabs } from '../../../../components';
import { FileSystemBridge } from '../../../../utils/file-system-bridge';
import { DocRegexParser } from '../doc-regex-parser.engine';
import { prepareConfigsForForm } from '../doc-regex-parser.form-keys';
import { formatDocRegexIssue } from '../doc-regex-parser.issues';
import {
  readStoredDocRegexConfigs,
  writeStoredDocRegexConfigs,
} from '../doc-regex-parser.store';
import type { DocRegexConfig } from '../doc-regex-parser.types';
import { DocRegexConfigForm } from './DocRegexConfigForm';

const I18N_NS = 'page.process.component.docRegexModalConfigSettings';

const EXPORT_FILE_NAME = 'doc-ninja-doc-regex-parser-config.json';

const stringifyConfigs = (configs: unknown) => JSON.stringify(configs, null, 2);

// Tabs mounts only the visible tab, so "the Form tab was just opened" is
// simply "this mounted".
const OnMount = ({ onMount }: { onMount: () => void }) => {
  React.useEffect(() => {
    onMount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const secondaryButtonClassName =
  'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:outline-none focus:ring-gray-200 focus:text-blue-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 cursor-pointer transition-colors';

const DocRegexModalConfigSettings = ({
  isOpen,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (configs: DocRegexConfig[]) => void;
}) => {
  const { t } = useTranslation();
  // The JSON text is the source of truth (it's what gets validated and
  // saved); the Form tab edits a parsed copy and writes back into it.
  const [configJson, setConfigJson] = React.useState('');
  const [formConfigs, setFormConfigs] = React.useState<DocRegexConfig[]>([]);
  const configJsonRef = React.useRef(configJson);
  configJsonRef.current = configJson;
  // Set by typing in the JSON tab; tells the Form tab it has to rebuild.
  const isJsonEditedRef = React.useRef(false);

  React.useEffect(() => {
    if (!isOpen) return;
    const stored = readStoredDocRegexConfigs();
    setConfigJson(stringifyConfigs(stored));
    setFormConfigs(prepareConfigsForForm(stored));
    isJsonEditedRef.current = false;
  }, [isOpen]);

  const commitFormConfigs = (next: DocRegexConfig[]) => {
    setFormConfigs(next);
    setConfigJson(stringifyConfigs(next));
  };

  // JSON -> Form when the Form tab is opened, and only after the JSON was
  // actually edited: rebuilding mints new form keys, which remounts every
  // card (and loses which ones were collapsed).
  const syncFormFromJson = () => {
    if (!isJsonEditedRef.current) return;
    try {
      const parsed = JSON.parse(configJsonRef.current);
      if (Array.isArray(parsed)) {
        setFormConfigs(prepareConfigsForForm(parsed));
        isJsonEditedRef.current = false;
      }
    } catch {
      // Left as is until the JSON is valid again — the Form tab lists the
      // error instead of the form meanwhile.
    }
  };

  const validation = React.useMemo(() => {
    try {
      const parsed = JSON.parse(configJson);
      return {
        parsedConfigs: parsed as DocRegexConfig[],
        jsonError: null,
        issues: DocRegexParser.validateConfigs(parsed),
      };
    } catch (error: any) {
      return {
        parsedConfigs: null,
        jsonError: error?.message ?? String(error),
        issues: [],
      };
    }
  }, [configJson]);

  const problemsCount =
    validation.issues.length + (validation.jsonError ? 1 : 0);
  const canSave = problemsCount === 0 && validation.parsedConfigs !== null;

  const handleSaveClick = () => {
    if (!canSave || !validation.parsedConfigs) return;
    writeStoredDocRegexConfigs(validation.parsedConfigs);
    onSave(validation.parsedConfigs);
  };

  /**
   * An exported list replaces the editor's content; a single config (handy
   * for passing one document type to a colleague) is merged in instead —
   * replacing the config of the same name, if there is one.
   */
  const handleImportJson = async () => {
    try {
      const result = await FileSystemBridge.pickFile({
        types: [
          {
            description: t(`${I18N_NS}.jsonFileTypeDescription`),
            accept: { 'application/json': ['.json'] },
          },
        ],
        excludeAcceptAllOption: true,
        multiple: false,
      });
      if (!result) return;

      // pickFile always hands back the real handle (Electron included).
      const file = await result.browserFSAPIhandle.getFile();
      const imported = JSON.parse(await file.text());

      let next: unknown[];
      if (Array.isArray(imported)) {
        next = imported;
      } else if (imported && typeof imported === 'object') {
        const current = validation.parsedConfigs ?? formConfigs;
        const sameNameIndex = current.findIndex(
          (config) => config?.name === imported.name,
        );
        next =
          sameNameIndex === -1
            ? [...current, imported]
            : current.map((config, index) =>
                index === sameNameIndex ? imported : config,
              );
      } else {
        throw new Error('Unsupported JSON shape');
      }

      setConfigJson(stringifyConfigs(next));
      setFormConfigs(prepareConfigsForForm(next));
    } catch (e) {
      console.error('Import failed', e);
      alert(t(`${I18N_NS}.importErrorAlert`));
    }
  };

  const handleExportJson = async () => {
    if (validation.jsonError) {
      alert(t(`${I18N_NS}.exportErrorAlert`));
      return;
    }

    const blob = new Blob([configJson], { type: 'application/json' });
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
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('Export failed', err);
        alert(t(`${I18N_NS}.exportErrorAlert`));
      }
    }
  };

  const problemsList = (
    <ul className="space-y-1">
      {validation.jsonError && (
        <li className="text-xs text-red-600 dark:text-red-400">
          {t(`${I18N_NS}.invalidJsonMessage`, {
            message: validation.jsonError,
            interpolation: { escapeValue: false },
          })}
        </li>
      )}
      {validation.issues.map((issue, index) => (
        <li key={index} className="text-xs text-red-600 dark:text-red-400">
          <code className="text-gray-600 dark:text-gray-400">
            {issue.path || '/'}
          </code>{' '}
          — {formatDocRegexIssue(t, issue)}
        </li>
      ))}
    </ul>
  );

  return (
    <Modal
      title={<Trans i18nKey={`${I18N_NS}.title`} />}
      isOpen={isOpen}
      onBtnCloseClick={onClose}
      maxWidthClassName="max-w-5xl"
      bodyClassName=""
      footer={
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleImportJson}
              className={secondaryButtonClassName}
            >
              <svg
                className="w-4 h-4"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 15v2a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-2M12 4v12m0-12 4 4m-4-4L8 8"
                />
              </svg>
              <Trans i18nKey={`${I18N_NS}.importJsonButton`} />
            </button>
            <button
              type="button"
              onClick={handleExportJson}
              className={secondaryButtonClassName}
            >
              <svg
                className="w-4 h-4"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 15v2a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-2m-8 1V4m0 12-4-4m4 4 4-4"
                />
              </svg>
              <Trans i18nKey={`${I18N_NS}.exportJsonButton`} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            {problemsCount > 0 && (
              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                {t(`${I18N_NS}.problemsCount`, { count: problemsCount })}
              </span>
            )}
            <button
              onClick={handleSaveClick}
              type="button"
              disabled={!canSave}
              title={canSave ? undefined : t(`${I18N_NS}.saveDisabledTitle`)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg enabled:hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:enabled:hover:bg-blue-700 dark:focus:ring-blue-800 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            >
              <svg
                className="w-4 h-4"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth={2}
                  d="M11 16h2m6.707-9.293-2.414-2.414A1 1 0 0 0 16.586 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7.414a1 1 0 0 0-.293-.707ZM16 20v-6a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v6h8ZM9 4h6v3a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V4Z"
                />
              </svg>
              <Trans i18nKey={`${I18N_NS}.saveButton`} />
            </button>
          </div>
        </>
      }
    >
      <Tabs>
        <Tabs.Item title={<Trans i18nKey={`${I18N_NS}.formTabTitle`} />}>
          <OnMount onMount={syncFormFromJson} />
          {validation.jsonError ? (
            <div className="p-4 space-y-2">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <Trans i18nKey={`${I18N_NS}.formUnavailableMessage`} />
              </p>
              {problemsList}
            </div>
          ) : (
            <DocRegexConfigForm
              configs={formConfigs}
              issues={validation.issues}
              onChange={commitFormConfigs}
            />
          )}
        </Tabs.Item>
        <Tabs.Item title="JSON">
          <div className="p-4 space-y-3">
            <label
              htmlFor="docRegexConfigJson"
              className="block text-sm font-medium text-gray-900 dark:text-white"
            >
              <Trans i18nKey={`${I18N_NS}.jsonConfigLabel`} />
            </label>
            <textarea
              id="docRegexConfigJson"
              value={configJson}
              onChange={(e) => {
                setConfigJson(e.target.value);
                isJsonEditedRef.current = true;
              }}
              spellCheck={false}
              className="block p-2.5 w-full h-[28rem] text-xs font-mono text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 resize-y"
              placeholder="[]"
            />
            {problemsCount > 0 && problemsList}
          </div>
        </Tabs.Item>
      </Tabs>
    </Modal>
  );
};

export { DocRegexModalConfigSettings };
