import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';

import { runtimePathById } from '../../supplement/index.mts';
import {
  createChunkNameExtractor,
  createSheetWithData,
  detectMerges,
  findSheetConfig,
  getSheetByConfig,
  getSheetStructure,
  processAdditionalSheets,
} from './doc-to-chunks.utils.mts';

interface SliceOptions {
  docPath?: string;
  destPath?: string;
  sheetToChunkPosition?: number;
  headerRows?: number;
  splitColumnPosition?: number;
  maxColumnsToInclude?: number;
  chunkNamePattern?: string;
  includeHiddenSheets?: boolean;
  additionalSheets?: Array<{
    sheetIndex: number;
    filterColumnPosition: number;
    headerRows?: number;
    maxColumnsToInclude?: number;
  }>;
}

const sliceDocumentForChunks = async ({
  docPath = path.join(runtimePathById.assets, 'doc-to-slice', 'data.xlsx'),
  destPath = path.join(runtimePathById.assets, 'doc-to-slice', 'chunks'),
  sheetToChunkPosition = 1,
  headerRows = 1,
  splitColumnPosition = 1,
  maxColumnsToInclude,
  chunkNamePattern,
  includeHiddenSheets = false,
  additionalSheets = [],
}: SliceOptions) => {
  const startTime = Date.now();

  try {
    console.log(`🚀 Starting to slice Excel document: ${docPath}`);
    console.log(`⏱️ Started at: ${new Date().toLocaleTimeString()}`);

    await fs.mkdir(destPath, { recursive: true });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(docPath);

    const loadTime = Date.now() - startTime;
    console.log(`📖 Document loaded in: ${loadTime}ms`);

    const worksheet = workbook.worksheets[sheetToChunkPosition - 1];
    if (!worksheet) {
      throw new Error(
        `Sheet number "${sheetToChunkPosition}" not found in the workbook.`,
      );
    }

    console.log(`📄 Using sheet: "${worksheet.name}"`);
    console.log(
      `📦 Splitting by column ${splitColumnPosition} with ${headerRows} header row(s).`,
    );

    if (chunkNamePattern) {
      console.log(`🎯 Using chunk name pattern: ${chunkNamePattern}`);
    }

    // Get column count and apply limits
    let maxColumn = 0;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        maxColumn = Math.max(maxColumn, colNumber);
      });
    });

    if (maxColumnsToInclude && maxColumnsToInclude > 0) {
      maxColumn = Math.min(maxColumn, maxColumnsToInclude);
      console.log(`📏 Limited columns to first ${maxColumn} columns`);
    }

    if (splitColumnPosition > maxColumn) {
      throw new Error(
        `Split column position ${splitColumnPosition} is beyond the maximum allowed columns ${maxColumn}`,
      );
    }

    // Detect merges
    const { mergeMap, detectedMerges } = detectMerges(
      worksheet,
      headerRows,
      maxColumn,
    );

    // Extract header and data rows
    const headerRowsData: any[][] = [];
    const dataRows: { data: any[]; originalRowIndex: number }[] = [];

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const rowData: any[] = [];
      for (let colNum = 1; colNum <= maxColumn; colNum++) {
        const cell = row.getCell(colNum);
        const cellKey = `${rowNumber},${colNum}`;
        const mergeInfo = mergeMap.get(cellKey);

        let cellValue;
        if (mergeInfo && mergeInfo.master !== cellKey) {
          cellValue = null;
        } else {
          cellValue = cell.value;

          // Convert formulas to values early to prevent shared formula issues
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

      if (rowNumber <= headerRows) {
        headerRowsData.push(rowData);
      } else {
        dataRows.push({ data: rowData, originalRowIndex: rowNumber });
      }
    });

    console.log(
      `📋 Found ${dataRows.length} data rows and ${headerRowsData.length} header rows`,
    );

    // Group rows by split column value
    const extractChunkName = createChunkNameExtractor(chunkNamePattern);
    const rowGroups = new Map<string, any[]>();
    let currentGroup: string | null = null;
    let pendingEmptyRows: any[] = [];

    for (const rowInfo of dataRows) {
      const currentCellValue = rowInfo.data[splitColumnPosition - 1];
      const extractedChunkName = extractChunkName(currentCellValue);

      if (extractedChunkName === null) {
        pendingEmptyRows.push(rowInfo);
        continue;
      }

      const groupKey = extractedChunkName;

      // Handle pending empty rows
      if (pendingEmptyRows.length > 0) {
        const targetGroup = currentGroup === groupKey ? currentGroup : groupKey;
        if (!rowGroups.has(targetGroup)) {
          rowGroups.set(targetGroup, []);
        }
        rowGroups.get(targetGroup)!.push(...pendingEmptyRows);
        pendingEmptyRows = [];
      }

      // Add current row to its group
      if (!rowGroups.has(groupKey)) {
        rowGroups.set(groupKey, []);
      }
      rowGroups.get(groupKey)!.push(rowInfo);
      currentGroup = groupKey;
    }

    // Handle remaining empty rows
    if (pendingEmptyRows.length > 0 && currentGroup) {
      rowGroups.get(currentGroup)!.push(...pendingEmptyRows);
    }

    console.log(
      `📦 Created ${rowGroups.size} group(s): ${Array.from(rowGroups.keys()).join(', ')}`,
    );

    // Process additional sheets
    const additionalSheetData = await processAdditionalSheets(
      workbook,
      additionalSheets,
      includeHiddenSheets,
      new Set(rowGroups.keys()),
      chunkNamePattern,
    );

    // Save chunks
    let chunkCount = 0;
    const saveChunk = async (chunkRows: any[], groupName: string) => {
      if (chunkRows.length === 0) return;

      const chunkWorkbook = new ExcelJS.Workbook();

      // Create main sheet
      await createSheetWithData(
        chunkWorkbook,
        worksheet.name,
        worksheet,
        headerRowsData,
        chunkRows,
        maxColumn,
        headerRows,
        mergeMap,
        detectedMerges,
      );

      // Add additional sheets
      let additionalSheetsAdded = 0;
      for (const [sheetName, groupedData] of additionalSheetData) {
        const additionalRows = groupedData.get(groupName) || [];

        if (additionalRows.length > 0) {
          const sheetConfig = findSheetConfig(
            additionalSheets,
            workbook,
            sheetName,
            includeHiddenSheets,
          );

          if (sheetConfig) {
            try {
              const sourceSheet = getSheetByConfig(
                workbook,
                sheetConfig,
                includeHiddenSheets,
              );
              const {
                headerRowsData: additionalHeaders,
                detectedMerges: additionalMerges,
                mergeMap: additionalMergeMap,
                maxColumn: additionalMaxColumn,
              } = await getSheetStructure(
                sourceSheet,
                sheetConfig.headerRows || 1,
                sheetConfig.maxColumnsToInclude,
              );

              const sanitizedGroupName = groupName.replace(
                /[<>:"/\\|?*]/g,
                '_',
              );
              await createSheetWithData(
                chunkWorkbook,
                `${sheetName} - ${sanitizedGroupName}`,
                sourceSheet,
                additionalHeaders,
                additionalRows,
                additionalMaxColumn,
                sheetConfig.headerRows || 1,
                additionalMergeMap,
                additionalMerges,
              );

              additionalSheetsAdded++;
            } catch (error) {
              console.error(
                `❌ Error creating additional sheet for "${sheetName}":`,
                error,
              );
            }
          }
        }
      }

      // Save file
      const today = new Date();
      const dateString = `${today.getDate().toString().padStart(2, '0')}.${(today.getMonth() + 1).toString().padStart(2, '0')}.${today.getFullYear()}`;
      const sanitizedGroupName = groupName.replace(/[<>:"/\\|?*]/g, '_');
      const chunkPath = path.join(
        destPath,
        `${sanitizedGroupName} - ${dateString}.xlsx`,
      );

      await chunkWorkbook.xlsx.writeFile(chunkPath);
      chunkCount++;

      const totalRows =
        chunkRows.length +
        Array.from(additionalSheetData.values()).reduce(
          (sum, groupMap) => sum + (groupMap.get(groupName)?.length || 0),
          0,
        );

      console.log(
        `✅ Saved chunk "${groupName}" with ${totalRows} total rows (${chunkWorkbook.worksheets.length} sheets): ${path.basename(chunkPath)}`,
      );
    };

    // Save all chunks
    for (const [groupName, rows] of rowGroups) {
      await saveChunk(rows, groupName);
    }

    // Final summary
    const totalTime = Date.now() - startTime;
    const minutes = Math.floor(totalTime / 60000);
    const seconds = Math.floor((totalTime % 60000) / 1000);

    console.log(`\n📊 Performance Summary:`);
    console.log(`  ⏱️ Total time: ${minutes}m ${seconds}s`);
    console.log(
      `✅ Slicing complete. ${chunkCount} chunk(s) saved based on column ${splitColumnPosition} values.`,
    );
    console.log(`🏁 Finished at: ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error('❌ Error slicing document:', error);
    console.log(`⏱️ Failed after: ${totalTime}ms`);
  }
};

export { sliceDocumentForChunks };
