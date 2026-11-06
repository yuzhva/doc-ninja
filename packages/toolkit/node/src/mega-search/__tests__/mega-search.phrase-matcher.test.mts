import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { PhraseMatcher } from '../mega-search.phrase-matcher.mjs';
import { TermMatcher } from '../mega-search.term-matcher.mjs';
import type { TermMatchOptions } from '../mega-search.term-matcher.mjs';
import { buildSearchData } from '../test-utils/in-memory-index.mjs';
import type { SearchData } from '../test-utils/in-memory-index.mjs';
import { UkrainianTextProcessor } from '../text-processor.mjs';

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
};

describe('PhraseMatcher', () => {
  let data: SearchData;

  before(async () => {
    data = await buildSearchData(DOCS);
  });

  const phrase = (
    query: string,
    maxWordsBetween: number,
    { isFuzzy = true, maxTypoDistance = 0 }: Partial<TermMatchOptions> = {},
  ) =>
    matcher.findPhrases(
      textProcessor
        .tokenize(query)
        .map((token) =>
          termMatcher.match(token.term, { isFuzzy, maxTypoDistance }, data),
        ),
      maxWordsBetween,
      data.docCache,
    );

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

    it('returns every matching sequence as document token positions', () => {
      assert.deepEqual(phrase('rich car', 3).get('adjacent.txt'), [
        [0, 1],
        [0, 4],
      ]);
      assert.deepEqual(phrase('начальник управління', 0).get('orders.txt'), [
        [0, 1],
        [5, 6],
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

    it('returns an empty map when any phrase word has no match', () => {
      assert.equal(phrase('rich unicorn', 5).size, 0);
      assert.equal(phrase('', 5).size, 0);
    });
  });
});
