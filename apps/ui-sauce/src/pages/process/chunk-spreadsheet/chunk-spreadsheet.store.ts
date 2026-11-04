import React from 'react';

const CONFIGS_STORAGE_KEY = 'docNinja_chunkSpreadsheetConfigs';
const SELECTED_INDEX_STORAGE_KEY = 'docNinja_chunkSpreadsheetSelectedConfig';

const DEFAULT_SUBFOLDER = 'chunks';

// An empty field stays empty while typing instead of snapping to 0.
type NumberField = number | '';

type AdditionalSheet = {
  sheetIndex: NumberField;
  headerRows: NumberField;
  filterColumnPosition: NumberField;
  // Left out of the request while unset: the slicer then keeps every column.
  maxColumnsToInclude?: NumberField;
};

// The slicing form's state, under the API's own field names, plus the name
// it's listed under in the configs dropdown — what localStorage keeps and
// a JSON export holds.
type ChunkSpreadsheetConfig = {
  name: string;
  sheetToChunkPosition: NumberField;
  headerRows: NumberField;
  splitColumnPosition: NumberField;
  maxColumnsToInclude: NumberField;
  filenameSuffix: string;
  outputSubfolder: string;
  isFasterLessStyledChunkerUsed: boolean;
  additionalSheets: AdditionalSheet[];
};

// Unnamed (the user names it in the dropdown), only the main sheet, and
// every field left blank: every workbook is laid out differently. An empty
// subfolder means DEFAULT_SUBFOLDER.
const createDefaultChunkSpreadsheetConfig = (): ChunkSpreadsheetConfig => ({
  name: '',
  sheetToChunkPosition: '',
  headerRows: '',
  splitColumnPosition: '',
  maxColumnsToInclude: '',
  filenameSuffix: '',
  outputSubfolder: '',
  isFasterLessStyledChunkerUsed: true,
  additionalSheets: [],
});

const isDefaultChunkSpreadsheetConfig = (config: ChunkSpreadsheetConfig) =>
  JSON.stringify(config) ===
  JSON.stringify(createDefaultChunkSpreadsheetConfig());

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asNumberField = (value: unknown): NumberField =>
  Number.isInteger(value) ? (value as number) : '';

const sameTypeOr = <T extends string | boolean>(
  value: unknown,
  fallback: T,
): T => (typeof value === typeof fallback ? (value as T) : fallback);

// Whatever was stored or imported, the form gets exactly the fields it
// renders — a hand-edited file can't break it.
const toChunkSpreadsheetConfig = (value: unknown): ChunkSpreadsheetConfig => {
  const config = isObject(value) ? value : {};
  const defaults = createDefaultChunkSpreadsheetConfig();

  return {
    name: sameTypeOr(config.name, defaults.name),
    sheetToChunkPosition: asNumberField(config.sheetToChunkPosition),
    headerRows: asNumberField(config.headerRows),
    splitColumnPosition: asNumberField(config.splitColumnPosition),
    maxColumnsToInclude: asNumberField(config.maxColumnsToInclude),
    filenameSuffix: sameTypeOr(config.filenameSuffix, defaults.filenameSuffix),
    outputSubfolder: sameTypeOr(
      config.outputSubfolder,
      defaults.outputSubfolder,
    ),
    isFasterLessStyledChunkerUsed: sameTypeOr(
      config.isFasterLessStyledChunkerUsed,
      defaults.isFasterLessStyledChunkerUsed,
    ),
    additionalSheets: Array.isArray(config.additionalSheets)
      ? config.additionalSheets.filter(isObject).map((sheet) => ({
          sheetIndex: asNumberField(sheet.sheetIndex),
          headerRows: asNumberField(sheet.headerRows),
          filterColumnPosition: asNumberField(sheet.filterColumnPosition),
          ...(Number.isInteger(sheet.maxColumnsToInclude) && {
            maxColumnsToInclude: sheet.maxColumnsToInclude,
          }),
        }))
      : [],
  };
};

// A whole export (an array) or a single config shared on its own.
const parseImportedChunkSpreadsheetConfigs = (
  json: unknown,
): ChunkSpreadsheetConfig[] => {
  const entries = Array.isArray(json) ? json : [json];
  if (!entries.length || !entries.every(isObject)) {
    throw new Error('Not a slicing config');
  }
  return entries.map(toChunkSpreadsheetConfig);
};

// An imported config replaces the one of the same name (an updated copy),
// the rest are added; an untouched blank config makes way for them.
const mergeImportedChunkSpreadsheetConfigs = (
  current: ChunkSpreadsheetConfig[],
  imported: ChunkSpreadsheetConfig[],
) => {
  const next = current.filter(
    (config) => !isDefaultChunkSpreadsheetConfig(config),
  );
  for (const config of imported) {
    const sameNameIndex = config.name
      ? next.findIndex(({ name }) => name === config.name)
      : -1;
    if (sameNameIndex === -1) next.push(config);
    else next[sameNameIndex] = config;
  }
  return next;
};

const readStored = (key: string): unknown => {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? null : JSON.parse(saved);
  } catch {
    return null;
  }
};

const writeStored = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Failed to save ${key}`, e);
  }
};

/**
 * The slicing configs and which one the form edits. There's always at least
 * one — a blank default until the user has their own — and every change is
 * kept in localStorage right away: the page has no Save button.
 */
const useChunkSpreadsheetConfigs = () => {
  const [configs, setConfigs] = React.useState<ChunkSpreadsheetConfig[]>(() => {
    const stored = readStored(CONFIGS_STORAGE_KEY);
    return Array.isArray(stored) && stored.length
      ? stored.map(toChunkSpreadsheetConfig)
      : [createDefaultChunkSpreadsheetConfig()];
  });
  const [storedSelectedIndex, setSelectedIndex] = React.useState(() => {
    const stored = readStored(SELECTED_INDEX_STORAGE_KEY);
    return typeof stored === 'number' ? stored : 0;
  });
  // A stale index (more configs than there are now) means the first one.
  const selectedIndex = configs[storedSelectedIndex] ? storedSelectedIndex : 0;

  React.useEffect(() => writeStored(CONFIGS_STORAGE_KEY, configs), [configs]);
  React.useEffect(
    () => writeStored(SELECTED_INDEX_STORAGE_KEY, selectedIndex),
    [selectedIndex],
  );

  const updateSelectedConfig = (
    update: (config: ChunkSpreadsheetConfig) => ChunkSpreadsheetConfig,
  ) =>
    setConfigs((prev) =>
      prev.map((config, index) =>
        index === selectedIndex ? update(config) : config,
      ),
    );

  return {
    configs,
    setConfigs,
    selectedIndex,
    setSelectedIndex,
    selectedConfig: configs[selectedIndex],
    updateSelectedConfig,
  };
};

export {
  DEFAULT_SUBFOLDER,
  createDefaultChunkSpreadsheetConfig,
  isDefaultChunkSpreadsheetConfig,
  mergeImportedChunkSpreadsheetConfigs,
  parseImportedChunkSpreadsheetConfigs,
  useChunkSpreadsheetConfigs,
};
export type { AdditionalSheet, ChunkSpreadsheetConfig, NumberField };
