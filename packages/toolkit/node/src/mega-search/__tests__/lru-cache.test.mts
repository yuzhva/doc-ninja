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
});
