import type {
  GroupedProcessedResults,
  ProcessedResultGroup as ResultGroup,
  RichProcessedResultItem,
} from '../../search-page.types';
import type { FilterConfig } from './frontend-information-extractor';
import type { MatchFiltersReader } from './match-filters';
import { getPrimaryText } from './result-helpers';

/** What the results pane's toolbars narrow the results down by. */
interface ResultsFilterCriteria {
  // The text typed into the results filter, once long enough to apply ('' —
  // none): kept are the queries containing it, and elsewhere only the
  // matches whose text does
  term: string;
  // Per filter (by id), the options ticked in its dropdown: a file stays if
  // any of its matches has one of them, for every filter with any ticked
  selectedOptionsByFilterId: Record<string, string[]>;
  // How many files each query keeps at most ('' — all of them)
  maxResults: string;
  filterConfigs: FilterConfig[];
  readMatchFilters: MatchFiltersReader;
  primaryFieldId: string | null;
}

// A file narrowed down to the matches whose own text has `termLower` — or
// nothing, when none has
const narrowToMatchesContaining = (
  group: ResultGroup,
  termLower: string,
  primaryFieldId: string | null,
): ResultGroup | null => {
  const matchingItems = group.items.filter((item: RichProcessedResultItem) =>
    (getPrimaryText(item, primaryFieldId) ?? '')
      .toLowerCase()
      .includes(termLower),
  );
  return matchingItems.length === 0 ? null : { ...group, items: matchingItems };
};

// Whether a file passes every filter with options ticked
const passesFilters = (
  group: ResultGroup,
  {
    selectedOptionsByFilterId,
    filterConfigs,
    readMatchFilters,
  }: ResultsFilterCriteria,
): boolean =>
  filterConfigs.every((config) => {
    const selectedOptions = selectedOptionsByFilterId[config.id];
    if (!selectedOptions || selectedOptions.length === 0) return true;

    return group.items.some((item: RichProcessedResultItem) => {
      const value = readMatchFilters(item).valueByFilterId[config.id];
      return value && selectedOptions.includes(value);
    });
  });

/**
 * The grouped results as the toolbars narrow them down — per query, the
 * files kept, in the same order. Queries left with no file are dropped.
 */
const filterGroupedResults = (
  results: GroupedProcessedResults,
  criteria: ResultsFilterCriteria,
): GroupedProcessedResults => {
  const { term, maxResults, primaryFieldId } = criteria;
  const termLower = term.toLowerCase();
  const limit = Number(maxResults);
  const hasLimit = maxResults !== '' && !isNaN(limit) && limit > 0;

  const filtered: GroupedProcessedResults = {};

  Object.entries(results).forEach(([searchQuery, groups]) => {
    // A query containing the term keeps its files whole
    const isQueryMatched =
      !term || searchQuery.toLowerCase().includes(termLower);

    const kept = groups
      .map((group) =>
        isQueryMatched
          ? group
          : narrowToMatchesContaining(group, termLower, primaryFieldId),
      )
      .filter((group): group is ResultGroup => group !== null)
      .filter((group) => passesFilters(group, criteria));

    const limited = hasLimit ? kept.slice(0, limit) : kept;
    if (limited.length > 0) filtered[searchQuery] = limited;
  });

  return filtered;
};

export { filterGroupedResults };
export type { ResultsFilterCriteria };
