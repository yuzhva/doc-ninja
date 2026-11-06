import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateMatchConfidence,
  getDocumentToken,
} from '../mega-search.utils.mjs';
import { buildDocumentIndex } from '../test-utils/in-memory-index.mjs';

describe('getDocumentToken()', () => {
  const doc = buildDocumentIndex('doc.txt', 'Бюджет міста. Бюджет області.');

  it('rehydrates a token from the compact vocab/positions encoding', () => {
    assert.deepEqual(getDocumentToken(doc, 2), {
      term: 'бюджет',
      position: 2,
      charStart: 14,
      charEnd: 20,
      normalized: 'бюджет',
    });
  });

  it('returns null outside the document', () => {
    assert.equal(getDocumentToken(doc, -1), null);
    assert.equal(getDocumentToken(doc, doc.positions.length), null);
  });
});

describe('calculateMatchConfidence()', () => {
  it('is 1 for an exact match', () => {
    assert.equal(calculateMatchConfidence('наказ', 'наказ'), 1);
  });

  it('drops linearly with the edit distance relative to the longer word', () => {
    assert.equal(calculateMatchConfidence('наказ', 'наказу'), 5 / 6);
    assert.equal(calculateMatchConfidence('abc', 'xyz'), 0);
  });
});
