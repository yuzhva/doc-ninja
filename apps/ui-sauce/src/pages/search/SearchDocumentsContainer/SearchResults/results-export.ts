import type { TFunction } from 'i18next';

import { fetchRequest } from '../../../../utils';
import type { FilterConfig } from './frontend-information-extractor';
import type { MatchFiltersReader } from './match-filters';
import {
  getExtractedFieldOutputs,
  getPrimaryText,
  truncateRowForXlsx,
} from './result-helpers';

const I18N_NS = 'page.search.container.searchResults';

const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface ResultsExportContext {
  // The parser configs the results were extracted with: their SPREADSHEET
  // fields are the sheet's columns
  parserSchemas: any[];
  filterConfigs: FilterConfig[];
  readMatchFilters: MatchFiltersReader;
  t: TFunction;
}

/**
 * The sheet for `items`: the query, the document and the phrase found, the
 * parser configs' SPREADSHEET fields, then a column per filter.
 */
const buildResultsSpreadsheet = (
  items: { extracted: any }[],
  { parserSchemas, filterConfigs, readMatchFilters, t }: ResultsExportContext,
) => {
  const baseColumns = [
    {
      header: t(`${I18N_NS}.inputNameColumnHeader`),
      key: 'inputName',
      options: { wch: 25 },
    },
    {
      header: t(`${I18N_NS}.foundInDocumentColumnHeader`),
      key: 'foundInDocument',
      options: { wch: 25 },
    },
    {
      header: t(`${I18N_NS}.foundDeclensionColumnHeader`),
      key: 'foundDeclension',
      options: { wch: 25 },
    },
  ];

  const { spreadsheetFields, primaryFieldId } =
    getExtractedFieldOutputs(parserSchemas);

  // The primary field is always shown in the UI (see the `?? 'summary'`
  // fallback in getExtractedFieldOutputs) even when the schema never
  // opts it into the SPREADSHEET destination — e.g. "Без обробки", which
  // has no fields/compounds at all. Exporting less than what's visible
  // on screen would be surprising, so guarantee it a column here too.
  const exportedFields =
    !primaryFieldId ||
    spreadsheetFields.some((field) => field.id === primaryFieldId)
      ? spreadsheetFields
      : [
          ...spreadsheetFields,
          { id: primaryFieldId, label: t(`${I18N_NS}.summaryColumnHeader`) },
        ];

  const schemaColumns = exportedFields.map((field) => ({
    header: field.label,
    key: field.id,
    options: { wch: field.id === primaryFieldId ? 80 : 25 },
  }));

  const filterColumns = filterConfigs.map((config) => ({
    header: config.labelFilterTitle,
    key: config.id,
    options: { wch: 25 },
  }));

  const rows = items.map(({ extracted }) => {
    // Standard fields, matching the BE's Excel structure
    const row: Record<string, unknown> = {
      inputName: extracted.searchQuery,
      foundInDocument: extracted.foundInDocument,
      foundDeclension: extracted.matchedText,
    };

    exportedFields.forEach((field) => {
      // The primary column holds each match's own body text, whichever
      // field its parser config keeps that in
      row[field.id] =
        field.id === primaryFieldId
          ? getPrimaryText({ extracted }, primaryFieldId)
          : extracted.extractedFieldById[field.id];
    });

    return truncateRowForXlsx({
      ...row,
      ...readMatchFilters({ extracted }).valueByFilterId,
    });
  });

  return {
    columns: [...baseColumns, ...schemaColumns, ...filterColumns],
    rows,
  };
};

// The backend makes the .xlsx file out of the sheet. Sent as a file in
// FormData, since a sheet of every result can be large.
const requestXlsxFile = async (
  spreadsheet: ReturnType<typeof buildResultsSpreadsheet>,
): Promise<{ name: string; blob: Blob } | null> => {
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([JSON.stringify(spreadsheet)], { type: 'application/json' }),
    'data.json',
  );

  const response = await fetchRequest(
    '/api-local/process/generate-filtered-spreadsheet',
    { method: 'POST', body: formData },
  );
  const file = response?.processedFiles?.[0];
  if (!file) return null;

  const bytes = Uint8Array.from(atob(file.content), (char) =>
    char.charCodeAt(0),
  );
  return { name: file.name, blob: new Blob([bytes], { type: XLSX_MIME_TYPE }) };
};

// Saved where the user picks — or, where the browser can't ask, downloaded
const saveXlsxFile = async (
  { name, blob }: { name: string; blob: Blob },
  t: TFunction,
) => {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: name,
        types: [
          {
            description: t(`${I18N_NS}.excelFileTypeDescription`),
            accept: { [XLSX_MIME_TYPE]: ['.xlsx'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Failed to save file:', error);
      }
    }
    return;
  }

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(link);
};

/** Exports `items` (everything in the tables, or the ticked matches) to .xlsx. */
const exportResultsToXlsx = async (
  items: { extracted: any }[],
  context: ResultsExportContext,
) => {
  try {
    const file = await requestXlsxFile(buildResultsSpreadsheet(items, context));
    if (file) await saveXlsxFile(file, context.t);
  } catch (error) {
    console.error('Failed to export filtered results:', error);
  }
};

export { exportResultsToXlsx };
export type { ResultsExportContext };
