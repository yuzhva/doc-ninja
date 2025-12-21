import cookieParser from 'cookie-parser';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { pathToFileURL } from 'url';

import { apiV1Routes } from './api-v1/index.mjs';

const app = express();
const port = process.env.PORT || 3000;

const handleForwardingToLatestApiPrefix = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const isReqUrlStartsWithApiPrefix = /^(\/api\/v1)/.test(req.url);
  if (!isReqUrlStartsWithApiPrefix) {
    req.url = `/api/v1${req.url}`;
  }
  next('route');
};

// parsers
app.use(cookieParser(process.env.SECURITY__COOKIE_SECRET)); // parse cookie to get JWT from {req.cookies} or {req.signedCookies}
app.use(express.json()); // parse application/json to get from {req.body}
// app.use(handleMultipart); // Handle multipart uploads globally

app.get('/{*splat}', handleForwardingToLatestApiPrefix);
app.post('/{*splat}', handleForwardingToLatestApiPrefix);
app.patch('/{*splat}', handleForwardingToLatestApiPrefix);
app.delete('/{*splat}', handleForwardingToLatestApiPrefix);

app.use('/api', [apiV1Routes]);

// Only start the server if this file is run directly (ES module version)
// Convert process.argv[1] to file URL format for comparison
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, () => console.log(`Example app listening on port ${port}!`));
}

// Export the app for reuse in other parts of your monorepo (like Electron)
export { app };
