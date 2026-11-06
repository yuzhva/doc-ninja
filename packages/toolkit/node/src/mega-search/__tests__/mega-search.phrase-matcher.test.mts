import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { PhraseMatcher } from '../mega-search.phrase-matcher.mjs';
import { TermMatcher } from '../mega-search.term-matcher.mjs';
import type { TermMatchOptions } from '../mega-search.term-matcher.mjs';
import { buildSearchData } from '../test-utils/in-memory-index.mjs';
import type { SearchData } from '../test-utils/in-memory-index.mjs';
import { UkrainianTextProcessor, findJoints } from '../text-processor.mjs';

const textProcessor = new UkrainianTextProcessor();
const termMatcher = new TermMatcher(textProcessor);
const matcher = new PhraseMatcher();

// Token positions after stop-word removal are noted next to each text.
const DOCS = {
  'adjacent.txt': 'Rich car owners love cars.', //  rich0 car1 owners2 love3 cars4
  'one-gap.txt': 'The rich expensive car was parked.', // rich0 expensive1 car2 parked3
  'wide-gap.txt': 'Rich people buy a very fast red car.', // rich0 … car5
  'reversed.txt': 'Car dealers are rich.', // car0 dealers1 rich2
  'typo.txt': 'Rech car spotted.', // rech0 car1 spotted2
  'orders.txt':
    'Начальник управління підписав наказ. Наказ начальника управління.',
  // начальник0 управління1 підписав2 наказ3 наказ4 начальника5 управління6
  'repeated.txt': 'Оплатити рахунок вчасно. Оплатити рахунок вчасно.',
  // оплатити0 рахунок1 вчасно2 оплатити3 рахунок4 вчасно5
  'contract.txt': 'Підписати договір, договір оренди.',
  // підписати0 договір1 договір2 оренди3
  'numbered.txt': 'Наказ № 15/2 від 01.02.2024 про відпустку.',
  // наказ0 15(1) 2(2) 01(3) 02(4) 2024(5) відпустку6
  'date-apart.txt': 'Від 22 травня до 12.06.2024.',
  // 22(0) травня1 12(2) 06(3) 2024(4)
  'date-written.txt': 'Отримано 22/12/2024, 22 12 2024 та 22.12.2024.',
  // отримано0 22(1) 12(2) 2024(3) 22(4) 12(5) 2024(6) 22(7) 12(8) 2024(9)
};

describe('PhraseMatcher', () => {
  let data: SearchData;

  before(async () => {
    data = await buildSearchData(DOCS);
  });

  /** Matches the query's words and joints, as MegaSearch does. */
  const phrase = (
    query: string,
    maxWordsBetween: number,
    {
      isFuzzy = true,
      isRelatedWordsAllowed = true,
      maxTypoDistance = 0,
    }: Partial<TermMatchOptions> = {},
  ) => {
    const tokens = textProcessor.tokenize(query);
    return matcher.findPhrases(
      tokens.map((token) =>
        termMatcher.match(
          token.term,
          { isFuzzy, isRelatedWordsAllowed, maxTypoDistance },
          data,
        ),
      ),
      maxWordsBetween,
      data.docCache,
      findJoints(query, tokens),
    );
  };

  describe('findPhrases()', () => {
    it('counts maxWordsBetween as the words in between: 0 = adjacent only', () => {
      const matches = phrase('rich car', 0);

      assert.deepEqual(matches.get('adjacent.txt'), [[0, 1]]);
      assert.equal(matches.has('one-gap.txt'), false);
    });

    it('lets 1 bridge one word in between (the value be-krang searches with)', () => {
      const matches = phrase('rich car', 1);

      assert.deepEqual(matches.get('one-gap.txt'), [[0, 2]]);
      assert.deepEqual(matches.get('adjacent.txt'), [[0, 1]]);
      assert.equal(matches.has('wide-gap.txt'), false);
    });

    it('keeps the phrase word order', () => {
      const matches = phrase('rich car', 10);

      assert.deepEqual(matches.get('wide-gap.txt'), [[0, 5]]);
      assert.equal(matches.has('reversed.txt'), false);
    });

    it('returns every occurrence as document token positions', () => {
      assert.deepEqual(phrase('начальник управління', 0).get('orders.txt'), [
        [0, 1],
        [5, 6],
      ]);
    });

    it('returns the same text at another place as another occurrence', () => {
      assert.deepEqual(phrase('оплатити рахунок', 0).get('repeated.txt'), [
        [0, 1],
        [3, 4],
      ]);
    });

    it('takes one occurrence per first word, from the nearest words after it', () => {
      // "rich" … "car" and "rich" … "cars" start at the same "rich"
      assert.deepEqual(phrase('rich car', 3).get('adjacent.txt'), [[0, 1]]);
      // "підписати договір" and "підписати … договір" alike
      assert.deepEqual(phrase('підписати договір', 1).get('contract.txt'), [
        [0, 1],
      ]);
    });

    it('matches a one-word phrase at each occurrence', () => {
      assert.deepEqual(phrase('наказ', 0).get('orders.txt'), [[3], [4]]);
    });

    it('matches the words the way the TermMatcher matched them', () => {
      // fuzzy match off: only the forms typed
      assert.deepEqual(
        phrase('начальника управління', 0, { isFuzzy: false }).get(
          'orders.txt',
        ),
        [[5, 6]],
      );
      // typos within maxTypoDistance
      assert.deepEqual(
        phrase('rich car', 0, { maxTypoDistance: 1 }).get('typo.txt'),
        [[0, 1]],
      );
      assert.equal(phrase('rich car', 0).has('typo.txt'), false);
    });

    it('does not count the numbers in between as words', () => {
      assert.deepEqual(phrase('наказ відпустку', 0).get('numbered.txt'), [
        [0, 6],
      ]);
      // and a number in the phrase still counts the words around it
      assert.deepEqual(phrase('травня 2024', 0).get('date-apart.txt'), [
        [1, 4],
      ]);
      assert.equal(phrase('22 2024', 0).has('date-apart.txt'), false);
    });

    it('finds the parts of a glued number side by side only', () => {
      assert.deepEqual(phrase('01.02.2024', 1).get('numbered.txt'), [
        [3, 4, 5],
      ]);
      // 22, 12 and 2024, one word apart at most, but not glued together
      assert.deepEqual(phrase('22 12 2024', 1).get('date-apart.txt'), [
        [0, 2, 4],
      ]);
      assert.equal(phrase('22.12.2024', 1).has('date-apart.txt'), false);
    });

    it('finds a glued number only where the same characters glue its parts', () => {
      assert.deepEqual(phrase('22.12.2024', 1).get('date-written.txt'), [
        [7, 8, 9],
      ]);
      assert.deepEqual(phrase('22/12/2024', 1).get('date-written.txt'), [
        [1, 2, 3],
      ]);
      // written apart, its parts are a phrase's words: any separators do
      assert.deepEqual(phrase('22 12 2024', 0).get('date-written.txt'), [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ]);
    });

    it('returns an empty map when any phrase word has no match', () => {
      assert.equal(phrase('rich unicorn', 5).size, 0);
      assert.equal(phrase('', 5).size, 0);
    });
  });
});
