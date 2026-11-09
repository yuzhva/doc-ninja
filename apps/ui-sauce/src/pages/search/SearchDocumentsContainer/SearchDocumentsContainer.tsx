import React from 'react';

import type {
  GroupedProcessedResults,
  SearchQueryTotals,
} from '../search-page.types';
import type { SearchRun } from '../use-search-run';
import { SearchForm } from './SearchForm/SearchForm';
import type {
  SearchFormProps,
  SearchRequest,
} from './SearchForm/SearchForm.types';
import { SearchResults } from './SearchResults/SearchResults';
import { getExtractedFieldOutputs } from './SearchResults/result-helpers';
import { useParserConfigs } from './search-configs-store';
import { normalizeSearchQueries } from './search-queries';
import { requestSearch } from './search-request';
import { groupSearchResponse } from './search-response';
import { buildSearchSourcesPayload } from './search-sources';
import { searchSourcesStore } from './search-sources-store';

interface SearchDocumentsContainerProps extends Pick<
  SearchFormProps,
  'onSelectSourceDirectory' | 'isFileSystemAccessSupported'
> {
  // Runs a search, with its toasts and its cancel button (see useSearchRun)
  runSearch: SearchRun['run'];
  isSearching: boolean;
  addToast: (
    type: 'success' | 'error' | 'warning',
    content: React.ReactNode,
  ) => void;
}

/**
 * Runs the searches and holds their results. What to search for comes from
 * the form, as a SearchRequest; where — the folders and their ticks — from
 * searchSourcesStore, read as the search runs. Neither is held here, so
 * typing in the form or ticking a folder never re-renders the results.
 */
const SearchDocumentsContainer = ({
  onSelectSourceDirectory,
  isFileSystemAccessSupported,
  runSearch,
  isSearching,
  addToast,
}: SearchDocumentsContainerProps) => {
  const [processedResults, setProcessedResults] =
    React.useState<GroupedProcessedResults>({});

  // What the engine found per query, kept beside the grouped results: the
  // groups below are built from `extractedResults`, which is already capped by
  // `pageSize` and so cannot report the real totals.
  const [searchTotalsByQuery, setSearchTotalsByQuery] = React.useState<
    Record<string, SearchQueryTotals>
  >({});

  // The parser configs the results on screen were extracted with — the folders'
  // as they were when searched, since what was extracted can't follow a later
  // change of one. They decide the results' columns.
  const [searchedParserConfigNames, setSearchedParserConfigNames] =
    React.useState<string[]>([]);

  // Parser config: determines how the backend extracts fields from documents.
  // Read live: a save in the settings modal shows here at once.
  const parserConfigs = useParserConfigs();

  const handleSearch = (request: SearchRequest) =>
    runSearch(async (signal) => {
      // Pick up folders created/removed since the trees were last read, so the
      // scope sent below matches what is actually on disk right now.
      const effective = await searchSourcesStore.refresh();
      signal.throwIfAborted();

      // Each folder with where in it to search, and the parser config the
      // backend parses what it finds there with
      const searchSources = buildSearchSourcesPayload(
        effective.sources,
        effective.selectedPaths,
        parserConfigs,
      );

      // The body text a match shows is its own parser config's primary field,
      // which differs between folders parsed with different configs
      const primaryFieldIdBySourcePath = new Map(
        searchSources.map((source) => [
          source.sourcePath,
          getExtractedFieldOutputs(
            source.extractorSchema ? [source.extractorSchema] : [],
          ).primaryFieldId,
        ]),
      );

      const response = await requestSearch(
        {
          pageSize: request.pageSize,
          sortOrder: request.sortOrder,
          // Blank rows and stray padding are the user's editing leftovers,
          // not queries — the request carries only what's actually
          // searchable.
          bulkNames: normalizeSearchQueries(request.queries),
          sources: searchSources,
          isInflectedWordFormsAllowed: request.isInflectedWordFormsAllowed,
          maxTypoDistance: request.maxTypoDistance,
        },
        // The Cancel button in SearchPage's progress footer
        signal,
      );
      signal.throwIfAborted();

      const { groupedResults, totalsByQuery } = groupSearchResponse(
        response,
        primaryFieldIdBySourcePath,
      );
      setProcessedResults(groupedResults);
      setSearchTotalsByQuery(totalsByQuery);
      setSearchedParserConfigNames([
        ...new Set(
          searchSources.flatMap((source) =>
            source.extractorSchema ? [source.extractorSchema.name] : [],
          ),
        ),
      ]);
    });

  return (
    // `min-h-0` stops the grid row from being sized by its content, which is
    // what lets both columns scroll internally instead of stretching the page.
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:flex-1 lg:min-h-0">
      <SearchForm
        onSelectSourceDirectory={onSelectSourceDirectory}
        isFileSystemAccessSupported={isFileSystemAccessSupported}
        isProcessing={isSearching}
        addToast={addToast}
        onSearch={handleSearch}
      />

      <SearchResults
        results={processedResults}
        totalsByQuery={searchTotalsByQuery}
        parserConfigNames={searchedParserConfigNames}
        isProcessing={isSearching}
        addToast={addToast}
      />
    </div>
  );
};

export { SearchDocumentsContainer };
