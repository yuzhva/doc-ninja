import type {
  DocRegexConfig,
  DocRegexConfigIssue,
  DocRegexDocumentResult,
  DocRegexMatchSpan,
  DocRegexRow,
  DocRegexTransform,
  DocRegexValueInfo,
  DocRegexValueRule,
} from './doc-regex-parser.types';

// Pure TS on purpose (no React, no DOM): the same engine runs in the browser
// and in Electron's renderer, and can be smoke-tested from Node with tsx.

// Case-insensitive because the same heading is typed "ДОГОВІР" in one
// document and "Договір" in the next; 'm' lets ^/$ anchor on line boundaries,
// same as the search page's parser config.
const DEFAULT_PATTERN_FLAGS = 'im';
// A cleanup step is nearly always meant for every occurrence.
const DEFAULT_REPLACE_FLAGS = 'gi';
const DEFAULT_FILE_EXTENSIONS = ['.doc', '.docx', '.pdf'];

// Unicode-aware, so ids may be Ukrainian ("дата") too.
const ID_PATTERN = /^[\p{L}\p{N}_]+$/u;
const PLACEHOLDER_PATTERN = /\{\{([\p{L}\p{N}_]+)\}\}/gu;

const QUALIFIER_RULE_ID_PREFIX = 'qualifier:';

// Matched against the start of a month word, so every grammatical case
// ("жовтень", "жовтня") resolves. Ukrainian first, then Russian and English
// spellings found in older documents.
const MONTH_BY_PREFIX: Array<[string, number]> = [
  ['січ', 1],
  ['лют', 2],
  ['берез', 3],
  ['квіт', 4],
  ['трав', 5],
  ['черв', 6],
  ['лип', 7],
  ['серп', 8],
  ['верес', 9],
  ['жовт', 10],
  ['листоп', 11],
  ['груд', 12],
  ['янв', 1],
  ['фев', 2],
  ['мар', 3],
  ['апр', 4],
  ['мая', 5],
  ['май', 5],
  ['июн', 6],
  ['июл', 7],
  ['авг', 8],
  ['сен', 9],
  ['окт', 10],
  ['ноя', 11],
  ['дек', 12],
  ['jan', 1],
  ['feb', 2],
  ['mar', 3],
  ['apr', 4],
  ['may', 5],
  ['jun', 6],
  ['jul', 7],
  ['aug', 8],
  ['sep', 9],
  ['oct', 10],
  ['nov', 11],
  ['dec', 12],
];

type CompiledValueRule = {
  id: string;
  regex: RegExp | null;
  template?: string;
  transforms: Array<(value: string) => string>;
};

type CompiledField = CompiledValueRule & {
  source?: string;
  split?: {
    delimiter: RegExp | null;
    match: RegExp | null;
    columns: CompiledValueRule[];
  };
};

type CompiledQualifierRule = (
  text: string,
  spans: DocRegexMatchSpan[],
) => boolean;

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * "Invalid regular expression: /(/dim: Unterminated group" -> "Unterminated
 * group": the pattern is already shown next to the error, and the flags in
 * that echo include the engine's own 'd', which the user never typed.
 */
const describeRegexError = (error: any) =>
  String(error?.message ?? '').replace(
    /^Invalid regular expression: \/[\s\S]*\/[a-z]*: /,
    '',
  );

/**
 * 'g'/'y' are stripped because they make exec() remember lastIndex between
 * calls (i.e. between documents); 'd' is the engine's own business — it is
 * added wherever match positions are needed for highlighting.
 */
const buildFlags = (
  flags: string | undefined,
  fallback: string,
  managedFlags = '',
) => {
  const userFlags = (flags ?? fallback).replace(/[dgy]/g, '');
  return Array.from(new Set(userFlags + managedFlags)).join('');
};

/**
 * Trims every line and squeezes runs of spaces/tabs into one, but keeps line
 * breaks — a `split` by "\n" has to keep working on the cleaned value. The
 * clipboard export flattens what is left (see doc-regex-parser.clipboard).
 */
const normalizeValue = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

const expandTemplate = (template: string, match: RegExpExecArray) =>
  template.replace(
    /\$(\$|&|<([^>]+)>|(\d{1,2}))/g,
    (whole, token: string, groupName?: string, groupIndex?: string) => {
      if (token === '$') return '$';
      if (token === '&') return match[0];
      if (groupName !== undefined) return match.groups?.[groupName] ?? '';
      return match[Number(groupIndex)] ?? '';
    },
  );

const formatDate = (day: number, month: number, year: string) => {
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
};

const parseDate = (value: string): string | null => {
  const isoMatch = /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(value);
  if (isoMatch) {
    return formatDate(Number(isoMatch[3]), Number(isoMatch[2]), isoMatch[1]);
  }

  const namedMonthMatch =
    /(?<!\d)(\d{1,2})[^\p{L}\d]{0,6}(\p{L}{3,})[^\p{L}\d]{0,6}(\d{4})(?!\d)/u.exec(
      value,
    );
  if (namedMonthMatch) {
    const monthWord = namedMonthMatch[2].toLowerCase();
    const month = MONTH_BY_PREFIX.find(([prefix]) =>
      monthWord.startsWith(prefix),
    )?.[1];
    if (month) {
      return formatDate(Number(namedMonthMatch[1]), month, namedMonthMatch[3]);
    }
  }

  // Generous gaps between the parts: a date typed into a form's blanks comes
  // out as "“  28  ”          10           2026 р.".
  const numericMatch =
    /(?<!\d)(\d{1,2})\D{1,24}?(\d{1,2})\D{1,24}?(\d{4})(?!\d)/.exec(value);
  if (numericMatch) {
    return formatDate(
      Number(numericMatch[1]),
      Number(numericMatch[2]),
      numericMatch[3],
    );
  }

  return null;
};

const compileTransform = (
  transform: DocRegexTransform,
): ((value: string) => string) => {
  if (transform.type === 'DATE') {
    return (value) => parseDate(value) ?? value;
  }

  const findRegex = new RegExp(
    transform.find,
    transform.flags ?? DEFAULT_REPLACE_FLAGS,
  );
  return (value) => value.replace(findRegex, transform.replace ?? '');
};

const compileValueRule = (rule: DocRegexValueRule): CompiledValueRule => ({
  id: rule.id,
  regex: rule.pattern
    ? new RegExp(
        rule.pattern,
        buildFlags(rule.flags, DEFAULT_PATTERN_FLAGS, 'd'),
      )
    : null,
  template: rule.template || undefined,
  transforms: (rule.transforms ?? []).map(compileTransform),
});

/**
 * Each phrase becomes a regex whose words may be separated by any amount of
 * whitespace — or none at all, since the extractor sometimes glues two lines
 * together ("ДОГОВІРпро").
 */
const compileKeyword = (keyword: string) =>
  new RegExp(keyword.trim().split(/\s+/).map(escapeRegex).join('\\s*'), 'gid');

const compileQualifierRule = (
  rule: NonNullable<DocRegexConfig['qualifier']>['rules'][number],
  ruleIndex: number,
): CompiledQualifierRule => {
  const ruleId = `${QUALIFIER_RULE_ID_PREFIX}${ruleIndex}`;

  if (rule.type === 'PATTERN') {
    const regex = new RegExp(
      rule.pattern,
      buildFlags(rule.flags, DEFAULT_PATTERN_FLAGS),
    );
    return (text, spans) => {
      const match = regex.exec(text);
      if (!match) return false;
      spans.push({
        ruleId,
        start: match.index,
        end: match.index + match[0].length,
      });
      return true;
    };
  }

  const keywordRegexes = rule.keywords
    .filter(isNonEmptyString)
    .map(compileKeyword);
  // Breadcrumbs read top to bottom by default: each phrase is looked for
  // only after the previous one.
  const isOrdered = rule.isOrdered !== false;

  return (text, spans) => {
    const keywordSpans: DocRegexMatchSpan[] = [];
    let cursor = 0;

    for (const keywordRegex of keywordRegexes) {
      keywordRegex.lastIndex = isOrdered ? cursor : 0;
      const match = keywordRegex.exec(text);
      if (!match) return false;
      keywordSpans.push({
        ruleId,
        start: match.index,
        end: match.index + match[0].length,
      });
      cursor = match.index + match[0].length;
    }

    spans.push(...keywordSpans);
    return true;
  };
};

class DocRegexParser {
  private readonly qualifierMode: 'ALL' | 'ANY';
  private readonly qualifierRules: CompiledQualifierRule[];
  private readonly fields: CompiledField[];
  private readonly compounds: Array<{ id: string; value: string }>;

  /**
   * Compiles every regex once for the whole run. Expects a config that
   * already passed validateConfig — an invalid regex throws here.
   */
  constructor(config: DocRegexConfig) {
    this.qualifierMode = config.qualifier?.mode === 'ANY' ? 'ANY' : 'ALL';
    this.qualifierRules = (config.qualifier?.rules ?? []).map(
      compileQualifierRule,
    );
    this.fields = config.fields.map((field) => ({
      ...compileValueRule(field),
      source: field.source || undefined,
      split: field.split
        ? {
            delimiter: field.split.delimiter
              ? new RegExp(
                  field.split.delimiter,
                  buildFlags(field.split.flags, DEFAULT_PATTERN_FLAGS),
                )
              : null,
            match: field.split.match
              ? new RegExp(
                  field.split.match,
                  buildFlags(field.split.flags, DEFAULT_PATTERN_FLAGS, 'g'),
                )
              : null,
            columns: field.split.columns.map(compileValueRule),
          }
        : undefined,
    }));
    this.compounds = (config.compounds ?? []).map(({ id, value }) => ({
      id,
      value,
    }));
  }

  /**
   * Resolves one rule against its input. `span` is where the value came
   * from, for highlighting: capture group 1 when that alone is the value,
   * the whole match when a template (or no group) builds it.
   */
  private static resolveValue(
    rule: CompiledValueRule,
    input: string,
  ): { value: string | null; span: [number, number] | null } {
    let rawValue = input;
    let span: [number, number] | null = null;

    if (rule.regex) {
      const match = rule.regex.exec(input);
      if (!match) return { value: null, span: null };

      const wholeMatchSpan: [number, number] = [
        match.index,
        match.index + match[0].length,
      ];
      const hasCaptureGroups = match.length > 1;

      if (rule.template) {
        rawValue = expandTemplate(rule.template, match);
        span = wholeMatchSpan;
      } else if (hasCaptureGroups) {
        rawValue = match[1] ?? '';
        span = (match as any).indices?.[1] ?? wholeMatchSpan;
      } else {
        rawValue = match[0];
        span = wholeMatchSpan;
      }
    }

    const value = rule.transforms
      .reduce((acc, transform) => transform(acc), normalizeValue(rawValue))
      .trim();

    return { value: value || null, span };
  }

  /**
   * Strict on purpose: one missing piece empties the whole compound, so the
   * gap is highlighted instead of hiding inside "№125 від ".
   */
  private static buildCompoundValue(template: string, row: DocRegexRow) {
    let hasMissingValue = false;
    const value = template.replace(PLACEHOLDER_PATTERN, (_, id: string) => {
      const referencedValue = row[id];
      if (!referencedValue) hasMissingValue = true;
      return referencedValue ?? '';
    });

    return hasMissingValue ? null : value.trim() || null;
  }

  private static splitValue(
    split: NonNullable<CompiledField['split']>,
    value: string,
  ): string[] {
    const items = split.delimiter
      ? value.split(split.delimiter)
      : Array.from(value.matchAll(split.match!), (match) => match[0]);

    return items
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  parse(text: string): DocRegexDocumentResult {
    const spans: DocRegexMatchSpan[] = [];

    const qualifierChecks = this.qualifierRules.map((rule) =>
      rule(text, spans),
    );
    const isQualified =
      qualifierChecks.length === 0 ||
      (this.qualifierMode === 'ANY'
        ? qualifierChecks.some(Boolean)
        : qualifierChecks.every(Boolean));

    if (!isQualified) {
      return { isQualified, qualifierChecks, rows: [], spans };
    }

    const valueById: DocRegexRow = {};
    let splitRows: DocRegexRow[] | null = null;

    for (const field of this.fields) {
      const input = field.source ? valueById[field.source] : text;
      const { value, span } =
        input == null
          ? { value: null, span: null }
          : DocRegexParser.resolveValue(field, input);

      valueById[field.id] = value;

      // A field reading another field's value has no position in the
      // document text to point at.
      if (span && !field.source) {
        spans.push({ ruleId: field.id, start: span[0], end: span[1] });
      }

      if (field.split) {
        const { columns } = field.split;
        const items =
          value == null ? [] : DocRegexParser.splitValue(field.split, value);

        // A document that qualified but has nothing to split still gets
        // its row, with the split columns left empty (and highlighted).
        splitRows = (items.length > 0 ? items : [null]).map((item) =>
          Object.fromEntries(
            columns.map((column) => [
              column.id,
              item == null
                ? null
                : DocRegexParser.resolveValue(column, item).value,
            ]),
          ),
        );
      }
    }

    const rows = (splitRows ?? [{}]).map((splitRow) => {
      const row: DocRegexRow = { ...valueById, ...splitRow };
      for (const compound of this.compounds) {
        row[compound.id] = DocRegexParser.buildCompoundValue(
          compound.value,
          row,
        );
      }
      return row;
    });

    return { isQualified, qualifierChecks, rows, spans };
  }

  /**
   * Every value a config produces, in the order a row is built: fields
   * (each followed by its split columns), then compounds.
   */
  static listValues(config: DocRegexConfig): DocRegexValueInfo[] {
    const values: DocRegexValueInfo[] = [];

    for (const field of config.fields ?? []) {
      values.push({
        id: field.id,
        label: field.label || field.id,
        kind: 'FIELD',
      });
      for (const column of field.split?.columns ?? []) {
        values.push({
          id: column.id,
          label: column.label || column.id,
          kind: 'SPLIT_COLUMN',
        });
      }
    }
    for (const compound of config.compounds ?? []) {
      values.push({
        id: compound.id,
        label: compound.label || compound.id,
        kind: 'COMPOUND',
      });
    }

    return values;
  }

  static getFileExtensions(config: DocRegexConfig): string[] {
    const extensions = (config.fileExtensions ?? [])
      .filter(isNonEmptyString)
      .map((extension) => {
        const trimmed = extension.trim().toLowerCase();
        return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
      });

    return extensions.length > 0 ? extensions : DEFAULT_FILE_EXTENSIONS;
  }

  static isQualifierRuleId(ruleId: string) {
    return ruleId.startsWith(QUALIFIER_RULE_ID_PREFIX);
  }

  /**
   * Validates one config. Works on arbitrary JSON (whatever the user typed
   * or imported), so every shape assumption is checked before it is used.
   */
  static validateConfig(
    config: unknown,
    pathPrefix = '',
  ): DocRegexConfigIssue[] {
    const issues: DocRegexConfigIssue[] = [];
    const at = (path: string) =>
      pathPrefix ? (path ? `${pathPrefix}.${path}` : pathPrefix) : path;
    const report = (
      path: string,
      code: DocRegexConfigIssue['code'],
      params?: Record<string, string>,
    ) => issues.push({ path: at(path), code, ...(params ? { params } : {}) });

    if (!isPlainObject(config)) {
      report('', 'NOT_AN_OBJECT');
      return issues;
    }

    const checkFlags = (path: string, flags: unknown, managedFlags = '') => {
      if (flags === undefined) return true;
      try {
        new RegExp(
          '',
          buildFlags(String(flags), DEFAULT_PATTERN_FLAGS, managedFlags),
        );
        return true;
      } catch {
        report(`${path}.flags`, 'FLAGS_INVALID', { flags: String(flags) });
        return false;
      }
    };

    const checkPattern = (
      path: string,
      pattern: unknown,
      flags: string | undefined,
      isRequired: boolean,
    ) => {
      if (pattern === undefined || pattern === '') {
        if (isRequired) report(path, 'PATTERN_REQUIRED');
        return;
      }
      try {
        new RegExp(String(pattern), flags);
      } catch (error: any) {
        report(path, 'PATTERN_INVALID', {
          message: describeRegexError(error),
        });
      }
    };

    // Ids are shared by fields, split columns and compounds alike — they
    // all land in the same row object and the same {{id}} namespace.
    const knownIds = new Set<string>();
    const fieldIds = new Set<string>();
    const checkId = (path: string, id: unknown) => {
      if (!isNonEmptyString(id)) {
        report(`${path}.id`, 'ID_REQUIRED');
        return false;
      }
      if (!ID_PATTERN.test(id)) {
        report(`${path}.id`, 'ID_INVALID', { id });
        return false;
      }
      if (knownIds.has(id)) {
        report(`${path}.id`, 'ID_DUPLICATE', { id });
        return false;
      }
      knownIds.add(id);
      return true;
    };

    const checkValueRule = (
      path: string,
      rule: unknown,
      isPatternRequired: boolean,
    ) => {
      if (!isPlainObject(rule)) {
        report(path, 'NOT_AN_OBJECT');
        return;
      }
      checkId(path, rule.id);
      if (checkFlags(path, rule.flags, 'd')) {
        checkPattern(
          `${path}.pattern`,
          rule.pattern,
          buildFlags(rule.flags, DEFAULT_PATTERN_FLAGS, 'd'),
          isPatternRequired,
        );
      }

      if (rule.transforms !== undefined && !Array.isArray(rule.transforms)) {
        report(`${path}.transforms`, 'NOT_AN_ARRAY');
        return;
      }
      (rule.transforms ?? []).forEach((transform: unknown, index: number) => {
        const transformPath = `${path}.transforms[${index}]`;
        if (!isPlainObject(transform)) {
          report(transformPath, 'NOT_AN_OBJECT');
        } else if (transform.type === 'REPLACE') {
          try {
            new RegExp(
              String(transform.find ?? ''),
              transform.flags ?? DEFAULT_REPLACE_FLAGS,
            );
            if (!isNonEmptyString(transform.find)) {
              report(`${transformPath}.find`, 'PATTERN_REQUIRED');
            }
          } catch (error: any) {
            report(`${transformPath}.find`, 'PATTERN_INVALID', {
              message: describeRegexError(error),
            });
          }
        } else if (transform.type !== 'DATE') {
          report(`${transformPath}.type`, 'TRANSFORM_TYPE_UNKNOWN', {
            type: String(transform.type),
          });
        }
      });
    };

    if (!isNonEmptyString(config.name)) report('name', 'NAME_REQUIRED');

    if (config.qualifier !== undefined) {
      const { qualifier } = config;
      if (!isPlainObject(qualifier)) {
        report('qualifier', 'NOT_AN_OBJECT');
      } else {
        if (
          qualifier.mode !== undefined &&
          qualifier.mode !== 'ALL' &&
          qualifier.mode !== 'ANY'
        ) {
          report('qualifier.mode', 'QUALIFIER_MODE_UNKNOWN', {
            mode: String(qualifier.mode),
          });
        }
        if (!Array.isArray(qualifier.rules)) {
          report('qualifier.rules', 'NOT_AN_ARRAY');
        } else {
          qualifier.rules.forEach((rule: unknown, index: number) => {
            const rulePath = `qualifier.rules[${index}]`;
            if (!isPlainObject(rule)) {
              report(rulePath, 'NOT_AN_OBJECT');
            } else if (rule.type === 'PATTERN') {
              if (checkFlags(rulePath, rule.flags)) {
                checkPattern(
                  `${rulePath}.pattern`,
                  rule.pattern,
                  buildFlags(rule.flags, DEFAULT_PATTERN_FLAGS),
                  true,
                );
              }
            } else if (rule.type === 'KEYWORDS') {
              if (
                !Array.isArray(rule.keywords) ||
                !rule.keywords.some(isNonEmptyString)
              ) {
                report(`${rulePath}.keywords`, 'KEYWORDS_REQUIRED');
              }
            } else {
              report(`${rulePath}.type`, 'RULE_TYPE_UNKNOWN', {
                type: String(rule.type),
              });
            }
          });
        }
      }
    }

    if (!Array.isArray(config.fields)) {
      report('fields', 'NOT_AN_ARRAY');
    } else {
      let splitFieldPath: string | null = null;

      config.fields.forEach((field: unknown, index: number) => {
        const fieldPath = `fields[${index}]`;
        if (!isPlainObject(field)) {
          report(fieldPath, 'NOT_AN_OBJECT');
          return;
        }

        if (field.source !== undefined && field.source !== '') {
          // Only an earlier field — its value is what this one reads.
          if (!fieldIds.has(String(field.source))) {
            report(`${fieldPath}.source`, 'SOURCE_UNKNOWN', {
              id: String(field.source),
            });
          }
        }

        const hasSource = isNonEmptyString(field.source);
        checkValueRule(fieldPath, field, !hasSource);
        if (isNonEmptyString(field.id)) fieldIds.add(field.id);

        if (field.split === undefined) return;

        const splitPath = `${fieldPath}.split`;
        if (!isPlainObject(field.split)) {
          report(splitPath, 'NOT_AN_OBJECT');
          return;
        }
        // One splitting field per config: two of them would have no
        // obvious way to combine (zip? every pair?) into rows.
        if (splitFieldPath) {
          report(splitPath, 'SPLIT_MULTIPLE', { path: splitFieldPath });
        }
        splitFieldPath = splitPath;

        const { split } = field;
        const splitBy = isNonEmptyString(split.delimiter)
          ? { key: 'delimiter', pattern: split.delimiter, managedFlags: '' }
          : isNonEmptyString(split.match)
            ? { key: 'match', pattern: split.match, managedFlags: 'g' }
            : null;
        if (!splitBy) {
          report(`${splitPath}.delimiter`, 'SPLIT_BY_REQUIRED');
        } else if (checkFlags(splitPath, split.flags, splitBy.managedFlags)) {
          checkPattern(
            `${splitPath}.${splitBy.key}`,
            splitBy.pattern,
            buildFlags(
              split.flags,
              DEFAULT_PATTERN_FLAGS,
              splitBy.managedFlags,
            ),
            true,
          );
        }

        if (!Array.isArray(split.columns) || split.columns.length === 0) {
          report(`${splitPath}.columns`, 'SPLIT_COLUMNS_REQUIRED');
        } else {
          split.columns.forEach((column: unknown, columnIndex: number) =>
            checkValueRule(
              `${splitPath}.columns[${columnIndex}]`,
              column,
              false,
            ),
          );
        }
      });
    }

    if (config.compounds !== undefined && !Array.isArray(config.compounds)) {
      report('compounds', 'NOT_AN_ARRAY');
    } else {
      (config.compounds ?? []).forEach((compound: unknown, index: number) => {
        const compoundPath = `compounds[${index}]`;
        if (!isPlainObject(compound)) {
          report(compoundPath, 'NOT_AN_OBJECT');
          return;
        }
        if (!isNonEmptyString(compound.value)) {
          report(`${compoundPath}.value`, 'VALUE_REQUIRED');
        } else {
          // Checked before this compound's own id is registered, so a
          // compound can't refer to itself (or to a later compound).
          for (const [, id] of compound.value.matchAll(PLACEHOLDER_PATTERN)) {
            if (!knownIds.has(id)) {
              report(`${compoundPath}.value`, 'REFERENCE_UNKNOWN', { id });
            }
          }
        }
        checkId(compoundPath, compound.id);
      });
    }

    if (!Array.isArray(config.columns) || config.columns.length === 0) {
      report('columns', 'COLUMNS_REQUIRED');
    } else {
      config.columns.forEach((columnId: unknown, index: number) => {
        if (typeof columnId !== 'string' || !knownIds.has(columnId)) {
          report(`columns[${index}]`, 'COLUMN_UNKNOWN', {
            id: String(columnId),
          });
        }
      });
    }

    return issues;
  }

  /** Validates the stored list of configs (what the JSON editor holds). */
  static validateConfigs(configs: unknown): DocRegexConfigIssue[] {
    if (!Array.isArray(configs)) return [{ path: '', code: 'NOT_AN_ARRAY' }];

    const issues: DocRegexConfigIssue[] = [];
    const seenNames = new Set<string>();

    configs.forEach((config, index) => {
      issues.push(...this.validateConfig(config, `[${index}]`));

      // The name is how the tab's dropdown tells configs apart.
      const name = isPlainObject(config) ? config.name : undefined;
      if (isNonEmptyString(name)) {
        if (seenNames.has(name)) {
          issues.push({
            path: `[${index}].name`,
            code: 'NAME_DUPLICATE',
            params: { name },
          });
        }
        seenNames.add(name);
      }
    });

    return issues;
  }
}

export { DEFAULT_FILE_EXTENSIONS, DocRegexParser };
