import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TokenPositions } from '../token-positions.mjs';

// "Наказ про відпустку": наказ 0–5, про 6–9, відпустку 10–19
const FLAT = [0, 0, 5, 1, 6, 9, 2, 10, 19];

describe('TokenPositions', () => {
  it('saves each token as its vocab index, the gap from the token before, and its length', () => {
    assert.deepEqual(
      TokenPositions.fromFlat(FLAT).toJSON(),
      [0, 0, 5, 1, 1, 3, 2, 1, 9],
    );
  });

  it('reads back what it saved', () => {
    const positions = TokenPositions.fromFlat(FLAT);
    const readBack = TokenPositions.fromSaved(positions.toJSON());

    assert.deepEqual(readBack, positions);
    assert.deepEqual(readBack.at(2), [2, 10, 19]);
  });

  it('reads back tokens out of text order too', () => {
    const flat = [0, 10, 19, 1, 0, 5, 2, 0, 5];
    const positions = TokenPositions.fromFlat(flat);

    assert.deepEqual(TokenPositions.fromSaved(positions.toJSON()), positions);
  });

  it('reads nothing saved as no tokens, and rejects numbers not in threes', () => {
    assert.equal(TokenPositions.fromSaved([]), TokenPositions.EMPTY);
    assert.equal(TokenPositions.fromSaved(undefined), TokenPositions.EMPTY);
    assert.throws(() => TokenPositions.fromSaved([0, 1]), /in threes/);
  });
});
