import { DocumentChunk } from '../types.mjs';

class TextProcessor {
  private sentenceBoundaries = /[.!?]+\s+/g;
  private wordBoundaries = /\s+/;

  async chunkText(
    text: string,
    maxChunkSize: number = 512,
  ): Promise<DocumentChunk[]> {
    // Normalize text
    const normalizedText = this.normalizeText(text);

    // Smart chunking by sentences to preserve context
    const chunks = this.intelligentChunking(normalizedText, maxChunkSize);

    return chunks.map((chunk, index) => ({
      id: `chunk_${index}`,
      text: chunk.text,
      start: chunk.start,
      end: chunk.end,
      metadata: {
        wordCount: this.countWords(chunk.text),
        sentences: this.countSentences(chunk.text),
      },
    }));
  }

  private normalizeText(text: string): string {
    return text
      .replace(/\r\n/g, '\n') // Normalize line endings
      .replace(/\t/g, ' ') // Convert tabs to spaces
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim(); // Remove leading/trailing whitespace
  }

  private intelligentChunking(
    text: string,
    maxSize: number,
  ): Array<{ text: string; start: number; end: number }> {
    const chunks: Array<{ text: string; start: number; end: number }> = [];
    const sentences = this.splitIntoSentences(text);

    let currentChunk = '';
    let currentStart = 0;
    let currentEnd = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const potentialChunk =
        currentChunk + (currentChunk ? ' ' : '') + sentence.text;

      if (potentialChunk.length > maxSize && currentChunk) {
        // Save current chunk
        chunks.push({
          text: currentChunk.trim(),
          start: currentStart,
          end: currentEnd,
        });

        // Start new chunk
        currentChunk = sentence.text;
        currentStart = sentence.start;
        currentEnd = sentence.end;
      } else {
        // Add sentence to current chunk
        if (!currentChunk) {
          currentStart = sentence.start;
        }
        currentChunk = potentialChunk;
        currentEnd = sentence.end;
      }
    }

    // Add final chunk
    if (currentChunk) {
      chunks.push({
        text: currentChunk.trim(),
        start: currentStart,
        end: currentEnd,
      });
    }

    return chunks;
  }

  private splitIntoSentences(
    text: string,
  ): Array<{ text: string; start: number; end: number }> {
    const sentences: Array<{ text: string; start: number; end: number }> = [];
    let lastIndex = 0;
    let match;

    const regex = new RegExp(this.sentenceBoundaries.source, 'g');

    while ((match = regex.exec(text)) !== null) {
      const sentenceEnd = match.index + match[0].length;
      const sentenceText = text.slice(lastIndex, sentenceEnd).trim();

      if (sentenceText) {
        sentences.push({
          text: sentenceText,
          start: lastIndex,
          end: sentenceEnd,
        });
      }

      lastIndex = sentenceEnd;
    }

    // Handle final sentence without punctuation
    if (lastIndex < text.length) {
      const finalText = text.slice(lastIndex).trim();
      if (finalText) {
        sentences.push({
          text: finalText,
          start: lastIndex,
          end: text.length,
        });
      }
    }

    return sentences;
  }

  private countWords(text: string): number {
    return text.split(this.wordBoundaries).filter((word) => word.length > 0)
      .length;
  }

  private countSentences(text: string): number {
    return this.splitIntoSentences(text).length;
  }

  extractKeywords(text: string, maxKeywords: number = 10): string[] {
    // Simple TF-IDF-like keyword extraction
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 3);

    const wordFreq = new Map<string, number>();
    words.forEach((word) => {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    });

    return Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([word]) => word);
  }

  calculateReadabilityScore(text: string): number {
    // Simple Flesch Reading Ease approximation
    const sentences = this.countSentences(text);
    const words = this.countWords(text);
    const syllables = this.estimateSyllables(text);

    if (sentences === 0 || words === 0) return 0;

    const avgSentenceLength = words / sentences;
    const avgSyllablesPerWord = syllables / words;

    return 206.835 - 1.015 * avgSentenceLength - 84.6 * avgSyllablesPerWord;
  }

  private estimateSyllables(text: string): number {
    // Simple syllable estimation
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];

    return words.reduce((total, word) => {
      // Basic syllable counting heuristic
      const vowels = word.match(/[aeiouy]+/g) || [];
      let syllableCount = vowels.length;

      // Adjust for silent 'e'
      if (word.endsWith('e') && syllableCount > 1) {
        syllableCount--;
      }

      return total + Math.max(1, syllableCount);
    }, 0);
  }
}

export { TextProcessor };
