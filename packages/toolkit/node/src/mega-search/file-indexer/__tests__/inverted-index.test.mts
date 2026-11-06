import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v8 from 'node:v8';

import { InvertedIndex } from '../inverted-index.mjs';

const sampleIndex = () => {
  const index = new InvertedIndex();
  index.addEntry('наказ', '/docs/a.txt', [0, 4]);
  index.addEntry('наказ', '/docs/b.txt', [2]);
  index.addEntry('бюджет', '/docs/b.txt', [7]);
  return index;
};

describe('InvertedIndex', () => {
  it('returns the postings added for a term, per document', () => {
    assert.deepEqual(sampleIndex().get('наказ'), [
      { documentId: '/docs/a.txt', frequency: 2, positions: [0, 4] },
      { documentId: '/docs/b.txt', frequency: 1, positions: [2] },
    ]);
  });

  it('registers each document path once and shares its id across terms', () => {
    assert.deepEqual(sampleIndex().getDocMapping(), [
      '/docs/a.txt',
      '/docs/b.txt',
    ]);
  });

  it('tracks the term set through size, has() and delete()', () => {
    const index = sampleIndex();

    assert.equal(index.size, 2);
    assert.equal(index.get('unknown'), undefined);
    assert.equal(index.delete('бюджет'), true);
    assert.equal(index.has('бюджет'), false);
    assert.equal(index.size, 1);
  });

  it('clear() drops all terms and the document registry', () => {
    const index = sampleIndex();
    index.clear();

    assert.equal(index.size, 0);
    assert.deepEqual(index.getDocMapping(), []);
    index.addEntry('новий', '/docs/c.txt', [0]);
    assert.deepEqual(index.getDocMapping(), ['/docs/c.txt']);
  });

  it('exposes every term as expanded entries through forEach() and toLegacyMap()', () => {
    const index = sampleIndex();
    const viaForEach = new Map();
    index.forEach((entries, term) => viaForEach.set(term, entries));

    assert.deepEqual(viaForEach, index.toLegacyMap());
    assert.deepEqual([...viaForEach.keys()], ['наказ', 'бюджет']);
  });

  it('restore() rebuilds an equivalent index from its serialized raw parts', () => {
    const original = sampleIndex();
    const [rawIndex, docMapping] = v8.deserialize(
      v8.serialize([original.getRawIndex(), original.getDocMapping()]),
    );

    const restored = new InvertedIndex();
    restored.restore(rawIndex, docMapping);

    assert.deepEqual(restored.toLegacyMap(), original.toLegacyMap());
    // the path → id registry is rebuilt too, so known documents keep their id
    restored.addEntry('кошторис', '/docs/a.txt', [9]);
    assert.deepEqual(restored.getDocMapping(), ['/docs/a.txt', '/docs/b.txt']);
  });

  it('get() returns a detached copy — mutating it leaves the index untouched', () => {
    // Worth knowing for re-indexing work: FileIndexer.purgeDocumentFromIndex
    // splices the array returned by get(), which therefore removes nothing.
    const index = sampleIndex();
    index.get('наказ')!.splice(0, 1);

    assert.equal(index.get('наказ')!.length, 2);
  });
});
