import type { RichProcessedResultItem } from '../../search-page.types';
import { FrontendInformationExtractor } from './frontend-information-extractor';
import type { FilterConfig } from './frontend-information-extractor';
import { getPrimaryText } from './result-helpers';

/** What the results filters make of one match. */
interface MatchFilters {
  /** The label each filter resolves to, by filter id; null where none does. */
  valueByFilterId: Record<string, string | null>;
  /**
   * The phrases in the match's text that made those labels apply — for the
   * row to highlight. Filters can opt out of highlighting (see the toggle in
   * FPDModalFilterSettings): `!== false` rather than a truthiness check, so
   * configs saved before the flag existed keep highlighting.
   */
  highlightedTexts: string[];
}

/** Reads what the results filters make of a match. */
type MatchFiltersReader = (
  match: Pick<RichProcessedResultItem, 'extracted'>,
) => MatchFilters;

const evaluateMatchFilters = (
  match: Pick<RichProcessedResultItem, 'extracted'>,
  filterConfigs: FilterConfig[],
  primaryFieldId: string | null,
): MatchFilters => {
  const filterMatches = FrontendInformationExtractor.findMatches(
    getPrimaryText(match, primaryFieldId),
    filterConfigs,
  );

  const valueByFilterId: Record<string, string | null> = {};
  const highlightedTexts: string[] = [];
  filterConfigs.forEach((config, index) => {
    const filterMatch = filterMatches[index];
    valueByFilterId[config.id] = filterMatch?.labelOption ?? null;
    if (filterMatch && config.isHighlightedInResults !== false) {
      highlightedTexts.push(...filterMatch.matchedTexts);
    }
  });

  return { valueByFilterId, highlightedTexts };
};

/**
 * The one place the results filters are applied to the matches. The
 * filtering, sorting, rows, preview and export all ask it, and each match is
 * worked out only once — the first time anything asks — for as long as the
 * filters and the primary field stay the same: a new reader is made when
 * they change.
 *
 * Kept by the match's `extracted` object, which a search response creates
 * once per match: the wrappers around it (sorting, the results filter,
 * flattening for export) come and go, it stays the same.
 */
const createMatchFiltersReader = (
  filterConfigs: FilterConfig[],
  primaryFieldId: string | null,
): MatchFiltersReader => {
  const matchFiltersByExtracted = new WeakMap<object, MatchFilters>();

  return (match) => {
    let matchFilters = matchFiltersByExtracted.get(match.extracted);
    if (!matchFilters) {
      matchFilters = evaluateMatchFilters(match, filterConfigs, primaryFieldId);
      matchFiltersByExtracted.set(match.extracted, matchFilters);
    }
    return matchFilters;
  };
};

export { createMatchFiltersReader };
export type { MatchFilters, MatchFiltersReader };
