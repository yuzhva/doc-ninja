import React from 'react';
import { useTranslation } from 'react-i18next';

import type {
  ProcessedResultGroup as ResultGroup,
  RichProcessedResultItem,
} from '../../search-page.types';
import { useFilterConfigs, useParserConfigs } from '../search-configs-store';
import { useHasSearchSources } from '../search-sources-store';
import { ProcessedResultGroup } from './ProcessedResultGroup';
import type { SearchResultsProps } from './SearchResults.types';
import { FPDModalFilterSettings } from './components/FPDModalFilterSettings';
import { MatchDocmMenu } from './components/MatchDocmMenu';
import type { MatchDocmMenuHandle } from './components/MatchDocmMenu';
import { ResultsFiltersBar } from './components/ResultsFiltersBar';
import { ResultsPlaceholder } from './components/ResultsPlaceholder';
import type { PlaceholderReason } from './components/ResultsPlaceholder';
import { ResultsPreviewSideOver } from './components/ResultsPreviewSideOver';
import { ResultsToolbar } from './components/ResultsToolbar';
import { ToolbarSkeleton } from './components/ToolbarSkeleton';
import { createMatchFiltersReader } from './match-filters';
import {
  flattenGroupedResults,
  getExtractedFieldOutputs,
} from './result-helpers';
import { exportResultsToXlsx } from './results-export';
import { filterGroupedResults } from './results-filtering';
import type { ResultsSortState } from './results-sorting';
import {
  DEFAULT_RESULTS_SORT,
  DOC_NAME_SORT_COLUMN_ID,
  FILE_PATH_SORT_COLUMN_ID,
  readStoredResultsSort,
  sortGroupedResults,
  writeStoredResultsSort,
} from './results-sorting';
import { useDocmGeneration } from './use-docm-generation';

const MATCH_SELECTION_ENABLED_STORAGE_KEY = 'docNinja_isMatchSelectionEnabled';

const readStoredMatchSelectionEnabled = () => {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.localStorage.getItem(MATCH_SELECTION_ENABLED_STORAGE_KEY) ===
      'true'
    );
  } catch {
    return false;
  }
};

/**
 * The results pane: the toolbars, and a table per query. It holds what the
 * toolbars narrow the results down by and how they're ordered, runs them
 * through that (filter, then sort), and lays out the parts that show them.
 */
const SearchResults = ({
  results,
  totalsByQuery,
  parserConfigNames,
  isProcessing,
  addToast,
}: SearchResultsProps) => {
  const { t } = useTranslation();
  const parserConfigs = useParserConfigs();
  // Whether there's a folder to search at all: the pane is dimmed while there
  // isn't. Changes only with that — not with a tick or a fold in the form.
  const isSourceDirectorySelected = useHasSearchSources();
  // The schemas the results were extracted with — derived locally since
  // nothing outside this pane (table columns, excel export, .docm template
  // tags) needs them. Looked up by name, so an edit to one (a field's label,
  // say) shows without searching again.
  const parserSchemas = React.useMemo(
    () =>
      parserConfigNames.flatMap((name) => {
        const config = parserConfigs.find((c: any) => c.name === name);
        return config ? [config] : [];
      }),
    [parserConfigs, parserConfigNames],
  );
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);

  // The filters as saved in their settings modal — each with an id
  const filterConfigs = useFilterConfigs();

  // What the toolbars narrow the results down by. Only what they apply lives
  // here — what's typed stays in the boxes (see ResultsToolbar).
  const [appliedSearchTerm, setAppliedSearchTerm] = React.useState('');
  const [maxResults, setMaxResults] = React.useState('');
  // Per filter (by id), the options ticked in its dropdown
  const [selectedFilters, setSelectedFilters] = React.useState<
    Record<string, string[]>
  >({});

  // The document shown in the preview, if any
  const [previewItem, setPreviewItem] = React.useState<ResultGroup | null>(
    null,
  );

  // Which column the results tables are ordered by, as last chosen by the user.
  // Every group renders the same columns, so this is shared across them rather
  // than owned per table.
  const [storedSort, setStoredSort] = React.useState<ResultsSortState>(
    readStoredResultsSort,
  );

  // Whether the tables show their "select for download" checkboxes at all.
  // Remembered across restarts, since it's a way of working rather than a
  // one-off — and off until asked for, so the tables look as they always did.
  const [isMatchSelectionEnabled, setIsMatchSelectionEnabled] = React.useState(
    readStoredMatchSelectionEnabled,
  );

  // Matches ticked for download, held by the match objects themselves rather
  // than by a derived key: a search response builds each one exactly once, and
  // sorting and the results filter only ever reshuffle those same objects — so
  // a selection survives both without any id bookkeeping. Lives here rather
  // than per table because it spans every table, and the toolbar that exports
  // it sits up here too.
  const [selectedMatches, setSelectedMatches] = React.useState<
    Set<RichProcessedResultItem>
  >(() => new Set());

  // A new search answers with a fresh set of match objects, so nothing held
  // from the previous one could ever be shown (or exported) again — let it go
  // instead of pinning the old results in memory.
  React.useEffect(() => {
    setSelectedMatches(new Set());
  }, [results]);

  const { tableFields, primaryFieldId, allFieldIds } = React.useMemo(
    () => getExtractedFieldOutputs(parserSchemas),
    [parserSchemas],
  );

  // What the filters make of each match, worked out once per match for the
  // filtering, sorting, rows, preview and export alike — anew only when the
  // filters or the primary field change.
  const readMatchFilters = React.useMemo(
    () => createMatchFiltersReader(filterConfigs, primaryFieldId),
    [filterConfigs, primaryFieldId],
  );

  const filteredResults = React.useMemo(
    () =>
      filterGroupedResults(results, {
        term: appliedSearchTerm,
        selectedOptionsByFilterId: selectedFilters,
        maxResults,
        filterConfigs,
        readMatchFilters,
        primaryFieldId,
      }),
    [
      results,
      appliedSearchTerm,
      selectedFilters,
      maxResults,
      filterConfigs,
      readMatchFilters,
      primaryFieldId,
    ],
  );

  // Every column a row can be ordered by, in header order.
  const sortableColumnIds = React.useMemo(
    () => [
      DOC_NAME_SORT_COLUMN_ID,
      FILE_PATH_SORT_COLUMN_ID,
      ...tableFields.map((field) => field.id),
      ...filterConfigs.map((conf) => conf.id),
    ],
    [tableFields, filterConfigs],
  );

  // Switching the parser config (or editing the filters) swaps the dynamic
  // columns out from under a stored sort, leaving it pointing at a column no
  // row has any more. Fall back to file name rather than ordering by a key
  // that resolves to nothing — and leave the stored value alone, so the
  // original ordering returns if the user switches the config back.
  const activeSort = React.useMemo(
    () =>
      sortableColumnIds.includes(storedSort.columnId)
        ? storedSort
        : DEFAULT_RESULTS_SORT,
    [sortableColumnIds, storedSort],
  );

  const sortedResults = React.useMemo(
    () =>
      sortGroupedResults(
        filteredResults,
        activeSort,
        filterConfigs,
        readMatchFilters,
      ),
    [filteredResults, activeSort, filterConfigs, readMatchFilters],
  );

  const hasResults = Object.keys(sortedResults).length > 0;
  const hasResultsBeforeFiltering = Object.keys(results).length > 0;

  // A completed search reports totals for every query it ran, even ones that
  // matched nothing — which is the only thing separating "searched, found
  // nothing" from "hasn't searched yet". `results` is empty in both cases.
  const hasSearched = Object.keys(totalsByQuery).length > 0;

  // What the pane says in place of the tables, when there are none to show.
  // An empty pane reads as "nothing searched for yet" on first load, but as
  // "the filters excluded everything" once a search has come back.
  const placeholderReason: PlaceholderReason | null = hasResults
    ? null
    : isProcessing
      ? 'searching'
      : hasResultsBeforeFiltering
        ? 'filteredOut'
        : hasSearched
          ? 'noMatches'
          : 'idle';

  // Shared by the table-level export dropdown and (per-row) the individual
  // download button — both just need the flat item list, not the grouping.
  // Fed from the sorted map so an export lands in the same order as the table.
  const flattenedItems = React.useMemo(
    () => flattenGroupedResults(sortedResults),
    [sortedResults],
  );

  // The ticked matches, in table order — the same order an export of
  // everything uses. Read off the rendered results rather than straight from
  // the set, so a ticked match that has since dropped out of view (another
  // parser config narrowing the text filter differently, say) is never
  // exported without the user seeing it.
  const selectedFlattenedItems = React.useMemo(
    () =>
      Object.values(sortedResults)
        .flat()
        .flatMap((group) => group.items)
        .filter((match) => selectedMatches.has(match))
        .map(({ extracted }) => ({ extracted })),
    [sortedResults, selectedMatches],
  );

  // Only over results that are actually on screen: while a new search runs,
  // the ones showing answer the previous query — and a run in flight
  // outranks them, since an export of those invites walking away with the
  // wrong rows. The selection is about to be dropped with them anyway.
  const isSelectionActive =
    !isProcessing && hasResults && selectedFlattenedItems.length > 0;

  // A fresh column starts ascending; clicking the active one flips it.
  const handleSortChange = (columnId: string) => {
    const next: ResultsSortState =
      activeSort.columnId === columnId
        ? {
            columnId,
            direction: activeSort.direction === 'asc' ? 'desc' : 'asc',
          }
        : { columnId, direction: 'asc' };

    setStoredSort(next);
    writeStoredResultsSort(next);
  };

  const handleMatchSelectionEnabledChange = (isEnabled: boolean) => {
    setIsMatchSelectionEnabled(isEnabled);

    // Hiding the checkboxes takes away the only way to untick anything, so
    // whatever was ticked goes with them rather than staying highlighted (and
    // exportable) with no visible way to undo it.
    if (!isEnabled) {
      setSelectedMatches(new Set());
    }

    try {
      window.localStorage.setItem(
        MATCH_SELECTION_ENABLED_STORAGE_KEY,
        String(isEnabled),
      );
    } catch (e) {
      console.warn('Failed to persist match selection setting', e);
    }
  };

  // One entry point for every level of the selection — a single match, a
  // whole file, a whole table — since each of them is just a list of matches.
  const handleMatchesSelectionChange = (
    matches: RichProcessedResultItem[],
    isSelected: boolean,
  ) => {
    setSelectedMatches((prev) => {
      const next = new Set(prev);
      matches.forEach((match) => {
        if (isSelected) {
          next.add(match);
        } else {
          next.delete(match);
        }
      });
      return next;
    });
  };

  const handleFilterOptionToggle = (filterId: string, option: string) => {
    setSelectedFilters((prev) => {
      const current = prev[filterId] || [];
      return {
        ...prev,
        [filterId]: current.includes(option)
          ? current.filter((selected) => selected !== option)
          : [...current, option],
      };
    });
  };

  // `items` is everything in the tables, or just the ticked matches, depending
  // on which of the two .xlsx buttons was clicked.
  const handleExportXlsx = (items: { extracted: any }[]) =>
    exportResultsToXlsx(items, {
      parserSchemas,
      filterConfigs,
      readMatchFilters,
      t,
    });

  const generateDocm = useDocmGeneration(addToast);

  // The page's one .docm menu for single matches, opened at a match's button
  const docmMenuRef = React.useRef<MatchDocmMenuHandle>(null);
  const handleOpenDocmMenu = (
    anchor: HTMLElement,
    match: RichProcessedResultItem,
  ) => docmMenuRef.current?.toggle(anchor, match);

  return (
    <div className="lg:col-span-3 lg:h-full lg:min-h-0">
      <div
        className={`relative bg-white shadow-md dark:bg-gray-800 sm:rounded-lg h-full flex flex-col lg:min-h-0 ${
          isSourceDirectorySelected ? '' : 'opacity-40'
        }`}
      >
        <ResultsPreviewSideOver
          previewItem={previewItem}
          onClose={() => setPreviewItem(null)}
          filterConfigs={filterConfigs}
          readMatchFilters={readMatchFilters}
        />

        {/* The saved filters reach the results through their store */}
        <FPDModalFilterSettings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSave={() => setIsSettingsOpen(false)}
        />

        <MatchDocmMenu
          ref={docmMenuRef}
          templateTagFieldIds={allFieldIds}
          primaryFieldId={primaryFieldId}
          onGenerate={generateDocm}
          addToast={addToast}
        />

        {/* Every control up here acts on results, so the real ones only appear
            once a search has brought some — no row of dead inputs on first
            load. They stay up while the filters exclude everything: hiding
            them there would take away the very controls needed to widen the
            filters again. Until then the same bars stand in for them,
            pulsing while a search runs and still before one has been asked
            for. */}
        {hasResultsBeforeFiltering ? (
          <>
            <ResultsToolbar
              appliedSearchTerm={appliedSearchTerm}
              onAppliedSearchTermChange={setAppliedSearchTerm}
              maxResults={maxResults}
              onMaxResultsChange={setMaxResults}
              items={flattenedItems}
              selectedItems={selectedFlattenedItems}
              isSelectionActive={isSelectionActive}
              onClearSelection={() => setSelectedMatches(new Set())}
              onExportXlsx={handleExportXlsx}
              templateTagFieldIds={allFieldIds}
              primaryFieldId={primaryFieldId}
              onGenerate={generateDocm}
              addToast={addToast}
            />

            {/* Divider */}
            <hr className="h-px bg-gray-200 border-0 dark:bg-gray-700" />

            <ResultsFiltersBar
              filterConfigs={filterConfigs}
              selectedOptionsByFilterId={selectedFilters}
              onOptionToggle={handleFilterOptionToggle}
              onOpenSettings={() => setIsSettingsOpen(true)}
              isLocked={isSelectionActive}
            />
          </>
        ) : (
          <ToolbarSkeleton tempo={isProcessing ? 'loading' : 'ghost'} />
        )}

        {/* Divider */}
        <hr className="h-px bg-gray-200 border-0 dark:bg-gray-700" />

        {/* Content Area — the only part of the results card that scrolls, so
            the toolbars above stay put while the list moves. */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {placeholderReason ? (
            <ResultsPlaceholder reason={placeholderReason} />
          ) : (
            <div className="space-y-6">
              {Object.entries(sortedResults).map(([searchQuery, items]) => (
                <ProcessedResultGroup
                  key={searchQuery}
                  searchQuery={searchQuery}
                  items={items}
                  totals={totalsByQuery[searchQuery]}
                  maxResults={maxResults}
                  onViewContent={setPreviewItem}
                  filterConfigs={filterConfigs}
                  readMatchFilters={readMatchFilters}
                  tableFields={tableFields}
                  primaryFieldId={primaryFieldId}
                  searchTerm={appliedSearchTerm}
                  sortColumnId={activeSort.columnId}
                  sortDirection={activeSort.direction}
                  onSortChange={handleSortChange}
                  isMatchSelectionEnabled={isMatchSelectionEnabled}
                  onMatchSelectionEnabledChange={
                    handleMatchSelectionEnabledChange
                  }
                  selectedMatches={selectedMatches}
                  onMatchesSelectionChange={handleMatchesSelectionChange}
                  onOpenDocmMenu={handleOpenDocmMenu}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export { SearchResults };
