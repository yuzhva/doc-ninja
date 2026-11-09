import type {
  PaginatedSearchResult,
  PaginationInfo,
  SearchOptions,
} from './mega-search.types.mjs';

type SortBy = NonNullable<SearchOptions['sortBy']>;
type SortOrder = NonNullable<SearchOptions['sortOrder']>;

/** What a search orders a found document by. */
type RankedResult = {
  /** Breaks ties when sorting by relevance, so the order is stable. */
  id: string;
  score: number;
  /** See dateFromFileName — 0 when sorting by relevance. */
  date: number;
};

/**
 * The date a document's file name carries, as a timestamp — what a search
 * sorted by date orders by — or 0 when it carries none.
 *
 * The default pattern reads DD.MM.YYYY, DD.MM.YY or D.M.YY, with `.`, `/` or
 * `-` between; a custom one must capture day, month and year, in that order.
 */
function dateFromFileName(fileName: string, customPattern?: string): number {
  try {
    // (?:^|\D) keeps it from starting in the middle of a number
    const defaultPattern =
      /(?:^|\D)(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\D|$)/;
    const regex = customPattern ? new RegExp(customPattern) : defaultPattern;

    const match = fileName.match(regex);
    if (!match) return 0;

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    let year = parseInt(match[3], 10);

    // Two digits: 00–49 are 2000–2049, 50–99 are 1950–1999 ("25" → 2025)
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return 0;

    return new Date(year, month - 1, day).getTime();
  } catch {
    return 0;
  }
}

/**
 * The order a search returns what it found in. By date: the date the file
 * name carries first, then the more relevant on the same date. By relevance:
 * the score, then the id, so equal scores keep one order.
 */
function compareRankedResults(
  a: RankedResult,
  b: RankedResult,
  sortBy: SortBy,
  sortOrder: SortOrder,
): number {
  if (sortBy === 'date') {
    const dateDiff = sortOrder === 'asc' ? a.date - b.date : b.date - a.date;
    if (dateDiff !== 0) return dateDiff;

    // Relevance breaks the tie, always the most relevant first
    return b.score - a.score;
  }

  const scoreDiff = sortOrder === 'asc' ? a.score - b.score : b.score - a.score;
  return scoreDiff !== 0 ? scoreDiff : a.id.localeCompare(b.id);
}

type MergeOptions = Pick<
  SearchOptions,
  'page' | 'pageSize' | 'sortBy' | 'sortOrder' | 'filenameDatePattern'
>;

/**
 * What to ask each folder for, so that mergeSearchResults can put together
 * page `page` of all of them: their first `page` pages, as one. Any of the
 * folders may hold every result on that page.
 */
function pageOptionsForMerge(
  options: MergeOptions,
): Required<Pick<SearchOptions, 'page' | 'pageSize'>> {
  const { page = 1, pageSize = 10 } = options;
  if (pageSize === 'ALL') return { page: 1, pageSize: 'ALL' };

  return { page: 1, pageSize: page * (Number(pageSize) || 10) };
}

/**
 * One query's results across several folders — each searched by its own
 * engine — as a search over all of them would return them: in the same order
 * (compareRankedResults), cut to the page asked for, with the totals of every
 * folder.
 *
 * Each folder's results must be its first pages, as pageOptionsForMerge asks
 * for. Scores come from separate engines, each scoring against its own
 * folder: they're compared as they are, which by date only breaks ties.
 */
function mergeSearchResults(
  resultsPerFolder: PaginatedSearchResult[],
  options: MergeOptions = {},
): PaginatedSearchResult {
  const {
    page = 1,
    pageSize = 10,
    sortBy = 'relevance',
    sortOrder = 'desc',
    filenameDatePattern,
  } = options;

  const totalResults = resultsPerFolder.reduce(
    (sum, result) => sum + result.pagination.totalResults,
    0,
  );
  const totalMatches = resultsPerFolder.reduce(
    (sum, result) => sum + (result.pagination.totalMatches ?? 0),
    0,
  );

  const ranked = resultsPerFolder
    .flatMap((result) => result.results)
    .map((result) => ({
      result,
      rank: {
        id: String(result.doc?.originalFilePath ?? ''),
        score: result.score,
        date:
          sortBy === 'date'
            ? dateFromFileName(
                String(result.doc?.fileName ?? ''),
                filenameDatePattern,
              )
            : 0,
      },
    }))
    .sort((a, b) => compareRankedResults(a.rank, b.rank, sortBy, sortOrder));

  const isAll = pageSize === 'ALL';
  const effectivePageSize = isAll ? totalResults : Number(pageSize) || 10;
  const totalPages = isAll ? 1 : Math.ceil(totalResults / effectivePageSize);
  const startIndex = isAll ? 0 : (page - 1) * effectivePageSize;
  const endIndex = isAll ? ranked.length : startIndex + effectivePageSize;

  const pagination: PaginationInfo = {
    currentPage: page,
    totalPages,
    totalResults,
    totalMatches,
    resultsPerPage: effectivePageSize,
    hasNextPage: isAll ? false : page < totalPages,
    hasPreviousPage: isAll ? false : page > 1,
  };

  return {
    results: ranked.slice(startIndex, endIndex).map(({ result }) => result),
    pagination,
  };
}

export {
  compareRankedResults,
  dateFromFileName,
  mergeSearchResults,
  pageOptionsForMerge,
};
export type { RankedResult };
