import { SearchToken } from './types';
import { normalizeUkrainian, lemmatizeUkrainian, ukrainianStopWords } from './lang/ukrainian';
import { normalizeEnglish, stemEnglish, englishStopWords } from './lang/english';

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
    const normalized = this.normalize(text);
    const tokens: SearchToken[] = [];

    // Track both normalized and original text positions
    let originalTextPos = 0;
    let normalizedPos = 0;

    // Split normalized text but keep track of original positions
    const words = normalized.split(' ');

    for (const word of words) {
      if (word.length > 1 &&
          !this.isStopWord(word) &&
          this.combinedAlphabet.test(word)) {

        // Find this word's position in the original text
        const wordStartInOriginal = text.toLowerCase().indexOf(word.toLowerCase(), originalTextPos);
        const wordEndInOriginal = wordStartInOriginal + word.length;

        tokens.push({
          term: word,
          position: tokens.length,
          normalized: word,
          charStart: wordStartInOriginal >= 0 ? wordStartInOriginal : originalTextPos,
          charEnd: wordStartInOriginal >= 0 ? wordEndInOriginal : originalTextPos + word.length
        });

        // Update position tracking
        if (wordStartInOriginal >= 0) {
          originalTextPos = wordEndInOriginal;
        } else {
          originalTextPos += word.length + 1; // Estimate if not found
        }
      }
    }

    return tokens;
  }

  private isStopWord(word: string): boolean {
    return ukrainianStopWords.has(word) || englishStopWords.has(word);
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

  generateVariants(word: string): string[] {
    const variants = new Set<string>();
    variants.add(word);
    variants.add(this.stemWord(word));

    if (this.ukrainianAlphabet.test(word)) {
      // Add Ukrainian word variations
      if (word.endsWith('ий')) {
        variants.add(word.slice(0, -2) + 'ого');
        variants.add(word.slice(0, -2) + 'ому');
      }
    } else if (this.englishAlphabet.test(word)) {
      // Add English word variations
      if (word.endsWith('y')) {
        variants.add(word.slice(0, -1) + 'ies');
      }
      if (
        !word.endsWith('s') &&
        !word.endsWith('sh') &&
        !word.endsWith('ch') &&
        !word.endsWith('x') &&
        !word.endsWith('z')
      ) {
        variants.add(word + 's');
      }
    }

    return Array.from(variants);
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
}

export { UkrainianTextProcessor };
