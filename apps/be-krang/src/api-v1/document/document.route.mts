import express from 'express';

import * as ApiV1DocumentController from './document.controller.mts';

const expressRouter = express.Router();

const DocumentRoute = expressRouter
  .post('/convert/doc-to-text', ApiV1DocumentController.postDocumentToText)
  .post('/convert/text-to-index', ApiV1DocumentController.postTextToIndex);

export { DocumentRoute };
