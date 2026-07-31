import en from './locales/en/translation.json';
import uk from './locales/uk/translation.json';

const RESOURCES = {
  en: { translation: en },
  uk: { translation: uk },
} as const;

type SupportedLanguage = keyof typeof RESOURCES;

// Native display names, shown in the language switcher itself rather than
// translated, since a language's own name isn't affected by which language
// is currently selected.
const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  uk: 'Українська',
};

export { LANGUAGE_LABELS, RESOURCES };
export type { SupportedLanguage };
