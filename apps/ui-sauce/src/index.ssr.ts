import ReactDOMClient from 'react-dom/client';

import BrowserReactApp from './app.browser.tsx';

const targetContainer = document.getElementById('nlp-ninja--ui-sauce');

if (targetContainer) {
  ReactDOMClient.hydrateRoot(targetContainer, BrowserReactApp);
}