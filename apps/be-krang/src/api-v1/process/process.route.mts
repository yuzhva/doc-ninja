import type { Router } from 'express';
import express from 'express';

import { uploadSingle } from '../../middleware/upload.middleware.mjs';
import * as ApiV1ProcessController from './process.controller.mjs';

const expressRouter: Router = express.Router();

const ProcessRoute = expressRouter
  .post('/process/documents', ApiV1ProcessController.postProcessDocuments)
  .post(
    '/process/read-file-content',
    ApiV1ProcessController.postReadFileContent,
  )
  .post(
    '/process/documents-index',
    ApiV1ProcessController.postManageDocumentsIndex,
  )
  .post(
    '/process/generate-filtered-spreadsheet',
    uploadSingle,
    ApiV1ProcessController.postGenerateFilteredSpreadsheet,
  );

export { ProcessRoute };
