import React from 'react';

import { Layout } from './containers';
import { ProcessPage, SearchPage } from './pages';

const routes = [
  {
    element: <Layout />,
    children: [
      {
        path: '/',
        element: <SearchPage />,
      },
      {
        path: '/process',
        element: <ProcessPage />,
      },
    ],
  },
];

export default routes;
