import fs from 'fs/promises';
import path from 'path';
import * as XLSX from 'xlsx';

import { runtimePathById } from '../../supplement/index.mts';

interface ExcelReportData {
  inputName: string;
  foundInDocument: string;
  documentDate: string;
  foundDeclension: string;
  sectionTitle: string;
  content: string;
  actionDateContent: string;
  reason: string;
  summary: string;
  actionDate: string;
  confidence: string;
}

class ExcelReportGenerator {
  /**
   * Generate Excel report from pre-processed data.
   */
  async generateReport(
    reportRows: ExcelReportData[],
    filename: string = 'document-intelligence-report.xlsx',
  ): Promise<string> {
    console.log(
      `📊 Generating Excel report from ${reportRows.length} data rows...`,
    );

    // Generate Excel workbook
    const outputPath = await this.createExcelWorkbook(reportRows, filename);

    console.log(`📋 Excel report saved: ${outputPath}`);

    return outputPath;
  }

  /**
   * Create Excel workbook with formatted data
   */
  private async createExcelWorkbook(
    reportRows: ExcelReportData[],
    filename: string,
  ): Promise<string> {
    console.log(
      `📊 Generating enhanced Excel workbook with complete match details...`,
    );

    const outputPath = path.join(
      runtimePathById.assets,
      'nlp-output',
      filename,
    );

    // Prepare worksheet data
    const data = [
      [
        'Input Name',
        'Found In Document',
        'Document Date',
        'Found Declension',
        'Section Title',
        'Content',
        'Action Date Content',
        'Reason',
        'Summary',
        'Action Date',
        'Confidence',
        'Learning Status',
      ],
    ];

    // Add data rows
    for (const match of reportRows) {
      const summaryParts: string[] = [];

      summaryParts.push(match.sectionTitle);
      summaryParts.push(''); // Add a blank line for separation
      summaryParts.push(match.content);
      summaryParts.push(match.actionDateContent);
      summaryParts.push(match.reason);

      const summary = summaryParts.join('\n').trim();

      data.push([
        match.inputName,
        match.foundInDocument,
        match.documentDate,
        match.foundDeclension,
        match.sectionTitle,
        match.content,
        match.actionDateContent,
        match.reason,
        summary,
        match.actionDate,
        match.confidence,
      ]);
    }

    // Add summary section
    data.push([]);
    data.push(['=== DOCUMENT INTELLIGENCE SUMMARY ===']);
    data.push(['Total Matches Found:', reportRows.length]);
    data.push([
      'Documents Processed:',
      new Set(reportRows.map((m) => m.foundInDocument)).size,
    ]);
    data.push(['Generated At:', new Date().toLocaleString('uk-UA')]);

    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(data);

    // Set column widths for better readability
    worksheet['!cols'] = [
      { wch: 25 }, // Input Name
      { wch: 50 }, // Found In Document
      { wch: 15 }, // Document Date
      { wch: 25 }, // Found Declension
      { wch: 40 }, // Section Title
      { wch: 60 }, // Content
      { wch: 30 }, // Action Date Content
      { wch: 50 }, // Reason
      { wch: 80 }, // Summary
      { wch: 15 }, // Action Date
      { wch: 12 }, // Confidence
      { wch: 25 }, // Learning Status
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Intelligence Results');

    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // Write the file
    XLSX.writeFile(workbook, outputPath);

    return outputPath;
  }
}

export { ExcelReportGenerator };
export type { ExcelReportData };
