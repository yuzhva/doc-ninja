import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { MegaSearch, createMegaSearch } from '../mega-search.mjs';
import type { SearchOptions } from '../mega-search.types.mjs';
import { knownBug } from '../test-utils/known-bug.mjs';
import {
  createSearchFixture,
  fileNames,
} from '../test-utils/search-fixture.mjs';
import type { SearchFixture } from '../test-utils/search-fixture.mjs';
import { later } from '../test-utils/temp-corpus.mjs';
import { UkrainianTextProcessor } from '../text-processor.mjs';

const textProcessor = new UkrainianTextProcessor();

/**
 * Shared, read-only corpus. Common words (наказ: 5 of 13 documents) stay below
 * half the corpus so BM25 idf is positive; see the ranking known bug below.
 */
const CORPUS = {
  // file names carry dates for sortBy: 'date' (default pattern DD.MM.YYYY / DD.MM.YY)
  'orders/наказ 01.02.2024.txt':
    'Начальник управління підписав наказ про бюджет. Документи передано до архіву.',
  'orders/наказ 15.06.23.txt':
    'Наказ про відпустку. Начальник відділу погодив.',
  'orders/наказ 10.10.25.txt': 'Наказ про премію.',
  'orders 2022/наказ 03.03.2022.txt': 'Архівний наказ щодо кошторису.',
  'misc/undated.txt': 'Наказ без дати.',
  'reports/budget.txt':
    'Кошторис кошторису кошторис. Бюджет міста. Новий кошторис.',
  'reports/annual.txt': 'Річний звіт про кошторис.',
  'reports/звіт_05_07_2024.txt': 'Звіт за липень.',
  'en/cars.txt':
    'The rich expensive car was parked. Rich car owners love cars.',
  'en/search.txt': 'Full text search engine documentation.',
  'misc/news.txt': 'Новини спорту сьогодні.',
  'misc/weather.txt': 'Погода сонячна весь тиждень.',
  'misc/recipe.txt': 'Рецепт борщу з пампушками.',
  'misc/readme.md': 'Кошторис у markdown — не індексується (.txt only).',
};

const ORDERS = [
  'наказ 01.02.2024.txt',
  'наказ 15.06.23.txt',
  'наказ 10.10.25.txt',
];

const STRICT_MODE_DECISION =
  'Pending decision on what strict mode ("Allow fuzzy match" off) means: the same word in any ' +
  'inflected form without typos, or the exact word form only';

/** How be-krang's DocumentIntelligenceService searches every query. */
const PRODUCTION_OPTIONS: SearchOptions = {
  maxTypoDistance: 1,
  isPhraseProximityEnabled: true,
  maxWordsInPhraseDistance: 2,
  snippetsLimit: 'ALL',
  sortBy: 'date',
};

describe('MegaSearch', () => {
  let fixture: SearchFixture;
  const search = (query: string, options?: SearchOptions) =>
    fixture.megaSearch.search(query, options);
  const find = async (query: string, options?: SearchOptions) =>
    fileNames(await search(query, options));

  before(async () => {
    fixture = await createSearchFixture(CORPUS);
  });

  after(() => fixture.cleanup());

  describe('createMegaSearch()', () => {
    it('indexes the corpus up front and reports its stats', () => {
      const stats = fixture.megaSearch.getStats();

      assert.equal(stats.documentsCount, 13);
      assert.ok(stats.termsCount > 0);
      assert.ok(stats.totalTokens > stats.documentsCount);
      assert.ok(stats.memory);
    });

    it('indexes only the configured extensions', async () => {
      assert.ok(!(await find('кошторис')).includes('readme.md'));
    });

    it('serves identical results from the persisted index on the next start', async () => {
      const restarted = await createMegaSearch(fixture.config);
      const scored = async (megaSearch: MegaSearch) =>
        (await megaSearch.search('кошторис')).results.map((r) => [
          r.doc.fileName,
          r.score,
        ]);

      assert.deepEqual(
        await scored(restarted),
        await scored(fixture.megaSearch),
      );
    });
  });

  describe('search() — words', () => {
    it('finds every inflected form of a word', async () => {
      assert.deepEqual((await find('кошторис')).sort(), [
        'annual.txt',
        'budget.txt',
        'наказ 03.03.2022.txt', // "кошторису"
      ]);
    });

    it('ignores letter case', async () => {
      assert.deepEqual(await find('КОШТОРИС'), await find('кошторис'));
    });

    it('returns an empty first page for a query made only of stop words', async () => {
      assert.deepEqual(await search('і та the'), {
        results: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalResults: 0,
          totalMatches: 0,
          resultsPerPage: 10,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });
    });

    it('returns token snippets rendered from the raw document text', async () => {
      const [result] = (
        await search('бюджет', { searchScopedPaths: ['orders'] })
      ).results;
      const raw = await fixture.corpus.read('orders/наказ 01.02.2024.txt');
      const [snippet] = result.snippets;

      assert.equal(snippet.matchType, 'token');
      assert.equal(snippet.match, 'бюджет');
      assert.equal(
        raw.slice(snippet.matchCharStart, snippet.matchCharEnd),
        'бюджет',
      );
      assert.ok(snippet.context.startsWith('<b>бюджет</b>'));
      assert.ok(snippet.context.endsWith('...'));
    });

    it('caps snippets per document with snippetsLimit (default 3, "ALL" for every match)', async () => {
      const snippetCount = async (snippetsLimit?: number | 'ALL') => {
        const result = await search('кошторис', { snippetsLimit });
        return result.results.find((r) => r.doc.fileName === 'budget.txt')!
          .snippets.length;
      };

      assert.equal(await snippetCount(), 3);
      assert.equal(await snippetCount(1), 1);
      assert.equal(await snippetCount('ALL'), 4);
    });

    it('lists every occurrence with raw char offsets when includeHighlights is set', async () => {
      const raw = await fixture.corpus.read('reports/budget.txt');
      const highlightsOf = async (includeHighlights?: boolean) =>
        (await search('кошторис', { includeHighlights })).results.find(
          (r) => r.doc.fileName === 'budget.txt',
        )!.highlights;

      assert.deepEqual(await highlightsOf(), []);

      const highlights = await highlightsOf(true);
      assert.equal(highlights.length, 4);
      for (const { charStart, charEnd } of highlights) {
        const word = textProcessor.normalize(raw.slice(charStart, charEnd));
        assert.equal(
          textProcessor.stemWord(word),
          textProcessor.stemWord('кошторис'),
        );
      }
    });
  });

  describe('search() — typo tolerance', () => {
    it('matches a misspelled word within maxTypoDistance (default 1)', async () => {
      assert.ok((await find('упрвління')).includes('наказ 01.02.2024.txt'));
    });

    it('matches more distant misspellings with a larger maxTypoDistance', async () => {
      assert.ok(!(await find('упрвлння')).includes('наказ 01.02.2024.txt'));
      assert.ok(
        (await find('упрвлння', { maxTypoDistance: 2 })).includes(
          'наказ 01.02.2024.txt',
        ),
      );
    });

    it('returns snippets and highlights for documents found through a typo', async () => {
      // Regression guard: scoring matched the misspelled stem by Levenshtein
      // distance, but snippets/highlights compared stems for exact equality,
      // so typo matches came back without any.
      const [result] = (await search('упрвління', { includeHighlights: true }))
        .results;
      const [snippet] = result.snippets;
      const queryStem = textProcessor.stemWord('упрвління');

      assert.equal(snippet.match, 'управління');
      assert.equal(snippet.highlights[0].term, queryStem);
      assert.ok(snippet.confidence > 0 && snippet.confidence < 1);
      assert.equal(result.highlights[0].originalWord, 'управління');
      assert.equal(result.highlights[0].term, queryStem);
      assert.ok(result.highlights[0].confidence < 1);
    });

    it(
      'tolerates two swapped letters with the default maxTypoDistance, as SearchOptions documents',
      knownBug(
        'SearchOptions.maxTypoDistance promises "search" ↔ "serach" (1 transposition), but plain ' +
          'Levenshtein counts a swap as 2 edits. Pending decision: count a swap as one edit ' +
          '(OSA / Damerau–Levenshtein), or correct the docs',
      ),
      async () => {
        assert.deepEqual(await find('serach'), ['search.txt']);
      },
    );

    it('with typo tolerance off, still finds an exact word whose stem is the word itself', async () => {
      assert.deepEqual(await find('car', { isTypoToleranceEnabled: false }), [
        'cars.txt',
      ]);
    });

    it(
      'with typo tolerance off, finds an inflected word spelled exactly as in the text',
      knownBug(
        'strict mode looks the unstemmed query word up in the inverted index, whose keys are stems, ' +
          'so any word that differs from its stem ("управління" → "управлін", "cars" → "car") is never found. ' +
          STRICT_MODE_DECISION,
      ),
      async () => {
        assert.ok(
          (
            await find('управління', { isTypoToleranceEnabled: false })
          ).includes('наказ 01.02.2024.txt'),
        );
      },
    );
  });

  describe('search() — "quoted" phrases', () => {
    it('requires the phrase words adjacent and in order', async () => {
      assert.deepEqual(await find('"rich car"'), ['cars.txt']);
      assert.deepEqual(await find('"car rich"'), []);
    });

    it('matches a phrase of inflected Ukrainian words', async () => {
      // Regression guard: the phrase was compared with the unstemmed query
      // words against stemmed document tokens (a parameter renamed to
      // `originalPhraseTokens` in ff6d602d was taken literally in cf2417a8).
      assert.deepEqual(await find('"начальник управління"'), [
        'наказ 01.02.2024.txt',
      ]);
    });

    it(
      'with typo tolerance off, matches a phrase of inflected words spelled exactly as in the text',
      knownBug(
        'strict mode compares the unstemmed query words with stems, as for single words. ' +
          STRICT_MODE_DECISION,
      ),
      async () => {
        assert.deepEqual(
          await find('"начальник управління"', {
            isTypoToleranceEnabled: false,
          }),
          ['наказ 01.02.2024.txt'],
        );
      },
    );

    it('returns snippets for phrase matches', async () => {
      // Regression guard: the strict phrase path counted matches but never
      // recorded their positions, which phrase snippets are rendered from.
      const [fuzzy] = (await search('"rich car"')).results;
      const [strict] = (
        await search('"rich car"', { isTypoToleranceEnabled: false })
      ).results;

      assert.deepEqual(
        fuzzy.snippets.map((s) => [s.matchType, s.match]),
        [['fuzzy-phrase', 'Rich car']],
      );
      assert.equal(
        fuzzy.snippets[0].context,
        '<b>Rich</b> <b>car</b> owners love cars...',
      );
      assert.deepEqual(
        strict.snippets.map((s) => [s.matchType, s.match]),
        [['exact-phrase', 'Rich car']],
      );
    });

    it('ranks phrase and proximity matches by relevance', async () => {
      // Regression guard: phrase scoring read doc.termFrequency, which the
      // indexer empties in memory, so every phrase result — and so every
      // be-krang query — scored 0.
      const [quoted] = (await search('"rich car"')).results;
      const [proximity] = (
        await search('начальник управління', PRODUCTION_OPTIONS)
      ).results;

      assert.ok(quoted.score > 0);
      assert.ok(proximity.score > 0);
    });
  });

  describe('search() — phrase proximity (how be-krang searches)', () => {
    const proximity = (query: string, maxWordsInPhraseDistance?: number) =>
      search(query, {
        isPhraseProximityEnabled: true,
        maxWordsInPhraseDistance,
      });

    it('maxWordsInPhraseDistance: 1 matches adjacent words only', async () => {
      const result = await proximity('rich car', 1);

      assert.deepEqual(
        result.results[0].snippets.map((s) => s.match),
        ['Rich car'],
      );
    });

    it('maxWordsInPhraseDistance: 2 also bridges one word in between', async () => {
      const result = await proximity('rich car', 2);
      const [snippet] = result.results[0].snippets;

      assert.deepEqual(
        result.results[0].snippets.map((s) => s.match),
        ['rich expensive car', 'Rich car'],
      );
      assert.equal(result.pagination.totalMatches, 2);
      assert.equal(snippet.matchType, 'fuzzy-phrase');
      assert.equal(
        snippet.context,
        '<b>rich</b> expensive <b>car</b> was parked...',
      );
    });

    it('matches inflected and misspelled phrase words with the production options', async () => {
      for (const query of ['начальника управління', 'начальник упрвління']) {
        assert.deepEqual(
          await find(query, PRODUCTION_OPTIONS),
          ['наказ 01.02.2024.txt'],
          query,
        );
      }
    });

    it(
      'with the default maxWordsInPhraseDistance (0), matches adjacent words as SearchOptions documents',
      knownBug(
        'the distance is compared as a position step (adjacent = 1), so the default 0 never matches ' +
          'a multi-word phrase; SearchOptions documents it as words *between* (0 = adjacent, 1 = one-word gap). ' +
          'Pending decision: make the code match the docs (and move be-krang from 2 to 1), or keep it and fix the docs + default',
      ),
      async () => {
        assert.deepEqual(fileNames(await proximity('rich car')), ['cars.txt']);
      },
    );
  });

  describe('search() — ranking', () => {
    it('ranks by BM25 relevance — more occurrences first', async () => {
      const { results } = await search('кошторис');

      assert.equal(results[0].doc.fileName, 'budget.txt');
      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1].score >= results[i].score);
      }
    });

    it('adds up scores across query words', async () => {
      assert.equal((await find('начальник бюджет'))[0], 'наказ 01.02.2024.txt');
    });

    it('ranks with TF-IDF when useBM25 is false', async () => {
      const tfIdf = await createMegaSearch({
        ...fixture.config,
        useBM25: false,
      });
      const { results } = await tfIdf.search('кошторис');

      assert.equal(results[0].doc.fileName, 'budget.txt');
      assert.ok(results.every((r) => r.score > 0));
    });

    describe('when the query words are common', () => {
      let common: SearchFixture;

      before(async () => {
        // each query word sits in 2 of 4 documents (df = N/2 → idf = 0)
        common = await createSearchFixture({
          'both.txt': 'Начальник управління підписав наказ.',
          'first-only.txt': 'Начальник відділу.',
          'second-only.txt': 'Управління справами.',
          'neither.txt': 'Бюджет міста.',
        });
      });

      after(() => common.cleanup());

      it(
        'ranks a document matching every query word above one matching only some',
        knownBug(
          'BM25 idf ln((N - df + 0.5) / (df + 0.5)) is 0 at df = N/2 and negative above, so ' +
            'common words cannot lift — or even lower — a document (see bm25-scorer.test.mts). ' +
            "Pending decision: switch to Lucene's ln(1 + …) idf",
        ),
        async () => {
          const { results } = await common.megaSearch.search(
            'начальник управління',
          );
          const scoreOf = (fileName: string) =>
            results.find((r) => r.doc.fileName === fileName)!.score;

          assert.ok(scoreOf('both.txt') > scoreOf('first-only.txt'));
        },
      );
    });
  });

  describe('search() — pagination', () => {
    it('slices the ranked results into pages', async () => {
      const first = await search('наказ', { pageSize: 2, page: 1 });
      const last = await search('наказ', { pageSize: 2, page: 3 });

      assert.equal(first.results.length, 2);
      assert.deepEqual(first.pagination, {
        currentPage: 1,
        totalPages: 3,
        totalResults: 5,
        totalMatches: 5,
        resultsPerPage: 2,
        hasNextPage: true,
        hasPreviousPage: false,
      });
      assert.equal(last.results.length, 1);
      assert.equal(last.pagination.hasNextPage, false);
      assert.equal(last.pagination.hasPreviousPage, true);
    });

    it('returns the same order across pages as on one "ALL" page', async () => {
      const all = await search('наказ', { pageSize: 'ALL' });
      const paged = [];
      for (const page of [1, 2, 3]) {
        paged.push(...(await find('наказ', { pageSize: 2, page })));
      }

      assert.deepEqual(paged, fileNames(all));
      assert.deepEqual(all.pagination, {
        currentPage: 1,
        totalPages: 1,
        totalResults: 5,
        totalMatches: 5,
        resultsPerPage: 5,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it('returns no results past the last page, keeping the totals', async () => {
      const { results, pagination } = await search('наказ', {
        pageSize: 2,
        page: 9,
      });

      assert.deepEqual(results, []);
      assert.equal(pagination.totalResults, 5);
    });
  });

  describe('search() — sorting by date in the file name', () => {
    it('sorts newest first by default, undated files last', async () => {
      assert.deepEqual(await find('наказ', { sortBy: 'date' }), [
        'наказ 10.10.25.txt', // two-digit "25" → 2025, the case the parser was written for
        'наказ 01.02.2024.txt',
        'наказ 15.06.23.txt',
        'наказ 03.03.2022.txt',
        'undated.txt',
      ]);
    });

    it('sorts oldest first with sortOrder: "asc", undated files first', async () => {
      assert.deepEqual(
        await find('наказ', { sortBy: 'date', sortOrder: 'asc' }),
        [
          'undated.txt',
          'наказ 03.03.2022.txt',
          'наказ 15.06.23.txt',
          'наказ 01.02.2024.txt',
          'наказ 10.10.25.txt',
        ],
      );
    });

    it('accepts a custom filenameDatePattern with (day, month, year) groups', async () => {
      const filenameDatePattern = String.raw`(\d{2})_(\d{2})_(\d{4})`;

      assert.deepEqual(
        await find('звіт', { sortBy: 'date', filenameDatePattern }),
        ['звіт_05_07_2024.txt', 'annual.txt'],
      );
      assert.deepEqual(
        await find('звіт', {
          sortBy: 'date',
          sortOrder: 'asc',
          filenameDatePattern,
        }),
        ['annual.txt', 'звіт_05_07_2024.txt'],
      );
    });
  });

  describe('search() — scoped paths', () => {
    const assertOrdersOnly = (found: string[]) => {
      for (const order of ORDERS) assert.ok(found.includes(order), order);
      assert.ok(!found.includes('undated.txt'));
    };

    it('restricts results to folders given relative to the root', async () => {
      assertOrdersOnly(await find('наказ', { searchScopedPaths: ['orders'] }));
    });

    it('accepts a leading slash and absolute paths inside the root', async () => {
      assertOrdersOnly(await find('наказ', { searchScopedPaths: ['/orders'] }));
      assertOrdersOnly(
        await find('наказ', {
          searchScopedPaths: [fixture.corpus.pathOf('orders')],
        }),
      );
    });

    it('unions several scopes', async () => {
      const found = await find('наказ', {
        searchScopedPaths: ['orders', 'misc'],
      });

      assert.ok(found.includes('undated.txt'));
      assert.ok(found.includes('наказ 10.10.25.txt'));
    });

    it('scopes phrase-proximity searches too', async () => {
      const inScope = (searchScopedPaths: string[]) =>
        find('начальник управління', {
          ...PRODUCTION_OPTIONS,
          searchScopedPaths,
        });

      assert.deepEqual(await inScope(['orders']), ['наказ 01.02.2024.txt']);
      assert.deepEqual(await inScope(['reports']), []);
    });

    it('does not leak into a sibling folder whose name starts with the scope', async () => {
      // Regression guard: a plain startsWith let "orders" match "orders 2022/…"
      // (and "Накази" would match "Накази 2022").
      for (const scope of ['orders', 'orders/', '/orders/']) {
        assert.ok(
          !(await find('наказ', { searchScopedPaths: [scope] })).includes(
            'наказ 03.03.2022.txt',
          ),
          scope,
        );
      }
    });

    it('accepts a single file as a scope', async () => {
      assert.deepEqual(
        await find('наказ', {
          searchScopedPaths: ['orders/наказ 10.10.25.txt'],
        }),
        ['наказ 10.10.25.txt'],
      );
    });
  });

  describe('search() — result cache', () => {
    it('serves a repeated identical search from the cache', async () => {
      assert.equal(await search('бюджет'), await search('бюджет'));
    });

    it('keys the cache by options as well as the query', async () => {
      assert.notEqual(
        await search('бюджет', { pageSize: 5 }),
        await search('бюджет', { pageSize: 6 }),
      );
    });
  });

  it('rejects with a wrapped error when the index is unavailable', async (t) => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(fixture.megaSearch.indexer, 'getSearchDataOptimized', () => {
      throw new Error('index file vanished');
    });

    await assert.rejects(
      search('погода'),
      /^Error: Search operation failed: Search indexes are not available$/,
    );
  });
});

describe('MegaSearch over an empty folder', () => {
  it('reports an empty index and returns empty results', async (t) => {
    t.mock.method(console, 'log', () => {}); // BM25 logs a NaN average for 0 docs
    const empty = await createSearchFixture({});
    t.after(() => empty.cleanup());

    assert.equal(empty.megaSearch.getStats().documentsCount, 0);
    assert.deepEqual((await empty.megaSearch.search('наказ')).results, []);
  });
});

describe('MegaSearch re-indexing and cache maintenance', () => {
  const INITIAL = {
    'a.txt': 'Начальник підписав наказ.',
    'b.txt': 'Бюджет міста затверджено.',
    'c.txt': 'Новини спорту сьогодні.',
  };
  let fixture: SearchFixture;
  const find = async (query: string) =>
    fileNames(await fixture.megaSearch.search(query));

  const useFreshFixture = () => {
    before(async () => {
      fixture = await createSearchFixture(INITIAL);
    });
    after(() => fixture.cleanup());
  };

  describe('reindex() after adding a document', () => {
    useFreshFixture();

    it('makes the new document searchable', async () => {
      await fixture.corpus.write('d.txt', 'Квартальний звіт.');
      await fixture.megaSearch.reindex();

      assert.deepEqual(await find('звіт'), ['d.txt']);
    });
  });

  describe('reindex() after deleting a document', () => {
    useFreshFixture();

    it('drops the document from results', async () => {
      await fixture.corpus.remove('b.txt');
      await fixture.megaSearch.reindex();

      assert.deepEqual(await find('бюджет'), []);
    });
  });

  describe('reindex() with earlier searches in the result cache', () => {
    useFreshFixture();

    it('returns fresh results for a query searched before the reindex', async () => {
      // Regression guard: reindex() never cleared the result cache, so a
      // long-lived instance — as in be-krang — served pre-reindex results.
      assert.deepEqual(await find('звіт'), []);
      await fixture.corpus.write('d.txt', 'Квартальний звіт.');
      await fixture.megaSearch.reindex();

      assert.deepEqual(await find('звіт'), ['d.txt']);
    });
  });

  describe('reindex() after editing an indexed document', () => {
    useFreshFixture();

    it('serves the edited content', async () => {
      // Regression guard (see file-indexer.test.mts): edited files were not
      // rebuilt into the inverted index, and the text cache kept the old text.
      await fixture.corpus.write('a.txt', 'Кошторис затверджено.', later());
      await fixture.megaSearch.reindex();

      assert.deepEqual(await find('кошторис'), ['a.txt']);
      assert.deepEqual(await find('наказ'), []);
    });
  });

  describe('a document edited while the app was closed', () => {
    useFreshFixture();

    it('is served with its edited content on the next start', async () => {
      await fixture.corpus.write('a.txt', 'Кошторис затверджено.', later());
      const restarted = await createMegaSearch(fixture.config);

      assert.deepEqual(fileNames(await restarted.search('кошторис')), [
        'a.txt',
      ]);
      assert.deepEqual(fileNames(await restarted.search('наказ')), []);
    });
  });

  describe('reindex() compared with a fresh start', () => {
    useFreshFixture();

    it('scores exactly like a fresh index of the same corpus', async () => {
      // Regression guard: only initialize() computed the BM25 average document
      // length, so scores drifted after every reindex().
      await fixture.corpus.write(
        'long.txt',
        'Начальник управління освіти підписав наказ про зміну графіку роботи всіх шкіл міста.',
      );
      await fixture.megaSearch.reindex();
      const fresh = await createMegaSearch(fixture.config);
      // a word only the new document has, so idf > 0 and length normalization shows
      const scores = async (megaSearch: MegaSearch) =>
        (await megaSearch.search('освіти')).results.map((r) => [
          r.doc.fileName,
          r.score,
        ]);

      assert.deepEqual(await scores(fixture.megaSearch), await scores(fresh));
    });
  });

  describe('clearCache()', () => {
    useFreshFixture();

    it('deletes the on-disk cache and empties the instance until the next reindex', async () => {
      assert.deepEqual(await find('наказ'), ['a.txt']);

      await fixture.megaSearch.clearCache();

      assert.equal(fixture.corpus.exists('.cache'), false);
      assert.deepEqual(await find('наказ'), []);

      await fixture.megaSearch.reindex();
      assert.deepEqual(await find('наказ'), ['a.txt']);
    });
  });

  describe('MegaSearch.clearCacheFor()', () => {
    it('deletes the cache of a root, honouring cache-path overrides', async (t) => {
      const custom = await createSearchFixture(INITIAL, {
        cacheRoot: 'search-cache',
      });
      t.after(() => custom.cleanup());
      assert.ok(custom.corpus.exists('search-cache'));

      await MegaSearch.clearCacheFor(custom.corpus.root, {
        cacheRoot: 'search-cache',
      });

      assert.equal(custom.corpus.exists('search-cache'), false);
    });
  });
});
