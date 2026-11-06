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

  describe('search() — letter case', () => {
    // The same name written three ways, and a query in each of them: "євген"
    // must find "Євген", in every mode the UI and the API search with
    const NAMES = {
      'capital.txt': 'Заяву подав Євген Петренко.',
      'upper.txt': 'ЗАЯВУ ПОДАВ ЄВГЕН ПЕТРЕНКО.',
      'lower.txt': 'заяву подав євген петренко.',
    };
    const MODES: Record<string, SearchOptions> = {
      'library defaults': {},
      'fuzzy match off': { isInflectedWordFormsAllowed: false },
      'no typos': { maxTypoDistance: 0 },
      'be-krang': PRODUCTION_OPTIONS,
      'be-krang, fuzzy match off, no typos': {
        ...PRODUCTION_OPTIONS,
        isInflectedWordFormsAllowed: false,
        maxTypoDistance: 0,
      },
    };
    let cases: SearchFixture;

    before(async () => {
      cases = await createSearchFixture(NAMES);
    });

    after(() => cases.cleanup());

    for (const [mode, options] of Object.entries(MODES)) {
      it(`finds a word whatever its case in the query and the text (${mode})`, async () => {
        for (const query of [
          'євген',
          'Євген',
          'ЄВГЕН',
          'євген ПЕТРЕНКО',
          '"Євген петренко"',
        ]) {
          const { results } = await cases.megaSearch.search(query, options);
          assert.deepEqual(
            results.map((r) => r.doc.fileName).sort(),
            Object.keys(NAMES).sort(),
            query,
          );
        }
      });
    }

    it('returns each match as the text writes it', async () => {
      const { results } = await cases.megaSearch.search(
        'євген',
        PRODUCTION_OPTIONS,
      );

      assert.deepEqual(
        results.flatMap((r) => r.snippets.map((s) => s.match)).sort(),
        ['Євген', 'ЄВГЕН', 'євген'].sort(),
      );
    });
  });

  describe('search() — numbers', () => {
    const NUMBERS = {
      'incoming.txt': 'Лист Петренку Івану, вх№36088 від 22.12.2024).',
      'apart.txt': 'Сплачено 12.01.2024, на 22 особи.',
      'near.txt': 'Кошторис на 2023 рік, рахунок № 36087.',
      'leading-zero.txt': 'Наказ від 05.12.2024 № 5.',
      'order.txt': 'Наказ № 15/2 від 01.02.2024 про відпустку Коваленко Марії.',
    };
    // The same parts, glued by other characters or written apart
    const WRITTEN = {
      'dots.txt': 'Лист від 22.12.2024 надіслано.',
      'slashes.txt': 'Лист від 22/12/2024 надіслано.',
      'spaces.txt': 'Лист від 22 12 2024 надіслано.',
      'list.txt': 'Виконано пункти 22, 12, 2024 та 15, 2.',
      'code.txt': 'Виконано пункт 15/2.',
      'glued-number.txt': 'Лист вх№36088 отримано.',
      'spaced-number.txt': 'Лист вх. № 36088 отримано.',
    };
    const MODES: Record<string, SearchOptions> = {
      'library defaults': {},
      'fuzzy match off': { isInflectedWordFormsAllowed: false },
      'no typos': { maxTypoDistance: 0 },
      'two typos': { maxTypoDistance: 2 },
      'be-krang': PRODUCTION_OPTIONS,
      'be-krang, adjacent words only': {
        ...PRODUCTION_OPTIONS,
        maxWordsInPhraseDistance: 0,
      },
    };
    let numbers: SearchFixture;
    let written: SearchFixture;

    before(async () => {
      numbers = await createSearchFixture(NUMBERS);
      written = await createSearchFixture(WRITTEN);
    });

    after(async () => {
      await numbers.cleanup();
      await written.cleanup();
    });

    const foundIn = async (
      megaSearch: MegaSearch,
      query: string,
      options: SearchOptions,
    ) => fileNames(await megaSearch.search(query, options)).sort();
    const found = (query: string, options: SearchOptions) =>
      foundIn(numbers.megaSearch, query, options);

    for (const [mode, options] of Object.entries(MODES)) {
      it(`finds a number however the query writes it, and only that number (${mode})`, async () => {
        for (const query of ['36088', '№36088', 'вх№36088', '"36088"']) {
          assert.deepEqual(
            await found(query, options),
            ['incoming.txt'],
            query,
          );
        }
        // 2023 and 36087 are one typo away, and still other numbers
        assert.deepEqual(await found('2024', options), [
          'apart.txt',
          'incoming.txt',
          'leading-zero.txt',
          'order.txt',
        ]);
      });

      it(`finds a date by its parts glued together, not scattered (${mode})`, async () => {
        // apart.txt holds 22, 12 and 2024, not as 22.12.2024
        assert.deepEqual(await found('22.12.2024', options), ['incoming.txt']);
        assert.deepEqual(await found('12.2024', options), [
          'incoming.txt',
          'leading-zero.txt',
        ]);
        assert.deepEqual(await found('15/2', options), ['order.txt']);
      });

      it(`finds a glued number only glued by the same characters (${mode})`, async () => {
        const writtenAs = (query: string) =>
          foundIn(written.megaSearch, query, options);

        assert.deepEqual(await writtenAs('22.12.2024'), ['dots.txt']);
        assert.deepEqual(await writtenAs('22/12/2024'), ['slashes.txt']);
        assert.deepEqual(await writtenAs('15/2'), ['code.txt']);
        assert.deepEqual(await writtenAs('вх№36088'), ['glued-number.txt']);
        assert.deepEqual(await writtenAs('36088'), [
          'glued-number.txt',
          'spaced-number.txt',
        ]);
      });

      it(`searches the date as written: 5.12.2024 is not 05.12.2024 (${mode})`, async () => {
        assert.deepEqual(await found('5.12.2024', options), []);
        assert.deepEqual(await found('05.12.2024', options), [
          'leading-zero.txt',
        ]);
      });
    }

    it('finds a glued number as written after a restart, from the saved index', async () => {
      const restarted = await createMegaSearch(written.config);

      assert.deepEqual(
        await foundIn(restarted, '22.12.2024', PRODUCTION_OPTIONS),
        ['dots.txt'],
      );
      assert.deepEqual(await foundIn(restarted, 'вх№36088', {}), [
        'glued-number.txt',
      ]);
    });

    it('finds words and numbers in one phrase, the numbers between words not counted', async () => {
      for (const query of [
        'наказ 01.02.2024',
        'наказ № 15/2',
        'наказ відпустку',
        'відпустку Коваленко',
      ]) {
        assert.deepEqual(
          await found(query, {
            ...PRODUCTION_OPTIONS,
            maxWordsInPhraseDistance: 0,
          }),
          ['order.txt'],
          query,
        );
      }
    });

    it('returns the number as the text writes it', async () => {
      const matches = async (query: string, options: SearchOptions) =>
        (await numbers.megaSearch.search(query, options)).results.flatMap((r) =>
          r.snippets.map((s) => s.match),
        );

      assert.deepEqual(await matches('22.12.2024', PRODUCTION_OPTIONS), [
        '22.12.2024',
      ]);
      assert.deepEqual(await matches('вх№36088', {}), ['вх№36088']);
      assert.deepEqual(await matches('наказ 15/2', PRODUCTION_OPTIONS), [
        'Наказ № 15/2',
      ]);
    });
  });

  describe('search() — words, with numbers indexed', () => {
    // The same texts, and the same texts with each digit replaced by "#",
    // which the tokenizer skips as it used to skip digits: a search for words
    // must find, rank and cut snippets from both alike
    const TEXTS = {
      'order.txt':
        'Наказ № 15 від 01.02.2024. Призначити Петренка Івана з 05.02.2024 менеджером 3 відділу продажу.',
      'report.txt':
        'Звіт 2023: кошторис 12 500 грн затверджено 14.03.2023 радою. Кошторис 2024 року на 1 200 000 грн.',
      'letter.txt':
        'Лист № 7/12-15 Шевченку Олександру щодо графіка 8:00–17:00 роботи бухгалтерії. Кошторис додано.',
      'plain.txt': 'Кошторис затверджено радою без змін.',
    };
    const QUERIES = [
      'наказ',
      'кошторис',
      'кошторис затверджено',
      '"кошторис затверджено"',
      'Івана менеджером',
      'графіка роботи',
      'Шевченку Олександру',
    ];
    const MODES: Record<string, SearchOptions> = {
      'library defaults': {},
      'be-krang': PRODUCTION_OPTIONS,
      'be-krang, adjacent words only': {
        ...PRODUCTION_OPTIONS,
        maxWordsInPhraseDistance: 0,
      },
      'fuzzy match off': { isInflectedWordFormsAllowed: false },
      'context before, highlights': {
        snippetContextBefore: 3,
        snippetContextAfter: 4,
        includeHighlights: true,
      },
    };
    let withNumbers: SearchFixture;
    let withoutNumbers: SearchFixture;

    before(async () => {
      withNumbers = await createSearchFixture(TEXTS);
      withoutNumbers = await createSearchFixture(
        Object.fromEntries(
          Object.entries(TEXTS).map(([file, text]) => [
            file,
            text.replace(/[0-9]/g, '#'),
          ]),
        ),
      );
    });

    after(async () => {
      await withNumbers.cleanup();
      await withoutNumbers.cleanup();
    });

    /** What a search shows, digits read as "#" (token indices aside). */
    const shown = async (
      fixture: SearchFixture,
      query: string,
      options: SearchOptions,
    ) => {
      const { results, pagination } = await fixture.megaSearch.search(
        query,
        options,
      );
      return {
        totalMatches: pagination.totalMatches,
        results: results.map((r) => ({
          file: r.doc.fileName,
          score: r.score,
          snippets: r.snippets.map((s) => [
            s.context.replace(/[0-9]/g, '#'),
            s.match.replace(/[0-9]/g, '#'),
            s.matchCharStart,
            s.confidence,
          ]),
          highlights: r.highlights.map((h) => [
            h.charStart,
            h.charEnd,
            h.confidence,
          ]),
        })),
      };
    };

    for (const [mode, options] of Object.entries(MODES)) {
      it(`finds, ranks and shows what it did before (${mode})`, async () => {
        for (const query of QUERIES) {
          const before = await shown(withoutNumbers, query, options);

          assert.ok(before.results.length > 0, query);
          assert.deepEqual(
            await shown(withNumbers, query, options),
            before,
            query,
          );
        }
      });
    }
  });

  describe('search() — one snippet per occurrence', () => {
    // Documents repeat a sentence for every person, and be-krang extracts a
    // row from each snippet: every repetition must come back.
    const PAYMENTS = ['Іваненко Петро', 'Петренко Марія', 'Сидоренко Олег']
      .map((name) => `${name}. Нарахувати щомісячну премію згідно з графіком.`)
      .join('\n');
    let occurrences: SearchFixture;

    before(async () => {
      occurrences = await createSearchFixture({
        'payments.txt': PAYMENTS,
        'contract.txt': 'Підписати договір, договір оренди.',
      });
    });

    after(() => occurrences.cleanup());

    const searchOccurrences = (query: string, options: SearchOptions = {}) =>
      occurrences.megaSearch.search(query, {
        ...PRODUCTION_OPTIONS,
        ...options,
      });

    const offsetsOf = (pattern: RegExp) =>
      [...PAYMENTS.matchAll(pattern)].map((m) => m.index);

    it('returns the same sentence at each place, with its own offsets', async () => {
      const { results, pagination } =
        await searchOccurrences('щомісячну премію');

      assert.deepEqual(
        results[0].snippets.map((s) => s.matchCharStart),
        offsetsOf(/щомісячну премію/g),
      );
      assert.equal(pagination.totalMatches, 3);
    });

    it('does the same for a word searched on its own', async () => {
      const { results } = await searchOccurrences('премію', {
        isPhraseProximityEnabled: false,
      });

      assert.deepEqual(
        results[0].snippets.map((s) => s.matchCharStart),
        offsetsOf(/премію/g),
      );
    });

    it('counts a phrase whose word repeats within the gap once', async () => {
      // "Підписати договір" and "Підписати договір, договір" start at the
      // same word: one occurrence
      const { results, pagination } =
        await searchOccurrences('підписати договір');

      assert.deepEqual(
        results[0].snippets.map((s) => s.match),
        ['Підписати договір'],
      );
      assert.equal(pagination.totalMatches, 1);
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

  describe('search() — names: inflected forms and related words (isRelatedWordsAllowed)', () => {
    let names: SearchFixture;

    before(async () => {
      names = await createSearchFixture({
        'kit.txt': 'Заяву подав Кіт Василь Петрович.',
        'kota.txt': 'Прийняти на роботу Кота Василя Петровича.',
        'kotyk.txt': 'Заяву подав Котик Василь Іванович.',
        'kotyka.txt': 'Прийняти на роботу Котика Василя Івановича.',
        'kyt.txt': 'Заяву подав Кит Василь Степанович.',
        'myroslav.txt': 'Заяву подав Мирослав Бондар.',
        'myroslava.txt': 'Призначити менеджером Мирослава Бондаря.',
        'bondaruk.txt': 'Заяву подав Мирослав Бондарук.',
      });
    });

    after(() => names.cleanup());

    const searchNames = (query: string, options: SearchOptions = {}) =>
      names.megaSearch.search(query, { ...PRODUCTION_OPTIONS, ...options });
    const findNames = async (query: string, options: SearchOptions = {}) =>
      fileNames(await searchNames(query, options)).sort();
    const noRelated: SearchOptions = { isRelatedWordsAllowed: false };

    it('related words are on by default, and find surnames derived from the one searched', async () => {
      assert.deepEqual(await findNames('Кота Василя'), [
        'kit.txt',
        'kota.txt',
        'kotyk.txt',
        'kotyka.txt',
        'kyt.txt',
      ]);
      assert.deepEqual(await findNames('Мирослав Бондар'), [
        'bondaruk.txt',
        'myroslav.txt',
        'myroslava.txt',
      ]);
    });

    it('without related words, finds every form of the name and no surname derived from it', async () => {
      // "Кіт" and "Кит" are 1 typo from "Кота"; "Котик" is not a typo.
      assert.deepEqual(await findNames('Кота Василя', noRelated), [
        'kit.txt',
        'kota.txt',
        'kyt.txt',
      ]);
      // The stemmer files "Мирослав" and "Мирослава" under two stems.
      for (const query of ['Мирослав Бондар', 'Мирослава Бондаря']) {
        assert.deepEqual(
          await findNames(query, { ...noRelated, maxTypoDistance: 0 }),
          ['myroslav.txt', 'myroslava.txt'],
          query,
        );
      }
    });

    it('a vowel change in the surname (Кіт → Кота) takes typo tolerance', async () => {
      assert.deepEqual(await findNames('Кіт Василь', { maxTypoDistance: 0 }), [
        'kit.txt',
      ]);
      assert.deepEqual(await findNames('Кіт Василь'), [
        'kit.txt',
        'kota.txt',
        'kyt.txt',
      ]);
    });

    it('highlights a related surname at lower confidence than a form of the name', async () => {
      const { results } = await searchNames('Кота Василя', {
        includeHighlights: true,
      });
      const confidenceOf = (word: string) =>
        results
          .flatMap((result) => result.highlights)
          .find((highlight) => highlight.originalWord === word)!.confidence;

      assert.equal(confidenceOf('кота'), 1);
      assert.ok(confidenceOf('котика') < 1);
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

  describe('reindex() after editing a document whose snippets were shown', () => {
    useFreshFixture();

    it('cuts the snippets from the edited text', async () => {
      // Regression guard: the snippet text cache kept the text from before
      // the edit, and the new positions cut it ("Начальник" → "Начальни").
      await fixture.megaSearch.search('наказ');
      await fixture.corpus.write('a.txt', 'Кошторис затверджено.', later());
      await fixture.megaSearch.reindex();

      const [result] = (await fixture.megaSearch.search('кошторис')).results;
      assert.deepEqual(
        result.snippets.map((s) => [s.match, s.context]),
        [['Кошторис', '<b>Кошторис</b> затверджено...']],
      );
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

  /** Runs `onIndex` each time the instance indexes a document, before it. */
  const onIndexDocument = (
    megaSearch: MegaSearch,
    onIndex: (fileName: string) => Promise<void>,
  ) => {
    const processor = megaSearch.indexer['processor'];
    const indexDocument = processor.indexDocument.bind(processor);
    processor.indexDocument = async (metadata) => {
      await onIndex(metadata.fileName);
      return indexDocument(metadata);
    };
  };

  describe('a search while reindex() updates the index', () => {
    useFreshFixture();

    it('reads the index from before the update, whole — snippets included', async () => {
      // Regression guard: edited documents went in before their postings,
      // and their text cache was rewritten before either — so a search in
      // between cut the new text at the old positions, and found a phrase
      // the document no longer holds.
      const during: Record<string, Array<[string, string[]]>> = {};
      onIndexDocument(fixture.megaSearch, async () => {
        // what indexing the edit does first: its text goes to the text cache
        await fixture.megaSearch.indexer.extractTextFromFile(
          fixture.corpus.pathOf('a.txt'),
        );
        for (const query of ['підписав наказ', 'кошторис']) {
          const { results } = await fixture.megaSearch.search(
            query,
            PRODUCTION_OPTIONS,
          );
          during[query] = results.map((r) => [
            r.doc.fileName,
            r.snippets.map((s) => s.match.toLowerCase()),
          ]);
        }
      });

      await fixture.corpus.write('a.txt', 'Кошторис затверджено.', later());
      await fixture.megaSearch.reindex();

      assert.deepEqual(during, {
        'підписав наказ': [['a.txt', ['підписав наказ']]],
        кошторис: [],
      });
      assert.deepEqual(await find('кошторис'), ['a.txt']);
      assert.deepEqual(await find('наказ'), []);
    });
  });

  describe('reindex() called several times at once', () => {
    useFreshFixture();

    it('runs one update at a time, so no file is indexed twice', async () => {
      // Regression guard: each call loaded the saved index and indexed the
      // same new file into it, all at the same time.
      const indexed: string[] = [];
      onIndexDocument(fixture.megaSearch, async (fileName) => {
        indexed.push(fileName);
      });

      await fixture.corpus.write('d.txt', 'Квартальний звіт.');
      await Promise.all([
        fixture.megaSearch.reindex(),
        fixture.megaSearch.reindex(),
        fixture.megaSearch.reindex(),
      ]);

      assert.deepEqual(indexed, ['d.txt']);
      assert.deepEqual(await find('звіт'), ['d.txt']);
    });
  });

  describe('reindex() called while an update runs', () => {
    useFreshFixture();

    it('runs after it, and picks up what changed in the meantime', async () => {
      let queued: Promise<void> | undefined;
      onIndexDocument(fixture.megaSearch, async () => {
        if (queued) return;
        await fixture.corpus.write('e.txt', 'Річний звіт.');
        queued = fixture.megaSearch.reindex();
      });

      await fixture.corpus.write('d.txt', 'Квартальний звіт.');
      await fixture.megaSearch.reindex();
      await queued;

      assert.deepEqual((await find('звіт')).sort(), ['d.txt', 'e.txt']);
    });
  });

  describe('an update through the indexer alone', () => {
    useFreshFixture();

    it('is what the next search reads — no cached result or score from before it', async () => {
      // Regression guard: reindex() refreshed cached results and BM25's
      // average document length only after the update was saved — so until
      // then, and for good after an update by the indexer alone, a search
      // could be served from the index as it was before.
      assert.deepEqual(await find('освіти'), []);
      await fixture.corpus.write(
        'long.txt',
        'Начальник управління освіти підписав наказ про зміну графіку роботи всіх шкіл міста.',
      );
      await fixture.megaSearch.indexer.buildFullIndex();

      const fresh = await createMegaSearch(fixture.config);
      const scores = async (megaSearch: MegaSearch) =>
        (await megaSearch.search('освіти')).results.map((r) => [
          r.doc.fileName,
          r.score,
        ]);
      assert.deepEqual(await find('освіти'), ['long.txt']);
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

    it('writes the caches again on the next reindex', async () => {
      // Regression guard: the instance remembered the cache folders as
      // created, so it never wrote the text and per-document caches again —
      // snippets lost the original text, and every start re-read every file.
      await fixture.megaSearch.clearCache();
      await fixture.megaSearch.reindex();

      for (const file of [
        '.cache/txt/a.txt.txt',
        '.cache/index/a.txt.index.json',
      ]) {
        assert.equal(fixture.corpus.exists(file), true, file);
      }
      const [result] = (
        await fixture.megaSearch.search('наказ', { snippetContextBefore: 2 })
      ).results;
      // the raw text's capital letter, not the index's lowercase words
      assert.deepEqual(
        result.snippets.map((s) => s.context),
        ['Начальник підписав <b>наказ</b>...'],
      );
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
