import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';

// Conditional multipart handler - only processes if content-type is multipart/form-data
const handleMultipart = (req: Request, res: Response, next: NextFunction) => {
  if (req.is('multipart/form-data')) {
    upload.single('file')(req, res, next);
  } else {
    next();
  }
};

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

// Specific middleware for single file upload
const uploadSingle: RequestHandler = upload.single('file');

// Specific middleware for single file upload
const uploadMultiple: RequestHandler = upload.array('files');

export { handleMultipart, upload, uploadMultiple, uploadSingle };
