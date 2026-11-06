import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { MegaSearch, createMegaSearch } from '../mega-search.mjs';
import type { SearchOptions } from '../mega-search.types.mjs';
import {
  createSearchFixture,
  fileNames,
} from '../test-utils/search-fixture.mjs';
import type { SearchFixture } from '../test-utils/search-fixture.mjs';
import { later } from '../test-utils/temp-corpus.mjs';
import { UkrainianTextProcessor } from '../text-processor.mjs';

const textProcessor = new UkrainianTextProcessor();

/**
 * Shared, read-only corpus: 13 documents, the commonest word (наказ) in 5.
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

/** How be-krang's DocumentIntelligenceService searches every query. */
const PRODUCTION_OPTIONS: SearchOptions = {
  maxTypoDistance: 1,
  isPhraseProximityEnabled: true,
  maxWordsInPhraseDistance: 1,
  snippetsLimit: 'ALL',
  sortBy: 'date',
};

/**
 * One name and one English word, a different form of it in each document —
 * the examples "Allow fuzzy match" is specified with.
 */
const FORMS_CORPUS = {
  'genitive.txt': 'Наказ видано на користь Євгена Петренка.',
  'nominative.txt': 'Заяву подав Євген Петренко.',
  'dative.txt': 'Лист надіслано Євгену Петренку.',
  'full-name.txt': 'Документ підписав Євгеній Коваль.',
  'parked.txt': 'The car was parked outside.',
  'parking.txt': 'Free parking near the office.',
  'parks.txt': 'Two parks in town.',
};

const EVHEN_FORMS = [
  'dative.txt',
  'full-name.txt',
  'genitive.txt',
  'nominative.txt',
];
const PARK_FORMS = ['parked.txt', 'parking.txt', 'parks.txt'];

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

    it('tolerates two swapped letters with the default maxTypoDistance, as SearchOptions documents', async () => {
      // Regression guard: plain Levenshtein counted a swap as 2 edits.
      assert.deepEqual(await find('serach'), ['search.txt']);
      assert.deepEqual(
        await find('serach', { isInflectedWordFormsAllowed: false }),
        ['search.txt'],
      );
      assert.deepEqual(await find('serach', { maxTypoDistance: 0 }), []);
    });

    it('with fuzzy match off, finds a word whose stem is the word itself', async () => {
      assert.deepEqual(
        await find('car', { isInflectedWordFormsAllowed: false }),
        ['cars.txt'],
      );
    });

    it('with fuzzy match off, finds an inflected word spelled exactly as in the text', async () => {
      // Regression guard: strict mode looked the unstemmed query word up in
      // the inverted index, whose keys are stems, so a word that differs
      // from its stem ("управління" → "управлін") was never found.
      assert.deepEqual(
        await find('управління', { isInflectedWordFormsAllowed: false }),
        ['наказ 01.02.2024.txt'],
      );
    });
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

    it('with fuzzy match off, matches a phrase of inflected words spelled exactly as in the text', async () => {
      // Regression guard: strict mode compared the unstemmed query words
      // with stems, as for single words.
      assert.deepEqual(
        await find('"начальник управління"', {
          isInflectedWordFormsAllowed: false,
        }),
        ['наказ 01.02.2024.txt'],
      );
    });

    it('returns snippets for phrase matches', async () => {
      // Regression guard: the strict phrase path counted matches but never
      // recorded their positions, which phrase snippets are rendered from.
      const [fuzzy] = (await search('"rich car"')).results;
      const [strict] = (
        await search('"rich car"', { isInflectedWordFormsAllowed: false })
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

    it('maxWordsInPhraseDistance: 0 (the default) matches adjacent words only', async () => {
      // Regression guard: the distance was compared as a position step
      // (adjacent = 1), so the default 0 never matched a multi-word phrase
      // and every value meant one word fewer than SearchOptions documents.
      for (const maxWordsInPhraseDistance of [undefined, 0]) {
        const result = await proximity('rich car', maxWordsInPhraseDistance);

        assert.deepEqual(
          result.results[0].snippets.map((s) => s.match),
          ['Rich car'],
        );
      }
    });

    it('maxWordsInPhraseDistance: 1 also bridges one word in between', async () => {
      const result = await proximity('rich car', 1);
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
  });

  it('treats a query searched both with and without proximity as each asks', async () => {
    // Regression guard: the tokenization cache ignored proximity, so a query
    // first searched word by word stayed word-by-word with proximity on.
    const query = 'rich car';
    const wordByWord = await search(query);
    const asPhrase = await search(query, { isPhraseProximityEnabled: true });

    assert.equal(wordByWord.results[0].snippets[0].matchType, 'token');
    assert.equal(asPhrase.results[0].snippets[0].matchType, 'fuzzy-phrase');
  });

  describe('search() — "Allow fuzzy match" (isInflectedWordFormsAllowed) and typos (maxTypoDistance)', () => {
    let forms: SearchFixture;

    before(async () => {
      forms = await createSearchFixture(FORMS_CORPUS);
    });

    after(() => forms.cleanup());

    const fuzzy = (maxTypoDistance = 1): SearchOptions => ({
      isInflectedWordFormsAllowed: true,
      maxTypoDistance,
    });
    const strict = (maxTypoDistance = 1): SearchOptions => ({
      isInflectedWordFormsAllowed: false,
      maxTypoDistance,
    });

    const SEARCH_MODES: Array<[string, SearchOptions]> = [
      ['as be-krang searches (phrase proximity)', PRODUCTION_OPTIONS],
      ['word by word', {}],
    ];

    for (const [mode, modeOptions] of SEARCH_MODES) {
      describe(mode, () => {
        const searchForms = (query: string, options: SearchOptions) =>
          forms.megaSearch.search(query, { ...modeOptions, ...options });
        const findForms = async (query: string, options: SearchOptions) =>
          fileNames(await searchForms(query, options)).sort();

        it('fuzzy match on: finds every inflected form of the word', async () => {
          assert.deepEqual(await findForms('Євгена', fuzzy()), EVHEN_FORMS);
          assert.deepEqual(await findForms('parked', fuzzy()), PARK_FORMS);
        });

        it('fuzzy match off: finds only the form typed, even though other forms are 1 edit away', async () => {
          assert.deepEqual(await findForms('Євгена', strict()), [
            'genitive.txt',
          ]);
          assert.deepEqual(await findForms('parked', strict()), ['parked.txt']);
        });

        it('fuzzy match off: still finds a misspelled word within maxTypoDistance', async () => {
          assert.deepEqual(await findForms('єгена', strict()), [
            'genitive.txt',
          ]);
          assert.deepEqual(await findForms('prked', strict()), ['parked.txt']);
        });

        it('fuzzy match on: typos and inflections combine', async () => {
          assert.deepEqual(await findForms('єгена', fuzzy()), EVHEN_FORMS);
          // "prked" hides its stem from the stemmer, yet is 1 edit from "parked"
          assert.deepEqual(await findForms('prked', fuzzy()), PARK_FORMS);
        });

        it('maxTypoDistance 0 turns typo tolerance off, in both modes', async () => {
          assert.deepEqual(await findForms('єгена', fuzzy(0)), []);
          assert.deepEqual(await findForms('єгена', strict(0)), []);
          assert.deepEqual(await findForms('Євгена', fuzzy(0)), EVHEN_FORMS);
          assert.deepEqual(await findForms('Євгена', strict(0)), [
            'genitive.txt',
          ]);
        });

        it('returns snippets of what matched, at lower confidence for a typo', async () => {
          const [exact] = (await searchForms('Євгена', strict())).results;
          const [typo] = (await searchForms('єгена', strict())).results;

          assert.deepEqual(
            exact.snippets.map((s) => [s.match, s.confidence]),
            [['Євгена', 1]],
          );
          assert.deepEqual(
            typo.snippets.map((s) => s.match),
            ['Євгена'],
          );
          assert.ok(typo.snippets[0].confidence < 1);

          for (const query of ['Євгена', 'єгена', 'parked']) {
            for (const { results } of [
              await searchForms(query, fuzzy()),
              await searchForms(query, strict()),
            ]) {
              assert.ok(
                results.every((r) => r.snippets.length > 0),
                `every result has snippets: "${query}"`,
              );
            }
          }
        });
      });
    }

    describe('phrases', () => {
      const PHRASES: Array<[string, string, SearchOptions]> = [
        ['as be-krang searches', 'Євгена Петренка', PRODUCTION_OPTIONS],
        ['"quoted"', '"Євгена Петренка"', {}],
      ];

      for (const [mode, query, modeOptions] of PHRASES) {
        it(`match word by word the same way — ${mode}`, async () => {
          const findPhrase = async (options: SearchOptions) =>
            fileNames(
              await forms.megaSearch.search(query, {
                ...modeOptions,
                ...options,
              }),
            ).sort();

          assert.deepEqual(await findPhrase(fuzzy()), [
            'dative.txt',
            'genitive.txt',
            'nominative.txt',
          ]);
          assert.deepEqual(await findPhrase(strict()), ['genitive.txt']);
        });
      }

      it('a strict phrase with a typo still renders its snippet', async () => {
        // Regression guard: exact-phrase snippets dropped any typo match.
        const [result] = (
          await forms.megaSearch.search('"єгена петренка"', strict())
        ).results;

        assert.deepEqual(
          result.snippets.map((s) => [s.matchType, s.match]),
          [['exact-phrase', 'Євгена Петренка']],
        );
      });
    });
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

      it('ranks a document matching every query word above one matching only some', async () => {
        // Regression guard: the classic BM25 idf is 0 at df = N/2 and
        // negative above, so common words could not lift — or even lowered —
        // a document (see bm25-scorer.test.mts).
        const { results } = await common.megaSearch.search(
          'начальник управління',
        );
        const scoreOf = (fileName: string) =>
          results.find((r) => r.doc.fileName === fileName)!.score;

        assert.ok(scoreOf('both.txt') > scoreOf('first-only.txt'));
      });
    });

    it('ranks more mentions of a word most documents hold higher, not lower', async () => {
      // наказ is in 3 of 4 documents (classic idf < 0 inverted this order)
      const fixture = await createSearchFixture({
        'three.txt': 'Наказ про наказ і ще один наказ.',
        'one.txt': 'Наказ про відпустку.',
        'two.txt': 'Наказ про премію та наказ.',
        'none.txt': 'Бюджет міста.',
      });
      try {
        const { results } = await fixture.megaSearch.search('наказ');

        assert.deepEqual(
          results.map((r) => r.doc.fileName),
          ['three.txt', 'two.txt', 'one.txt'],
        );
        assert.ok(results.every((r) => r.score > 0));
      } finally {
        await fixture.cleanup();
      }
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
