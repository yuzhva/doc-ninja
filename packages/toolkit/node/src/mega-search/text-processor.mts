import { englishFunctionWords, stemEnglish } from './lang/english.mjs';
import {
  lemmatizeUkrainian,
  normalizeUkrainian,
  ukrainianFunctionWords,
} from './lang/ukrainian.mjs';
import { SearchToken } from './types.mjs';

/**
 * A token is a number: a run of digits, part of a document number, a date or
 * a code. Words never hold a digit, so a token is all digits or none.
 */
const isNumberTerm = (term: string): boolean => /^[0-9]+$/.test(term);

/**
 * A token is a function word: a preposition, conjunction or particle ("про",
 * "та", "лише"; "of", "and"), which only ties the words around it together.
 * It is indexed and must be there in a phrase, but:
 * - it matches itself only, as typed, never another form or a typo, and no
 *   other word matches it: "від" is no typo of "вид";
 * - it doesn't count where distance is counted in words, as numbers don't,
 *   so phrase gaps and snippets count the words they counted before function
 *   words were indexed;
 * - a word-by-word search skips it, unless the query holds nothing else.
 */
const isFunctionWord = (term: string): boolean =>
  ukrainianFunctionWords.has(term) || englishFunctionWords.has(term);

/** A token matched as typed only, never by another form or a typo. */
const matchesItselfOnly = (term: string): boolean =>
  isNumberTerm(term) || isFunctionWord(term);

/**
 * Whether a token counts where distance is counted in words — phrase gaps,
 * snippet windows, document length. Numbers and function words don't.
 */
const countsAsWord = (term: string): boolean =>
  !isNumberTerm(term) && !isFunctionWord(term);

/**
 * What glues each token to the one before it, by the token's index: the
 * characters between the two, where one of them is a number and no
 * whitespace parts them. "вх№36088 від 22.12.2024" → { 1: "№", 3: ".",
 * 4: "." }. A document and a query both have them, and a number the query
 * writes glued ("22.12.2024", "15/2") is found only where the text glues its
 * parts with the same characters: not in "22/12/2024" or "пункти 15, 2".
 */
const findJoints = (
  text: string,
  tokens: readonly SearchToken[],
): Record<number, string> => {
  const joints: Record<number, string> = {};
  for (let i = 1; i < tokens.length; i++) {
    const previous = tokens[i - 1];
    const token = tokens[i];
    if (!isNumberTerm(previous.term) && !isNumberTerm(token.term)) continue;
    const between = text.slice(previous.charEnd, token.charStart);
    if (!/\s/.test(between)) joints[i] = between;
  }
  return joints;
};

/**
 * What a run of letters or digits in a text stands for: the token, and the
 * characters it spans there — `length` of them from `offset` on, the quote
 * marks and hyphens at its edges left out (see tokenize).
 */
interface WordReading {
  term: string;
  offset: number;
  length: number;
}

/**
 * The letters detectLanguage counts as Ukrainian, by UTF-16 code: А–я, Є, І,
 * Ї and Ґ in both cases, and U+1C80–U+1C86, old variant forms of в, д, о, с,
 * т and ъ. That's what /[а-яїієґ]/i matched — counted with it, each text
 * became an array of its letters.
 */
const isUkrainianLetter = (code: number): boolean =>
  (code >= 0x410 && code <= 0x44f) ||
  code === 0x404 ||
  code === 0x454 ||
  code === 0x406 ||
  code === 0x456 ||
  code === 0x407 ||
  code === 0x457 ||
  code === 0x490 ||
  code === 0x491 ||
  (code >= 0x1c80 && code <= 0x1c86);

/** The letters detectLanguage counts as English: a–z in both cases. */
const isEnglishLetter = (code: number): boolean =>
  (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);

class UkrainianTextProcessor {
  private readonly ukrainianAlphabet = /[а-яїієґ]/i;
  private readonly englishAlphabet = /[a-z]/i;
  private readonly combinedAlphabet = /[a-zа-яїієґ]/i;

  normalize(text: string): string {
    // Use Ukrainian normalization for all text (can extend for other languages)
    // Optionally, detect language and use appropriate normalization
    return normalizeUkrainian(text);
  }

  /**
   * Words and numbers, in text order.
   *
   * A number is a run of digits, apart from the letters and separators
   * around it: "вх№36088 від 22.12.2024" → вх, 36088, 22, 12, 2024. That is
   * what lets "36088" or "2024" find the text; a query that glues parts
   * together ("22.12.2024", "вх№36088") finds them side by side (see
   * MegaSearch). Single digits are kept ("№ 5"), leading zeros too: "05" is
   * not "5".
   *
   * Words are what they were before numbers were indexed — a digit ends a
   * word as any separator does — and numbers don't count where distance is
   * counted in words, so searches for words find what they found before.
   *
   * Every word is a token, function words too (see isFunctionWord). Single
   * letters aren't: "в", "і", "з", initials.
   */
  tokenize(text: string): SearchToken[] {
    const tokens: SearchToken[] = [];

    // Use regex that properly handles Ukrainian characters. Apostrophes: ASCII ',
    // the typographic U+2019 (what Word auto-inserts) and the modifier letter
    // U+02BC (the Unicode-recommended Ukrainian apostrophe). The Latin "\u00EF"
    // and "\u00CF" too, the look-alikes of "\u0457" and "\u0407" (see normalizeUkrainian).
    const regex =
      /[\u0400-\u04FFa-zA-Z\u0100-\u017F\u00CF\u00EF'\u2019\u02BC-]+|[0-9]+/g;
    // A text repeats its words: each one is read once (on 362 documents, a
    // third of the time it took to read every occurrence)
    const readings = new Map<string, WordReading | null>();
    let match;

    while ((match = regex.exec(text)) !== null) {
      let reading = readings.get(match[0]);
      if (reading === undefined) {
        reading = this.readWord(match[0]);
        readings.set(match[0], reading);
      }
      if (!reading) continue;

      const charStart = match.index + reading.offset;
      tokens.push({
        term: reading.term,
        position: tokens.length,
        normalized: reading.term,
        charStart,
        charEnd: charStart + reading.length,
      });
    }

    return tokens;
  }

  /**
   * The token a run of letters or digits the tokenizer matched stands for;
   * null when it stands for none.
   */
  private readWord(match: string): WordReading | null {
    if (isNumberTerm(match)) {
      return { term: match, offset: 0, length: match.length };
    }

    // Inside a word an apostrophe or a hyphen is part of it ("п'ять",
    // "науково-дослідний"). At its edges an apostrophe can only be a quote
    // mark, and a hyphen is left over from a compound broken by a space
    // ("інженера- конструктора", "Івано- Франківськ") or from a dash, so
    // both stay out of the token: "інженера-" is the word "інженера".
    const withoutLeading = match.replace(/^['\u2019\u02BC-]+/, '');
    const term = withoutLeading.replace(/['\u2019\u02BC-]+$/, '');
    const normalizedTerm = this.normalize(term);

    if (
      normalizedTerm.length <= 1 ||
      !this.combinedAlphabet.test(normalizedTerm)
    ) {
      return null;
    }
    return {
      term: normalizedTerm,
      offset: match.length - withoutLeading.length,
      length: term.length,
    };
  }

  /**
   * The key a word is indexed and searched under: its stem, or the word
   * itself for a function word. No other word's stem is ever a function
   * word's key — a word whose stem would be one keeps its whole form — so a
   * function word's postings hold that word only.
   */
  stemWord(word: string): string {
    if (isFunctionWord(word)) return word;
    const stem = this.stem(word);
    return isFunctionWord(stem) ? word : stem;
  }

  private stem(word: string): string {
    if (this.ukrainianAlphabet.test(word)) {
      return lemmatizeUkrainian(word);
    }
    if (this.englishAlphabet.test(word)) {
      return stemEnglish(word);
    }
    return word;
  }

  detectLanguage(text: string): 'ukrainian' | 'english' | 'mixed' {
    let ukrainianChars = 0;
    let englishChars = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (isUkrainianLetter(code)) ukrainianChars++;
      else if (isEnglishLetter(code)) englishChars++;
    }
    const totalChars = ukrainianChars + englishChars;

    if (totalChars === 0) return 'english'; // default

    const ukrainianRatio = ukrainianChars / totalChars;

    if (ukrainianRatio > 0.8) return 'ukrainian';
    if (ukrainianRatio < 0.2) return 'english';
    return 'mixed';
  }
}

export {
  countsAsWord,
  findJoints,
  isFunctionWord,
  isNumberTerm,
  matchesItselfOnly,
  UkrainianTextProcessor,
};
