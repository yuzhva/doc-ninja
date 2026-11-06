import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { editDistance, fuzzyMatch } from '../fuzzy.mjs';

describe('editDistance()', () => {
  it('is 0 for identical strings', () => {
    assert.equal(editDistance('наказ', 'наказ'), 0);
  });

  it('returns the length of the other string when one side is empty', () => {
    assert.equal(editDistance('', 'abc'), 3);
    assert.equal(editDistance('abc', ''), 3);
    assert.equal(editDistance('', ''), 0);
  });

  it('counts one substitution, insertion or deletion as a single edit', () => {
    assert.equal(editDistance('apple', 'apply'), 1);
    assert.equal(editDistance('car', 'cart'), 1);
    assert.equal(editDistance('cart', 'car'), 1);
  });

  it('counts a swap of adjacent letters as a single edit (OSA, not plain Levenshtein)', () => {
    assert.equal(editDistance('search', 'serach'), 1);
    assert.equal(editDistance('наказ', 'накза'), 1);
    assert.equal(editDistance('ab', 'ba'), 1);
  });

  it('counts a swap and another typo as two edits', () => {
    assert.equal(editDistance('search', 'serech'), 2); // swap is not enough
    assert.equal(editDistance('search', 'seracha'), 2); // swap + insertion
  });

  it('never edits the same letters twice (OSA, not unrestricted Damerau)', () => {
    // unrestricted Damerau–Levenshtein: "ca" → "ac" → "abc", 2 edits
    assert.equal(editDistance('ca', 'abc'), 3);
  });

  it('is symmetric', () => {
    assert.equal(
      editDistance('кошторис', 'кашторыс'),
      editDistance('кашторыс', 'кошторис'),
    );
    assert.equal(
      editDistance('search', 'serach'),
      editDistance('serach', 'search'),
    );
  });

  it('compares Cyrillic text letter by letter', () => {
    // a missing letter in a stemmed Ukrainian query word
    assert.equal(editDistance('упрвлін', 'управлін'), 1);
  });
});

describe('fuzzyMatch()', () => {
  it('accepts up to one edit by default', () => {
    assert.equal(fuzzyMatch('наказ', 'наказу'), true);
    assert.equal(fuzzyMatch('наказ', 'накза'), true);
    assert.equal(fuzzyMatch('наказ', 'наказів'), false);
  });

  it('honours a custom threshold', () => {
    assert.equal(fuzzyMatch('наказ', 'наказів', 2), true);
    assert.equal(fuzzyMatch('наказ', 'наказ', 0), true);
    assert.equal(fuzzyMatch('наказ', 'наказу', 0), false);
    assert.equal(fuzzyMatch('наказ', 'накза', 0), false);
  });
});
