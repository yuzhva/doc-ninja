import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fuzzyMatch } from '../fuzzy.mjs';
import { VocabularyIndex } from '../vocabulary-index.mjs';

// The same words every run
let seed = 7;
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = (letters: string) =>
  letters[Math.floor(random() * letters.length)];
const LETTERS = 'абвгдежзиіїйклмнопрстуфхцчшщьюяєabcdeo';

/** A word with one typo: a letter changed, added, dropped, or two swapped. */
function withTypo(word: string): string {
  const at = Math.floor(random() * word.length);
  switch (Math.floor(random() * 4)) {
    case 0:
      return word.slice(0, at) + pick(LETTERS) + word.slice(at + 1);
    case 1:
      return word.slice(0, at) + pick(LETTERS) + word.slice(at);
    case 2:
      return word.slice(0, at) + word.slice(at + 1);
    default:
      return at + 1 < word.length
        ? word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2)
        : word;
  }
}

/**
 * Words of every length, their typos, and the hard cases for letter pairs:
 * short words, which have few, and repeated letters, which share them.
 */
function vocabulary(): string[] {
  const words = new Set<string>(['аа', 'ааа', 'аааааа', 'ab', 'ba', 'кк']);
  for (let i = 0; i < 400; i++) {
    const length = 2 + Math.floor(random() * 11);
    let word = '';
    for (let j = 0; j < length; j++) word += pick(LETTERS);
    words.add(word);
    const typo = withTypo(word);
    if (typo.length > 1) words.add(typo);
    const twoTypos = withTypo(typo);
    if (twoTypos.length > 1) words.add(twoTypos);
  }
  return [...words];
}

/** Words filed under made-up stems, their first 3 letters — as a dictionary holds them. */
function dictionaryOf(words: string[]): Map<string, Set<string>> {
  const dictionary = new Map<string, Set<string>>();
  for (const word of words) {
    const stem = word.slice(0, 3);
    if (!dictionary.has(stem)) dictionary.set(stem, new Set());
    dictionary.get(stem)!.add(word);
  }
  return dictionary;
}

describe('VocabularyIndex', () => {
  const words = vocabulary();
  const dictionary = dictionaryOf(words);
  const index = VocabularyIndex.of(dictionary);
  const queries = [
    ...words.slice(0, 150),
    ...words.slice(0, 150).map(withTypo),
  ];

  it('finds every stem within the typos asked for', () => {
    for (const maxTypos of [1, 2, 3]) {
      for (const query of queries) {
        const found = index.stemsNear(query, maxTypos);
        for (const stem of dictionary.keys()) {
          if (fuzzyMatch(query, stem, maxTypos)) {
            assert.ok(found.has(stem), `${query} ~ ${stem}, ${maxTypos}`);
          }
        }
      }
    }
  });

  it('finds every stem holding a word within the typos asked for', () => {
    for (const maxTypos of [1, 2, 3]) {
      for (const query of queries) {
        const found = index.stemsHoldingWordsNear(query, maxTypos);
        for (const [stem, stemWords] of dictionary) {
          for (const word of stemWords) {
            if (fuzzyMatch(query, word, maxTypos)) {
              assert.ok(found.has(stem), `${query} ~ ${word}, ${maxTypos}`);
            }
          }
        }
      }
    }
  });

  it('finds the near words of a short word that shares no letter pair with them', () => {
    // "ab" and "ba" are one swap apart, with no pair in common
    assert.ok(index.stemsHoldingWordsNear('ab', 1).has('ba'));
  });

  it('leaves out the words too far to be near', () => {
    // a long word with one typo shares nearly all its pairs only with
    // itself, so a lookup reads a few stems, not all of them
    const word = words.find((w) => w.length >= 10)!;
    assert.ok(index.stemsHoldingWordsNear(word, 1).size < dictionary.size / 20);
  });

  it('lists the stems that start with a prefix, the prefix itself included', () => {
    const stems = [...dictionary.keys()];
    for (const prefix of ['', 'а', 'аа', 'ааа', 'ab', 'кк', 'щщщщ']) {
      assert.deepEqual(
        index.stemsStartingWith(prefix).sort(),
        stems.filter((stem) => stem.startsWith(prefix)).sort(),
        prefix,
      );
    }
  });

  it('puts stems in the dictionary’s order', () => {
    const stems = [...dictionary.keys()];
    const shuffled = [...stems].sort(() => random() - 0.5);
    assert.deepEqual(index.inDictionaryOrder(shuffled), stems);
  });

  it('is built once per dictionary', () => {
    assert.equal(VocabularyIndex.of(dictionary), index);
    assert.notEqual(VocabularyIndex.of(new Map(dictionary)), index);
  });
});
