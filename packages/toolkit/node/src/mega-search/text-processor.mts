import {
  englishStopWords,
  normalizeEnglish,
  stemEnglish,
} from './lang/english.mjs';
import {
  lemmatizeUkrainian,
  normalizeUkrainian,
  ukrainianStopWords,
} from './lang/ukrainian.mjs';
import { SearchToken } from './types.mjs';

class UkrainianTextProcessor {
  private readonly ukrainianAlphabet = /[а-яїієґ]/i;
  private readonly englishAlphabet = /[a-z]/i;
  private readonly combinedAlphabet = /[a-zа-яїієґ]/i;

  normalize(text: string): string {
    // Use Ukrainian normalization for all text (can extend for other languages)
    // Optionally, detect language and use appropriate normalization
    return normalizeUkrainian(text);
  }

  tokenize(text: string): SearchToken[] {
    const tokens: SearchToken[] = [];

    // Use regex that properly handles Ukrainian characters
    const regex = /[\u0400-\u04FFa-zA-Z\u0100-\u017F''-]+/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const term = match[0];
      const normalizedTerm = this.normalize(term);

      if (
        normalizedTerm.length > 1 &&
        !this.isStopWord(normalizedTerm) &&
        this.combinedAlphabet.test(normalizedTerm)
      ) {
        tokens.push({
          term: normalizedTerm,
          position: tokens.length,
          normalized: normalizedTerm,
          charStart: match.index,
          charEnd: match.index + term.length,
        });
      }
    }

    return tokens;
  }

  private isStopWord(word: string): boolean {
    const stemmed = this.stemWord(word);

    if (this.ukrainianAlphabet.test(word)) {
      return ukrainianStopWords.has(stemmed);
    }
    return englishStopWords.has(stemmed);
  }

  stemWord(word: string): string {
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

export { UkrainianTextProcessor };
