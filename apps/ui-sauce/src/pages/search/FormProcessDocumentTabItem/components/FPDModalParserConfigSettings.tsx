import React from 'react';

import { Checkbox, Modal, Select, Tabs } from '../../../../components';
import { FileSystemBridge } from '../../../../utils/file-system-bridge';

const PARSER_CONFIGS_STORAGE_KEY = 'docNinja_parserConfigs';

const START_FROM_OPTIONS = {
  DOC__START: { label: 'Від початку документа', value: 'DOC__START' },
  DOC__CONTENT: {
    label: 'Від місця, де знайдено збіг',
    value: 'DOC__CONTENT',
    isDefault: true,
  },
  DOC__END: { label: 'Від кінця документа', value: 'DOC__END' },
} as const;

const DIRECTION_OPTIONS = {
  DIRECTION__TOP: {
    label: 'Вгору (до початку документа)',
    value: 'DIRECTION__TOP',
  },
  DIRECTION__BOTTOM: {
    label: 'Вниз (до кінця документа)',
    value: 'DIRECTION__BOTTOM',
    isDefault: true,
  },
} as const;

const UNIT_OPTIONS = {
  PARAGRAPH: { label: 'Абзацами', value: 'PARAGRAPH', isDefault: true },
  LINE: { label: 'Рядками', value: 'LINE' },
} as const;

const getDefaultOptionValue = (
  options: Record<string, { value: string; isDefault?: boolean }>,
) =>
  Object.values(options).find((o) => o.isDefault)?.value ??
  Object.values(options)[0].value;

interface PipelineEntry {
  clientId: number;
  id: string;
  startFrom: string;
  direction: string;
  unit: string;
  limit: string;
  pattern: string;
  stopAt: string;
  consume: boolean;
  outputLabel: string;
  useInTable: boolean;
  useInSpreadsheet: boolean;
  isPrimarySearchResponseText: boolean;
}

interface CompoundEntry {
  clientId: number;
  id: string;
  valueText: string;
  outputLabel: string;
  useInTable: boolean;
  useInSpreadsheet: boolean;
  isPrimarySearchResponseText: boolean;
}

interface ParserConfigEntry {
  clientId: number;
  name: string;
  pipelines: PipelineEntry[];
  compounds: CompoundEntry[];
}

const readStoredParserConfigs = (): unknown[] => {
  let config: unknown[] = [];
  try {
    const saved = localStorage.getItem(PARSER_CONFIGS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        config = parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load parser config from storage', e);
  }

  return config;
};

// Rendered as <Field>/<Checkbox> JSX by pipeline/compound cards below. These
// must live at module scope, not inside FPDModalParserConfigSettings' body —
// a component defined inside another component's render gets a fresh
// function identity every render, which makes React remount it (and drop
// input focus) on every keystroke instead of reusing the existing DOM node.
const useInCheckboxes = (
  entry: {
    useInTable: boolean;
    useInSpreadsheet: boolean;
  },
  onChange: (field: string, value: string | boolean) => void,
) => (
  <div>
    <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
      Використовувати результат у:
    </p>
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Checkbox
        theme="toggle"
        checked={entry.useInTable}
        onChange={(checked) => onChange('useInTable', checked)}
        label="Таблиця результатів"
      />
      <Checkbox
        theme="toggle"
        checked={entry.useInSpreadsheet}
        onChange={(checked) => onChange('useInSpreadsheet', checked)}
        label="Excel"
      />
    </div>
  </div>
);

const inputClassName =
  'block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2 text-sm';

// Select's label prop (unlike Field's) has no `required` flag of its own,
// so callers wrap the label text with this to render the same red asterisk.
const requiredLabel = (text: string) => (
  <>
    {text} <span className="text-red-500">*</span>
  </>
);

const Field = ({
  label,
  className = '',
  required = false,
  children,
}: {
  label: string;
  className?: string;
  required?: boolean;
  children: React.ReactNode;
}) => (
  <div className={className}>
    <label className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">
      {label}
      {required && <span className="text-red-500"> *</span>}
    </label>
    {children}
  </div>
);

const FPDModalParserConfigSettings = ({
  isOpen,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}) => {
  const [configJson, setConfigJson] = React.useState('');
  const [parserConfigEntries, setParserConfigEntries] = React.useState<
    ParserConfigEntry[]
  >([]);
  const [collapsedConfigClientIds, setCollapsedConfigClientIds] =
    React.useState<Set<number>>(new Set());

  // Monotonic counter for client-side ids (configs/pipelines/compounds) — not persisted.
  const nextClientId = React.useRef(0);
  const createClientId = () => nextClientId.current++;

  const buildUseInFlags = (useIn: any) => {
    const list = Array.isArray(useIn) ? useIn : [];

    return {
      useInTable: list.some((u: any) => u?.type === 'TABLE'),
      useInSpreadsheet: list.some((u: any) => u?.type === 'SPREADSHEET'),
    };
  };

  const buildParserConfigEntries = (parsed: unknown): ParserConfigEntry[] => {
    if (!Array.isArray(parsed)) return [];

    return parsed.map((entry) => ({
      clientId: createClientId(),
      name: entry?.name ?? '',
      pipelines: Array.isArray(entry?.config?.pipelines)
        ? entry.config.pipelines.map((p: any) => ({
            clientId: createClientId(),
            id: p?.id ?? '',
            startFrom:
              p?.startFrom || getDefaultOptionValue(START_FROM_OPTIONS),
            direction: p?.direction || getDefaultOptionValue(DIRECTION_OPTIONS),
            unit: p?.unit || getDefaultOptionValue(UNIT_OPTIONS),
            limit:
              p?.limit !== undefined && p?.limit !== null
                ? String(p.limit)
                : '',
            pattern: p?.pattern ?? '',
            stopAt: p?.stopAt ?? '',
            consume: Boolean(p?.consume),
            outputLabel: p?.output?.label ?? '',
            isPrimarySearchResponseText: Boolean(
              p?.output?.isPrimarySearchResponseText,
            ),
            ...buildUseInFlags(p?.output?.useIn),
          }))
        : [],
      compounds: Array.isArray(entry?.config?.compounds)
        ? entry.config.compounds.map((c: any) => ({
            clientId: createClientId(),
            id: c?.id ?? '',
            valueText: Array.isArray(c?.value) ? c.value.join('\n') : '',
            outputLabel: c?.output?.label ?? '',
            isPrimarySearchResponseText: Boolean(
              c?.output?.isPrimarySearchResponseText,
            ),
            ...buildUseInFlags(c?.output?.useIn),
          }))
        : [],
    }));
  };

  const serializeUseIn = (entry: {
    useInTable: boolean;
    useInSpreadsheet: boolean;
  }) => {
    const useIn: any[] = [];
    if (entry.useInTable) useIn.push({ type: 'TABLE' });
    if (entry.useInSpreadsheet) useIn.push({ type: 'SPREADSHEET' });
    return useIn;
  };

  const serializeParserConfigEntries = (entries: ParserConfigEntry[]) =>
    entries.map(({ name, pipelines, compounds }) => ({
      name,
      config: {
        pipelines: pipelines.map((p) => {
          const pipeline: any = {
            id: p.id,
            startFrom: p.startFrom,
            direction: p.direction,
            unit: p.unit,
          };
          if (p.limit !== '') pipeline.limit = Number(p.limit);
          if (p.pattern) pipeline.pattern = p.pattern;
          if (p.stopAt) pipeline.stopAt = p.stopAt;
          if (p.consume) pipeline.consume = true;
          pipeline.output = {
            label: p.outputLabel,
            useIn: serializeUseIn(p),
            ...(p.isPrimarySearchResponseText
              ? { isPrimarySearchResponseText: true }
              : {}),
          };
          return pipeline;
        }),
        compounds: compounds.map((c) => ({
          id: c.id,
          value: c.valueText.split('\n'),
          output: {
            label: c.outputLabel,
            useIn: serializeUseIn(c),
            ...(c.isPrimarySearchResponseText
              ? { isPrimarySearchResponseText: true }
              : {}),
          },
        })),
      },
    }));

  // Keep the Form tab state and the JSON tab textarea in sync on every edit.
  const commitParserConfigEntries = (next: ParserConfigEntry[]) => {
    setParserConfigEntries(next);
    setConfigJson(JSON.stringify(serializeParserConfigEntries(next), null, 2));
  };

  // Sync JSON -> Form once the user is done editing (not on every keystroke,
  // since rebuilding entries mints new clientIds and would reset the
  // collapsed/expanded state on every change). Silently skip invalid JSON;
  // the user will get a proper error on Save.
  const handleConfigJsonBlur = () => {
    try {
      const parsed = JSON.parse(configJson);
      setParserConfigEntries(buildParserConfigEntries(parsed));
    } catch (e) {
      // Leave the Form tab as-is until the JSON becomes valid again.
    }
  };

  React.useEffect(() => {
    if (isOpen) {
      const stored = readStoredParserConfigs();
      setConfigJson(JSON.stringify(stored, null, 2));
      setParserConfigEntries(buildParserConfigEntries(stored));
    }
  }, [isOpen]);

  const handleSaveClick = () => {
    try {
      const parsed = JSON.parse(configJson);
      if (!Array.isArray(parsed)) {
        alert('Помилка: Конфігурація повинна бути масивом');
        return;
      }
      localStorage.setItem(PARSER_CONFIGS_STORAGE_KEY, JSON.stringify(parsed));
      onSave();
    } catch (e) {
      alert('Помилка: Невалідний JSON формат');
    }
  };

  const handleImportJson = async () => {
    try {
      const result = await FileSystemBridge.pickFile({
        types: [
          {
            description: 'JSON Config',
            accept: { 'application/json': ['.json'] },
          },
        ],
        excludeAcceptAllOption: true,
        multiple: false,
      });

      if (!result) return;

      const rawContent = await Promise.resolve(
        result.files[0].getFileContent(),
      );
      let contentStr = '';

      if (rawContent instanceof Blob) {
        contentStr = await rawContent.text();
      } else {
        contentStr = new TextDecoder('utf-8').decode(rawContent as any);
      }

      const parsed = JSON.parse(contentStr);
      setConfigJson(JSON.stringify(parsed, null, 2));
      setParserConfigEntries(buildParserConfigEntries(parsed));
    } catch (e) {
      console.error('Import failed', e);
      alert('Помилка імпорту: Невалідний файл або формат JSON');
    }
  };

  const handleExportJson = async () => {
    try {
      JSON.parse(configJson);

      const blob = new Blob([configJson], { type: 'application/json' });
      const fileName = 'doc-ninja-parser-config.json';

      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: fileName,
            types: [
              {
                description: 'JSON File',
                accept: { 'application/json': ['.json'] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
        } catch (err: any) {
          if (err.name !== 'AbortError') throw err;
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      alert('Помилка експорту: Невалідний JSON у редакторі');
    }
  };

  const addParserConfig = () => {
    commitParserConfigEntries([
      ...parserConfigEntries,
      {
        clientId: createClientId(),
        name: '',
        // Mirrors DEFAULT_EXTRACTOR_SCHEMA's pipeline (information-extractor.mts)
        // so a brand-new config starts equivalent to the BE's no-schema fallback.
        pipelines: [
          {
            clientId: createClientId(),
            id: '',
            startFrom: getDefaultOptionValue(START_FROM_OPTIONS),
            direction: getDefaultOptionValue(DIRECTION_OPTIONS),
            unit: getDefaultOptionValue(UNIT_OPTIONS),
            limit: '1',
            pattern: '',
            stopAt: '',
            consume: false,
            outputLabel: '',
            useInTable: false,
            useInSpreadsheet: false,
            isPrimarySearchResponseText: false,
          },
        ],
        compounds: [],
      },
    ]);
  };

  const removeParserConfig = (configClientId: number) => {
    commitParserConfigEntries(
      parserConfigEntries.filter((c) => c.clientId !== configClientId),
    );
  };

  const updateParserConfigName = (configClientId: number, name: string) => {
    commitParserConfigEntries(
      parserConfigEntries.map((c) =>
        c.clientId === configClientId ? { ...c, name } : c,
      ),
    );
  };

  const toggleParserConfigCollapsed = (configClientId: number) => {
    setCollapsedConfigClientIds((prev) => {
      const next = new Set(prev);
      if (next.has(configClientId)) {
        next.delete(configClientId);
      } else {
        next.add(configClientId);
      }
      return next;
    });
  };

  const addPipeline = (configClientId: number) => {
    commitParserConfigEntries(
      parserConfigEntries.map((c) =>
        c.clientId === configClientId
          ? {
              ...c,
              pipelines: [
                ...c.pipelines,
                {
                  clientId: createClientId(),
                  id: '',
                  startFrom: getDefaultOptionValue(START_FROM_OPTIONS),
                  direction: getDefaultOptionValue(DIRECTION_OPTIONS),
                  unit: getDefaultOptionValue(UNIT_OPTIONS),
                  limit: '',
                  pattern: '',
                  stopAt: '',
                  consume: false,
                  outputLabel: '',
                  useInTable: false,
                  useInSpreadsheet: false,
                  isPrimarySearchResponseText: false,
                },
              ],
            }
          : c,
      ),
    );
  };

  const removePipeline = (configClientId: number, pipelineClientId: number) => {
    commitParserConfigEntries(
      parserConfigEntries.map((c) =>
        c.clientId === configClientId
          ? {
              ...c,
              pipelines: c.pipelines.filter(
                (p) => p.clientId !== pipelineClientId,
              ),
            }
          : c,
      ),
    );
  };

  const updatePipelineField = (
    configClientId: number,
    pipelineClientId: number,
    field: keyof PipelineEntry,
    value: string | boolean,
  ) => {
    commitParserConfigEntries(
      parserConfigEntries.map((c) =>
        c.clientId === configClientId
          ? {
              ...c,
              pipelines: c.pipelines.map((p) =>
                p.clientId === pipelineClientId ? { ...p, [field]: value } : p,
              ),
            }
          : c,
      ),
    );
  };

  const addCompound = (configClientId: number) => {
    commitParserConfigEntries(
      parserConfigEntries.map((c) =>
        c.clientId === configClientId
          ? {
              ...c,
              compounds: [
                ...c.compounds,
                {
                  clientId: createClientId(),
                  id: '',
                  valueText: '',
                  outputLabel: '',
                  useInTable: false,
                  useInSpreadsheet: false,
                  isPrimarySearchResponseText: false,
                },
              ],
            }
          : c,
      ),
    );
  };

  const removeCompound = (configClientId: number, compoundClientId: number) => {
    commitParserConfigEntries(
      parserConfigEntries.map((c) =>
        c.clientId === configClientId
          ? {
              ...c,
              compounds: c.compounds.filter(
                (cp) => cp.clientId !== compoundClientId,
              ),
            }
          : c,
      ),
    );
  };

  const updateCompoundField = (
    configClientId: number,
    compoundClientId: number,
    field: keyof CompoundEntry,
    value: string | boolean,
  ) => {
    commitParserConfigEntries(
      parserConfigEntries.map((c) =>
        c.clientId === configClientId
          ? {
              ...c,
              compounds: c.compounds.map((cp) =>
                cp.clientId === compoundClientId
                  ? { ...cp, [field]: value }
                  : cp,
              ),
            }
          : c,
      ),
    );
  };

  // isPrimarySearchResponseText is exclusive across the whole config (only
  // one pipeline/compound may be primary), so checking one clears it on
  // every other pipeline and compound in the same config.
  const setPrimarySearchResponseText = (
    configClientId: number,
    kind: 'pipeline' | 'compound',
    entryClientId: number,
    checked: boolean,
  ) => {
    commitParserConfigEntries(
      parserConfigEntries.map((c) =>
        c.clientId === configClientId
          ? {
              ...c,
              pipelines: c.pipelines.map((p) => ({
                ...p,
                isPrimarySearchResponseText:
                  kind === 'pipeline' && p.clientId === entryClientId
                    ? checked
                    : false,
              })),
              compounds: c.compounds.map((cp) => ({
                ...cp,
                isPrimarySearchResponseText:
                  kind === 'compound' && cp.clientId === entryClientId
                    ? checked
                    : false,
              })),
            }
          : c,
      ),
    );
  };

  return (
    <Modal
      title="Налаштування вилучення даних із документів"
      isOpen={isOpen}
      onBtnCloseClick={onClose}
      bodyClassName=""
      footer={
        <>
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={handleImportJson}
              className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:outline-none focus:ring-gray-200 focus:text-blue-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700"
            >
              Імпортувати з JSON
            </button>
            <button
              type="button"
              onClick={handleExportJson}
              className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:outline-none focus:ring-gray-200 focus:text-blue-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700"
            >
              Зберегти в JSON
            </button>
          </div>
          <div>
            <button
              onClick={handleSaveClick}
              type="button"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
            >
              Зберегти
            </button>
          </div>
        </>
      }
    >
      <Tabs>
        <Tabs.Item title="Форма">
          {parserConfigEntries.length === 0 ? (
            <div className="flex flex-col items-start gap-3 p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Ще немає жодної схеми вилучення даних.
              </p>
              <button
                type="button"
                onClick={addParserConfig}
                className="flex items-center gap-2 px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
              >
                + Додати конфігурацію
              </button>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {parserConfigEntries.map((configEntry) => {
                const isCollapsed = collapsedConfigClientIds.has(
                  configEntry.clientId,
                );

                return (
                  <div
                    key={configEntry.clientId}
                    className="rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-3 bg-gray-50 px-4 py-3 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                      <button
                        type="button"
                        onClick={() => removeParserConfig(configEntry.clientId)}
                        className="flex items-center justify-center w-9 h-9 text-red-600 bg-white border border-red-600 hover:bg-red-600 hover:text-white focus:ring-4 focus:ring-red-200 font-medium rounded-lg text-sm dark:bg-gray-800 dark:text-red-500 dark:border-red-500 dark:hover:text-white dark:hover:bg-red-600 dark:focus:ring-red-900 shrink-0 cursor-pointer"
                        title="Видалити конфігурацію"
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
                            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                          />
                        </svg>
                      </button>
                      <input
                        type="text"
                        value={configEntry.name}
                        onChange={(e) =>
                          updateParserConfigName(
                            configEntry.clientId,
                            e.target.value,
                          )
                        }
                        placeholder="Назва конфігурації"
                        className="flex-1 block w-full border bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-600 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2 text-sm font-semibold"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          toggleParserConfigCollapsed(configEntry.clientId)
                        }
                        className="p-2 rounded-lg text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 focus:outline-none cursor-pointer shrink-0"
                        title={isCollapsed ? 'Розгорнути' : 'Згорнути'}
                      >
                        <svg
                          className={`w-4 h-4 transition-transform duration-200 ${
                            isCollapsed ? '' : 'rotate-180'
                          }`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            fillRule="evenodd"
                            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          ></path>
                        </svg>
                      </button>
                    </div>

                    {!isCollapsed && (
                      <div className="p-4 space-y-6">
                        {/* Pipelines */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                            Правила вилучення полів
                          </h4>
                          {configEntry.pipelines.map((pipeline) => (
                            <div
                              key={pipeline.clientId}
                              className="relative rounded-lg border border-gray-200 dark:border-gray-600 p-4 space-y-4"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  removePipeline(
                                    configEntry.clientId,
                                    pipeline.clientId,
                                  )
                                }
                                className="absolute top-3 right-3 flex items-center justify-center w-8 h-8 text-red-600 bg-white border border-red-600 hover:bg-red-600 hover:text-white focus:ring-4 focus:ring-red-200 font-medium rounded-lg text-sm dark:bg-gray-800 dark:text-red-500 dark:border-red-500 dark:hover:text-white dark:hover:bg-red-600 dark:focus:ring-red-900 cursor-pointer"
                                title="Видалити правило"
                              >
                                −
                              </button>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-10">
                                <Field label="Ідентифікатор поля" required>
                                  <input
                                    type="text"
                                    value={pipeline.id}
                                    onChange={(e) =>
                                      updatePipelineField(
                                        configEntry.clientId,
                                        pipeline.clientId,
                                        'id',
                                        e.target.value,
                                      )
                                    }
                                    placeholder="напр. DOCUMENT_NUMBER"
                                    className={inputClassName}
                                  />
                                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                                    {pipeline.id && (
                                      <>
                                        У шаблоні документа:{' '}
                                        <code className="text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-0.5">
                                          {`{{${pipeline.id}}}`}
                                        </code>
                                      </>
                                    )}
                                  </p>
                                </Field>
                                <Field label="Назва" required>
                                  <input
                                    type="text"
                                    value={pipeline.outputLabel}
                                    onChange={(e) =>
                                      updatePipelineField(
                                        configEntry.clientId,
                                        pipeline.clientId,
                                        'outputLabel',
                                        e.target.value,
                                      )
                                    }
                                    placeholder="Назва, що відображається користувачу"
                                    className={inputClassName}
                                  />
                                </Field>
                              </div>
                              <Field label="Регулярний вираз для пошуку" required>
                                <input
                                  type="text"
                                  value={pipeline.pattern}
                                  onChange={(e) =>
                                    updatePipelineField(
                                      configEntry.clientId,
                                      pipeline.clientId,
                                      'pattern',
                                      e.target.value,
                                    )
                                  }
                                  placeholder="напр. \d{4}-\d{2}-\d{2}; якщо порожньо — береться весь фрагмент"
                                  className={`${inputClassName} font-mono`}
                                />
                              </Field>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <Select
                                  label={requiredLabel('Починати пошук від')}
                                  value={pipeline.startFrom}
                                  onChange={(value) =>
                                    updatePipelineField(
                                      configEntry.clientId,
                                      pipeline.clientId,
                                      'startFrom',
                                      value,
                                    )
                                  }
                                  options={Object.values(START_FROM_OPTIONS)}
                                />
                                <Select
                                  label={requiredLabel('Напрямок сканування')}
                                  value={pipeline.direction}
                                  onChange={(value) =>
                                    updatePipelineField(
                                      configEntry.clientId,
                                      pipeline.clientId,
                                      'direction',
                                      value,
                                    )
                                  }
                                  options={Object.values(DIRECTION_OPTIONS)}
                                />
                                <Select
                                  label={requiredLabel('Сканувати по')}
                                  value={pipeline.unit}
                                  onChange={(value) =>
                                    updatePipelineField(
                                      configEntry.clientId,
                                      pipeline.clientId,
                                      'unit',
                                      value,
                                    )
                                  }
                                  options={Object.values(UNIT_OPTIONS)}
                                />
                                <div className="min-w-0">
                                  <label className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">
                                    Максимум одиниць
                                  </label>
                                  <input
                                    type="number"
                                    value={pipeline.limit}
                                    onChange={(e) =>
                                      updatePipelineField(
                                        configEntry.clientId,
                                        pipeline.clientId,
                                        'limit',
                                        e.target.value,
                                      )
                                    }
                                    placeholder="необмежено"
                                    className="block w-full truncate border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                                <Field label="Зупинити збір на фрагменті">
                                  <input
                                    type="text"
                                    value={pipeline.stopAt}
                                    onChange={(e) =>
                                      updatePipelineField(
                                        configEntry.clientId,
                                        pipeline.clientId,
                                        'stopAt',
                                        e.target.value,
                                      )
                                    }
                                    placeholder="—"
                                    className={`${inputClassName} font-mono`}
                                  />
                                </Field>
                                <div>
                                  <div className="h-5 mb-2" aria-hidden="true" />
                                  <Checkbox
                                    theme="toggle"
                                    checked={pipeline.consume}
                                    onChange={(checked) =>
                                      updatePipelineField(
                                        configEntry.clientId,
                                        pipeline.clientId,
                                        'consume',
                                        checked,
                                      )
                                    }
                                    label="Прибрати текст із поля «content»"
                                  />
                                </div>
                              </div>
                              <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
                                {useInCheckboxes(pipeline, (field, value) =>
                                  updatePipelineField(
                                    configEntry.clientId,
                                    pipeline.clientId,
                                    field as keyof PipelineEntry,
                                    value,
                                  ),
                                )}
                              </div>
                              <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
                                <Checkbox
                                  checked={pipeline.isPrimarySearchResponseText}
                                  onChange={(checked) =>
                                    setPrimarySearchResponseText(
                                      configEntry.clientId,
                                      'pipeline',
                                      pipeline.clientId,
                                      checked,
                                    )
                                  }
                                  label="Показувати як основний текст результату пошуку"
                                />
                              </div>
                            </div>
                          ))}
                          <div className="flex justify-end pr-2">
                            <button
                              type="button"
                              onClick={() => addPipeline(configEntry.clientId)}
                              className="flex items-center justify-center w-8 h-8 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 cursor-pointer"
                              title="Додати правило"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* Compounds */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                            Комбіновані поля
                          </h4>
                          {configEntry.compounds.map((compound) => (
                            <div
                              key={compound.clientId}
                              className="relative rounded-lg border border-gray-200 dark:border-gray-600 p-4 space-y-4"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  removeCompound(
                                    configEntry.clientId,
                                    compound.clientId,
                                  )
                                }
                                className="absolute top-3 right-3 flex items-center justify-center w-8 h-8 text-red-600 bg-white border border-red-600 hover:bg-red-600 hover:text-white focus:ring-4 focus:ring-red-200 font-medium rounded-lg text-sm dark:bg-gray-800 dark:text-red-500 dark:border-red-500 dark:hover:text-white dark:hover:bg-red-600 dark:focus:ring-red-900 cursor-pointer"
                                title="Видалити складове поле"
                              >
                                −
                              </button>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-10">
                                <Field label="Ідентифікатор поля" required>
                                  <input
                                    type="text"
                                    value={compound.id}
                                    onChange={(e) =>
                                      updateCompoundField(
                                        configEntry.clientId,
                                        compound.clientId,
                                        'id',
                                        e.target.value,
                                      )
                                    }
                                    placeholder="напр. summary"
                                    className={inputClassName}
                                  />
                                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                                    {compound.id && (
                                      <>
                                        У шаблоні документа:{' '}
                                        <code className="text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-0.5">
                                          {`{{${compound.id}}}`}
                                        </code>
                                      </>
                                    )}
                                  </p>
                                </Field>
                                <Field label="Назва для відображення" required>
                                  <input
                                    type="text"
                                    value={compound.outputLabel}
                                    onChange={(e) =>
                                      updateCompoundField(
                                        configEntry.clientId,
                                        compound.clientId,
                                        'outputLabel',
                                        e.target.value,
                                      )
                                    }
                                    placeholder="Назва, що покажеться користувачу"
                                    className={inputClassName}
                                  />
                                </Field>
                              </div>
                              <Field label="Шаблон тексту (об'єднання полів)" required>
                                <textarea
                                  value={compound.valueText}
                                  onChange={(e) =>
                                    updateCompoundField(
                                      configEntry.clientId,
                                      compound.clientId,
                                      'valueText',
                                      e.target.value,
                                    )
                                  }
                                  rows={4}
                                  placeholder={
                                    'Кожен рядок — це один рядок тексту.\nЩоб підставити значення іншого поля, напишіть {{ідентифікатор_поля}} (той самий формат, що й у шаблоні документа)\n(рядок додається лише якщо те поле має значення).'
                                  }
                                  className={`${inputClassName} font-mono resize-y`}
                                />
                              </Field>
                              <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
                                {useInCheckboxes(compound, (field, value) =>
                                  updateCompoundField(
                                    configEntry.clientId,
                                    compound.clientId,
                                    field as keyof CompoundEntry,
                                    value,
                                  ),
                                )}
                              </div>
                              <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
                                <Checkbox
                                  checked={compound.isPrimarySearchResponseText}
                                  onChange={(checked) =>
                                    setPrimarySearchResponseText(
                                      configEntry.clientId,
                                      'compound',
                                      compound.clientId,
                                      checked,
                                    )
                                  }
                                  label="Показувати як основний текст результату пошуку"
                                />
                              </div>
                            </div>
                          ))}
                          <div className="flex justify-end pr-2">
                            <button
                              type="button"
                              onClick={() => addCompound(configEntry.clientId)}
                              className="flex items-center justify-center w-8 h-8 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 cursor-pointer"
                              title="Додати складове поле"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addParserConfig}
                className="flex items-center gap-2 px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
              >
                + Додати конфігурацію
              </button>
            </div>
          )}
        </Tabs.Item>
        <Tabs.Item title="JSON">
          <div className="p-4 space-y-4">
            <label
              htmlFor="parserConfigJson"
              className="block text-sm font-medium text-gray-900 dark:text-white"
            >
              Конфігурація JSON (масив парсерів)
            </label>
            <textarea
              id="parserConfigJson"
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              onBlur={handleConfigJsonBlur}
              className="block p-2.5 w-full h-96 text-xs font-mono text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 resize-y"
              placeholder="[]"
            ></textarea>
          </div>
        </Tabs.Item>
      </Tabs>
    </Modal>
  );
};

export {
  FPDModalParserConfigSettings,
  PARSER_CONFIGS_STORAGE_KEY,
  readStoredParserConfigs,
};
