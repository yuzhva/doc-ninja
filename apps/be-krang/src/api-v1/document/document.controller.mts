import type { Request, Response } from 'express';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';

import { processFoldersTree } from '../../features/doc-to-text.mts';
import { buildIndex } from '../../features/doc-build-index.mts';

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

export { postDocumentToText, postTextToIndex };
