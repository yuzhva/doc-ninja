import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Modal, Select } from '../../components';
import { LANGUAGE_LABELS, RESOURCES } from '../../i18n';
import type { SupportedLanguage } from '../../i18n';

const I18N_NS = 'container.layout.welcomeModal';

const WELCOME_MODAL_SEEN_STORAGE_KEY = 'docNinja_hasSeenWelcomeModal';

const GREETING_CYCLE_INTERVAL_MS = 2800;
const GREETING_FADE_DURATION_MS = 300;

const LANGUAGE_OPTIONS = Object.keys(RESOURCES).map((language) => ({
  value: language,
  label: LANGUAGE_LABELS[language as SupportedLanguage],
}));

// Demonstrates the app's language support up front — cycles through every
// supported locale's own greeting, independent of whichever language is
// currently active, read straight out of the same translation bundles the
// rest of the app uses (RESOURCES) instead of a separate hardcoded copy.
const GREETING_LANGUAGES = Object.keys(RESOURCES) as SupportedLanguage[];

const WelcomeModal = () => {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const [greetingIndex, setGreetingIndex] = React.useState(0);
  const [isGreetingVisible, setIsGreetingVisible] = React.useState(true);

  // Read on mount rather than in the initializer so server and first client
  // render both start closed — localStorage doesn't exist on the server, and
  // reading it in the initializer would cause a hydration mismatch for
  // anyone who has already dismissed this once before.
  React.useEffect(() => {
    const hasSeenWelcomeModal =
      window.localStorage.getItem(WELCOME_MODAL_SEEN_STORAGE_KEY) === 'true';
    if (!hasSeenWelcomeModal) setIsOpen(true);
  }, []);

  React.useEffect(() => {
    if (!isOpen || GREETING_LANGUAGES.length < 2) return;

    const intervalId = window.setInterval(() => {
      setIsGreetingVisible(false);
      window.setTimeout(() => {
        setGreetingIndex(
          (prevIndex) => (prevIndex + 1) % GREETING_LANGUAGES.length,
        );
        setIsGreetingVisible(true);
      }, GREETING_FADE_DURATION_MS);
    }, GREETING_CYCLE_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [isOpen]);

  const handleSubmit = () => {
    try {
      window.localStorage.setItem(WELCOME_MODAL_SEEN_STORAGE_KEY, 'true');
    } catch (e) {
      console.warn('Failed to persist welcome modal seen flag', e);
    }
    setIsOpen(false);
  };

  const greetingLanguage = GREETING_LANGUAGES[greetingIndex];
  const greeting =
    RESOURCES[greetingLanguage].translation.container.layout.welcomeModal;

  return (
    <Modal
      title=""
      isOpen={isOpen}
      onBtnCloseClick={handleSubmit}
      maxWidthClassName="max-w-xl"
    >
      <div className="text-center space-y-1">
        <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white flex items-center justify-center gap-x-2">
          <span
            className={`transition-opacity ${
              isGreetingVisible ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ transitionDuration: `${GREETING_FADE_DURATION_MS}ms` }}
          >
            {greeting.greetingLine1}
          </span>
          <span>👋</span>
        </p>
        <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white flex items-center justify-center gap-x-2 flex-wrap">
          <span
            className={`transition-opacity ${
              isGreetingVisible ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ transitionDuration: `${GREETING_FADE_DURATION_MS}ms` }}
          >
            {greeting.greetingLine2}
          </span>
          <span>
            <span className="text-blue-600 dark:text-blue-400">DocNinja</span>{' '}
            🎉
          </span>
        </p>
      </div>

      <p className="text-center text-sm text-gray-600 dark:text-gray-400">
        <Trans i18nKey={`${I18N_NS}.description`} />
      </p>

      <p className="text-left text-xs italic text-gray-500 dark:text-gray-400">
        <Trans i18nKey={`${I18N_NS}.complianceNote`} />
      </p>

      <Select
        value={i18n.resolvedLanguage ?? i18n.language}
        onChange={(language) => i18n.changeLanguage(language)}
        options={LANGUAGE_OPTIONS}
        label={<Trans i18nKey={`${I18N_NS}.languageLabel`} />}
      />

      <button
        type="button"
        onClick={handleSubmit}
        className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 cursor-pointer transition-colors"
      >
        <Trans i18nKey={`${I18N_NS}.submitButton`} />
      </button>
    </Modal>
  );
};

export { WelcomeModal };
