import React from 'react';
import { Trans } from 'react-i18next';

import { SearchPlaceholderIllustration } from './SearchPlaceholderIllustration';

const I18N_NS = 'page.search.component.resultsPlaceholder';

type PlaceholderReason =
  // Nothing searched for yet
  | 'idle'
  // A search is running
  | 'searching'
  // The search found nothing
  | 'noMatches'
  // It found something, but the toolbars' filters leave none of it
  | 'filteredOut';

const ILLUSTRATION_CLASS_NAME = 'w-1/6 max-w-40';

/** What the results pane says in place of the tables. */
const ResultsPlaceholder = ({ reason }: { reason: PlaceholderReason }) => (
  <div className="flex flex-col items-center justify-center gap-2 h-full text-gray-500 dark:text-gray-400">
    {reason === 'searching' ? (
      <>
        <SearchPlaceholderIllustration
          className={ILLUSTRATION_CLASS_NAME}
          isAnimationInProgress
        />
        <Trans i18nKey={`${I18N_NS}.searchingMessage`} />
      </>
    ) : reason === 'filteredOut' ? (
      <>
        <SearchPlaceholderIllustration
          className={ILLUSTRATION_CLASS_NAME}
          icon="notFound"
        />
        <Trans i18nKey={`${I18N_NS}.noResultsForFiltersMessage`} />
      </>
    ) : reason === 'noMatches' ? (
      <>
        <SearchPlaceholderIllustration
          className={ILLUSTRATION_CLASS_NAME}
          icon="warning"
        />
        <Trans i18nKey={`${I18N_NS}.noMatchesMessage`} />
      </>
    ) : (
      <>
        <SearchPlaceholderIllustration className={ILLUSTRATION_CLASS_NAME} />
        <Trans i18nKey={`${I18N_NS}.resultsPlaceholderMessage`} />
      </>
    )}
  </div>
);

export { ResultsPlaceholder };
export type { PlaceholderReason };
