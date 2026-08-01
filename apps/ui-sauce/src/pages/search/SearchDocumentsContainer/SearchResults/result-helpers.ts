import type { RichProcessedResultItem } from '../../search-page.types';
import { FrontendInformationExtractor } from './frontend-information-extractor';

// Helper to calculate dynamic values including legacy dependencies
const calculateDynamicValues = (
  item: RichProcessedResultItem,
  filterConfigs: any[],
  primaryFieldId: string | null,
) => {
  const dynamicValues: Record<string, string | null> = {};
  const primaryText = primaryFieldId
    ? item.extracted?.extractedFieldById[primaryFieldId]
    : undefined;

  filterConfigs.forEach((conf) => {
    dynamicValues[conf.id] = FrontendInformationExtractor.determineValue(
      primaryText,
      conf,
    );
  });

  return dynamicValues;
};

// A field/compound is only relevant to a given FE surface if it opted into
// that destination (or was marked as the primary search-result text) — every
// other detail of the parser schema (regex, scan direction, ...) is a BE
// concern the FE never needs to know about.
type ExtractedTableField = { id: string; label: string };

const getExtractedFieldOutputs = (
  parserSchema: any,
): {
  tableFields: ExtractedTableField[];
  spreadsheetFields: ExtractedTableField[];
  primaryFieldId: string | null;
  // Every schema-defined field id, regardless of TABLE/SPREADSHEET useIn —
  // this is the set that follows the {{fieldId}} template-tag convention
  // (see FPDModalParserConfigSettings' hint text), unlike the BE's
  // structural search fields (searchQuery/foundInDocument/matchedText/...)
  // which were never meant to be filled into a document template.
  allFieldIds: string[];
} => {
  const pipelines = Array.isArray(parserSchema?.config?.pipelines)
    ? parserSchema.config.pipelines
    : [];
  const compounds = Array.isArray(parserSchema?.config?.compounds)
    ? parserSchema.config.compounds
    : [];
  const allFields = [...pipelines, ...compounds];

  const fieldsForDestination = (destination: string): ExtractedTableField[] =>
    allFields
      .filter((field: any) =>
        field?.output?.useIn?.some((dest: any) => dest?.type === destination),
      )
      .map((field: any) => ({
        id: field.id,
        label: field.output?.label || field.id,
      }));

  // BE always emits a 'summary' compound (see DEFAULT_EXTRACTOR_SCHEMA), so
  // fall back to it whenever no field in the schema was explicitly marked
  // primary — otherwise no-template/default-template searches show no content.
  const primaryFieldId =
    allFields.find((field: any) => field?.output?.isPrimarySearchResponseText)
      ?.id ?? 'summary';

  return {
    tableFields: fieldsForDestination('TABLE'),
    spreadsheetFields: fieldsForDestination('SPREADSHEET'),
    primaryFieldId,
    allFieldIds: allFields.map((field: any) => field.id),
  };
};

// Shared by the xlsx export and the .docm generation dropdown — unwraps the
// grouped-by-document-with-duplicates structure into individual extracted items.
const flattenGroupedResults = (
  filteredResults: Record<string, any[]>,
): { extracted: any }[] => {
  const flattenedGroups = Object.values(filteredResults).flat();

  return flattenedGroups.flatMap((group: any) => {
    const items =
      group.items && Array.isArray(group.items) ? group.items : [group];
    return items.map((item: any) => ({ extracted: item.extracted || item }));
  });
};

// xlsx has a hard 32767-char-per-cell ceiling (SheetJS throws
// "Text length must not exceed 32767 characters" past it). Some source
// .txt files have no paragraph breaks at all, so even a schema that only
// reads "to the end of the paragraph" can occasionally still produce a
// huge string — truncate defensively right before export so one oversized
// field can never crash the whole spreadsheet generation.
const MAX_XLSX_CELL_LENGTH = 32000;
const truncateForXlsxCell = (value: unknown): unknown => {
  if (typeof value !== 'string' || value.length <= MAX_XLSX_CELL_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_XLSX_CELL_LENGTH)}… [обрізано]`;
};
const truncateRowForXlsx = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      truncateForXlsxCell(value),
    ]),
  );

export {
  calculateDynamicValues,
  flattenGroupedResults,
  getExtractedFieldOutputs,
  truncateRowForXlsx,
};
export type { ExtractedTableField };
