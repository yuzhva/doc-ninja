import express from 'express';

import * as ApiV1DocumentController from './document.controller.mts';

const expressRouter = express.Router();

const DocumentRoute = expressRouter.post(
  '/document/to-text',
  ApiV1DocumentController.postDocumentToText,
);

export { DocumentRoute };
