import type { Request, Response } from 'express';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';

import { extractInformation } from '../../features/nlp-extract-info.mts';

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

    // TODO: replace ols {extractInformation} with DocumentIntelligenceService usage
    await extractInformation({ queries });

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
