import type { DocRegexParser } from './doc-regex-parser.engine';
import type { DocRegexSourceDocument } from './doc-regex-parser.store';
import type {
  DocRegexDocumentResult,
  DocRegexRow,
} from './doc-regex-parser.types';

// MATCHED — qualified and parsed; SKIPPED — read fine, but isn't the
// document type the config is for; NO_TEXT — read fine, but there's no text
// in it (typically a scanned PDF); FAILED — the backend couldn't read it.
type DocRegexDocumentStatus = 'MATCHED' | 'SKIPPED' | 'NO_TEXT' | 'FAILED';

interface DocRegexDocumentOutcome {
  document: DocRegexSourceDocument;
  status: DocRegexDocumentStatus;
  result: DocRegexDocumentResult | null;
  // Rows of this document with at least one result column left empty.
  rowsWithGapsCount: number;
}

interface DocRegexResultRow {
  key: string;
  documentIndex: number;
  values: DocRegexRow;
}

interface DocRegexResults {
  outcomes: DocRegexDocumentOutcome[];
  rows: DocRegexResultRow[];
  countByStatus: Record<DocRegexDocumentStatus, number>;
  rowsWithGapsCount: number;
}

/**
 * A gap is an empty result column — the ones the table shows and copies.
 * An empty intermediate value only counts through a column built from it.
 */
const listEmptyColumnIds = (row: DocRegexRow, columnIds: string[]) =>
  columnIds.filter((id) => !row[id]);

/**
 * Cheap enough to redo on every config change (regexes over texts already in
 * memory) — which is the point: editing a regex re-fills the table instantly,
 * without reading a single file again.
 */
const buildDocRegexResults = (
  parser: DocRegexParser,
  documents: DocRegexSourceDocument[],
  columnIds: string[],
): DocRegexResults => {
  const countByStatus: Record<DocRegexDocumentStatus, number> = {
    MATCHED: 0,
    SKIPPED: 0,
    NO_TEXT: 0,
    FAILED: 0,
  };
  const rows: DocRegexResultRow[] = [];
  let rowsWithGapsCount = 0;

  const outcomes = documents.map((document, documentIndex) => {
    let outcome: DocRegexDocumentOutcome;

    if (document.error !== null || document.text === null) {
      outcome = {
        document,
        status: 'FAILED',
        result: null,
        rowsWithGapsCount: 0,
      };
    } else if (!document.text.trim()) {
      outcome = {
        document,
        status: 'NO_TEXT',
        result: null,
        rowsWithGapsCount: 0,
      };
    } else {
      const result = parser.parse(document.text);
      outcome = {
        document,
        status: result.isQualified ? 'MATCHED' : 'SKIPPED',
        result,
        rowsWithGapsCount: result.rows.filter(
          (values) => listEmptyColumnIds(values, columnIds).length > 0,
        ).length,
      };
      result.rows.forEach((values, rowIndex) =>
        rows.push({
          key: `${document.path}#${rowIndex}`,
          documentIndex,
          values,
        }),
      );
    }

    countByStatus[outcome.status]++;
    rowsWithGapsCount += outcome.rowsWithGapsCount;
    return outcome;
  });

  return { outcomes, rows, countByStatus, rowsWithGapsCount };
};

export { buildDocRegexResults, listEmptyColumnIds };
export type {
  DocRegexDocumentOutcome,
  DocRegexDocumentStatus,
  DocRegexResultRow,
  DocRegexResults,
};
