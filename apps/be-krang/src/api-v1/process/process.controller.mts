import type { Request, Response } from 'express';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';

import { extractInformation } from '../../features/nlp-extract-info.mts';

const postProcessDocuments = async (_req: Request, res: Response) => {
  try {
    await extractInformation();

    res.status(StatusCodes.OK).json({
      message: ReasonPhrases.OK,
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

export { postProcessDocuments };
