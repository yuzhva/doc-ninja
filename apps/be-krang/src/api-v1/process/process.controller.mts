import type { Request, Response } from 'express';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';
import * as path from 'path';
import { FileScannerNode } from 'toolkit--local/node';

import {
  DocumentIntelligenceService,
  ExcelReportGenerator,
} from '../../features/document-intelligence-service/index.mjs';
import { InformationExtractor } from '../../features/document-intelligence-service/information-extractor.mjs';
import type { ExtractorSchema } from '../../features/document-intelligence-service/information-extractor.mjs';

const postProcessDocuments = async (req: Request, res: Response) => {
  try {
    // Get queries from bulkNames payload
    const bulkNames: string = req.body.bulkNames || '';
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
      searchScopedPaths: req.body.searchScopedPaths,
      isTypoToleranceEnabled: req.body.isTypoToleranceEnabled,
    };

    // Use DocumentIntelligenceService for search
    const documentIntelligenceService = new DocumentIntelligenceService(
      req.body.sourcePath,
    );

    const searchResults = await documentIntelligenceService.searchDocuments(
      queries,
      searchOptions,
    );

    const extractorSchema: ExtractorSchema | undefined =
      req.body.extractorSchema;
    const extractedResults = await InformationExtractor.extractSearchResults(
      extractorSchema,
      searchResults,
    );

    res.status(StatusCodes.OK).json({
      batchIndex: 1,
      totalBatches: 1,
      failedFiles: [],
      summary: {
        processed: 1,
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
          message:
            'File upload required (filteredResults with columns and rows).',
        },
      });
    }

    const buffer = req.file.buffer;
    const content = buffer.toString('utf-8');
    let parsedContent;

    try {
      parsedContent = JSON.parse(content);
    } catch (e) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'INVALID_JSON',
          message: 'Failed to parse JSON file.',
        },
      });
    }

    const { columns, rows } = parsedContent;

    if (!Array.isArray(rows)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'INVALID_DATA',
          message: 'Expected "rows" as an array in the JSON file.',
        },
      });
    }

    if (!Array.isArray(columns) || columns.length === 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'MISSING_COLUMNS',
          message: 'Expected "columns" as a non-empty array in the JSON file.',
        },
      });
    }

    // Map incoming extracted results to report rows format if needed
    // The FE is expected to send rows matching the column keys (searchQuery, matchedText, etc.)
    const reportRows = rows;

    const excelReportGenerator = new ExcelReportGenerator();

    const { reportBuffer, reportFilename } =
      await excelReportGenerator.generateReport(
        reportRows,
        columns,
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

const postReadFileContent = async (req: Request, res: Response) => {
  try {
    const { filePath } = req.body;

    if (!filePath || typeof filePath !== 'string') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'filePath is required and must be a string.',
        },
      });
    }

    const fileBuffer = await FileScannerNode.safeReadFile(filePath);

    const fileName = path.basename(filePath);
    const mimeType = 'application/octet-stream'; // Default binary type, adjust logic if needed

    // Return base64 encoded content so the frontend can handle binary or text
    res.status(StatusCodes.OK).json({
      fileName,
      mimeType,
      content: fileBuffer.toString('base64'),
    });
  } catch (error) {
    console.error('Read local file error:', error);

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          error instanceof Error
            ? error.message
            : ReasonPhrases.INTERNAL_SERVER_ERROR,
      },
    });
  }
};

export {
  postGenerateFilteredSpreadsheet,
  postProcessDocuments,
  postReadFileContent,
};
