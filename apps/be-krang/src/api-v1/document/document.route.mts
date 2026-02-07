import type { Router } from 'express';
import express from 'express';

import {
  uploadMultiple,
  uploadSingle,
} from '../../middleware/upload.middleware.mjs';
import * as ApiV1DocumentController from './document.controller.mjs';

const expressRouter: Router = express.Router();

const DocumentRoute = expressRouter
  .post(
    '/convert/doc-to-text',
    uploadMultiple,
    ApiV1DocumentController.postDocumentToText,
  )
  .post(
    '/convert/spreadsheet-to-static',
    uploadSingle,
    ApiV1DocumentController.postConvertSpreadsheetToStatic,
  )
  .post(
    '/spreadsheet/slice',
    uploadSingle,
    ApiV1DocumentController.postDocumentToSlice,
  );

export { DocumentRoute };
