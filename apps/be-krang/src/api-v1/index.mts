import express from 'express';

import { DocumentRoute } from './document/index.mjs';
import { ProcessRoute } from './process/index.mjs';
import { WelcomeRoute } from './welcome/index.mjs';

const expressRouter = express.Router();

const apiV1Routes = expressRouter.use('/v1', [
  WelcomeRoute,
  DocumentRoute,
  ProcessRoute,
  // NOTE: put other v1 routes here
]);

export { apiV1Routes };
