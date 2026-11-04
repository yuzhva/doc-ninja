import type { DocRegexConfig } from './doc-regex-parser.types';

// React keys for the Form editor's lists (configs, rules, fields, ...). Kept
// on the config objects themselves under a Symbol: object spread copies it
// along every immutable update, while JSON.stringify skips it — so it never
// reaches the JSON tab, an export or localStorage.
const FORM_KEY = Symbol('docRegexFormKey');
let nextFormKey = 0;

const withFormKey = <T extends object>(item: T): T => {
  if (!(FORM_KEY in item)) (item as any)[FORM_KEY] = nextFormKey++;
  return item;
};

const getFormKey = (item: object): number => (item as any)[FORM_KEY];

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const keyEach = (
  list: unknown,
  visit?: (item: Record<string, any>) => void,
) => {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!isObject(item)) continue;
    withFormKey(item);
    visit?.(item);
  }
};

/**
 * Deep-clones first (the bundled default config must never be mutated),
 * then keys every list item the form renders. Tolerates malformed JSON —
 * whatever isn't the expected shape is simply left unkeyed.
 */
const prepareConfigsForForm = (configs: unknown): DocRegexConfig[] => {
  if (!Array.isArray(configs)) return [];
  const cloned = JSON.parse(JSON.stringify(configs));

  keyEach(cloned, (config) => {
    keyEach(config.qualifier?.rules);
    keyEach(config.fields, (field) => {
      keyEach(field.transforms);
      keyEach(field.split?.columns, (column) => keyEach(column.transforms));
    });
    keyEach(config.compounds);
  });

  return cloned;
};

export { getFormKey, prepareConfigsForForm, withFormKey };
