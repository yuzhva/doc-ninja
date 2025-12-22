import { runtimePathById } from '@mainset/cli/runtime';
import type { SSRConfigParams } from '@mainset/cli/ssr-server';
import fs from 'fs';
import path from 'path';
import ReactDOMServer from 'react-dom/server';

import provideServerReactApp from '../src/app.server.tsx';
import proxyConfigByPath from './proxy.config.mjs';

const ssrServerConfig: SSRConfigParams = {
  listenPort: 8080,
  serveStatics: [
    {
      rootPath: path.join(runtimePathById.dist, 'public'),
    },
  ],
  proxyConfigByPath,
  renderSSRContentByPath: {
    '/{*any}': ({ reqUrl, fullUrl }) =>
      new Promise((resolve, reject) => {
        fs.readFile(
          path.join(runtimePathById.dist, 'public', 'server.html'),
          'utf8',
          async (err, htmlData) => {
            if (err) {
              return reject(err);
            }

            // Const context = {}; // Context to track SSR rendering information

            try {
              // Pass both requestUrl (relative) and fullUrl to provider of React App for server-side rendering
              const appHtml = await provideServerReactApp({
                reqUrl,
                fullUrl,
                // Context
              });

              const content = htmlData.replace(
                '<div id="doc-ninja--ui-sauce"></div>',
                `<div id="doc-ninja--ui-sauce">${ReactDOMServer.renderToString(
                  appHtml,
                )}</div>`,
              );

              return resolve(content);
            } catch (error) {
              return reject(error);
            }
          },
        );
      }),
  },
};

export default ssrServerConfig;
