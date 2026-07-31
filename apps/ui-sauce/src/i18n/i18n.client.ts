import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { BASE_I18N_CONFIG } from './i18n.constants';

// Detects the visitor's language from localStorage (if they've switched
// before) or their browser's language settings, falling back to English
// whenever a translation for the detected language is missing.
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    ...BASE_I18N_CONFIG,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
