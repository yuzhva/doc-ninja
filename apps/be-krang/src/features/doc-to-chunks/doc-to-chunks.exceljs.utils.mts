import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';

import { runtimePathById } from '../../supplement/index.mjs';

// Optimized merge detection with caching
const mergeCache = new WeakMap<
  any,
  { mergeMap: Map<string, { master: string }>; detectedMerges: any[] }
>();

function detectMerges(worksheet: any, headerRows: number, maxColumn: number) {
  // Check cache first
  const cached = mergeCache.get(worksheet);
  if (cached) {
    return cached;
  }

  console.log(`🔍 Detecting merges for sheet "${worksheet.name}"`);

  const mergeMap = new Map<string, { master: string }>();
  const detectedMerges: Array<{
    top: number;
    bottom: number;
    left: number;
    right: number;
  }> = [];

  // Try ExcelJS merge data first (fastest path)
  if (worksheet.model?.merges?.length > 0) {
    const validMerges = parseExcelMerges(worksheet.model.merges);

    if (validMerges.length > 0) {
      console.log(`✅ Using ${validMerges.length} merges from ExcelJS`);

      // Batch process merges for better performance
      for (const merge of validMerges) {
        const masterCell = `${merge.top},${merge.left}`;
        for (let r = merge.top; r <= merge.bottom; r++) {
          for (let c = merge.left; c <= merge.right; c++) {
            mergeMap.set(`${r},${c}`, { master: masterCell });
          }
        }
        detectedMerges.push(merge);
      }

      const result = { mergeMap, detectedMerges };
      mergeCache.set(worksheet, result);
      return result;
    }
  }

  // Fallback: content analysis (limited to header rows)
  console.log(`🔍 Analyzing content for merge detection`);
  const processedCells = new Set<string>();

  for (let rowNum = 1; rowNum <= headerRows; rowNum++) {
    const row = worksheet.getRow(rowNum);

    for (let startCol = 1; startCol <= maxColumn; startCol++) {
      const cellKey = `${rowNum},${startCol}`;
      if (processedCells.has(cellKey)) continue;

      const startCell = row.getCell(startCol);
      const startValue = startCell.value?.toString().trim();

      if (!startValue) {
        processedCells.add(cellKey);
        continue;
      }

      const merge = findMergeRegion(
        worksheet,
        rowNum,
        startCol,
        startValue,
        headerRows,
        maxColumn,
      );

      if (merge) {
        // Mark all cells in this merge as processed
        for (let r = merge.top; r <= merge.bottom; r++) {
          for (let c = merge.left; c <= merge.right; c++) {
            processedCells.add(`${r},${c}`);
            mergeMap.set(`${r},${c}`, { master: `${merge.top},${merge.left}` });
          }
        }
        detectedMerges.push(merge);
      } else {
        processedCells.add(cellKey);
      }
    }
  }

  console.log(`📋 Found ${detectedMerges.length} merges`);
  const result = { mergeMap, detectedMerges };
  mergeCache.set(worksheet, result);
  return result;
}

function parseExcelMerges(merges: any[]): any[] {
  const validMerges: any[] = [];

  for (const merge of merges) {
    let parsedMerge = null;

    if (typeof merge === 'string') {
      parsedMerge = parseExcelRange(merge);
    } else if (merge.value && typeof merge.value === 'string') {
      parsedMerge = parseExcelRange(merge.value);
    } else if (merge.top && merge.bottom && merge.left && merge.right) {
      parsedMerge = merge;
    }

    if (parsedMerge) {
      validMerges.push(parsedMerge);
    }
  }

  return validMerges;
}

function findMergeRegion(
  worksheet: any,
  startRow: number,
  startCol: number,
  value: string,
  maxRows: number,
  maxCols: number,
): { top: number; bottom: number; left: number; right: number } | null {
  let endCol = startCol;
  const row = worksheet.getRow(startRow);

  // Find horizontal extent
  for (let c = startCol + 1; c <= maxCols; c++) {
    const cell = row.getCell(c);
    if (cell.value?.toString().trim() === value) {
      endCol = c;
    } else {
      break;
    }
  }

  // Find vertical extent (only if horizontal merge found)
  let endRow = startRow;
  if (endCol > startCol) {
    for (let r = startRow + 1; r <= maxRows; r++) {
      const checkRow = worksheet.getRow(r);
      let allMatch = true;

      for (let c = startCol; c <= endCol; c++) {
        const cell = checkRow.getCell(c);
        if (cell.value?.toString().trim() !== value) {
          allMatch = false;
          break;
        }
      }

      if (allMatch) {
        endRow = r;
      } else {
        break;
      }
    }
  }

  return endCol > startCol || endRow > startRow
    ? { top: startRow, bottom: endRow, left: startCol, right: endCol }
    : null;
}

function cellRefToCoords(cellRef: string): { row: number; col: number } {
  const match = cellRef.match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`Invalid cell reference: ${cellRef}`);

  const [, colStr, rowStr] = match;

  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }

  return { row: parseInt(rowStr, 10), col };
}

function parseExcelRange(
  rangeStr: string,
): { top: number; bottom: number; left: number; right: number } | null {
  try {
    const [startCell, endCell] = rangeStr.split(':');
    if (!startCell || !endCell) return null;

    const start = cellRefToCoords(startCell);
    const end = cellRefToCoords(endCell);

    return {
      top: Math.min(start.row, end.row),
      bottom: Math.max(start.row, end.row),
      left: Math.min(start.col, end.col),
      right: Math.max(start.col, end.col),
    };
  } catch {
    return null;
  }
}

async function getSheetStructure(
  worksheet: any,
  headerRows: number,
  maxColumnsToInclude?: number,
) {
  // Calculate max column efficiently
  let maxColumn = maxColumnsToInclude || 0;
  if (!maxColumn) {
    worksheet.eachRow({ includeEmpty: false }, (row: any) => {
      row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
        maxColumn = Math.max(maxColumn, colNumber);
      });
    });
  }

  const { mergeMap, detectedMerges } = detectMerges(
    worksheet,
    headerRows,
    maxColumn,
  );

  // Extract header rows - Handle formulas here too
  const headerRowsData: any[][] = [];
  for (let rowNum = 1; rowNum <= headerRows; rowNum++) {
    const row = worksheet.getRow(rowNum);
    const rowData: any[] = [];

    for (let colNum = 1; colNum <= maxColumn; colNum++) {
      const cell = row.getCell(colNum);
      const cellKey = `${rowNum},${colNum}`;
      const mergeInfo = mergeMap.get(cellKey);

      let cellValue;
      if (mergeInfo && mergeInfo.master !== cellKey) {
        cellValue = null;
      } else {
        cellValue = cell.value;

        // Convert formulas to values in header extraction too
        if (
          cellValue &&
          typeof cellValue === 'object' &&
          'formula' in cellValue
        ) {
          // Use result if available, otherwise treat as empty (don't fall back to formula text)
          // cellValue = cellValue.result || cellValue.formula || '';
          cellValue = cellValue.result ?? null;
        }
      }

      rowData.push(cellValue);
    }
    headerRowsData.push(rowData);
  }

  return { headerRowsData, detectedMerges, mergeMap, maxColumn };
}

// Optimized sheet creation with batch operations
async function createSheetWithData(
  workbook: any,
  sheetName: string,
  sourceWorksheet: any,
  headerRowsData: any[][],
  dataRows: any[],
  maxColumn: number,
  headerRows: number,
  mergeMap: Map<string, { master: string }>,
  detectedMerges: any[],
) {
  const sheet = workbook.addWorksheet(sheetName);

  // Copy column properties in batch
  const sourceColumns = sourceWorksheet.columns;
  for (
    let colIdx = 0;
    colIdx < maxColumn && colIdx < sourceColumns.length;
    colIdx++
  ) {
    const sourceCol = sourceColumns[colIdx];
    if (sourceCol) {
      const targetCol = sheet.getColumn(colIdx + 1);
      targetCol.width = sourceCol.width;
      targetCol.hidden = sourceCol.hidden;
    }
  }

  const mergedCells: string[] = [];

  // Create header rows with safe formula handling
  headerRowsData.forEach((headerRowData, headerIdx) => {
    const sourceHeaderRow = sourceWorksheet.getRow(headerIdx + 1);
    const targetHeaderRow = sheet.addRow(new Array(maxColumn).fill(null));

    if (sourceHeaderRow.height) {
      targetHeaderRow.height = sourceHeaderRow.height;
    }

    // Copy header styles with safe formula stripping
    for (let colNum = 1; colNum <= maxColumn; colNum++) {
      const cellKey = `${headerIdx + 1},${colNum}`;
      const mergeInfo = mergeMap.get(cellKey);
      const sourceCell = sourceHeaderRow.getCell(colNum);
      const targetCell = targetHeaderRow.getCell(colNum);

      // Safe style copying - only copy visual properties to avoid formula metadata
      const safeStyle: any = {};
      if (sourceCell.style) {
        if (sourceCell.style.font)
          safeStyle.font = { ...sourceCell.style.font };
        if (sourceCell.style.fill)
          safeStyle.fill = { ...sourceCell.style.fill };
        if (sourceCell.style.border)
          safeStyle.border = { ...sourceCell.style.border };
        if (sourceCell.style.alignment)
          safeStyle.alignment = { ...sourceCell.style.alignment };
        if (sourceCell.style.numFmt) safeStyle.numFmt = sourceCell.style.numFmt;
      }

      if (Object.keys(safeStyle).length > 0) {
        targetCell.style = safeStyle;
      }

      // Set ONLY the converted value - never copy formula objects
      let cellValue =
        !mergeInfo || mergeInfo.master === cellKey
          ? headerRowData[colNum - 1]
          : null;

      // Extra safety: ensure it's never a formula object
      if (
        cellValue &&
        typeof cellValue === 'object' &&
        'formula' in cellValue
      ) {
        // Use result if available, otherwise treat as empty (don't fall back to formula text)
        // cellValue = cellValue.result || cellValue.formula || '';
        cellValue = cellValue.result ?? null;
      }

      targetCell.value = cellValue;
    }
  });

  // Process header merges
  detectedMerges
    .filter((merge) => merge.top <= headerRows && merge.bottom <= headerRows)
    .forEach((merge) => {
      const targetMerge = `${sheet.getCell(merge.top, merge.left).address}:${sheet.getCell(merge.bottom, merge.right).address}`;
      mergedCells.push(targetMerge);
    });

  // Create data rows with safe formula handling
  dataRows.forEach((rowInfo) => {
    const sourceRow = sourceWorksheet.getRow(rowInfo.originalRowIndex);

    // Create row with fully converted values (already done in data extraction)
    const targetRow = sheet.addRow(rowInfo.data);

    targetRow.height =
      sourceRow.height || sourceWorksheet.properties.defaultRowHeight || 15;

    // Copy styles with safe formula stripping for all cells in the row
    for (let colNumber = 1; colNumber <= maxColumn; colNumber++) {
      const sourceCell = sourceRow.getCell(colNumber);
      const targetCell = targetRow.getCell(colNumber);

      // Safe style copying - only copy visual properties to avoid formula metadata
      const safeStyle: any = {};
      if (sourceCell.style) {
        if (sourceCell.style.font)
          safeStyle.font = { ...sourceCell.style.font };
        if (sourceCell.style.fill)
          safeStyle.fill = { ...sourceCell.style.fill };
        if (sourceCell.style.border)
          safeStyle.border = { ...sourceCell.style.border };
        if (sourceCell.style.alignment)
          safeStyle.alignment = { ...sourceCell.style.alignment };
        if (sourceCell.style.numFmt) safeStyle.numFmt = sourceCell.style.numFmt;
      }

      if (Object.keys(safeStyle).length > 0) {
        targetCell.style = safeStyle;
      }

      // Ensure the cell value is never a formula object
      let cellValue = targetCell.value;
      if (
        cellValue &&
        typeof cellValue === 'object' &&
        ('formula' in cellValue || 'sharedFormula' in cellValue)
      ) {
        // Use result if available, otherwise treat as empty (don't fall back to formula text)
        // cellValue = cellValue.result || cellValue.formula || '';
        cellValue = cellValue.result ?? null;
        targetCell.value = cellValue;
      }
    }
  });

  // Process data row merges efficiently
  const processedMerges = new Set<string>();
  detectedMerges
    .filter((merge) => merge.top > headerRows)
    .forEach((merge) => {
      const affectedRows = dataRows.filter(
        (row) =>
          row.originalRowIndex >= merge.top &&
          row.originalRowIndex <= merge.bottom,
      );

      if (affectedRows.length > 0) {
        const firstAffectedIdx = dataRows.findIndex(
          (row) => row.originalRowIndex === affectedRows[0].originalRowIndex,
        );
        const lastAffectedIdx = dataRows.findIndex(
          (row) =>
            row.originalRowIndex ===
            affectedRows[affectedRows.length - 1].originalRowIndex,
        );

        const targetMergeTop = headerRows + firstAffectedIdx + 1;
        const targetMergeBottom = headerRows + lastAffectedIdx + 1;
        const mergeKey = `${targetMergeTop}-${targetMergeBottom}-${merge.left}-${merge.right}`;

        if (!processedMerges.has(mergeKey)) {
          const targetMerge = `${sheet.getCell(targetMergeTop, merge.left).address}:${sheet.getCell(targetMergeBottom, merge.right).address}`;
          mergedCells.push(targetMerge);
          processedMerges.add(mergeKey);
        }
      }
    });

  // Apply all merges in batch
  mergedCells.forEach((merge) => {
    try {
      sheet.mergeCells(merge);
    } catch (error) {
      // Silently ignore merge errors to avoid log spam
    }
  });

  // Final safety check: Iterate through all cells and strip any remaining formulas
  sheet.eachRow({ includeEmpty: false }, (row: any) => {
    row.eachCell({ includeEmpty: false }, (cell: any) => {
      if (
        cell.value &&
        typeof cell.value === 'object' &&
        ('formula' in cell.value || 'sharedFormula' in cell.value)
      ) {
        // Use result if available, otherwise treat as empty (don't fall back to formula text)
        // cellValue = cellValue.result || cellValue.formula || '';
        cell.value = cell.value.result ?? null;
      }
    });
  });

  return sheet;
}

function createChunkNameExtractor(chunkNamePattern?: string) {
  // Pre-compile regex for performance
  const regex = chunkNamePattern ? new RegExp(chunkNamePattern, 'i') : null;

  return (cellValue: any): string | null => {
    if (cellValue === undefined || cellValue === null || cellValue === '') {
      return null;
    }

    const stringValue = String(cellValue).trim();

    if (!regex) {
      return stringValue;
    }

    try {
      const match = stringValue.match(regex);
      return match ? (match[1] || match[0]).trim() : stringValue;
    } catch (error: Error | any) {
      console.error(
        `❌ Invalid regex pattern "${chunkNamePattern}": ${error.message}`,
      );
      return stringValue;
    }
  };
}

function getSheetByConfig(
  workbook: any,
  sheetConfig: any,
  includeHiddenSheets: boolean,
  visibleSheets?: any[],
): any {
  if (includeHiddenSheets) {
    return workbook.worksheets[sheetConfig.sheetIndex - 1];
  } else {
    const sheets =
      visibleSheets ||
      workbook.worksheets.filter(
        (ws: any) => (ws.state || 'visible') === 'visible',
      );
    return sheets[sheetConfig.sheetIndex - 1];
  }
}

async function processSheetForFiltering(
  worksheet: any,
  config: {
    filterColumnPosition: number;
    headerRows?: number;
    maxColumnsToInclude?: number;
  },
  chunkValues: Set<string>,
  chunkNamePattern?: string,
): Promise<Map<string, any[]>> {
  const headerRows = config.headerRows || 1;

  // Calculate max column efficiently
  let maxColumn = config.maxColumnsToInclude || 0;
  if (!maxColumn) {
    worksheet.eachRow({ includeEmpty: false }, (row: any) => {
      row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
        maxColumn = Math.max(maxColumn, colNumber);
      });
    });
  }

  // Extract data rows
  const dataRows: { data: any[]; originalRowIndex: number }[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
    if (rowNumber > headerRows) {
      const rowData: any[] = [];
      for (let colNum = 1; colNum <= maxColumn; colNum++) {
        const cell = row.getCell(colNum);
        let cellValue = cell.value;

        // Convert formulas to values to prevent shared formula issues
        if (
          cellValue &&
          typeof cellValue === 'object' &&
          'formula' in cellValue
        ) {
          // Use result if available, otherwise treat as empty (don't fall back to formula text)
          // cellValue = cellValue.result || cellValue.formula || '';
          cellValue = cellValue.result ?? null;
        }

        rowData.push(cellValue);
      }
      dataRows.push({ data: rowData, originalRowIndex: rowNumber });
    }
  });

  // Group rows by matching chunk values
  const groupedRows = new Map<string, any[]>();
  const extractChunkName = createChunkNameExtractor(chunkNamePattern);
  let matchCount = 0;

  for (const rowInfo of dataRows) {
    const cellValue = rowInfo.data[config.filterColumnPosition - 1];
    const extractedValue = extractChunkName(cellValue);

    if (extractedValue && chunkValues.has(extractedValue)) {
      if (!groupedRows.has(extractedValue)) {
        groupedRows.set(extractedValue, []);
      }
      groupedRows.get(extractedValue)!.push(rowInfo);
      matchCount++;
    }
  }

  console.log(
    `📋 Processed ${dataRows.length} rows, found ${matchCount} matches in "${worksheet.name}"`,
  );
  return groupedRows;
}

async function processAdditionalSheets(
  workbook: any,
  additionalSheets: any[],
  includeHiddenSheets: boolean,
  chunkValues: Set<string>,
  chunkNamePattern?: string,
): Promise<Map<string, Map<string, any[]>>> {
  const additionalSheetData = new Map<string, Map<string, any[]>>();

  if (additionalSheets.length === 0) {
    console.log(`📋 No additional sheets configured for processing`);
    return additionalSheetData;
  }

  console.log(
    `📋 Processing ${additionalSheets.length} additional sheet(s)...`,
  );

  // Analyze sheet visibility once
  const visibleSheets = workbook.worksheets.filter(
    (ws: any) => (ws.state || 'visible') === 'visible',
  );
  console.log(
    `🔧 Hidden sheets processing: ${includeHiddenSheets ? 'ENABLED' : 'DISABLED'}`,
  );

  for (const [configIndex, sheetConfig] of additionalSheets.entries()) {
    const additionalWorksheet = getSheetByConfig(
      workbook,
      sheetConfig,
      includeHiddenSheets,
      visibleSheets,
    );

    if (!additionalWorksheet) {
      const availableCount = includeHiddenSheets
        ? workbook.worksheets.length
        : visibleSheets.length;
      console.warn(
        `⚠️ Sheet index ${sheetConfig.sheetIndex} not found! Available sheets: ${availableCount}`,
      );
      continue;
    }

    const sheetVisibility = additionalWorksheet.state || 'visible';
    const isHidden = sheetVisibility !== 'visible';

    if (isHidden && !includeHiddenSheets) {
      console.warn(`⚠️ Skipping hidden sheet "${additionalWorksheet.name}"`);
      continue;
    }

    console.log(
      `📄 Processing additional sheet: "${additionalWorksheet.name}"`,
    );

    try {
      const sheetData = await processSheetForFiltering(
        additionalWorksheet,
        sheetConfig,
        chunkValues,
        chunkNamePattern,
      );

      additionalSheetData.set(additionalWorksheet.name, sheetData);

      const totalFilteredRows = Array.from(sheetData.values()).reduce(
        (sum, rows) => sum + rows.length,
        0,
      );
      console.log(
        `📊 Found ${totalFilteredRows} filtered rows across ${sheetData.size} groups in "${additionalWorksheet.name}"`,
      );
    } catch (error) {
      console.error(
        `❌ Error processing sheet "${additionalWorksheet.name}":`,
        error,
      );
    }
  }

  return additionalSheetData;
}

function findSheetConfig(
  additionalSheets: any[],
  workbook: any,
  sheetName: string,
  includeHiddenSheets: boolean,
): any {
  for (const config of additionalSheets) {
    const targetWorksheet = getSheetByConfig(
      workbook,
      config,
      includeHiddenSheets,
    );
    if (targetWorksheet && targetWorksheet.name === sheetName) {
      return config;
    }
  }
  return null;
}

async function saveFirstSheetAsTextWithStyles({
  docPath = path.join(runtimePathById.assets, 'doc-to-slice', 'data.xlsx'),
  destPath = path.join(runtimePathById.assets, 'doc-to-slice', 'chunks'),
}: { docPath?: string; destPath?: string } = {}) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(docPath);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error('No sheets found in workbook.');

    let output = '';
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const rowCells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        let value = cell.value;
        if (typeof value === 'object' && value && 'formula' in value) {
          value = value.result ?? '';
        }

        const style =
          cell.style && Object.keys(cell.style).length > 0
            ? `/*style:${JSON.stringify(cell.style)}*/`
            : '';

        rowCells.push(`${value ?? ''}${style}`);
      });
      output += rowCells.join('\t') + '\n';
    });

    await fs.writeFile(destPath, output, 'utf8');
    console.log(`✅ First sheet saved as text with styles: ${destPath}`);
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

export {
  // helpers
  detectMerges,
  getSheetStructure,
  createSheetWithData,
  createChunkNameExtractor,
  getSheetByConfig,
  processAdditionalSheets,
  findSheetConfig,
  // features
  saveFirstSheetAsTextWithStyles,
};
