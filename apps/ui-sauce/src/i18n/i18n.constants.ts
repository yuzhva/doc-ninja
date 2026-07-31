import type { InitOptions } from 'i18next';

import { RESOURCES } from './resources';

export const FALLBACK_LANGUAGE = 'en';

export const BASE_I18N_CONFIG: InitOptions = {
  resources: RESOURCES,
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: Object.keys(RESOURCES),
  interpolation: {
    escapeValue: false,
  },
};
