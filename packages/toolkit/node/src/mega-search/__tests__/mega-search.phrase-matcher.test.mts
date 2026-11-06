import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { PhraseMatcher } from '../mega-search.phrase-matcher.mjs';
import { buildSearchData, stemQuery } from '../test-utils/in-memory-index.mjs';
import type { SearchData } from '../test-utils/in-memory-index.mjs';
import { UkrainianTextProcessor } from '../text-processor.mjs';

const matcher = new PhraseMatcher(new UkrainianTextProcessor());

// Token positions after stop-word removal are noted next to each text.
const DOCS = {
  'adjacent.txt': 'Rich car owners love cars.', //  rich0 car1 owners2 love3 cars4
  'one-gap.txt': 'The rich expensive car was parked.', // rich0 expensive1 car2 parked3
  'wide-gap.txt': 'Rich people buy a very fast red car.', // rich0 … car5
  'reversed.txt': 'Car dealers are rich.', // car0 dealers1 rich2
  'typo.txt': 'Rech car spotted.', // rech0 car1 spotted2
  'archive.txt': 'Передано до архіву документів.', // передано0 архіву1 документів2
  'orders.txt':
    'Начальник управління підписав наказ. Наказ начальника управління.',
  // начальник0 управління1 підписав2 наказ3 наказ4 начальника5 управління6
};

describe('PhraseMatcher', () => {
  let data: SearchData;

  before(async () => {
    data = await buildSearchData(DOCS);
  });

  const fuzzyPhrase = (
    query: string,
    maxWordsInPhraseDistance: number,
    maxTypoDistance = 1,
  ) =>
    matcher.findDocsWithFuzzyPhrase(
      stemQuery(query),
      { maxTypoDistance, maxWordsInPhraseDistance },
      data.invertedIndex,
      data.stemDictionary,
      data.docCache,
    );

  describe('countExactPhrase()', () => {
    it('counts every in-order occurrence, comparing against stemmed document tokens', () => {
      const doc = data.docCache.get('orders.txt')!;

      // "Начальник управління" + "начальника управління" share stems
      assert.equal(
        matcher.countExactPhrase(doc, stemQuery('начальник управління')),
        2,
      );
      assert.equal(
        matcher.countExactPhrase(doc, stemQuery('управління начальник')),
        0,
      );
    });

    it('expects stemmed phrase tokens — an unstemmed inflected word never matches', () => {
      // Pins the contract of this helper; see the strict-phrase known bug in
      // mega-search.test.mts, where the caller passes unstemmed words.
      const doc = data.docCache.get('orders.txt')!;
      assert.equal(
        matcher.countExactPhrase(doc, ['начальник', 'управління']),
        0,
      );
    });

    it('returns 0 for an empty phrase', () => {
      assert.equal(
        matcher.countExactPhrase(data.docCache.get('orders.txt')!, []),
        0,
      );
    });
  });

  describe('getCandidateDocsForPhrase()', () => {
    it('returns documents containing every phrase word, in any order', () => {
      assert.deepEqual(
        matcher
          .getCandidateDocsForPhrase(stemQuery('rich car'), data.invertedIndex)
          .sort(),
        ['adjacent.txt', 'one-gap.txt', 'reversed.txt', 'wide-gap.txt'],
      );
    });

    it('returns nothing when a word is absent or the phrase is empty', () => {
      assert.deepEqual(
        matcher.getCandidateDocsForPhrase(
          stemQuery('rich unicorn'),
          data.invertedIndex,
        ),
        [],
      );
      assert.deepEqual(
        matcher.getCandidateDocsForPhrase([], data.invertedIndex),
        [],
      );
    });
  });

  describe('findDocsWithFuzzyPhrase()', () => {
    it('treats maxWordsInPhraseDistance as a position step: 1 = adjacent words only', () => {
      const matches = fuzzyPhrase('rich car', 1, 0);

      assert.deepEqual(matches.get('adjacent.txt'), [[0, 1]]);
      assert.equal(matches.has('one-gap.txt'), false);
    });

    it('lets 2 bridge one word in between (the value be-krang searches with)', () => {
      const matches = fuzzyPhrase('rich car', 2, 0);

      assert.deepEqual(matches.get('one-gap.txt'), [[0, 2]]);
      assert.deepEqual(matches.get('adjacent.txt'), [[0, 1]]);
      assert.equal(matches.has('wide-gap.txt'), false);
    });

    it('keeps the phrase word order', () => {
      const matches = fuzzyPhrase('rich car', 10, 0);

      assert.deepEqual(matches.get('wide-gap.txt'), [[0, 5]]);
      assert.equal(matches.has('reversed.txt'), false);
    });

    it('returns every matching sequence as document token positions', () => {
      assert.deepEqual(fuzzyPhrase('rich car', 4, 0).get('adjacent.txt'), [
        [0, 1],
        [0, 4],
      ]);
      assert.deepEqual(
        fuzzyPhrase('начальник управління', 1).get('orders.txt'),
        [
          [0, 1],
          [5, 6],
        ],
      );
    });

    it('matches a one-word phrase at each occurrence', () => {
      assert.deepEqual(fuzzyPhrase('наказ', 0).get('orders.txt'), [[3], [4]]);
    });

    it('tolerates typos up to maxTypoDistance', () => {
      assert.deepEqual(fuzzyPhrase('rich car', 1, 1).get('typo.txt'), [[0, 1]]);
      assert.equal(fuzzyPhrase('rich car', 1, 0).has('typo.txt'), false);
    });

    it('matches stems that differ only by a short suffix, even with no typo allowance', () => {
      // The stemmer is inconsistent across declensions: "архів" → "арх" but
      // "архіву" → "архів" (2 edits apart). The prefix rule bridges that gap.
      assert.notEqual(stemQuery('архів')[0], stemQuery('архіву')[0]);
      assert.deepEqual(fuzzyPhrase('архів', 0, 0).get('archive.txt'), [[1]]);
    });

    it('returns an empty map when any phrase word has no candidates', () => {
      assert.equal(fuzzyPhrase('rich unicorn', 5).size, 0);
      assert.equal(fuzzyPhrase('', 5).size, 0);
    });
  });
});
