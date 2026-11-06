import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import {
  TermMatcher,
  mergeMatchedWords,
} from '../mega-search.term-matcher.mjs';
import type { TermMatchOptions } from '../mega-search.term-matcher.mjs';
import { calculateMatchConfidence } from '../mega-search.utils.mjs';
import { buildSearchData, stemQuery } from '../test-utils/in-memory-index.mjs';
import type { SearchData } from '../test-utils/in-memory-index.mjs';
import { UkrainianTextProcessor } from '../text-processor.mjs';

const matcher = new TermMatcher(new UkrainianTextProcessor());

// One name and one English word, a different form of it in each document.
const DOCS = {
  'genitive.txt': 'Наказ видано на користь Євгена Петренка.',
  'nominative.txt': 'Заяву подав Євген Петренко.',
  'dative.txt': 'Лист надіслано Євгену Петренку.',
  'full-name.txt': 'Документ підписав Євгеній Коваль.',
  'parked.txt': 'The car was parked outside.',
  'parking.txt': 'Free parking near the office.',
  'parks.txt': 'Two parks in town.',
  'archive.txt': 'Передано до архіву.',
  'mixed.txt': 'Rech car, rich man.', // rech0 car1 rich2 man3
};

const FUZZY: TermMatchOptions = { isFuzzy: true, maxTypoDistance: 1 };
const STRICT: TermMatchOptions = { isFuzzy: false, maxTypoDistance: 1 };

describe('TermMatcher', () => {
  let data: SearchData;

  before(async () => {
    data = await buildSearchData(DOCS);
  });

  const match = (word: string, options: TermMatchOptions) =>
    matcher.match(word, options, data);

  /** Documents where the word really occurs, i.e. with positions. */
  const docsWith = (word: string, options: TermMatchOptions) => {
    const wordMatch = match(word, options);
    return [...wordMatch.documentIds()]
      .filter(
        (docId) =>
          wordMatch.positionsIn(docId, data.docCache.get(docId)!).length > 0,
      )
      .sort();
  };

  describe('with fuzzy match on', () => {
    it('matches every inflected form of the word', () => {
      assert.deepEqual(docsWith('євгена', FUZZY), [
        'dative.txt',
        'full-name.txt',
        'genitive.txt',
        'nominative.txt',
      ]);
      assert.deepEqual(docsWith('parked', FUZZY), [
        'parked.txt',
        'parking.txt',
        'parks.txt',
      ]);
    });

    it('reports every form as the query stem, at full confidence', () => {
      const { queryToken, words } = match('євгена', FUZZY);

      assert.equal(queryToken, stemQuery('євгена')[0]);
      assert.deepEqual([...words.keys()].sort(), [
        'євген',
        'євгена',
        'євгену',
        'євгеній',
      ]);
      for (const matched of words.values()) {
        assert.deepEqual(matched, { queryToken, confidence: 1 });
      }
    });

    it('also matches the forms of a stem within maxTypoDistance, at lower confidence', () => {
      const { words } = match('єгена', FUZZY); // stem "єген", 1 edit from "євген"

      assert.deepEqual([...words.keys()].sort(), [
        'євген',
        'євгена',
        'євгену',
        'євгеній',
      ]);
      // the closer of the two comparisons: stem to stem ("єген" ↔ "євген",
      // 0.8) or word to word ("єгена" ↔ "євгена", 5/6)
      assert.equal(
        words.get('євгену')!.confidence,
        calculateMatchConfidence('єгена', 'євгена'),
      );
      assert.ok(words.get('євгену')!.confidence < 1);
    });

    it('also matches the forms of a word within maxTypoDistance whose stem the typo hid', () => {
      // "prked" stems to itself, 3 edits from "park" — but it is 1 edit
      // from "parked", which fuzzy match off finds; on must find it too.
      assert.deepEqual(docsWith('prked', STRICT), ['parked.txt']);
      assert.deepEqual(docsWith('prked', FUZZY), [
        'parked.txt',
        'parking.txt',
        'parks.txt',
      ]);
    });

    it('matches stems that differ only by a short ending, even with maxTypoDistance 0', () => {
      // The stemmer is inconsistent across declensions: "архів" → "арх" but
      // "архіву" → "архів" (2 edits apart). The prefix rule bridges that gap.
      assert.notEqual(stemQuery('архів')[0], stemQuery('архіву')[0]);
      assert.deepEqual(
        docsWith('архів', { isFuzzy: true, maxTypoDistance: 0 }),
        ['archive.txt'],
      );
    });
  });

  describe('with fuzzy match off', () => {
    it('matches only the form typed — the other forms are inflections, not typos', () => {
      // "євгену" and "євген" are 1 edit from "євгена", within the default
      // maxTypoDistance; as forms of the same stem they still do not count.
      assert.deepEqual(docsWith('євгена', STRICT), ['genitive.txt']);
      assert.deepEqual(docsWith('parked', STRICT), ['parked.txt']);
    });

    it('reports the word itself as the query token', () => {
      const { queryToken, words } = match('євгена', STRICT);

      assert.equal(queryToken, 'євгена');
      assert.deepEqual(
        [...words.entries()],
        [['євгена', { queryToken: 'євгена', confidence: 1 }]],
      );
    });

    it('still matches words within maxTypoDistance, at lower confidence', () => {
      const { words } = match('єгена', STRICT);

      assert.deepEqual([...words.keys()], ['євгена']);
      assert.equal(
        words.get('євгена')!.confidence,
        calculateMatchConfidence('єгена', 'євгена'),
      );
      assert.ok(words.get('євгена')!.confidence < 1);
    });

    it('counts document frequency per stem, so other forms of it count too', () => {
      // documentIds()/documentCount stay cheap (no document loads);
      // positionsIn() is what narrows them to the form typed.
      const wordMatch = match('євгена', STRICT);

      assert.equal(wordMatch.documentCount, 4);
      assert.deepEqual(
        wordMatch.positionsIn(
          'nominative.txt',
          data.docCache.get('nominative.txt')!,
        ),
        [],
      );
    });
  });

  describe('maxTypoDistance 0', () => {
    it('turns typo tolerance off in both modes', () => {
      for (const isFuzzy of [true, false]) {
        assert.deepEqual(
          docsWith('єгена', { isFuzzy, maxTypoDistance: 0 }),
          [],
          `isFuzzy: ${isFuzzy}`,
        );
      }
      assert.deepEqual(
        docsWith('євгена', { isFuzzy: false, maxTypoDistance: 0 }),
        ['genitive.txt'],
      );
    });
  });

  describe('WordMatch.positionsIn()', () => {
    it('merges the positions of several matched stems in document order', () => {
      const wordMatch = match('rich', FUZZY); // "rich" and "rech"

      assert.deepEqual(
        wordMatch.positionsIn('mixed.txt', data.docCache.get('mixed.txt')!),
        [0, 2],
      );
    });

    it('is empty for a document without a match', () => {
      assert.deepEqual(
        match('rich', FUZZY).positionsIn(
          'parks.txt',
          data.docCache.get('parks.txt')!,
        ),
        [],
      );
    });
  });

  describe('mergeMatchedWords()', () => {
    it('keeps the most confident match of a word several query words matched', () => {
      const merged = mergeMatchedWords([
        match('rech', STRICT), // "rech" exactly
        match('rich', STRICT), // "rich" exactly, "rech" through a typo
      ]);

      assert.deepEqual(merged.get('rech'), {
        queryToken: 'rech',
        confidence: 1,
      });
      assert.deepEqual(merged.get('rich'), {
        queryToken: 'rich',
        confidence: 1,
      });
    });
  });
});
