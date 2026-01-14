import React from 'react';
import {
  RouterProvider,
  // createBrowserRouter,
  createHashRouter,
} from 'react-router';

import routes from './routes';

// const BrowserReactApp = <RouterProvider router={createBrowserRouter(routes)} />;
const BrowserReactApp = <RouterProvider router={createHashRouter(routes)} />;

export default BrowserReactApp;
