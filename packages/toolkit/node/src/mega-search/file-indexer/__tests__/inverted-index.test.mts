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

  describe('removeDocuments()', () => {
    it('drops every posting of the documents and keeps the others', () => {
      const index = sampleIndex();
      index.addEntry('наказ', '/docs/c.txt', [1, 3]);

      assert.deepEqual(index.removeDocuments(['/docs/b.txt']), ['бюджет']);
      assert.deepEqual(index.get('наказ'), [
        { documentId: '/docs/a.txt', frequency: 2, positions: [0, 4] },
        { documentId: '/docs/c.txt', frequency: 2, positions: [1, 3] },
      ]);
      assert.equal(index.has('бюджет'), false);
    });

    it('returns the terms no document holds any more', () => {
      const index = sampleIndex();

      assert.deepEqual(
        index.removeDocuments(['/docs/a.txt', '/docs/b.txt']).sort(),
        ['бюджет', 'наказ'],
      );
      assert.equal(index.size, 0);
    });

    it('leaves the index untouched for documents it does not hold', () => {
      const index = sampleIndex();

      assert.deepEqual(index.removeDocuments(['/docs/unknown.txt']), []);
      assert.deepEqual(index.toLegacyMap(), sampleIndex().toLegacyMap());
    });

    it('keeps the document id, so a document added back reuses it', () => {
      const index = sampleIndex();
      index.removeDocuments(['/docs/a.txt']);
      index.addEntry('кошторис', '/docs/a.txt', [0]);

      assert.deepEqual(index.getDocMapping(), ['/docs/a.txt', '/docs/b.txt']);
      assert.deepEqual(index.get('кошторис'), [
        { documentId: '/docs/a.txt', frequency: 1, positions: [0] },
      ]);
    });
  });

  describe('fork()', () => {
    it('takes changes and leaves the index it was forked from as it was', () => {
      // Searches read the index in place while an update changes a fork
      const index = sampleIndex();
      const fork = index.fork();

      fork.addEntry('наказ', '/docs/c.txt', [5]); // a list both hold
      fork.addEntry('кошторис', '/docs/c.txt', [1]); // a new term
      fork.removeDocuments(['/docs/b.txt']);

      assert.deepEqual(index.toLegacyMap(), sampleIndex().toLegacyMap());
      assert.deepEqual(index.getDocMapping(), ['/docs/a.txt', '/docs/b.txt']);
      assert.deepEqual(fork.get('наказ'), [
        { documentId: '/docs/a.txt', frequency: 2, positions: [0, 4] },
        { documentId: '/docs/c.txt', frequency: 1, positions: [5] },
      ]);
      assert.deepEqual(fork.get('кошторис'), [
        { documentId: '/docs/c.txt', frequency: 1, positions: [1] },
      ]);
      assert.equal(fork.has('бюджет'), false);
    });

    it('keeps the document ids, so both read the same postings the same way', () => {
      const index = sampleIndex();
      const fork = index.fork();
      fork.addEntry('бюджет', '/docs/a.txt', [3]);

      assert.deepEqual(fork.getDocMapping(), ['/docs/a.txt', '/docs/b.txt']);
      assert.deepEqual(fork.get('бюджет'), [
        { documentId: '/docs/b.txt', frequency: 1, positions: [7] },
        { documentId: '/docs/a.txt', frequency: 1, positions: [3] },
      ]);
      assert.deepEqual(index.get('бюджет'), sampleIndex().get('бюджет'));
    });
  });

  it('get() returns a detached copy — mutating it leaves the index untouched', () => {
    // Removing a document goes through removeDocuments(): splicing the array
    // get() returns removes nothing.
    const index = sampleIndex();
    index.get('наказ')!.splice(0, 1);

    assert.equal(index.get('наказ')!.length, 2);
  });
});
