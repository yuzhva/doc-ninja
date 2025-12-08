import express from 'express';

import { uploadSingle } from '../../middleware/upload.middleware.mts';
import * as ApiV1ProcessController from './process.controller.mts';

const expressRouter = express.Router();

const ProcessRoute = expressRouter
  .post('/process/documents', ApiV1ProcessController.postProcessDocuments)
  .post(
    '/process/generate-filtered-spreadsheet',
    uploadSingle,
    ApiV1ProcessController.postGenerateFilteredSpreadsheet,
  );

export { ProcessRoute };
