import React from 'react';
import { useTranslation } from 'react-i18next';

import { Select } from './Select';
import type { SelectOption } from './Select';

const I18N_NS = 'component.formConfigSelect';

/**
 * The "pick a config + ⚙ settings" control shared by every page that runs
 * user-defined configs, so they all look and behave the same.
 *
 * While there are no configs, a "+ Create config" button stands in for the
 * dropdown — a dropdown with nothing to choose doesn't tell anyone what the
 * control is for. It opens the same settings, so ⚙ stays disabled until
 * there is a config to manage — two buttons doing one job read as two
 * different actions.
 */
const FormConfigSelect = ({
  id,
  name,
  label,
  value,
  onChange,
  options,
  noneOption,
  settingsTitle,
  onSettingsClick,
}: {
  id: string;
  name?: string;
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  // One per config.
  options: SelectOption[];
  // A choice that isn't a config, listed first — e.g. "No processing" where
  // a config is optional.
  noneOption?: SelectOption;
  settingsTitle: string;
  onSettingsClick: () => void;
}) => {
  const { t } = useTranslation();
  const hasConfigs = options.length > 0;

  return (
    <div>
      <label
        // Only the dropdown is labelled: clicking the label must not "press"
        // the create button and open a modal.
        htmlFor={hasConfigs ? id : undefined}
        className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          {hasConfigs ? (
            <Select
              id={id}
              name={name}
              value={value}
              onChange={onChange}
              options={noneOption ? [noneOption, ...options] : options}
            />
          ) : (
            <button
              type="button"
              onClick={onSettingsClick}
              className="w-full p-2.5 text-sm font-medium text-left text-blue-700 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-200 dark:text-blue-400 dark:border-blue-700 dark:hover:bg-blue-900/30 dark:focus:ring-blue-900 cursor-pointer transition-colors"
            >
              + {t(`${I18N_NS}.createConfigButton`)}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onSettingsClick}
          disabled={!hasConfigs}
          title={settingsTitle}
          aria-label={settingsTitle}
          className="shrink-0 rounded-lg p-2.5 text-sm text-gray-500 enabled:hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-200 dark:text-gray-400 dark:enabled:hover:bg-gray-700 dark:focus:ring-gray-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            className="w-5 h-5"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

export { FormConfigSelect };
