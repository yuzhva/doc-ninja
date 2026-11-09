import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { BadgeCounter, LoadingSpinner } from '../../../../../components';

const I18N_NS = 'page.search.component.resultsFilterBox';

// A single letter sits in nearly every match, so filtering (and highlighting)
// by one narrows nothing down while repainting every row. The filter starts
// applying from this many characters.
const MIN_APPLIED_LENGTH = 2;

// What the filter applies of the text typed into it: nothing until there are
// enough characters to narrow the results down, then the text as typed.
const toAppliedTerm = (typed: string): string =>
  typed.trim().length >= MIN_APPLIED_LENGTH ? typed : '';

interface ResultsFilterBoxProps {
  // The term the results are filtered by now. Read once, when the box
  // appears: it unmounts while a search that found nothing shows, and comes
  // back showing exactly what the results are still filtered by.
  initialAppliedTerm: string;
  // Called only when a keystroke changes the applied term, not on each one
  onAppliedTermChange: (appliedTerm: string) => void;
}

// The results filter's text box. It holds what's typed itself, so a keystroke
// that applies nothing new (the first letter, say) re-renders just this box
// and none of the rows it filters. One that does is handed on as a
// transition: the letter shows at once, the tables follow in the background,
// and a next keystroke drops their half-done update for a fresh one.
const ResultsFilterBox = ({
  initialAppliedTerm,
  onAppliedTermChange,
}: ResultsFilterBoxProps) => {
  const { t } = useTranslation();
  const [typed, setTyped] = React.useState(initialAppliedTerm);
  // What the box asked the results to be filtered by last — read off what's
  // typed, since the results may still be catching up with it
  const appliedTerm = toAppliedTerm(typed);
  const isTooShortToApply = typed !== '' && appliedTerm === '';
  const [isApplying, startApplying] = React.useTransition();

  const changeTyped = (value: string) => {
    setTyped(value);
    const nextAppliedTerm = toAppliedTerm(value);
    if (nextAppliedTerm !== appliedTerm) {
      startApplying(() => onAppliedTermChange(nextAppliedTerm));
    }
  };

  return (
    <form
      className="flex items-center w-full sm:w-auto"
      onSubmit={(e) => e.preventDefault()}
    >
      <label htmlFor="simple-search" className="sr-only">
        <Trans i18nKey={`${I18N_NS}.filterLabel`} />
      </label>
      <div className="relative w-full sm:w-64 md:w-72">
        {/* The magnifier turns into a spinner while the tables catch up */}
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          {isApplying ? (
            <span className="flex w-5 h-5 items-center justify-center">
              <LoadingSpinner className="m-0! text-gray-500 dark:text-gray-400" />
            </span>
          ) : (
            <svg
              aria-hidden="true"
              className="w-5 h-5 text-gray-500 dark:text-gray-400"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </div>
        <input
          type="text"
          id="simple-search"
          className="block w-full p-2 pl-10 text-sm text-gray-900 border border-gray-300 rounded-lg bg-gray-50 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
          placeholder={t(`${I18N_NS}.filterLabel`)}
          value={typed}
          onChange={(e) => changeTyped(e.target.value)}
          aria-describedby={
            isTooShortToApply ? 'simple-search-min-length-hint' : undefined
          }
        />
        {/* Too short to apply yet: said inside the box, beside the clear
            button, so the toolbar doesn't shift. */}
        {isTooShortToApply && (
          <span
            id="simple-search-min-length-hint"
            className="absolute inset-y-0 right-8 flex items-center text-xs text-gray-400 dark:text-gray-500 pointer-events-none"
          >
            {t(`${I18N_NS}.filterMinLengthHint`, { min: MIN_APPLIED_LENGTH })}
          </span>
        )}
        {typed && (
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white focus:outline-none"
            onClick={() => changeTyped('')}
          >
            <svg
              className="w-3 h-3"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 14 14"
            >
              <path
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
              />
            </svg>
            <span className="sr-only">
              <Trans i18nKey={`${I18N_NS}.clearSearchLabel`} />
            </span>
          </button>
        )}
        {/* One filter in force — shown only once it actually applies */}
        {appliedTerm && (
          <BadgeCounter
            count={1}
            variant="red"
            size="md"
            bordered
            className="absolute -top-2 -end-2"
          />
        )}
      </div>
    </form>
  );
};

export { ResultsFilterBox };
