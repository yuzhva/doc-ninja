import type { Router } from 'express';
import express from 'express';

import * as ApiV1WelcomeController from './welcome.controller.mjs';

const expressRouter: Router = express.Router();

const WelcomeRoute = expressRouter
  .get('/', ApiV1WelcomeController.getPublicIndex)
  .get('/welcome/public', ApiV1WelcomeController.getPublicIndex);

export { WelcomeRoute };
