import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SharedWords } from '../shared-words.mjs';

describe('SharedWords', () => {
  it('keeps every word as it was, in the same list', () => {
    const sharedWords = new SharedWords();
    // a lone surrogate, as a broken text can hold, survives the copy too
    const words = ['звіт', 'договору', 'report', '2024', 'a\uD800b', ''];
    const vocab = [...words];

    assert.equal(sharedWords.share(vocab), vocab);
    assert.deepEqual(vocab, words);
    assert.deepEqual(sharedWords.share(['договору', 'звіт']), [
      'договору',
      'звіт',
    ]);
  });

  it('gives back each word as it was after clear()', () => {
    const sharedWords = new SharedWords();
    sharedWords.get('звіт');
    sharedWords.clear();

    assert.equal(sharedWords.get('звіт'), 'звіт');
  });
});
