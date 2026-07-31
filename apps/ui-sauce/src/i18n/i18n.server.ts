import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { BASE_I18N_CONFIG, FALLBACK_LANGUAGE } from './i18n.constants';

// No LanguageDetector here: there's no window/navigator on the server, and
// the SSR handler doesn't currently forward the request's Accept-Language
// header. Server-rendered markup always uses the fallback language; the
// client then re-renders with the visitor's detected language after hydration.
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    ...BASE_I18N_CONFIG,
    lng: FALLBACK_LANGUAGE,
  });
}

export default i18n;
