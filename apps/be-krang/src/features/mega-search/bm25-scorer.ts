import type { DocumentIndex, InvertedIndexEntry } from './types';

export interface BM25Config {
  k1: number; // Controls term frequency saturation (typically 1.0-2.0)
  b: number; // Controls length normalization (0.0-1.0)
}

export class BM25Scorer {
  private avgDocLength: number = 0;

  constructor(private config: BM25Config) {}

  /**
   * Calculate average document length for the corpus
   */
  calculateAverageDocLength(documents: Map<string, DocumentIndex>): void {
    const totalLength = Array.from(documents.values()).reduce(
      (sum, doc) => sum + doc.wordCount,
      0,
    );

    this.avgDocLength = totalLength / documents.size;
    console.log(
      `[BM25] Calculated average document length: ${this.avgDocLength.toFixed(2)} tokens`,
    );
  }

  /**
   * Calculate BM25 score for a term in a document
   *
   * BM25 Formula:
   * score = IDF(qi) * (f(qi,D) * (k1 + 1)) / (f(qi,D) + k1 * (1 - b + b * |D| / avgdl))
   *
   * Where:
   * - IDF(qi) = log((N - df(qi) + 0.5) / (df(qi) + 0.5))
   * - f(qi,D) = frequency of term qi in document D
   * - |D| = length of document D in tokens
   * - avgdl = average document length in the collection
   * - N = total number of documents in the collection
   * - df(qi) = number of documents containing qi
   */
  calculateScore(
    termFreq: number, // f(qi,D) - frequency of term in document
    docLength: number, // |D| - document length
    docFreq: number, // df(qi) - documents containing term
    totalDocs: number, // N - total documents in corpus
  ): number {
    // Calculate IDF component using BM25 IDF formula
    const idf = Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5));

    // Calculate term frequency component with saturation
    const tfComponent =
      (termFreq * (this.config.k1 + 1)) /
      (termFreq +
        this.config.k1 *
          (1 -
            this.config.b +
            this.config.b * (docLength / this.avgDocLength)));

    return idf * tfComponent;
  }

  /**
   * Calculate traditional TF-IDF score for comparison
   */
  calculateTfIdfScore(
    termFreq: number,
    docFreq: number,
    totalDocs: number,
  ): number {
    const tf = termFreq;
    const idf = Math.log((totalDocs + 1) / (docFreq + 1)) + 1;
    return tf * idf;
  }

  /**
   * Get scoring method name for logging
   */
  getScoringMethod(): string {
    return `BM25(k1=${this.config.k1}, b=${this.config.b})`;
  }
}
