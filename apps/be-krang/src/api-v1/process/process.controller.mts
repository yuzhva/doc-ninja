import type { Request, Response } from 'express';
import * as fs from 'fs';
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
    const maxTypoDistance = req.body.maxTypoDistance;
    const searchOptions = {
      pageSize: pageSize === 'ALL' ? pageSize : Number(pageSize) || 10,
      sortOrder,
      searchScopedPaths: req.body.searchScopedPaths,
      isTypoToleranceEnabled: req.body.isTypoToleranceEnabled,
      maxTypoDistance,
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

/**
 * Re-scans an already-picked source folder so the UI can refresh its directory
 * tree (new subfolders, changed file counts) without making the user re-open
 * the folder picker.
 *
 * Deliberately mirrors Electron's directory-picker handler: the same
 * `FileScannerNode.scanDirectory` defaults and the same
 * `{ name, filePath, files }` DTO. That parity matters — the UI compares a
 * refreshed tree against the stored one to decide whether anything changed, so
 * any scan-option drift here would make every refresh look like a change.
 */
const postReadDirectoryStructure = async (req: Request, res: Response) => {
  try {
    const { sourcePath } = req.body;

    if (!sourcePath || typeof sourcePath !== 'string') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'sourcePath is required and must be a string.',
        },
      });
    }

    // A source folder can be renamed, moved or deleted between two runs, so
    // this is an expected outcome rather than a server fault — hence 404 and
    // not the catch-all 500 below.
    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(sourcePath);
    } catch {
      return res.status(StatusCodes.NOT_FOUND).json({
        error: {
          code: 'SOURCE_PATH_NOT_FOUND',
          message: `Source folder not found: ${sourcePath}`,
        },
      });
    }

    if (!stats.isDirectory()) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'INVALID_PARAMETERS',
          message: `Source path is not a directory: ${sourcePath}`,
        },
      });
    }

    const files = await FileScannerNode.scanDirectory(sourcePath);

    res.status(StatusCodes.OK).json({
      name: path.basename(sourcePath),
      filePath: sourcePath,
      files,
    });
  } catch (error) {
    console.error('Read directory structure error:', error);

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

type DocumentsIndexAction = 'reindex' | 'delete-cache';

const DOCUMENTS_INDEX_ACTIONS: DocumentsIndexAction[] = [
  'reindex',
  'delete-cache',
];

const postManageDocumentsIndex = async (req: Request, res: Response) => {
  try {
    const { action, sourcePath } = req.body;

    if (
      !action ||
      !DOCUMENTS_INDEX_ACTIONS.includes(action as DocumentsIndexAction)
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'INVALID_PARAMETERS',
          message: `action is required and must be one of: ${DOCUMENTS_INDEX_ACTIONS.join(', ')}.`,
        },
      });
    }

    if (!sourcePath || typeof sourcePath !== 'string') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'sourcePath is required and must be a string.',
        },
      });
    }

    const documentIntelligenceService = new DocumentIntelligenceService(
      sourcePath,
    );

    switch (action as DocumentsIndexAction) {
      case 'reindex':
        await documentIntelligenceService.reindex();
        break;
      case 'delete-cache':
        await documentIntelligenceService.clearCache();
        break;
    }

    res.status(StatusCodes.OK).json({ action, sourcePath });
  } catch (error) {
    console.error('Manage documents index error:', error);

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
  postManageDocumentsIndex,
  postProcessDocuments,
  postReadDirectoryStructure,
  postReadFileContent,
};
