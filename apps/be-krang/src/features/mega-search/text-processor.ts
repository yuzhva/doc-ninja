import { SearchToken } from './types';

class UkrainianTextProcessor {
  private readonly ukrainianAlphabet = /[а-яїієґ]/i;
  private readonly englishAlphabet = /[a-z]/i;
  private readonly combinedAlphabet = /[a-zа-яїієґ]/i;

  private readonly ukrainianStopWords = new Set([
    'і',
    'в',
    'на',
    'з',
    'за',
    'до',
    'по',
    'від',
    'для',
    'про',
    'під',
    'над',
    'між',
    'через',
    'це',
    'той',
    'та',
    'те',
    'який',
    'яка',
    'яке',
    'що',
    'хто',
    'де',
    'коли',
    'як',
    'але',
    'або',
    'якщо',
    'тому',
    'щоб',
    'після',
    'перед',
    'біля',
    'навколо',
  ]);

  private readonly englishStopWords = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'by',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'must',
    'shall',
    'this',
    'that',
    'these',
    'those',
    'here',
    'there',
    'where',
    'when',
    'how',
    'why',
    'what',
    'who',
  ]);

  private readonly ukrainianSuffixes = [
    'ський',
    'цький',
    'ний',
    'ова',
    'ева',
    'ити',
    'ати',
    'ути',
    'ість',
    'ення',
    'ання',
    'енні',
    'онні',
    'льний',
    'ального',
    'овий',
    'евий',
  ];

  private readonly englishSuffixes = [
    'ing',
    'ed',
    'er',
    'est',
    'ly',
    'tion',
    'sion',
    'ness',
    'ment',
    'able',
    'ible',
    'ful',
    'less',
    'ous',
    'ious',
    'ive',
    'ize',
    'ise',
    'al',
    'ic',
  ];

  normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\wa-zа-яїієґ\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  tokenize(text: string): SearchToken[] {
    const normalized = this.normalize(text);
    const words = normalized.split(' ').filter(
      (word) =>
        word.length > 1 &&
        !this.isStopWord(word) &&
        this.combinedAlphabet.test(word),
    );

    return words.map((term, index) => ({
      term: term,
      position: index,
      normalized: term,
    }));
  }

  private isStopWord(word: string): boolean {
    return this.ukrainianStopWords.has(word) || this.englishStopWords.has(word);
  }

  stemWord(word: string): string {
    // Detect language and apply appropriate stemming
    if (this.ukrainianAlphabet.test(word)) {
      return this.stemUkrainian(word);
    } else if (this.englishAlphabet.test(word)) {
      return this.stemEnglish(word);
    }

    return word;
  }

  private stemUkrainian(word: string): string {
    // Sort suffixes by length (longest first) for better matching
    const sortedSuffixes = [...this.ukrainianSuffixes].sort(
      (a, b) => b.length - a.length,
    );

    for (const suffix of sortedSuffixes) {
      if (word.endsWith(suffix) && word.length > suffix.length + 2) {
        return word.slice(0, -suffix.length);
      }
    }

    return word;
  }

  private stemEnglish(word: string): string {
    // Basic English stemming - Porter-like algorithm
    let stem = word;

    // Handle plurals
    if (stem.endsWith('ies') && stem.length > 4) {
      stem = stem.slice(0, -3) + 'y';
    } else if (stem.endsWith('s') && stem.length > 3 && !stem.endsWith('ss')) {
      stem = stem.slice(0, -1);
    }

    // Handle common suffixes
    const sortedSuffixes = [...this.englishSuffixes].sort(
      (a, b) => b.length - a.length,
    );

    for (const suffix of sortedSuffixes) {
      if (stem.endsWith(suffix) && stem.length > suffix.length + 2) {
        stem = stem.slice(0, -suffix.length);
        break;
      }
    }

    // Handle double consonants at the end
    if (stem.length > 3 && stem.match(/[bcdfghjklmnpqrstvwxz]{2}$/)) {
      const lastTwo = stem.slice(-2);
      if (lastTwo[0] === lastTwo[1]) {
        stem = stem.slice(0, -1);
      }
    }

    return stem;
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
