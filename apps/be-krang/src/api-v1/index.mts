import express from 'express';

import { DocumentRoute } from './document/index.mts';
import { ProcessRoute } from './process/index.mts';
import { WelcomeRoute } from './welcome/index.mts';

const expressRouter = express.Router();

const apiV1Routes = expressRouter.use('/v1', [
  WelcomeRoute,
  DocumentRoute,
  ProcessRoute,
  // NOTE: put other v1 routes here
]);

export { apiV1Routes };
