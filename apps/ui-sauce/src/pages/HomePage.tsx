import React from 'react';

import { Layout } from '../containers';
import { DocumentsPage } from './documents';

const HomePage = () => {
  return (
    <Layout>
      <DocumentsPage />
    </Layout>
  );
};

export { HomePage };
