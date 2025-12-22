import fs from 'fs/promises';
import * as XLSX from 'xlsx';

import type { ExtendedNameMatch } from '../../features/nlp-extract-info.mjs';

interface ProcessingResult {
  inputName: string;
  matches: ExtendedNameMatch[];
  documentsSearched: number;
  totalMatches: number;
}

/**
 * Read names from the first column of an Excel file
 */
async function readExcelData(filePath: string): Promise<string[]> {
  try {
    const fileBuffer = await fs.readFile(filePath);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

    // Get first worksheet
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // Convert to JSON to extract first column
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // Extract names from first column, skip empty cells
    const names: string[] = [];
    for (const row of jsonData as any[][]) {
      if (row[0] && typeof row[0] === 'string' && row[0].trim()) {
        names.push(row[0].trim());
      }
    }

    return names;
  } catch (error: Error | any) {
    console.error(`Failed to read Excel file ${filePath}:`, error);
    throw new Error(`Could not read input Excel file: ${error.message}`);
  }
}

/**
 * Write processing results to Excel file
 */
async function writeExcelResults(
  results: ProcessingResult[],
  outputPath: string,
): Promise<void> {
  try {
    // Prepare data for Excel
    const excelData: any[][] = [
      // Header row - added "Found Form" as 2nd column
      [
        'Input Name',
        'Found Form',
        'Matches Found',
        'Documents Searched',
        'Match Details',
        'Documents with Matches',
      ],
    ];

    for (const result of results) {
      // Group matches by document for better presentation
      const matchesByDoc = new Map<string, ExtendedNameMatch[]>();
      result.matches.forEach((match) => {
        const docPath = match.documentPath || 'unknown';
        if (!matchesByDoc.has(docPath)) {
          matchesByDoc.set(docPath, []);
        }
        matchesByDoc.get(docPath)!.push(match);
      });

      // Extract the first/primary matched form for the 2nd column
      const primaryMatchedForm =
        result.matches.length > 0 ? result.matches[0].declension : '';

      // Create match details string
      const matchDetails: string[] = [];
      const documentsWithMatches: string[] = [];

      matchesByDoc.forEach((matches, docPath) => {
        documentsWithMatches.push(docPath);

        matches.forEach((match) => {
          const confidence = (match.confidence * 100).toFixed(1);
          matchDetails.push(
            `"${match.declension}" in ${docPath} (confidence: ${confidence}%)`,
          );
        });
      });

      // Add row to Excel data - inserted primaryMatchedForm as 2nd column
      excelData.push([
        result.inputName,
        primaryMatchedForm, // NEW: 2nd column with matched form
        result.totalMatches,
        result.documentsSearched,
        matchDetails.join('\n'),
        documentsWithMatches.join('\n'),
      ]);
    }

    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths for better readability - updated for 6 columns
    const columnWidths = [
      { wch: 20 }, // Input Name
      { wch: 20 }, // Found Form (NEW)
      { wch: 15 }, // Matches Found
      { wch: 18 }, // Documents Searched
      { wch: 60 }, // Match Details
      { wch: 40 }, // Documents with Matches
    ];
    worksheet['!cols'] = columnWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'NLP Results');

    // Write to file
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    await fs.writeFile(outputPath, buffer);

    console.log(`📊 Excel results written to: ${outputPath}`);
  } catch (error: Error | any) {
    console.error(`Failed to write Excel results:`, error);
    throw new Error(`Could not write Excel results: ${error.message}`);
  }
}

/**
 * Create a detailed results sheet with individual matches
 */
async function writeDetailedResults(
  results: ProcessingResult[],
  outputPath: string,
): Promise<void> {
  const detailedData: any[][] = [
    [
      'Input Name',
      'Found Text',
      'Document',
      'Position',
      'Confidence',
      'Context',
    ],
  ];

  for (const result of results) {
    if (result.matches.length === 0) {
      // Add row for names with no matches
      detailedData.push([result.inputName, 'No matches found', '', '', '', '']);
    } else {
      // Add row for each match
      result.matches.forEach((match) => {
        const confidence = (match.confidence * 100).toFixed(1) + '%';
        detailedData.push([
          result.inputName,
          match.declension,
          match.documentPath || 'unknown',
          match.position,
          confidence,
          '', // Context could be added here if needed
        ]);
      });
    }
  }

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(detailedData);

  // Set column widths
  worksheet['!cols'] = [
    { wch: 20 }, // Input Name
    { wch: 25 }, // Found Text
    { wch: 30 }, // Document
    { wch: 10 }, // Position
    { wch: 12 }, // Confidence
    { wch: 40 }, // Context
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Detailed Matches');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const detailedPath = outputPath.replace('.xlsx', '_detailed.xlsx');
  await fs.writeFile(detailedPath, buffer);

  console.log(`📋 Detailed results written to: ${detailedPath}`);
}

export { readExcelData, writeDetailedResults, writeExcelResults };
