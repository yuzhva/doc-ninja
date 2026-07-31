import React from 'react';
import { I18nextProvider } from 'react-i18next';
import {
  RouterProvider,
  // createBrowserRouter,
  createHashRouter,
} from 'react-router';

import i18n from './i18n/i18n.client';
import routes from './routes';

// const BrowserReactApp = <RouterProvider router={createBrowserRouter(routes)} />;
const BrowserReactApp = (
  <I18nextProvider i18n={i18n}>
    <RouterProvider router={createHashRouter(routes)} />
  </I18nextProvider>
);

export default BrowserReactApp;
