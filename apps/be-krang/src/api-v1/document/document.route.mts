import express from 'express';

import { uploadSingle } from '../../middleware/upload.middleware.mts';

import * as ApiV1DocumentController from './document.controller.mts';

const expressRouter = express.Router();

const DocumentRoute = expressRouter
  .post('/convert/doc-to-text', ApiV1DocumentController.postDocumentToText)
  .post('/convert/text-to-index', ApiV1DocumentController.postTextToIndex)
  .post('/spreadsheet/slice', uploadSingle, ApiV1DocumentController.postDocumentToSlice); // Add specific middleware

export { DocumentRoute };
