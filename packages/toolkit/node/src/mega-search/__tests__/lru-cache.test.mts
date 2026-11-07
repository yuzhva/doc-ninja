import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LRUCache } from '../lru-cache.mjs';

const filledCache = (...keys: string[]) => {
  const cache = new LRUCache<string, string>(keys.length);
  keys.forEach((key) => cache.set(key, key.toUpperCase()));
  return cache;
};

describe('LRUCache', () => {
  it('returns undefined for a missing key', () => {
    assert.equal(new LRUCache<string, number>(2).get('missing'), undefined);
  });

  it('evicts the least recently used entry once over capacity', () => {
    const cache = filledCache('a', 'b');

    cache.set('c', 'C');

    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.get('b'), 'B');
    assert.equal(cache.get('c'), 'C');
    assert.equal(cache.size, 2);
  });

  it('treats get() as a use, so a read entry survives the next eviction', () => {
    const cache = filledCache('a', 'b');

    cache.get('a');
    cache.set('c', 'C');

    assert.equal(cache.get('a'), 'A');
    assert.equal(cache.get('b'), undefined);
  });

  it('updates an existing key in place without growing, and marks it recently used', () => {
    const cache = filledCache('a', 'b');

    cache.set('a', 'A2');
    cache.set('c', 'C');

    assert.equal(cache.size, 2);
    assert.equal(cache.get('a'), 'A2');
    assert.equal(cache.get('b'), undefined);
  });

  it('stores falsy values', () => {
    const cache = new LRUCache<string, unknown>(3);
    cache.set('zero', 0);
    cache.set('empty', '');
    cache.set('null', null);

    assert.equal(cache.get('zero'), 0);
    assert.equal(cache.get('empty'), '');
    assert.equal(cache.get('null'), null);
  });

  it('removes entries with delete() and clear()', () => {
    const cache = filledCache('a', 'b', 'c');

    cache.delete('b');
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.size, 2);

    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.get('a'), undefined);
  });

  describe('with sizeOf', () => {
    const textCache = () =>
      new LRUCache<string, string>(10, (text) => text.length);

    it('keeps the entries whose sizes add up to maxSize, least recently used out first', () => {
      const cache = textCache();
      cache.set('a', 'aaaa');
      cache.set('b', 'bbbb');
      cache.get('a');
      cache.set('c', 'cccc');

      assert.equal(cache.get('b'), undefined);
      assert.equal(cache.get('a'), 'aaaa');
      assert.equal(cache.get('c'), 'cccc');
    });

    it('drops as many entries as the new one needs room for', () => {
      const cache = textCache();
      cache.set('a', 'aaa');
      cache.set('b', 'bbb');
      cache.set('c', 'ccc');
      cache.set('d', 'dddddddd');

      assert.deepEqual(
        ['a', 'b', 'c', 'd'].map((key) => cache.get(key)),
        [undefined, undefined, undefined, 'dddddddd'],
      );
    });

    it('keeps no entry bigger than maxSize, and drops the others to try', () => {
      const cache = textCache();
      cache.set('a', 'aaa');
      cache.set('big', 'x'.repeat(11));

      assert.equal(cache.get('big'), undefined);
      assert.equal(cache.size, 0);
    });

    it('frees the size of an entry replaced, deleted or cleared', () => {
      const cache = textCache();
      cache.set('a', 'aaaaaaaaaa');
      cache.set('a', 'aa');
      cache.set('b', 'bbbbbbbb');
      assert.equal(cache.size, 2);

      cache.delete('b');
      cache.set('c', 'cccccccc');
      assert.equal(cache.size, 2);

      cache.clear();
      cache.set('d', 'dddddddddd');
      assert.equal(cache.get('d'), 'dddddddddd');
    });
  });
});
