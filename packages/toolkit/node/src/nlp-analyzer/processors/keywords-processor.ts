import { TaskProcessor } from '../managers/model-manager.ts';
import { AnalysisConfig, DocumentChunk } from '../types.ts';

interface KeywordsResult {
  keywords: Array<{
    word: string;
    score: number;
    frequency: number;
  }>;
  phrases: Array<{
    phrase: string;
    score: number;
    frequency: number;
  }>;
  topKeywords: string[];
  topPhrases: string[];
}

class KeywordsProcessor implements TaskProcessor {
  private stopWords = new Set([
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
    'from',
    'as',
    'is',
    'was',
    'are',
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
    'should',
    'could',
    'can',
    'may',
    'might',
    'must',
    'shall',
    'this',
    'that',
    'these',
    'those',
    'i',
    'you',
    'he',
    'she',
    'it',
    'we',
    'they',
    'me',
    'him',
    'her',
    'us',
    'them',
    'my',
    'your',
    'his',
    'our',
    'their',
  ]);

  async process(
    chunks: DocumentChunk[],
    config: AnalysisConfig,
  ): Promise<KeywordsResult> {
    const fullText = chunks.map((chunk) => chunk.text).join(' ');
    const maxKeywords = 20;
    const maxPhrases = 10;

    // Extract keywords using TF-IDF-like approach
    const keywords = this.extractKeywords(fullText, maxKeywords);

    // Extract key phrases (2-3 word combinations)
    const phrases = this.extractPhrases(fullText, maxPhrases);

    return {
      keywords,
      phrases,
      topKeywords: keywords.slice(0, 10).map((k) => k.word),
      topPhrases: phrases.slice(0, 5).map((p) => p.phrase),
    };
  }

  private extractKeywords(
    text: string,
    maxKeywords: number,
  ): Array<{
    word: string;
    score: number;
    frequency: number;
  }> {
    // Normalize and tokenize
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 2 && !this.stopWords.has(word) && !/^\d+$/.test(word), // Remove pure numbers
      );

    // Calculate frequency
    const wordFreq = new Map<string, number>();
    words.forEach((word) => {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    });

    // Calculate TF-IDF-like scores
    const totalWords = words.length;
    const results = Array.from(wordFreq.entries()).map(([word, freq]) => {
      // Simple TF score
      const tf = freq / totalWords;

      // Boost score for longer words (likely more meaningful)
      const lengthBoost = Math.min(word.length / 10, 1.5);

      // Simple relevance score
      const score = tf * lengthBoost * Math.log(totalWords / freq);

      return {
        word,
        score,
        frequency: freq,
      };
    });

    return results.sort((a, b) => b.score - a.score).slice(0, maxKeywords);
  }

  private extractPhrases(
    text: string,
    maxPhrases: number,
  ): Array<{
    phrase: string;
    score: number;
    frequency: number;
  }> {
    // Simple n-gram extraction (2-3 words)
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const phrases = new Map<string, number>();

    sentences.forEach((sentence) => {
      const words = sentence
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 1);

      // Extract 2-grams and 3-grams
      for (let i = 0; i < words.length - 1; i++) {
        // 2-gram
        const bigram = words.slice(i, i + 2).join(' ');
        if (this.isPhraseRelevant(bigram)) {
          phrases.set(bigram, (phrases.get(bigram) || 0) + 1);
        }

        // 3-gram
        if (i < words.length - 2) {
          const trigram = words.slice(i, i + 3).join(' ');
          if (this.isPhraseRelevant(trigram)) {
            phrases.set(trigram, (phrases.get(trigram) || 0) + 1);
          }
        }
      }
    });

    const results = Array.from(phrases.entries())
      .filter(([phrase, freq]) => freq > 1) // Only phrases that appear multiple times
      .map(([phrase, freq]) => ({
        phrase,
        frequency: freq,
        score: freq * phrase.split(' ').length, // Longer phrases get higher scores
      }));

    return results.sort((a, b) => b.score - a.score).slice(0, maxPhrases);
  }

  private isPhraseRelevant(phrase: string): boolean {
    const words = phrase.split(' ');

    // Filter out phrases with too many stop words
    const stopWordCount = words.filter((word) =>
      this.stopWords.has(word),
    ).length;
    if (stopWordCount >= words.length / 2) {
      return false;
    }

    // Filter out phrases with numbers only
    if (words.every((word) => /^\d+$/.test(word))) {
      return false;
    }

    return phrase.length > 5; // Minimum phrase length
  }
}

export { KeywordsProcessor };
export type { KeywordsResult };
