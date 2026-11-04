import React from 'react';

import { Layout } from './containers';
import type { LayoutRouteHandle } from './containers';
import { ProcessPage, SearchPage } from './pages';

const routes = [
  {
    element: <Layout />,
    children: [
      {
        path: '/',
        element: <SearchPage />,
        // Its form and results columns scroll on their own.
        handle: { isViewportFitted: true } satisfies LayoutRouteHandle,
      },
      {
        path: '/process',
        element: <ProcessPage />,
      },
    ],
  },
];

export default routes;
