import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { useAppZoom } from './use-app-zoom';

const I18N_NS = 'container.layout.navbar';

// The same −/value/+ group as the search results' "max results" counter.
const STEPPER_BUTTON_CLASS_NAME =
  'bg-gray-100 dark:bg-gray-700 dark:enabled:hover:bg-gray-600 dark:border-gray-600 enabled:hover:bg-gray-200 border border-gray-300 p-3 h-10 focus:ring-gray-100 dark:focus:ring-gray-700 focus:ring-2 focus:outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 transition-colors';
const KBD_CLASS_NAME =
  'px-1.5 py-0.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-md dark:bg-gray-600 dark:text-gray-100 dark:border-gray-500';

const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl';

/** "Interface scale" in the settings — desktop app only, see useAppZoom. */
const AppZoomSetting = ({ zoom }: { zoom: ReturnType<typeof useAppZoom> }) => {
  const { t } = useTranslation();
  const percent = Math.round(zoom.zoomFactor * 100);
  // What's being typed into the field; applied on Enter or on leaving it.
  const [draft, setDraft] = React.useState<string | null>(null);

  const applyDraft = () => {
    if (draft) zoom.setZoom(Number(draft) / 100);
    setDraft(null);
  };

  const shortcuts = [
    { key: '+', action: t(`${I18N_NS}.zoomInTitle`) },
    { key: '−', action: t(`${I18N_NS}.zoomOutTitle`) },
    { key: '0', action: t(`${I18N_NS}.zoomResetButton`) },
  ];

  return (
    <div role="group" aria-labelledby="appZoomLabel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          id="appZoomLabel"
          className="text-sm font-medium text-gray-900 dark:text-white"
        >
          <Trans i18nKey={`${I18N_NS}.zoomLabel`} />
        </span>
        {percent !== 100 && (
          <button
            type="button"
            onClick={zoom.resetZoom}
            className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-500 cursor-pointer"
          >
            <Trans i18nKey={`${I18N_NS}.zoomResetButton`} />
          </button>
        )}
      </div>

      <div className="flex items-center max-w-[9rem]">
        <button
          type="button"
          onClick={zoom.zoomOut}
          disabled={!zoom.canZoomOut}
          title={t(`${I18N_NS}.zoomOutTitle`)}
          aria-label={t(`${I18N_NS}.zoomOutTitle`)}
          className={`${STEPPER_BUTTON_CLASS_NAME} rounded-s-lg`}
        >
          <svg
            className="w-3 h-3 text-gray-900 dark:text-white"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 18 2"
          >
            <path
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M1 1h16"
            />
          </svg>
        </button>
        {/* The "%" sits next to the number, outside the field, so typing
            never has to work around it. */}
        <label className="flex flex-1 items-center justify-center h-10 bg-gray-50 border-y border-gray-300 text-sm text-gray-900 focus-within:ring-1 focus-within:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white cursor-text">
          <input
            type="text"
            inputMode="numeric"
            value={draft ?? String(percent)}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              const value = e.target.value;
              if (/^\d{0,3}$/.test(value)) setDraft(value);
            }}
            onBlur={applyDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setDraft(null);
            }}
            aria-label={t(`${I18N_NS}.zoomLabel`)}
            className="w-9 p-0 text-end bg-transparent border-0 focus:ring-0 tabular-nums"
          />
          <span aria-hidden="true">%</span>
        </label>
        <button
          type="button"
          onClick={zoom.zoomIn}
          disabled={!zoom.canZoomIn}
          title={t(`${I18N_NS}.zoomInTitle`)}
          aria-label={t(`${I18N_NS}.zoomInTitle`)}
          className={`${STEPPER_BUTTON_CLASS_NAME} rounded-e-lg`}
        >
          <svg
            className="w-3 h-3 text-gray-900 dark:text-white"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 18 18"
          >
            <path
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M9 1v16M1 9h16"
            />
          </svg>
        </button>
      </div>

      <p className="mt-3 mb-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Trans i18nKey={`${I18N_NS}.zoomShortcutsTitle`} />
      </p>
      <ul className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
        {shortcuts.map(({ key, action }) => (
          <li key={key} className="flex items-center gap-1">
            <kbd className={KBD_CLASS_NAME}>{MOD_KEY}</kbd>
            <kbd className={KBD_CLASS_NAME}>{key}</kbd>
            <span className="ms-1">— {action}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export { AppZoomSetting };
