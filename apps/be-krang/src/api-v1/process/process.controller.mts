import type { Request, Response } from 'express';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';

import { extractInformation } from '../../features/nlp-extract-info.mts';
// import { extractInformationModern } from '../../features/nlp-extract-info-modern.mts';
import { appendExtension } from '../../supplement/file-extension-utils.mts';

interface BatchRequest {
  batchIndex?: number;
  totalBatches?: number;
  structure: any;
  files: Array<{
    path: string;
    name: string;
    content: string;
    size: number;
    modifiedAt: string;
  }>;
}

const postProcessDocuments = async (req: Request, res: Response) => {
  try {
    // await extractInformationModern();
    await extractInformation();

    res.status(StatusCodes.OK).json({
      message: ReasonPhrases.OK,
    });
    /*
    const { batchIndex = 1, totalBatches = 1, files }: BatchRequest = req.body;

    console.log(
      `Processing documents batch ${batchIndex}/${totalBatches} with ${files.length} files`,
    );

    const processedFiles = [];
    const failedFiles = [];

    for (const fileData of files) {
      try {
        // Convert base64 content back to text/buffer depending on file type
        const isTextFile =
          fileData.name.endsWith('.txt') || fileData.name.endsWith('.json');
        const content = isTextFile
          ? Buffer.from(fileData.content, 'base64').toString('utf-8')
          : Buffer.from(fileData.content, 'base64');

        // Process the document (extract information using NLP)
        // For now, we'll create a simple processed result
        const processedResult = {
          originalFile: fileData.name,
          path: fileData.path,
          size: fileData.size,
          modifiedAt: fileData.modifiedAt,
          processedAt: new Date().toISOString(),
          content: isTextFile ? content : '[Binary file processed]',
          // Add any extracted information here
          extractedInfo: {
            // This would be populated by the actual NLP extraction
            processed: true,
            status: 'completed',
          },
        };

        processedFiles.push({
          name: appendExtension(fileData.name, '_processed.json'),
          content: JSON.stringify(processedResult, null, 2),
          relativePath: appendExtension(fileData.path, '_processed.json'),
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
    */
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

export { postProcessDocuments };
