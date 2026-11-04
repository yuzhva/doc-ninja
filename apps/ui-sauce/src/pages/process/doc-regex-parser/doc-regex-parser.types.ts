// JSON config of the "Обробка даних з документів" tool. Plain data on purpose:
// it is what the user edits (Form/JSON), imports/exports and keeps in
// localStorage, so everything a document type needs has to be expressible
// here without touching the engine.

// "Is this the document we are looking for?" — a strict regex, or a list of
// phrases ("breadcrumbs") that only have to be present, ignoring case and
// whitespace (extracted text often loses line breaks: "ДОГОВІРпро ...").
type DocRegexQualifierRule =
  | { type: 'PATTERN'; pattern: string; flags?: string }
  | { type: 'KEYWORDS'; keywords: string[]; isOrdered?: boolean };

type DocRegexQualifier = {
  // ALL (default) — every rule has to match; ANY — one is enough.
  mode?: 'ALL' | 'ANY';
  rules: DocRegexQualifierRule[];
};

// Cleanup steps applied, in order, to an already extracted value.
type DocRegexTransform =
  // String.prototype.replace — `replace` may use $1, $<name>, $&.
  | { type: 'REPLACE'; find: string; replace: string; flags?: string }
  // Any recognisable date ("“28” 10 2026 р.", "28 жовтня 2026", "2026-10-28")
  // to DD.MM.YYYY; a value it can't read is left as is.
  | { type: 'DATE' };

// One extracted value. Without a `pattern` it takes its whole input.
type DocRegexValueRule = {
  id: string;
  label?: string;
  pattern?: string;
  flags?: string;
  // Builds the value out of the match: "$1.$2.$3", "$<day>", "$&". Without
  // it the value is capture group 1, or the whole match when there is none.
  template?: string;
  transforms?: DocRegexTransform[];
};

// Turns one value into several result rows: by a `delimiter` regex, or one
// row per `match` of a regex. Each piece is then cut into cells by `columns`.
type DocRegexSplit = {
  delimiter?: string;
  match?: string;
  flags?: string;
  columns: DocRegexValueRule[];
};

type DocRegexField = DocRegexValueRule & {
  // id of an earlier field to search in instead of the document text.
  source?: string;
  split?: DocRegexSplit;
};

// A value glued from other values: "№{{number}} від {{date}}". Stays
// empty when any value it refers to is empty, rather than producing a
// half-filled "№125 від ".
type DocRegexCompound = {
  id: string;
  label?: string;
  value: string;
};

type DocRegexConfig = {
  name: string;
  // Which files of the picked folder get read at all, e.g. [".docx", ".pdf"].
  fileExtensions?: string[];
  qualifier?: DocRegexQualifier;
  fields: DocRegexField[];
  compounds?: DocRegexCompound[];
  // Ids (fields, split columns, compounds) shown in the result, in order.
  // Everything else is an intermediate value, visible only on demand.
  columns: string[];
};

type DocRegexIssueCode =
  | 'NOT_AN_ARRAY'
  | 'NOT_AN_OBJECT'
  | 'NAME_REQUIRED'
  | 'NAME_DUPLICATE'
  | 'ID_REQUIRED'
  | 'ID_INVALID'
  | 'ID_DUPLICATE'
  | 'PATTERN_REQUIRED'
  | 'PATTERN_INVALID'
  | 'FLAGS_INVALID'
  | 'KEYWORDS_REQUIRED'
  | 'RULE_TYPE_UNKNOWN'
  | 'QUALIFIER_MODE_UNKNOWN'
  | 'TRANSFORM_TYPE_UNKNOWN'
  | 'SOURCE_UNKNOWN'
  | 'SPLIT_MULTIPLE'
  | 'SPLIT_BY_REQUIRED'
  | 'SPLIT_COLUMNS_REQUIRED'
  | 'VALUE_REQUIRED'
  | 'REFERENCE_UNKNOWN'
  | 'COLUMNS_REQUIRED'
  | 'COLUMN_UNKNOWN';

// A config problem, pointing at the offending spot ("fields[2].pattern") so
// both the JSON and the Form editor can show it next to the right input.
type DocRegexConfigIssue = {
  path: string;
  code: DocRegexIssueCode;
  params?: Record<string, string>;
};

type DocRegexValueKind = 'FIELD' | 'SPLIT_COLUMN' | 'COMPOUND';

type DocRegexValueInfo = {
  id: string;
  label: string;
  kind: DocRegexValueKind;
};

// Every value of one result row, by id — the visible columns and the
// intermediate ones alike. null means "nothing matched".
type DocRegexRow = Record<string, string | null>;

// Where a rule matched in the document text, for highlighting it.
type DocRegexMatchSpan = {
  // A field id, or `qualifier:<index>` for a qualifier PATTERN rule.
  ruleId: string;
  start: number;
  end: number;
};

type DocRegexDocumentResult = {
  isQualified: boolean;
  // One entry per qualifier rule, in config order.
  qualifierChecks: boolean[];
  // Empty for a document that didn't qualify.
  rows: DocRegexRow[];
  spans: DocRegexMatchSpan[];
};

export type {
  DocRegexCompound,
  DocRegexConfig,
  DocRegexConfigIssue,
  DocRegexDocumentResult,
  DocRegexField,
  DocRegexIssueCode,
  DocRegexMatchSpan,
  DocRegexQualifier,
  DocRegexQualifierRule,
  DocRegexRow,
  DocRegexSplit,
  DocRegexTransform,
  DocRegexValueInfo,
  DocRegexValueKind,
  DocRegexValueRule,
};
