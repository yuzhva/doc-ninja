import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fuzzyMatch, levenshtein } from '../fuzzy.mjs';

describe('levenshtein()', () => {
  it('is 0 for identical strings', () => {
    assert.equal(levenshtein('наказ', 'наказ'), 0);
  });

  it('returns the length of the other string when one side is empty', () => {
    assert.equal(levenshtein('', 'abc'), 3);
    assert.equal(levenshtein('abc', ''), 3);
    assert.equal(levenshtein('', ''), 0);
  });

  it('counts one substitution, insertion or deletion as a single edit', () => {
    assert.equal(levenshtein('apple', 'apply'), 1);
    assert.equal(levenshtein('car', 'cart'), 1);
    assert.equal(levenshtein('cart', 'car'), 1);
  });

  it('counts a swap of adjacent letters as two edits (plain Levenshtein, not Damerau)', () => {
    assert.equal(levenshtein('search', 'serach'), 2);
  });

  it('is symmetric', () => {
    assert.equal(
      levenshtein('кошторис', 'кашторыс'),
      levenshtein('кашторыс', 'кошторис'),
    );
  });

  it('compares Cyrillic text letter by letter', () => {
    // a missing letter in a stemmed Ukrainian query word
    assert.equal(levenshtein('упрвлін', 'управлін'), 1);
  });
});

describe('fuzzyMatch()', () => {
  it('accepts up to one edit by default', () => {
    assert.equal(fuzzyMatch('наказ', 'наказу'), true);
    assert.equal(fuzzyMatch('наказ', 'наказів'), false);
  });

  it('honours a custom threshold', () => {
    assert.equal(fuzzyMatch('наказ', 'наказів', 2), true);
    assert.equal(fuzzyMatch('наказ', 'наказ', 0), true);
    assert.equal(fuzzyMatch('наказ', 'наказу', 0), false);
  });
});
