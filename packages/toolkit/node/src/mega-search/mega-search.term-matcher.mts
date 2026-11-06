import { fuzzyMatch } from './fuzzy.mjs';
import { calculateMatchConfidence } from './mega-search.utils.mjs';
import { UkrainianTextProcessor, isNumberTerm } from './text-processor.mjs';
import type { DocumentIndex, SearchSnapshot } from './types.mjs';

type TermMatchOptions = {
  /**
   * "Allow fuzzy match" (SearchOptions.isInflectedWordFormsAllowed): any inflected
   * form of the word matches, not only the form typed.
   */
  isFuzzy: boolean;
  /**
   * With fuzzy match on, related words match too (SearchOptions.isRelatedWordsAllowed):
   * words whose stem is the query word's stem plus or minus up to 2 letters.
   */
  isRelatedWordsAllowed: boolean;
  /** Character edits a word may differ by (SearchOptions.maxTypoDistance). */
  maxTypoDistance: number;
};

type SearchIndex = Pick<SearchSnapshot, 'invertedIndex' | 'stemDictionary'>;

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

const NO_FORMS: ReadonlySet<string> = new Set();

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
   * Documents holding a matched stem. Where only some forms of a stem count
   * (fuzzy match off, or a stem the stemmer cut short) this is a superset: a
   * document may hold only other forms of the stem (see positionsIn).
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
 * With related words, fuzzy match on also takes stems up to 2 letters longer
 * or shorter (see isRelatedStem). N is maxTypoDistance; 0 turns typo tolerance off in either mode. Fuzzy
 * match on always finds at least what it finds off. Inflection and typos
 * stay apart even where they overlap: "Євгену" is 1 edit from "Євгена", but
 * as another form of the same word only fuzzy match finds it.
 *
 * "Every form" means every word under the same stem, and also the forms the
 * stemmer filed under a stem of their own — it cuts off whatever looks like
 * an ending, and so cuts some forms short of the others:
 *
 *   архів → арх       архіву, архівом → архів
 *   паперова, паперове → папер     паперовий, паперового → паперов
 *   Мирослав → миросл      Мирослава, Мирославу → мирослав
 *
 * The words show which stem was cut short: the longer stem is the start of
 * the shorter stem's word ("паперова" starts with "паперов"). A word derived with
 * a suffix does not ("Бондар" does not start with "бондарук", "Кота" not with
 * "котик"), so this needs no list of endings and no length limit.
 *
 * What it cannot see is the opposite: a stem the stemmer left too long, with
 * part of the ending still on it — most verbs ("призначила" → "призначил",
 * "призначив" → "признач") and the "-ією"/"-ієм" forms ("Марією" → "маріє").
 * Without a list of endings, a leftover "-ил" looks the same as the "-ук" of
 * "Бондарук". Related words (on by default) find those, together with the
 * derived words. A vowel change inside the stem ("Кіт" → "Кота") is for typo
 * tolerance; no stem rule spans it.
 *
 * A number matches itself only, in every mode: "2024" is never "2023",
 * "202" or "20245", whatever the typo distance or fuzzy match.
 */
class TermMatcher {
  constructor(private textProcessor: UkrainianTextProcessor) {}

  /** @param queryWord a normalized query token (UkrainianTextProcessor.tokenize). */
  match(
    queryWord: string,
    options: TermMatchOptions,
    index: SearchIndex,
  ): WordMatch {
    if (isNumberTerm(queryWord)) return this.matchNumber(queryWord, index);
    return options.isFuzzy
      ? this.matchInflectedForms(queryWord, options, index)
      : this.matchWordForms(queryWord, options.maxTypoDistance, index);
  }

  private matchNumber(number: string, index: SearchIndex): WordMatch {
    return this.toWordMatch(
      number,
      new Map([[number, null]]),
      new Map([[number, { queryToken: number, confidence: 1 }]]),
      index,
    );
  }

  private matchInflectedForms(
    queryWord: string,
    { maxTypoDistance, isRelatedWordsAllowed }: TermMatchOptions,
    index: SearchIndex,
  ): WordMatch {
    const queryStem = this.textProcessor.stemWord(queryWord);
    const forms = new Map<string, ReadonlySet<string> | null>();
    const words = new Map<string, MatchedWord>();

    for (const [stem, stemWords] of index.stemDictionary) {
      let confidence = this.matchStem(queryWord, queryStem, stem, {
        maxTypoDistance,
        isRelatedWordsAllowed,
      });

      // A typo can keep the stemmer from finding the stem at all ("prked"
      // stays "prked", 3 edits from "park"), so the word as typed is checked
      // against the forms too — as it would be with fuzzy match off.
      if ((confidence ?? 0) < 1 && maxTypoDistance > 0) {
        for (const word of stemWords) {
          if (fuzzyMatch(queryWord, word, maxTypoDistance)) {
            confidence = Math.max(
              confidence ?? 0,
              calculateMatchConfidence(queryWord, word),
            );
          }
        }
      }

      const cutShort = this.formsCutShort(queryStem, stem, stemWords);
      if (confidence !== null) {
        forms.set(stem, null);
        for (const word of stemWords) {
          words.set(word, {
            queryToken: queryStem,
            // Forms of the word itself, even where a related-words or typo
            // match brought the whole stem in.
            confidence: cutShort.has(word) ? 1 : confidence,
          });
        }
      } else if (cutShort.size > 0) {
        forms.set(stem, cutShort);
        for (const word of cutShort) {
          words.set(word, { queryToken: queryStem, confidence: 1 });
        }
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
    if (index.stemDictionary.get(queryStem)?.has(queryWord)) {
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
   * Whether every word under an index stem matches the query word, and how
   * confidently; null when not.
   * - 1: the same stem, or the stem of the query word's other forms where the
   *   stemmer cut the query word short: "архів" → "арх", and the word
   *   "архів" starts "архів", the stem of "архіву".
   * - below 1: a stem within maxTypoDistance edits, or — with related words —
   *   a stem up to 2 letters longer or shorter than the query word's.
   */
  private matchStem(
    queryWord: string,
    queryStem: string,
    stem: string,
    {
      maxTypoDistance,
      isRelatedWordsAllowed,
    }: Pick<TermMatchOptions, 'maxTypoDistance' | 'isRelatedWordsAllowed'>,
  ): number | null {
    if (stem === queryStem) return 1;
    if (stem.startsWith(queryStem) && queryWord.startsWith(stem)) return 1;

    const isTypo =
      maxTypoDistance > 0 && fuzzyMatch(queryStem, stem, maxTypoDistance);
    const isRelated = isRelatedWordsAllowed && isRelatedStem(queryStem, stem);
    return isTypo || isRelated
      ? calculateMatchConfidence(queryStem, stem)
      : null;
  }

  /**
   * The words under a shorter index stem that are forms of the query word,
   * which the stemmer cut short: the words that start with the query word's
   * stem ("архів" under "арх", for "архіву" → "архів"). Only those: other
   * words under the same stem may be other words ("дмитр" holds "Дмитрів"
   * and "Дмитро", so "Дмитріва" → "дмитрів" brings in "Дмитрів" alone).
   */
  private formsCutShort(
    queryStem: string,
    stem: string,
    stemWords: ReadonlySet<string>,
  ): ReadonlySet<string> {
    if (stem.length >= queryStem.length || !queryStem.startsWith(stem)) {
      return NO_FORMS;
    }
    const forms = new Set<string>();
    for (const word of stemWords) {
      if (word.startsWith(queryStem)) forms.add(word);
    }
    return forms;
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
 * Related words: one stem is the other plus up to 2 letters. That takes in
 * words derived with a short suffix ("столяр" → "столярного", "облік" →
 * "обліковими"), the verb forms the stemmer splits ("призначив" →
 * "призначила") — and surnames derived the same way ("Бондар" →
 * "Бондарук", "Цап" → "Цапик", "Кота" → "Котика").
 */
function isRelatedStem(queryStem: string, stem: string): boolean {
  return (
    Math.abs(queryStem.length - stem.length) <= 2 &&
    (queryStem.startsWith(stem) || stem.startsWith(queryStem))
  );
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
