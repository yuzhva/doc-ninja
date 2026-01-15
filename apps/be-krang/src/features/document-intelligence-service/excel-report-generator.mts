import * as XLSX from 'xlsx';

interface ExcelColumn {
  header: string;
  key: string;
  options?: {
    wch?: number;
    hidden?: boolean;
  };
}

// We remove the rigid ExcelReportData interface in favor of a generic structure defined by columns
type ReportRow = Record<string, any>;

class ExcelReportGenerator {
  /**
   * Generate Excel report from pre-processed data with dynamic columns.
   */
  async generateReport(
    reportRows: ReportRow[],
    columns: ExcelColumn[],
    filename?: string,
  ): Promise<{ reportBuffer: Buffer; reportFilename: string }> {
    console.log(
      `📊 Generating Excel report from ${reportRows.length} data rows...`,
    );

    // Generate Excel workbook
    const defaultFilename = `dis-report-${new Date().toISOString().split('T')[0]}`;
    const reportFilename = `${filename || defaultFilename}.xlsx`;
    const reportBuffer = await this.createExcelWorkbook(reportRows, columns);

    console.log(`📋 Excel report generated (${reportBuffer.length} bytes)`);

    return { reportBuffer, reportFilename };
  }

  /**
   * Create Excel workbook with formatted data
   */
  private async createExcelWorkbook(
    reportRows: ReportRow[],
    columns: ExcelColumn[],
  ): Promise<Buffer> {
    console.log(
      `📊 Generating enhanced Excel workbook with ${columns.length} columns...`,
    );

    // Prepare worksheet data
    // 1. Headers
    const headers = columns.map((col) => col.header);
    const data: any[][] = [headers];

    // 2. Data Rows
    for (const row of reportRows) {
      const rowData = columns.map((col) => {
        const val = row[col.key];
        return val !== undefined && val !== null ? val : '';
      });
      data.push(rowData);
    }

    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    worksheet['!cols'] = columns.map((col) => ({ ...(col.options || {}) }));

    XLSX.utils.book_append_sheet(workbook, worksheet, 'DIS Results');

    // Write to buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return buffer;
  }
}

export { ExcelReportGenerator };
export type { ExcelColumn, ReportRow };
