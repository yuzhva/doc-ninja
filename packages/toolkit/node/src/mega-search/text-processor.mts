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
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (isNumberTerm(match[0])) {
        tokens.push({
          term: match[0],
          position: tokens.length,
          normalized: match[0],
          charStart: match.index,
          charEnd: match.index + match[0].length,
        });
        continue;
      }

      // Inside a word an apostrophe or a hyphen is part of it ("п'ять",
      // "науково-дослідний"). At its edges an apostrophe can only be a quote
      // mark, and a hyphen is left over from a compound broken by a space
      // ("інженера- конструктора", "Івано- Франківськ") or from a dash, so
      // both stay out of the token: "інженера-" is the word "інженера".
      const withoutLeading = match[0].replace(/^['\u2019\u02BC-]+/, '');
      const term = withoutLeading.replace(/['\u2019\u02BC-]+$/, '');
      const charStart = match.index + (match[0].length - withoutLeading.length);
      const normalizedTerm = this.normalize(term);

      if (
        normalizedTerm.length > 1 &&
        this.combinedAlphabet.test(normalizedTerm)
      ) {
        tokens.push({
          term: normalizedTerm,
          position: tokens.length,
          normalized: normalizedTerm,
          charStart,
          charEnd: charStart + term.length,
        });
      }
    }

    return tokens;
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
    const ukrainianChars = (text.match(/[а-яїієґ]/gi) || []).length;
    const englishChars = (text.match(/[a-z]/gi) || []).length;
    const totalChars = ukrainianChars + englishChars;

    if (totalChars === 0) return 'english'; // default

    const ukrainianRatio = ukrainianChars / totalChars;

    if (ukrainianRatio > 0.8) return 'ukrainian';
    if (ukrainianRatio < 0.2) return 'english';
    return 'mixed';
  }

  calculateSimilarity(word1: string, word2: string): number {
    // Simple Levenshtein distance for fuzzy matching
    const len1 = word1.length;
    const len2 = word2.length;
    const matrix = Array(len1 + 1)
      .fill(null)
      .map(() => Array(len2 + 1).fill(null));

    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = word1[i - 1] === word2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // deletion
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j - 1] + cost, // substitution
        );
      }
    }

    const distance = matrix[len1][len2];
    return 1 - distance / Math.max(len1, len2);
  }

  /**
   * Extract paragraphs from text while preserving structure
   */
  extractParagraphs(
    text: string,
  ): Array<{ content: string; startPos: number; endPos: number }> {
    const paragraphs: Array<{
      content: string;
      startPos: number;
      endPos: number;
    }> = [];

    // Split by double newlines to get paragraphs
    const paragraphTexts = text.split(/\n\s*\n/);
    let currentPos = 0;

    for (const paragraphText of paragraphTexts) {
      const trimmed = paragraphText.trim();
      if (trimmed.length > 0) {
        const startPos = text.indexOf(trimmed, currentPos);
        const endPos = startPos + trimmed.length;

        paragraphs.push({
          content: trimmed,
          startPos: startPos >= 0 ? startPos : currentPos,
          endPos: startPos >= 0 ? endPos : currentPos + trimmed.length,
        });

        currentPos = endPos;
      }
    }

    return paragraphs;
  }

  /**
   * Tokenize text while tracking paragraph boundaries
   */
  tokenizeWithParagraphs(text: string): {
    tokens: SearchToken[];
    paragraphs: Array<{
      content: string;
      startPos: number;
      endPos: number;
      tokenStart: number;
      tokenEnd: number;
    }>;
  } {
    const tokens = this.tokenize(text);
    const paragraphs = this.extractParagraphs(text);

    // Map paragraph boundaries to token indices
    const enhancedParagraphs = paragraphs.map((paragraph) => {
      const tokenStart = tokens.findIndex(
        (token) => token.charStart >= paragraph.startPos,
      );
      const tokenEnd = tokens.findIndex(
        (token) => token.charEnd > paragraph.endPos,
      );

      return {
        ...paragraph,
        tokenStart: tokenStart >= 0 ? tokenStart : 0,
        tokenEnd: tokenEnd >= 0 ? tokenEnd : tokens.length,
      };
    });

    return { tokens, paragraphs: enhancedParagraphs };
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
