import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PaginatedSearchResult } from '../mega-search.types.mjs';
import {
  compareRankedResults,
  dateFromFileName,
  mergeSearchResults,
  pageOptionsForMerge,
} from '../search-result-order.mjs';

type Found = { fileName: string; score: number };

/** One folder's search answer, its results in the order given. */
const folderResult = (
  folder: string,
  found: Found[],
  totals: { totalResults?: number; totalMatches?: number } = {},
): PaginatedSearchResult => ({
  results: found.map(({ fileName, score }) => ({
    doc: { fileName, originalFilePath: `${folder}/${fileName}` },
    score,
    snippets: [],
    highlights: [],
  })),
  pagination: {
    currentPage: 1,
    totalPages: 1,
    totalResults: totals.totalResults ?? found.length,
    totalMatches: totals.totalMatches ?? found.length,
    resultsPerPage: 10,
    hasNextPage: false,
    hasPreviousPage: false,
  },
});

const fileNames = (result: PaginatedSearchResult) =>
  result.results.map((found) => found.doc.fileName);

describe('dateFromFileName()', () => {
  it('reads DD.MM.YYYY', () => {
    assert.equal(
      dateFromFileName('Наказ 12 від 03.02.2024.docx'),
      new Date(2024, 1, 3).getTime(),
    );
  });

  it('reads a two-digit year as 2000–2049 or 1950–1999', () => {
    assert.equal(
      dateFromFileName('report 1-2-25.pdf'),
      new Date(2025, 1, 1).getTime(),
    );
    assert.equal(
      dateFromFileName('report 1/2/99.pdf'),
      new Date(1999, 1, 1).getTime(),
    );
  });

  it('is 0 for a name with no date, or an impossible one', () => {
    assert.equal(dateFromFileName('notes.txt'), 0);
    assert.equal(dateFromFileName('notes 31.13.2024.txt'), 0);
  });
});

describe('compareRankedResults()', () => {
  const older = { id: 'b', score: 9, date: 1 };
  const newer = { id: 'a', score: 1, date: 2 };

  it('puts the newer first by date, desc', () => {
    assert.ok(compareRankedResults(newer, older, 'date', 'desc') < 0);
    assert.ok(compareRankedResults(newer, older, 'date', 'asc') > 0);
  });

  it('puts the more relevant first on the same date, in either order', () => {
    const relevant = { id: 'x', score: 5, date: 1 };
    const lessRelevant = { id: 'y', score: 2, date: 1 };
    assert.ok(compareRankedResults(relevant, lessRelevant, 'date', 'asc') < 0);
    assert.ok(compareRankedResults(relevant, lessRelevant, 'date', 'desc') < 0);
  });

  it('orders equal scores by id when sorting by relevance', () => {
    const first = { id: 'a', score: 3, date: 0 };
    const second = { id: 'b', score: 3, date: 0 };
    assert.ok(compareRankedResults(first, second, 'relevance', 'desc') < 0);
  });
});

describe('pageOptionsForMerge()', () => {
  it('asks each folder for every page up to the one wanted', () => {
    assert.deepEqual(pageOptionsForMerge({ page: 3, pageSize: 10 }), {
      page: 1,
      pageSize: 30,
    });
  });

  it('asks for all of them when the page is all', () => {
    assert.deepEqual(pageOptionsForMerge({ pageSize: 'ALL' }), {
      page: 1,
      pageSize: 'ALL',
    });
  });

  it('defaults to the first page of 10', () => {
    assert.deepEqual(pageOptionsForMerge({}), { page: 1, pageSize: 10 });
  });
});

describe('mergeSearchResults()', () => {
  const orders = folderResult('/docs/orders', [
    { fileName: 'order 05.03.2024.txt', score: 1 },
    { fileName: 'order 01.01.2023.txt', score: 4 },
  ]);
  const archive = folderResult('/archive', [
    { fileName: 'memo 10.06.2024.txt', score: 2 },
    { fileName: 'memo 01.02.2024.txt', score: 3 },
  ]);

  it('orders both folders as one, by date', () => {
    const merged = mergeSearchResults([orders, archive], {
      sortBy: 'date',
      sortOrder: 'desc',
    });

    assert.deepEqual(fileNames(merged), [
      'memo 10.06.2024.txt',
      'order 05.03.2024.txt',
      'memo 01.02.2024.txt',
      'order 01.01.2023.txt',
    ]);
  });

  it('orders them by relevance', () => {
    const merged = mergeSearchResults([orders, archive], {
      sortBy: 'relevance',
    });

    assert.deepEqual(
      merged.results.map((found) => found.score),
      [4, 3, 2, 1],
    );
  });

  it('cuts to the page asked for, and adds up every folder’s totals', () => {
    const merged = mergeSearchResults(
      [
        folderResult(
          '/docs/orders',
          [{ fileName: 'order 05.03.2024.txt', score: 1 }],
          { totalResults: 7, totalMatches: 20 },
        ),
        folderResult(
          '/archive',
          [
            { fileName: 'memo 10.06.2024.txt', score: 2 },
            { fileName: 'memo 01.02.2024.txt', score: 3 },
          ],
          { totalResults: 5, totalMatches: 9 },
        ),
      ],
      { sortBy: 'date', page: 1, pageSize: 2 },
    );

    assert.deepEqual(fileNames(merged), [
      'memo 10.06.2024.txt',
      'order 05.03.2024.txt',
    ]);
    assert.deepEqual(merged.pagination, {
      currentPage: 1,
      totalPages: 6,
      totalResults: 12,
      totalMatches: 29,
      resultsPerPage: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  it('returns a later page out of the first pages of each folder', () => {
    const merged = mergeSearchResults([orders, archive], {
      sortBy: 'date',
      page: 2,
      pageSize: 2,
    });

    assert.deepEqual(fileNames(merged), [
      'memo 01.02.2024.txt',
      'order 01.01.2023.txt',
    ]);
    assert.equal(merged.pagination.hasPreviousPage, true);
  });

  it('returns everything when the page is all', () => {
    const merged = mergeSearchResults([orders, archive], {
      pageSize: 'ALL',
    });

    assert.equal(merged.results.length, 4);
    assert.equal(merged.pagination.totalPages, 1);
    assert.equal(merged.pagination.resultsPerPage, 4);
    assert.equal(merged.pagination.hasNextPage, false);
  });

  it('is an empty answer for no folders', () => {
    const merged = mergeSearchResults([], { pageSize: 10 });

    assert.deepEqual(merged.results, []);
    assert.equal(merged.pagination.totalResults, 0);
    assert.equal(merged.pagination.totalPages, 0);
  });
});
