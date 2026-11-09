import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { FilterDropdown } from '../../../../../components';
import type { FilterConfig } from '../frontend-information-extractor';

const I18N_NS = 'page.search.component.resultsFiltersBar';

const CogIcon = ({ className }: { className: string }) => (
  <svg
    className={className}
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
);

// A filter's options, as its rules name them: each once, sorted
const optionsOf = (config: FilterConfig): string[] =>
  Array.from(
    new Set<string>(
      config.filterRules
        ?.map((rule: any) => rule.labelOption)
        .filter(Boolean) || [],
    ),
  ).sort();

interface ResultsFiltersBarProps {
  filterConfigs: FilterConfig[];
  // Per filter (by id), the options ticked
  selectedOptionsByFilterId: Record<string, string[]>;
  onOptionToggle: (filterId: string, option: string) => void;
  onOpenSettings: () => void;
  // Locked while matches are ticked, so a filter change can't hide a match
  // that's already going into the download
  isLocked: boolean;
}

/**
 * The results' second toolbar row: a dropdown per filter, and the cog to set
 * the filters up — or, with none set up yet, a button to add some.
 */
const ResultsFiltersBar = ({
  filterConfigs,
  selectedOptionsByFilterId,
  onOptionToggle,
  onOpenSettings,
  isLocked,
}: ResultsFiltersBarProps) => {
  const { t } = useTranslation();

  return (
    <div
      className="flex flex-wrap items-center gap-2 p-2 px-4 bg-gray-50/50 dark:bg-gray-700/20"
      title={isLocked ? t(`${I18N_NS}.filtersLockedTitle`) : undefined}
    >
      <div className="flex-grow" />

      {filterConfigs.length === 0 ? (
        <button
          onClick={onOpenSettings}
          disabled={isLocked}
          className={`relative flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg md:w-auto focus:outline-none focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 ${
            isLocked
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-gray-100 hover:text-blue-700 dark:hover:text-white dark:hover:bg-gray-700 cursor-pointer'
          }`}
        >
          <CogIcon className="mr-2 w-4 h-4 text-gray-400" />
          <Trans i18nKey={`${I18N_NS}.addFiltersButton`} />
        </button>
      ) : (
        <>
          {/* The settings cog, first in the filters cluster */}
          <button
            onClick={onOpenSettings}
            disabled={isLocked}
            className={`rounded-lg p-2.5 text-sm text-gray-500 focus:outline-none focus:ring-4 focus:ring-gray-200 dark:text-gray-400 dark:focus:ring-gray-700 ${
              isLocked
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer'
            }`}
          >
            <CogIcon className="w-4 h-4 text-gray-400" />
          </button>

          {filterConfigs.map((config) => {
            const options = optionsOf(config);
            if (options.length === 0) return null;

            return (
              <FilterDropdown
                key={config.id}
                label={config.labelFilterTitle}
                dropdownTitle={config.labelFilterDescription}
                items={options}
                selectedItems={selectedOptionsByFilterId[config.id] || []}
                onItemChange={(option) => onOptionToggle(config.id, option)}
                idPrefix={`filter-${config.id}`}
                disabled={isLocked}
              />
            );
          })}
        </>
      )}
    </div>
  );
};

export { ResultsFiltersBar };
