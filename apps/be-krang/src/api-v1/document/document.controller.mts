import type { Request, Response } from 'express';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';

import { buildIndex } from '../../features/doc-build-index.mts';
import { sliceDocumentForChunks } from '../../features/doc-to-chunks/doc-to-chunks.mts';
import { processFoldersTree } from '../../features/doc-to-text.mts';

const postDocumentToText = async (_req: Request, res: Response) => {
  try {
    await processFoldersTree();

    res.status(StatusCodes.OK).json({
      message: ReasonPhrases.OK,
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

const postTextToIndex = async (_req: Request, res: Response) => {
  try {
    await buildIndex();

    res.status(StatusCodes.OK).json({
      message: ReasonPhrases.OK,
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

const postDocumentToSlice = async (_req: Request, res: Response) => {
  try {
    await sliceDocumentForChunks({
      sheetToChunkPosition: 2,
      headerRows: 5,
      splitColumnPosition: 11,
      maxColumnsToInclude: 17,
      chunkNamePattern: '^([0-9]+\\s+[а-яА-ЯіІїЇєЄ]+|[а-яА-ЯіІїЇєЄ]+)',
      includeHiddenSheets: false, // DISABLED BY DEFAULT - prevents processing hidden sheets
      additionalSheets: [
        {
          sheetIndex: 8,
          filterColumnPosition: 19,
          headerRows: 3,
          // maxColumnsToInclude: 10,
        },
        {
          sheetIndex: 9,
          filterColumnPosition: 5,
          headerRows: 2,
          // maxColumnsToInclude: 10,
        },
      ],
    });

    res.status(StatusCodes.OK).json({
      message: ReasonPhrases.OK,
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

export { postDocumentToText, postTextToIndex, postDocumentToSlice };
