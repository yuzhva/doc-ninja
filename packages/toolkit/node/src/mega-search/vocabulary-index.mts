import type { SearchSnapshot } from './types.mjs';

type StemDictionary = SearchSnapshot['stemDictionary'];

// Mark a word's edges, so its first and last letters make pairs too. Never
// in a token: the tokenizer keeps letters, apostrophes and hyphens only.
const START = '\u0002';
const END = '\u0003';

/**
 * The most letter pairs (see letterPairs) one typo breaks: a swap of two
 * letters breaks 3 ("кіт" → "ікт" loses ^к, кі, іт), a substitution or a
 * deletion 2, an insertion 1.
 */
const PAIRS_A_TYPO_BREAKS = 3;

/** A word's adjacent letters, its edges included: "кіт" → ^к, кі, іт, т$. */
function letterPairs(word: string): Set<string> {
  const padded = START + word + END;
  const pairs = new Set<string>();
  for (let i = 0; i < padded.length - 1; i++) {
    pairs.add(padded.slice(i, i + 2));
  }
  return pairs;
}

const indexes = new WeakMap<StemDictionary, VocabularyIndex>();

/**
 * Lookups over a stem dictionary's stems and words, so that matching a
 * query word reads the few stems that may match it instead of every stem in
 * the index (see TermMatcher).
 *
 * Typos are found by letter pairs, as PostgreSQL's pg_trgm finds them by
 * triples: a word a few typos away from another shares most of its pairs
 * with it. One typo breaks at most 3 pairs, so a word within N typos keeps
 * all but 3·N of its pairs — the words that share fewer can't be within N,
 * and are never compared. What's left is a superset: the caller compares
 * each word itself (fuzzyMatch).
 *
 * Built the first time a dictionary is asked for and kept as long as the
 * dictionary is: a dictionary never changes once searches read it (see
 * SearchSnapshot) — an update makes a new one.
 */
class VocabularyIndex {
  /** The index of a stem dictionary. */
  static of(stemDictionary: StemDictionary): VocabularyIndex {
    let index = indexes.get(stemDictionary);
    if (!index) {
      index = new VocabularyIndex(stemDictionary);
      indexes.set(stemDictionary, index);
    }
    return index;
  }

  /** Each stem's place in the dictionary's own order. */
  private readonly order = new Map<string, number>();
  /** The stems, sorted: the ones that start with the same letters are side by side. */
  private readonly sortedStems: string[];

  /** Every stem and every word, once each: what typos are looked up among. */
  private readonly strings: string[] = [];
  /**
   * By string: the stem holding it as a word, if it is one. A word is under
   * one stem only, the one UkrainianTextProcessor.stemWord gives it.
   */
  private readonly holders: (string | undefined)[] = [];
  /** By string: how many letter pairs it has. */
  private readonly pairCounts: Int32Array;
  /** Letter pair → the strings that have it. */
  private readonly stringsByPair = new Map<string, Int32Array>();
  /** Every string, the ones with the fewest letter pairs first. */
  private readonly fewestPairsFirst: Int32Array;

  // Filled by stringsNear() and cleared before it returns
  private readonly shared: Int32Array;
  private readonly sharing: Int32Array;

  private constructor(stemDictionary: StemDictionary) {
    const ids = new Map<string, number>();
    const idOf = (string: string) => {
      let id = ids.get(string);
      if (id === undefined) {
        id = this.strings.length;
        ids.set(string, id);
        this.strings.push(string);
      }
      return id;
    };
    for (const [stem, words] of stemDictionary) {
      this.order.set(stem, this.order.size);
      idOf(stem);
      for (const word of words) this.holders[idOf(word)] = stem;
    }
    this.sortedStems = [...this.order.keys()].sort();

    const count = this.strings.length;
    this.pairCounts = new Int32Array(count);
    const lists = new Map<string, number[]>();
    for (let id = 0; id < count; id++) {
      const pairs = letterPairs(this.strings[id]);
      this.pairCounts[id] = pairs.size;
      for (const pair of pairs) {
        let list = lists.get(pair);
        if (!list) lists.set(pair, (list = []));
        list.push(id);
      }
    }
    for (const [pair, list] of lists) {
      this.stringsByPair.set(pair, Int32Array.from(list));
    }
    this.fewestPairsFirst = Int32Array.from(
      { length: count },
      (_, id) => id,
    ).sort((a, b) => this.pairCounts[a] - this.pairCounts[b]);

    this.shared = new Int32Array(count);
    this.sharing = new Int32Array(count);
  }

  /** The stems that start with `prefix`, itself included. */
  stemsStartingWith(prefix: string): string[] {
    const stems = this.sortedStems;
    let low = 0;
    let high = stems.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (stems[middle] < prefix) low = middle + 1;
      else high = middle;
    }
    const found: string[] = [];
    for (let i = low; i < stems.length && stems[i].startsWith(prefix); i++) {
      found.push(stems[i]);
    }
    return found;
  }

  /** The stems that may be within `maxTypos` of `word`: all that are, and a few more. */
  stemsNear(word: string, maxTypos: number): Set<string> {
    const stems = new Set<string>();
    for (const id of this.stringsNear(word, maxTypos)) {
      if (this.order.has(this.strings[id])) stems.add(this.strings[id]);
    }
    return stems;
  }

  /**
   * The stems holding a word that may be within `maxTypos` of `word`: all
   * that hold one, and a few more.
   */
  stemsHoldingWordsNear(word: string, maxTypos: number): Set<string> {
    const stems = new Set<string>();
    for (const id of this.stringsNear(word, maxTypos)) {
      const holder = this.holders[id];
      if (holder !== undefined) stems.add(holder);
    }
    return stems;
  }

  /** The stems in the dictionary's own order, the order a scan of it reads them in. */
  inDictionaryOrder(stems: Iterable<string>): string[] {
    return [...stems].sort((a, b) => this.order.get(a)! - this.order.get(b)!);
  }

  /**
   * The strings within `maxTypos` of `word` and the few more that share as
   * many letter pairs: within N typos, two strings differ in length by N at
   * most, and share all but 3·N of the pairs of either one.
   */
  private stringsNear(word: string, maxTypos: number): number[] {
    const pairs = letterPairs(word);
    const brokenAtMost = PAIRS_A_TYPO_BREAKS * maxTypos;
    const isNear = (id: number) =>
      Math.abs(this.strings[id].length - word.length) <= maxTypos &&
      this.shared[id] >=
        Math.max(pairs.size, this.pairCounts[id]) - brokenAtMost;

    let sharingCount = 0;
    for (const pair of pairs) {
      const ids = this.stringsByPair.get(pair);
      if (!ids) continue;
      for (let i = 0; i < ids.length; i++) {
        if (this.shared[ids[i]]++ === 0) this.sharing[sharingCount++] = ids[i];
      }
    }

    const near: number[] = [];
    for (let i = 0; i < sharingCount; i++) {
      if (isNear(this.sharing[i])) near.push(this.sharing[i]);
    }
    // Two short strings may share no pair at all and still be near: "ab"
    // and "ba" are one swap apart
    if (pairs.size <= brokenAtMost) {
      for (const id of this.fewestPairsFirst) {
        if (this.pairCounts[id] > brokenAtMost) break;
        if (this.shared[id] === 0 && isNear(id)) near.push(id);
      }
    }

    for (let i = 0; i < sharingCount; i++) this.shared[this.sharing[i]] = 0;
    return near;
  }
}

export { VocabularyIndex };
