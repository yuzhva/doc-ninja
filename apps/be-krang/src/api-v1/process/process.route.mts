import express from 'express';

import * as ApiV1ProcessController from './process.controller.mts';

const expressRouter = express.Router();

const ProcessRoute = expressRouter.post(
  '/process/documents',
  ApiV1ProcessController.postProcessDocuments,
);

export { ProcessRoute };
