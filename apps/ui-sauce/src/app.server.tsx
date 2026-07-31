import type { SSRConfigParams } from '@mainset/cli/ssr-server';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import {
  StaticRouterProvider,
  createStaticHandler,
  createStaticRouter,
} from 'react-router';

import i18n from './i18n/i18n.server';
import routes from './routes';

type RenderSSRContentByPath = SSRConfigParams['renderSSRContentByPath'];
type RenderSSRHandler = RenderSSRContentByPath[string];
type RenderSSRHandlerParams = Parameters<RenderSSRHandler>[0];

const provideServerReactApp = async ({ fullUrl }: RenderSSRHandlerParams) => {
  // Step 1: Create a static handler for the routes
  const { query, dataRoutes } = createStaticHandler(routes);

  // Step 2: Create a fetch-compatible Request object
  const fetchRequest = new Request(fullUrl);

  // Step 3: Use the handler to get the context (data loading, routing matches)
  const routerContext = await query(fetchRequest);

  // If the context is a Response (e.g., redirect), throw it to be handled
  if (routerContext instanceof Response) {
    throw routerContext;
  }

  // Step 5: Create the static router
  const staticRouter = createStaticRouter(dataRoutes, routerContext);

  return (
    <I18nextProvider i18n={i18n}>
      <StaticRouterProvider router={staticRouter} context={routerContext} />
    </I18nextProvider>
  );
};

export default provideServerReactApp;
