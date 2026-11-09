import React from 'react';
import { useTranslation } from 'react-i18next';

import { BadgeCounter } from '../../../../../components';

const I18N_NS = 'page.search.component.maxResultsCounter';

interface MaxResultsCounterProps {
  // The cap the results are cut to now ('' — none). Read once, when the
  // counter appears: from then on it holds the number itself.
  initialValue: string;
  // A new cap ('' — none), applied to the results in the background
  onChange: (value: string) => void;
}

// How many files each query shows at most — typed, or stepped with − and +.
// The counter holds the number it shows, and hands every change on as a
// transition: the number changes at once, while the tables catch up behind
// it without holding up the next keystroke or click.
const MaxResultsCounter = ({
  initialValue,
  onChange,
}: MaxResultsCounterProps) => {
  const { t } = useTranslation();
  const [value, setValue] = React.useState(initialValue);
  const [, startApplying] = React.useTransition();

  const change = (next: string) => {
    setValue(next);
    startApplying(() => onChange(next));
  };

  const count = parseInt(value || '0', 10);

  return (
    <div className="relative flex items-center max-w-[8rem]">
      <button
        type="button"
        id="decrement-button"
        onClick={() => change(count > 1 ? String(count - 1) : '')}
        className="bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 dark:border-gray-600 hover:bg-gray-200 border border-gray-300 rounded-s-lg p-3 h-10 focus:ring-gray-100 dark:focus:ring-gray-700 focus:ring-2 focus:outline-none cursor-pointer transition-colors"
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
      <input
        type="text"
        id="max-results-input"
        className="bg-gray-50 border-x-0 border-gray-300 h-10 text-center text-gray-900 text-sm focus:ring-blue-500 focus:border-blue-500 block w-full py-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
        placeholder={t(`${I18N_NS}.allResultsPlaceholder`)}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '' || /^\d+$/.test(next)) change(next);
        }}
      />
      <button
        type="button"
        id="increment-button"
        onClick={() => change(String(count + 1))}
        className="bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 dark:border-gray-600 hover:bg-gray-200 border border-gray-300 rounded-e-lg p-3 h-10 focus:ring-gray-100 dark:focus:ring-gray-700 focus:ring-2 focus:outline-none cursor-pointer transition-colors"
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
      {value !== '' && (
        <BadgeCounter
          count={1}
          variant="red"
          size="md"
          bordered
          className="absolute -top-2 -end-2"
        />
      )}
    </div>
  );
};

export { MaxResultsCounter };
