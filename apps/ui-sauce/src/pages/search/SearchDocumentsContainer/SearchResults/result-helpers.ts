import type { RichProcessedResultItem } from '../../search-page.types';
import { FrontendInformationExtractor } from './frontend-information-extractor';

/**
 * A match's body text: the primary field of the parser config it was
 * extracted with — stamped on the match when the search answered, since the
 * folders searched together can each have their own (see
 * SearchDocumentsContainer) — or else `primaryFieldId`, the results' own.
 */
const getPrimaryText = (
  item: Pick<RichProcessedResultItem, 'extracted'>,
  primaryFieldId: string | null,
) => {
  const fieldId = item.extracted?.primaryFieldId ?? primaryFieldId;
  return fieldId ? item.extracted?.extractedFieldById[fieldId] : undefined;
};

// Helper to calculate dynamic values including legacy dependencies
const calculateDynamicValues = (
  item: RichProcessedResultItem,
  filterConfigs: any[],
  primaryFieldId: string | null,
) => {
  const dynamicValues: Record<string, string | null> = {};
  const primaryText = getPrimaryText(item, primaryFieldId);

  filterConfigs.forEach((conf) => {
    dynamicValues[conf.id] = FrontendInformationExtractor.determineValue(
      primaryText,
      conf,
    );
  });

  return dynamicValues;
};

// The phrases that made each filter badge appear, so a row can point back at
// them in the summary it derived them from. Kept separate from
// calculateDynamicValues because the filtering and export call sites only ever
// want the resolved label, and shouldn't pay for (or unpack) the phrases.
//
// Filters can opt out of highlighting (see the toggle in FPDModalFilterSettings)
// — `!== false` rather than a truthiness check, so configs saved before the
// flag existed keep highlighting instead of silently going dark.
const collectFilterMatchedTexts = (
  item: RichProcessedResultItem,
  filterConfigs: any[],
  primaryFieldId: string | null,
): string[] => {
  const primaryText = getPrimaryText(item, primaryFieldId);

  return filterConfigs
    .filter((conf) => conf?.isHighlightedInResults !== false)
    .flatMap(
      (conf) =>
        FrontendInformationExtractor.findMatch(primaryText, conf)
          ?.matchedTexts ?? [],
    );
};

// A field/compound is only relevant to a given FE surface if it opted into
// that destination (or was marked as the primary search-result text) — every
// other detail of the parser schema (regex, scan direction, ...) is a BE
// concern the FE never needs to know about.
type ExtractedTableField = { id: string; label: string };

// The results of folders searched together may come from several parser
// configs: their fields are all shown, a field id the configs share once
// (labelled as the first config has it), so each match fills the columns of
// its own config and leaves the others blank.
const getExtractedFieldOutputs = (
  parserSchemas: any[],
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
  const fieldIds = new Set<string>();
  const allFields = parserSchemas
    .flatMap((parserSchema) => [
      ...(Array.isArray(parserSchema?.config?.pipelines)
        ? parserSchema.config.pipelines
        : []),
      ...(Array.isArray(parserSchema?.config?.compounds)
        ? parserSchema.config.compounds
        : []),
    ])
    .filter((field: any) => {
      if (fieldIds.has(field?.id)) return false;
      fieldIds.add(field?.id);
      return true;
    });

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
  // With several configs the first one's wins: it's only the fallback for a
  // match with no primary field of its own (see getPrimaryText).
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
  return `${value.slice(0, MAX_XLSX_CELL_LENGTH)} ...`;
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
  collectFilterMatchedTexts,
  flattenGroupedResults,
  getExtractedFieldOutputs,
  getPrimaryText,
  truncateRowForXlsx,
};
export type { ExtractedTableField };
