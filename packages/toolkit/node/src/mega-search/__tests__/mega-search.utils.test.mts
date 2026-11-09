import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateMatchConfidence,
  createAbortCheck,
  getDocumentToken,
} from '../mega-search.utils.mjs';
import { buildDocumentIndex } from '../test-utils/in-memory-index.mjs';

describe('createAbortCheck()', () => {
  it('passes without a signal', async () => {
    await createAbortCheck(undefined, 0)();
  });

  it('throws the reason of a signal aborted already', async () => {
    await assert.rejects(createAbortCheck(AbortSignal.abort())(), {
      name: 'AbortError',
    });
  });

  it('lets the event loop in once everyMs went by, and sees an abort that came in', async () => {
    const controller = new AbortController();
    setImmediate(() => controller.abort());

    await assert.rejects(createAbortCheck(controller.signal, 0)(), {
      name: 'AbortError',
    });
  });

  it('lets nothing in before everyMs went by', async () => {
    const controller = new AbortController();
    setImmediate(() => controller.abort());

    await createAbortCheck(controller.signal, 60_000)();
    assert.equal(controller.signal.aborted, false);
  });
});

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
