import type {
  GroupedProcessedResults,
  ProcessDocumentsApiResponse,
  ProcessedResultGroup,
  SearchQueryTotals,
  SearchResultItem,
} from '../search-page.types';

/** What the results pane shows of a search response. */
interface SearchResponseResults {
  /** Each query's matches, grouped by the document they were found in. */
  groupedResults: GroupedProcessedResults;
  /**
   * What the engine found per query. Reported to the user as "N of M", so
   * they come from pagination: `extractedResults` is already capped by
   * `pageSize` and can't tell the real totals.
   */
  totalsByQuery: Record<string, SearchQueryTotals>;
}

/**
 * Engine totals per query, and each document's search result by its path —
 * so its metadata (file path, text file) can go with its matches.
 */
const readResultSets = (response: ProcessDocumentsApiResponse) => {
  const totalsByQuery: Record<string, SearchQueryTotals> = {};
  const searchResultByPath = new Map<string, SearchResultItem>();

  // One result set per query
  for (const resultSet of Array.isArray(response.results)
    ? response.results
    : []) {
    // A query the engine failed on comes back with a stub pagination that has
    // no totalMatches, so both counts are checked — a half-known total would
    // render as a literal "{{count}}" in the summary.
    if (
      resultSet.query &&
      typeof resultSet.pagination?.totalMatches === 'number' &&
      typeof resultSet.pagination?.totalResults === 'number'
    ) {
      totalsByQuery[resultSet.query] = {
        totalMatches: resultSet.pagination.totalMatches,
        totalResults: resultSet.pagination.totalResults,
      };
    }

    if (Array.isArray(resultSet.results)) {
      for (const searchResult of resultSet.results) {
        const path = searchResult.doc?.originalFilePath;
        if (path) searchResultByPath.set(path, searchResult);
      }
    }
  }

  return { totalsByQuery, searchResultByPath };
};

/**
 * A search response as the results pane shows it: each query's matches,
 * grouped by the document they were found in, in the order the response
 * lists them.
 *
 * `primaryFieldIdBySourcePath` is the field holding a match's body text, by
 * the source folder it was found in: folders searched together can each be
 * parsed with their own config, which keeps that text in a field of its own.
 */
const groupSearchResponse = (
  response: ProcessDocumentsApiResponse,
  primaryFieldIdBySourcePath: Map<string, string | null>,
): SearchResponseResults => {
  const { totalsByQuery, searchResultByPath } = readResultSets(response);

  const groupedResults: GroupedProcessedResults = {};
  // Each query's groups by document path, to find a document's group in one
  // look-up. A match the backend sent no path for goes under `undefined`: all
  // of a query's path-less matches share one group.
  const groupByPathByQuery = new Map<
    string,
    Map<string | undefined, ProcessedResultGroup>
  >();

  for (const item of response.extractedResults) {
    const query = item.searchQuery;
    const path = item.originalFilePath || undefined;
    const searchResult = (path && searchResultByPath.get(path)) || null;

    const match = {
      extracted: item.sourcePath
        ? {
            ...item,
            primaryFieldId:
              primaryFieldIdBySourcePath.get(item.sourcePath) ?? undefined,
          }
        : item,
      search: searchResult,
    };

    let groupByPath = groupByPathByQuery.get(query);
    if (!groupByPath) {
      groupByPath = new Map();
      groupByPathByQuery.set(query, groupByPath);
      groupedResults[query] = [];
    }

    const group = groupByPath.get(path);
    if (group) {
      group.items.push(match);
    } else {
      const newGroup: ProcessedResultGroup = {
        docName: item.foundInDocument,
        uniqueId: path,
        items: [match],
        // The document's metadata (file path, text file) for the whole group
        search: searchResult,
      };
      groupByPath.set(path, newGroup);
      groupedResults[query].push(newGroup);
    }
  }

  return { groupedResults, totalsByQuery };
};

export { groupSearchResponse };
export type { SearchResponseResults };
