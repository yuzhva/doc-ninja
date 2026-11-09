import type { Request, Response } from 'express';
import * as fs from 'fs';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';
import * as path from 'path';
import { setImmediate as nextTurn } from 'timers/promises';
import { FileScannerNode } from 'toolkit--local/node';

import {
  DocumentIntelligenceService,
  ExcelReportGenerator,
} from '../../features/document-intelligence-service/index.mjs';
import type { SearchFolder } from '../../features/document-intelligence-service/index.mjs';
import { InformationExtractor } from '../../features/document-intelligence-service/information-extractor.mjs';
import type { ExtractorSchema } from '../../features/document-intelligence-service/information-extractor.mjs';

// One entry per search, as decided by the client: the search form sends its
// whole textarea as a single entry, or one entry per row from its per-line
// editor. Nothing is cut up here — a newline inside an entry belongs to the
// phrase being searched for, so splitting on it would break a quote that spans
// several lines. Only trimming and dropping the blanks is this layer's job.
const normalizeSearchQueries = (bulkNames: unknown): string[] =>
  (Array.isArray(bulkNames) ? bulkNames : [bulkNames])
    .filter((entry): entry is string => typeof entry === 'string')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

/** A source folder to search, and the parser config for what's found in it. */
type SearchSource = SearchFolder & { extractorSchema?: ExtractorSchema };

/**
 * The source folders a search request names, in `sources` — or, from a
 * client that searches one folder, at the top level of the body
 * (`sourcePath`, `searchScopedPaths`, `extractorSchema`). Null when there is
 * none, or one without a path.
 */
const readSearchSources = (body: any): SearchSource[] | null => {
  const named: unknown[] = Array.isArray(body?.sources)
    ? body.sources
    : [
        {
          sourcePath: body?.sourcePath,
          searchScopedPaths: body?.searchScopedPaths,
          extractorSchema: body?.extractorSchema,
        },
      ];

  const sources: SearchSource[] = [];
  for (const source of named as any[]) {
    if (typeof source?.sourcePath !== 'string' || !source.sourcePath) {
      return null;
    }
    sources.push({
      sourcePath: source.sourcePath,
      searchScopedPaths: Array.isArray(source.searchScopedPaths)
        ? source.searchScopedPaths.filter(
            (scope: unknown): scope is string => typeof scope === 'string',
          )
        : [],
      extractorSchema: source.extractorSchema ?? undefined,
    });
  }

  return sources.length > 0 ? sources : null;
};

/**
 * Aborts once the client is gone before its answer is sent: the connection
 * closed by a fetch() cancelled in the browser, or by a request Electron's
 * backend process cancelled (see backend-process.mts in apps/electron).
 *
 * The response's close, not the request's: since Node 16 the request's
 * fires as soon as its body is read.
 */
const abortedWhenClientLeaves = (res: Response): AbortSignal => {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
};

const postProcessDocuments = async (req: Request, res: Response) => {
  const signal = abortedWhenClientLeaves(res);

  try {
    // Get queries from bulkNames payload
    const queries = normalizeSearchQueries(req.body.bulkNames);

    if (queries.length === 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: { message: 'No queries provided in bulkNames' },
      });
    }

    const sources = readSearchSources(req.body);

    if (!sources) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: { message: 'No source folder provided to search in' },
      });
    }

    // Extract search options from request
    const pageSize = req.body.pageSize;
    const sortOrder = req.body.sortOrder;
    const maxTypoDistance = req.body.maxTypoDistance;
    const searchOptions = {
      pageSize: pageSize === 'ALL' ? pageSize : Number(pageSize) || 10,
      sortOrder,
      isInflectedWordFormsAllowed: req.body.isInflectedWordFormsAllowed,
      maxTypoDistance,
      signal,
    };

    const searchResults = await DocumentIntelligenceService.searchFolders(
      sources,
      queries,
      searchOptions,
    );

    // Parsing what was found takes its time too: not for a search cancelled
    // as its last query ended
    await nextTurn();
    signal.throwIfAborted();

    // Each result is parsed the way its own folder asked for
    const extractorSchemaBySourcePath = new Map(
      sources.map((source) => [source.sourcePath, source.extractorSchema]),
    );
    const extractedResults = await InformationExtractor.extractSearchResults(
      (sourcePath) => extractorSchemaBySourcePath.get(sourcePath),
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
    // Nobody to answer: the connection is closed
    if (signal.aborted) {
      console.info('Search cancelled by the client');
      return;
    }

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
