import type { Request, Response } from 'express';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';

import {
  DocumentIntelligenceService,
  ExcelReportGenerator,
} from '../../features/document-intelligence-service/index.mts';
import { InformationExtractor } from '../../nlp/information-extractor.mts';

const mapExtractedResultsToReportRows = (results: any[]) => {
  return results.map((row: any) => {
    // If it looks like ExtractedInfo (has searchQuery), map it
    if ('searchQuery' in row) {
      return {
        inputName: row.searchQuery,
        foundInDocument: row.foundInDocument,
        documentDate: row.documentDate,
        foundDeclension: row.matchedText,
        sectionTitle: row.sectionTitle,
        content: row.content,
        actionDateContent: row.actionDateContent,
        reason: row.reason,
        summary: row.summary,
        actionDate: row.actionDate,
        status: row.status,
        commandType: row.commandType,
        confidence: row.confidence || '',
      };
    }
    // Otherwise assume it's already in report format
    return row;
  });
};

const postProcessDocuments = async (req: Request, res: Response) => {
  try {
    // Get queries from bulkNames payload
    const bulkNames = req.body.bulkNames || '';
    const queries = bulkNames
      .split(/[,\n]/)
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    if (queries.length === 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: { message: 'No queries provided in bulkNames' },
      });
    }

    // Extract search options from request
    const pageSize = req.body.pageSize;
    const sortOrder = req.body.sortOrder;
    const searchOptions = {
      pageSize: pageSize === 'ALL' ? pageSize : Number(pageSize) || 10,
      sortOrder,
    };

    // Use DocumentIntelligenceService for search
    const documentIntelligenceService = new DocumentIntelligenceService();
    const excelReportGenerator = new ExcelReportGenerator();

    const searchResults = await documentIntelligenceService.searchDocuments(
      queries,
      searchOptions,
    );

    const extractedResults =
      await InformationExtractor.extractSearchResults(searchResults);

    // Generate Excel report
    const reportRows = mapExtractedResultsToReportRows(extractedResults);

    // Generate report
    const { reportBuffer, reportFilename } =
      await excelReportGenerator.generateReport(
        reportRows,
        req.body.outputFileName,
      );

    const processedFiles = [
      {
        name: reportFilename,
        content: reportBuffer.toString('base64'),
        relativePath: reportFilename,
        originalPath: reportFilename,
      },
    ];

    res.status(StatusCodes.OK).json({
      batchIndex: 1,
      totalBatches: 1,
      processedFiles,
      failedFiles: [],
      summary: {
        processed: processedFiles.length,
        failed: 0,
      },
      results: searchResults,
      extractedResults,
    });
  } catch (error) {
    console.error('Process documents error:', error);

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: ReasonPhrases.INTERNAL_SERVER_ERROR,
      },
    });
  }
};

const postGenerateFilteredSpreadsheet = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'NO_FILE',
          message: 'File upload required (filteredResults).',
        },
      });
    }

    const buffer = req.file.buffer;
    const content = buffer.toString('utf-8');
    let inputRows;

    try {
      inputRows = JSON.parse(content);
    } catch (e) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'INVALID_JSON',
          message: 'Failed to parse JSON file.',
        },
      });
    }

    if (!Array.isArray(inputRows)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'INVALID_DATA',
          message: 'Expected an array of rows.',
        },
      });
    }

    // Map incoming extracted results to report rows format if needed
    const reportRows = mapExtractedResultsToReportRows(inputRows);

    const excelReportGenerator = new ExcelReportGenerator();

    const { reportBuffer, reportFilename } =
      await excelReportGenerator.generateReport(reportRows);

    const processedFiles = [
      {
        name: reportFilename,
        content: reportBuffer.toString('base64'),
        relativePath: reportFilename,
        originalPath: reportFilename,
      },
    ];

    res.status(StatusCodes.OK).json({
      batchIndex: 1,
      totalBatches: 1,
      processedFiles,
      failedFiles: [],
      summary: {
        processed: processedFiles.length,
        failed: 0,
      },
    });
  } catch (error) {
    console.error('Generate filtered spreadsheet error:', error);

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: ReasonPhrases.INTERNAL_SERVER_ERROR,
      },
    });
  }
};

export { postGenerateFilteredSpreadsheet, postProcessDocuments };
