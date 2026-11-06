import { fuzzyMatch } from './fuzzy.mjs';
import { calculateMatchConfidence } from './mega-search.utils.mjs';
import { UkrainianTextProcessor } from './text-processor.mjs';
import type { DocumentIndex, InvertedIndexEntry } from './types.mjs';

type TermMatchOptions = {
  /**
   * "Allow fuzzy match" (SearchOptions.isInflectedWordFormsAllowed): any inflected
   * form of the word matches, not only the form typed.
   */
  isFuzzy: boolean;
  /** Character edits a word may differ by (SearchOptions.maxTypoDistance). */
  maxTypoDistance: number;
};

type SearchIndex = {
  invertedIndex: Map<string, InvertedIndexEntry[]>;
  stemDictionary: Map<string, string[]>;
};

/** A document word that a query word matched. */
type MatchedWord = {
  /** The query word it stands for, as matches report it (see WordMatch.queryToken). */
  queryToken: string;
  /** 1 for the word itself (or, when fuzzy, any of its forms); lower for a typo. */
  confidence: number;
};

type StemPosting = {
  positions: number[];
  /** The forms of the stem that count, or null when every form does. */
  forms: ReadonlySet<string> | null;
};

/**
 * Everything one query word matched in the index — the single answer that
 * scoring, phrase matching, snippets and highlights all read, so they can
 * never disagree about what counts as a match.
 */
class WordMatch {
  constructor(
    /** The query word's stem when fuzzy, the word itself otherwise. */
    readonly queryToken: string,
    /** Every document word that counts as this query word. */
    readonly words: ReadonlyMap<string, MatchedWord>,
    private readonly postingsByDoc: ReadonlyMap<string, StemPosting[]>,
  ) {}

  /**
   * Documents holding a matched stem. Without fuzzy match this is a superset:
   * a document may hold only other forms of the stem (see positionsIn).
   */
  documentIds(): IterableIterator<string> {
    return this.postingsByDoc.keys();
  }

  /**
   * How many documents hold a matched stem — the document frequency for
   * scoring. Counted per stem in both modes, so it needs no document loads.
   */
  get documentCount(): number {
    return this.postingsByDoc.size;
  }

  /**
   * Token positions of the matched words in a document, ascending. May be
   * the index's own array — read it, never mutate it.
   */
  positionsIn(docId: string, doc: DocumentIndex): readonly number[] {
    const postings = this.postingsByDoc.get(docId);
    if (!postings) return [];

    if (postings.length === 1 && postings[0].forms === null) {
      return postings[0].positions;
    }

    const positions: number[] = [];
    for (const { positions: stemPositions, forms } of postings) {
      for (const position of stemPositions) {
        if (
          forms === null ||
          forms.has(doc.vocab[doc.positions[position][0]])
        ) {
          positions.push(position);
        }
      }
    }
    return positions.sort((a, b) => a - b);
  }
}

/**
 * Decides which index words a query word matches. This is where the UI's
 * "Allow fuzzy match" and "Allowed typo num. of chars" get their meaning,
 * independently of each other:
 *
 * | fuzzy | matches                                                         |
 * | ----- | --------------------------------------------------------------- |
 * | off   | the word as typed (letter case aside), and words within N edits |
 * | on    | every form of each of those words, and of stems within N edits  |
 *
 * N is maxTypoDistance; 0 turns typo tolerance off in either mode. Fuzzy
 * match on always finds at least what it finds off. Inflection and typos
 * stay apart even where they overlap: "Євгену" is 1 edit from "Євгена", but
 * as another form of the same word only fuzzy match finds it.
 */
class TermMatcher {
  constructor(private textProcessor: UkrainianTextProcessor) {}

  /** @param queryWord a normalized query token (UkrainianTextProcessor.tokenize). */
  match(
    queryWord: string,
    options: TermMatchOptions,
    index: SearchIndex,
  ): WordMatch {
    return options.isFuzzy
      ? this.matchInflectedForms(queryWord, options.maxTypoDistance, index)
      : this.matchWordForms(queryWord, options.maxTypoDistance, index);
  }

  private matchInflectedForms(
    queryWord: string,
    maxTypoDistance: number,
    index: SearchIndex,
  ): WordMatch {
    const queryStem = this.textProcessor.stemWord(queryWord);
    const forms = new Map<string, ReadonlySet<string> | null>();
    const words = new Map<string, MatchedWord>();

    for (const [stem, stemWords] of index.stemDictionary) {
      let isMatch = this.isSameWordStem(queryStem, stem, maxTypoDistance);
      let confidence = isMatch ? calculateMatchConfidence(queryStem, stem) : 0;

      // A typo can keep the stemmer from finding the stem at all ("prked"
      // stays "prked", 3 edits from "park"), so the word as typed is checked
      // against the forms too — as it would be with fuzzy match off.
      if (confidence < 1 && maxTypoDistance > 0) {
        for (const word of stemWords) {
          if (fuzzyMatch(queryWord, word, maxTypoDistance)) {
            isMatch = true;
            confidence = Math.max(
              confidence,
              calculateMatchConfidence(queryWord, word),
            );
          }
        }
      }
      if (!isMatch) continue;

      forms.set(stem, null);
      for (const word of stemWords) {
        words.set(word, { queryToken: queryStem, confidence });
      }
    }

    return this.toWordMatch(queryStem, forms, words, index);
  }

  private matchWordForms(
    queryWord: string,
    maxTypoDistance: number,
    index: SearchIndex,
  ): WordMatch {
    const forms = new Map<string, Set<string>>();
    const words = new Map<string, MatchedWord>();
    const add = (stem: string, word: string) => {
      if (!forms.has(stem)) forms.set(stem, new Set());
      forms.get(stem)!.add(word);
      words.set(word, {
        queryToken: queryWord,
        confidence: calculateMatchConfidence(queryWord, word),
      });
    };

    // Indexing stems every word the same way, so the word itself can only be
    // filed under its own stem.
    const queryStem = this.textProcessor.stemWord(queryWord);
    if (index.stemDictionary.get(queryStem)?.includes(queryWord)) {
      add(queryStem, queryWord);
    }

    if (maxTypoDistance > 0) {
      for (const [stem, stemWords] of index.stemDictionary) {
        // The other forms of the word are inflections, not typos — "Євгену"
        // is 1 edit from "Євгена" — and only fuzzy match finds those.
        if (stem === queryStem) continue;

        for (const word of stemWords) {
          if (fuzzyMatch(queryWord, word, maxTypoDistance)) add(stem, word);
        }
      }
    }

    return this.toWordMatch(queryWord, forms, words, index);
  }

  /**
   * Whether an index stem belongs to the query word: the same stem, one
   * within maxTypoDistance edits, or one that differs only by a short ending.
   * The last rule bridges the stemmer's inconsistencies across declensions
   * ("архів" → "арх", but "архіву" → "архів"), and so applies whatever
   * maxTypoDistance is.
   */
  private isSameWordStem(
    queryStem: string,
    stem: string,
    maxTypoDistance: number,
  ): boolean {
    if (queryStem === stem) return true;
    if (maxTypoDistance > 0 && fuzzyMatch(queryStem, stem, maxTypoDistance)) {
      return true;
    }

    const lengthDifference = Math.abs(queryStem.length - stem.length);
    return (
      lengthDifference <= 2 &&
      (queryStem.startsWith(stem) || stem.startsWith(queryStem))
    );
  }

  private toWordMatch(
    queryToken: string,
    forms: ReadonlyMap<string, ReadonlySet<string> | null>,
    words: ReadonlyMap<string, MatchedWord>,
    { invertedIndex }: SearchIndex,
  ): WordMatch {
    const postingsByDoc = new Map<string, StemPosting[]>();

    for (const [stem, stemForms] of forms) {
      for (const entry of invertedIndex.get(stem) ?? []) {
        let postings = postingsByDoc.get(entry.documentId);
        if (!postings) {
          postings = [];
          postingsByDoc.set(entry.documentId, postings);
        }
        postings.push({ positions: entry.positions, forms: stemForms });
      }
    }

    return new WordMatch(queryToken, words, postingsByDoc);
  }
}

/**
 * All document words a query matched, for snippets and highlights. A word
 * matched by several query words keeps its most confident match.
 */
function mergeMatchedWords(
  matches: readonly WordMatch[],
): Map<string, MatchedWord> {
  const merged = new Map<string, MatchedWord>();
  for (const { words } of matches) {
    for (const [word, matched] of words) {
      const current = merged.get(word);
      if (!current || current.confidence < matched.confidence) {
        merged.set(word, matched);
      }
    }
  }
  return merged;
}

export { mergeMatchedWords, TermMatcher, WordMatch };
export type { MatchedWord, SearchIndex, TermMatchOptions };
