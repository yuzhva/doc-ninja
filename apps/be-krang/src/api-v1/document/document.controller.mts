import type { Request, Response } from 'express';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';

import { buildIndex } from '../../features/doc-build-index.mts';
import { sliceDocumentForChunks } from '../../features/doc-to-chunks/doc-to-chunks.mts';
import { convertDocViaHtmlToTxtAdvanced } from '../../supplement/convert-doc-to-txt.mts';
import {
  appendExtension,
  replaceExtension,
} from '../../supplement/file-extension-utils.mts';

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

const postDocumentToText = async (req: Request, res: Response) => {
  try {
    const { batchIndex, totalBatches, files }: BatchRequest = req.body;

    console.log(
      `Processing batch ${batchIndex}/${totalBatches} with ${files.length} files`,
    );

    const processedFiles = [];
    const failedFiles = [];

    for (const fileData of files) {
      try {
        // Convert base64 content back to a buffer
        const buffer = Buffer.from(fileData.content, 'base64');

        // Use the advanced converter to get text from buffer
        const { text } = await convertDocViaHtmlToTxtAdvanced(
          buffer,
          fileData.name,
        );

        processedFiles.push({
          name: appendExtension(fileData.name, '.txt'),
          content: text, // Use the converted text
          relativePath: appendExtension(fileData.path, '.txt'),
          originalPath: fileData.path,
        });
      } catch (error) {
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

const postTextToIndex = async (req: Request, res: Response) => {
  try {
    const { batchIndex, totalBatches, files }: BatchRequest = req.body;

    console.log(
      `Processing text-to-index batch ${batchIndex}/${totalBatches} with ${files.length} files`,
    );

    const processedFiles = [];
    const failedFiles = [];

    for (const fileData of files) {
      try {
        // Convert base64 content back to text (for text files, base64 is just encoded text)
        const textContent = Buffer.from(fileData.content, 'base64').toString(
          'utf-8',
        );

        // Build index for this text file (simplified - just add metadata and structure)
        const indexData = {
          originalFile: fileData.name,
          path: fileData.path,
          size: fileData.size,
          modifiedAt: fileData.modifiedAt,
          wordCount: textContent.split(/\s+/).length,
          charCount: textContent.length,
          content: textContent,
          indexed: true,
          indexedAt: new Date().toISOString(),
        };

        processedFiles.push({
          name: replaceExtension(fileData.name, '.json'),
          content: JSON.stringify(indexData, null, 2),
          relativePath: replaceExtension(fileData.path, '.json'),
          originalPath: fileData.path,
        });
      } catch (error) {
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
    console.error('Text to index error:', error);

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
    const fileName = req.file.originalname;

    console.log(
      `✅ Processing uploaded file: ${fileName} (${buffer.length} bytes)`,
    );

    const processedFiles = [];
    const failedFiles = [];

    try {
      /*
      // Convert formulas to values and get the processed buffer
      const convertedBuffer = await convertFormulasToValues(buffer);

      // Create the processed file object
      const processedFile = {
        name: fileName.replace('.xlsx', '_converted.xlsx'),
        content: convertedBuffer.toString('base64'),
        relativePath: fileName.replace('.xlsx', '_converted.xlsx'),
        originalPath: fileName,
      };

      processedFiles.push(processedFile);

      console.log(`✅ Successfully converted formulas in ${fileName}`);
      */

      // Process the Excel file
      const chunkFiles = await sliceDocumentForChunks({
        buffer,
        sheetToChunkPosition: 2,
        headerRows: 5,
        splitColumnPosition: 11,
        maxColumnsToInclude: 17,
        chunkNamePattern: '^([0-9]+\\s+[а-яА-ЯіІїЇєЄ]+|[а-яА-ЯіІїЇєЄ]+)',
        includeHiddenSheets: false,
        additionalSheets: [
          {
            sheetIndex: 8,
            filterColumnPosition: 19,
            headerRows: 3,
          },
          {
            sheetIndex: 9,
            filterColumnPosition: 5,
            headerRows: 2,
          },
        ],
      });
      // const chunkFiles = await sliceDocumentForChunks({
      //   buffer,
      //   sheetToChunkPosition: 1,
      //   headerRows: 5,
      //   splitColumnPosition: 11,
      //   maxColumnsToInclude: 17,
      //   chunkNamePattern: '^([0-9]+\\s+[а-яА-ЯіІїЇєЄ]+|[а-яА-ЯіІїЇєЄ]+)',
      //   includeHiddenSheets: false,
      // });

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
    } catch (error) {
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
  } catch (error) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(StatusCodes.REQUEST_ENTITY_TOO_LARGE).json({
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

export { postDocumentToText, postTextToIndex, postDocumentToSlice };
