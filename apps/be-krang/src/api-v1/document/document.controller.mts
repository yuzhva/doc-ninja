import type { Request, Response } from 'express';
import fs from 'fs/promises';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';
import os from 'os';
import path from 'path';
import { DocumentExtractor } from 'toolkit--local/node';

import {
  sliceDocumentForChunksViaExcelJs,
  sliceDocumentForChunksViaPythonScript,
} from '../../features/doc-to-chunks/index.mjs';
import { executePythonScript } from '../../python-scripts/python-executor.mjs';
import {
  appendExtension,
  replaceExtension,
} from '../../supplement/file-extension-utils.mjs';

interface BatchRequest {
  batchIndex: number;
  totalBatches: number;
  structure: any;
  files: Array<{
    path: string;
    name: string;
    content: string;
    size: number;
    modifiedAt: string;
  }>;
}

const postConvertSpreadsheetToStatic = async (req: Request, res: Response) => {
  const tempFiles: string[] = [];

  try {
    // Only support multipart/form-data uploads
    if (!req.file) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'NO_FILE',
          message: 'File upload required. Use multipart/form-data.',
        },
      });
    }

    const buffer = req.file.buffer;
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString(
      'utf8',
    );
    const filenameSuffix = req.body.filenameSuffix ?? ' - static';

    console.log(
      `✅ Processing uploaded file for static conversion: ${fileName} (${buffer.length} bytes)`,
    );

    const processedFiles = [];
    const failedFiles = [];

    try {
      // Setup paths
      const tempDir = os.tmpdir();
      const timestamp = Date.now();

      // Use simple ASCII-safe temp filenames to avoid encoding issues
      const inputFilePath = path.join(tempDir, `input_${timestamp}.xlsx`);
      const outputFilePath = path.join(tempDir, `output_${timestamp}.xlsm`);
      tempFiles.push(inputFilePath, outputFilePath);

      // Write buffer to temp file
      await fs.writeFile(inputFilePath, buffer);

      console.log('Spawning Python conversion script (openpyxl)...');

      await executePythonScript(
        'convert_xlsx_to_static',
        [inputFilePath, outputFilePath],
        {
          onLog: (str) => console.log(`Python: ${str}`),
          onError: (str) => console.error(`Python Error: ${str}`),
        },
      );

      // Read the converted file
      const convertedBuffer = await fs.readFile(outputFilePath);

      // Add suffix before the extension - preserve original filename encoding
      const originalFileExt = path.extname(fileName);
      const nameWithoutExt = fileName.slice(0, -originalFileExt.length);
      const staticFileExt = '.xlsm';
      const staticFileName = `${nameWithoutExt}${filenameSuffix}${staticFileExt}`;

      processedFiles.push({
        name: staticFileName,
        content: convertedBuffer.toString('base64'),
        relativePath: staticFileName,
        originalPath: fileName,
      });

      console.log(
        `✅ Successfully converted ${fileName} to static format as ${staticFileName}`,
      );
    } catch (error: Error | any) {
      console.error(`❌ Failed to convert ${fileName}:`, error);
      failedFiles.push({
        fileName,
        path: fileName,
        error: error.message,
      });
    }

    res.status(StatusCodes.OK).json({
      batchIndex: 1,
      totalBatches: 1,
      processedFiles,
      failedFiles,
      summary: {
        processed: processedFiles.length,
        failed: failedFiles.length,
      },
    });
  } catch (error: Error | any) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(StatusCodes.REQUEST_TOO_LONG).json({
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'File size exceeds 100MB limit',
        },
      });
    }

    console.error('Spreadsheet to static conversion error:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: ReasonPhrases.INTERNAL_SERVER_ERROR,
      },
    });
  } finally {
    // Cleanup temp files
    for (const tempFile of tempFiles) {
      await fs.unlink(tempFile).catch(() => {});
    }
  }
};

const postDocumentToText = async (req: Request, res: Response) => {
  try {
    if (!req.files || !Array.isArray(req.files)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'NO_FILES',
          message: 'Files upload required. Use multipart/form-data.',
        },
      });
    }

    const batchIndex = Number(req.body.batchIndex);
    const totalBatches = Number(req.body.totalBatches);
    const structure = req.body.structure
      ? JSON.parse(req.body.structure)
      : null;

    // Create a map of filename -> path from the structure
    const filePaths = new Map<string, string>();
    const collectPaths = (node: any) => {
      if (node.type === 'file') filePaths.set(node.name, node.path);
      node.children?.forEach(collectPaths);
    };
    if (structure) collectPaths(structure);

    // Map files using the lookup map
    const filesToProcess = (req.files as Express.Multer.File[]).map((f) => {
      // Fix encoding just like in other endpoints to handle Ukrainian characters correctly
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');

      return {
        name,
        path: filePaths.get(name) || name,
        buffer: f.buffer,
      };
    });

    console.log(
      `Processing batch ${batchIndex}/${totalBatches} with ${filesToProcess.length} files`,
    );

    const processedFiles = [];
    const failedFiles = [];

    for (const fileData of filesToProcess) {
      try {
        // Use the advanced converter to get text from buffer
        const docExtractor = new DocumentExtractor();

        const text = await docExtractor.extractText({
          fileBuffer: fileData.buffer,
          fileName: fileData.name,
        });

        processedFiles.push({
          name: appendExtension(fileData.name, '.txt'),
          content: text, // Use the converted text
          relativePath: appendExtension(fileData.path, '.txt'),
          originalPath: fileData.path,
        });
      } catch (error: Error | any) {
        failedFiles.push({
          fileName: fileData.name,
          path: fileData.path,
          error: error.message,
        });
      }
    }

    res.status(StatusCodes.OK).json({
      batchIndex,
      totalBatches,
      processedFiles,
      failedFiles,
      summary: {
        processed: processedFiles.length,
        failed: failedFiles.length,
      },
    });
  } catch (error) {
    console.error('Document to text error:', error);

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: ReasonPhrases.INTERNAL_SERVER_ERROR,
      },
    });
  }
};

const postDocumentToSlice = async (req: Request, res: Response) => {
  try {
    // Only support multipart/form-data uploads
    if (!req.file) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: {
          code: 'NO_FILE',
          message: 'File upload required. Use multipart/form-data.',
        },
      });
    }

    const buffer = req.file.buffer;
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString(
      'utf8',
    );

    console.log(
      `✅ Processing uploaded file: ${fileName} (${buffer.length} bytes)`,
    );

    const processedFiles = [];
    const failedFiles = [];

    try {
      const sliceDocumentForChunks =
        req.body.isFasterLessStyledChunkerUsed === 'true'
          ? sliceDocumentForChunksViaExcelJs
          : sliceDocumentForChunksViaPythonScript;
      const chunkFiles = await sliceDocumentForChunks({
        buffer,
        originalFileName: fileName,
        sheetToChunkPosition: parseInt(req.body.sheetToChunkPosition),
        headerRows: parseInt(req.body.headerRows),
        splitColumnPosition: parseInt(req.body.splitColumnPosition),
        maxColumnsToInclude: parseInt(req.body.maxColumnsToInclude),
        filenameSuffix: req.body.filenameSuffix,
        chunkNamePattern: '^([0-9]+\\s+[а-яА-ЯіІїЇєЄ]+|[а-яА-ЯіІїЇєЄ]+)',
        includeHiddenSheets: false,
        additionalSheets: [...JSON.parse(req.body.additionalSheets || '[]')],
      });

      // Convert chunk files to the unified format
      for (const chunkFile of chunkFiles) {
        processedFiles.push({
          name: chunkFile.name,
          content: chunkFile.content.toString('base64'),
          relativePath: chunkFile.relativePath,
          originalPath: fileName,
        });
      }

      console.log(
        `✅ Successfully processed ${chunkFiles.length} chunks from ${fileName}`,
      );
    } catch (error: Error | any) {
      console.error(`❌ Failed to process ${fileName}:`, error);
      failedFiles.push({
        fileName,
        path: fileName,
        error: error.message,
      });
    }

    res.status(StatusCodes.OK).json({
      batchIndex: 1,
      totalBatches: 1,
      processedFiles,
      failedFiles,
      summary: {
        processed: processedFiles.length,
        failed: failedFiles.length,
      },
    });
  } catch (error: Error | any) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(StatusCodes.REQUEST_TOO_LONG).json({
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'File size exceeds 100MB limit',
        },
      });
    }

    console.error('Document slice error:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: ReasonPhrases.INTERNAL_SERVER_ERROR,
      },
    });
  }
};

export {
  postConvertSpreadsheetToStatic,
  postDocumentToSlice,
  postDocumentToText,
};
