import { EventEmitter } from 'events';

import { AnalysisConfig, DocumentChunk, LoadedPipeline } from '../types.mjs';

interface TaskProcessor {
  process(chunks: DocumentChunk[], config: AnalysisConfig): Promise<any>;
  dispose?(): Promise<void>;
}

abstract class BaseProcessor extends EventEmitter implements TaskProcessor {
  protected model?: LoadedPipeline;
  protected config: Record<string, any> = {};
  protected stats = {
    processedChunks: 0,
    totalProcessingTime: 0,
    errors: 0,
  };

  constructor(model?: LoadedPipeline, config?: Record<string, any>) {
    super();
    this.model = model;
    this.config = config || {};
  }

  abstract process(
    chunks: DocumentChunk[],
    config: AnalysisConfig,
  ): Promise<any>;

  /**
   * Common preprocessing pipeline
   */
  protected preprocessText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  protected async processWithFallback<T>(
    primaryFn: () => Promise<T>,
    fallbackFn: () => T | Promise<T>,
    context: string,
  ): Promise<T> {
    try {
      return await primaryFn();
    } catch (error) {
      console.warn(`${context} failed, falling back to rules:`, error);
      return fallbackFn();
    }
  }

  /**
   * Common postprocessing pipeline
   */
  protected postprocessResult(result: any, chunks: DocumentChunk[]): any {
    return result;
  }

  /**
   * Batch processing with error handling
   */
  protected async processBatch<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    options: {
      batchSize?: number;
      continueOnError?: boolean;
      onProgress?: (processed: number, total: number) => void;
    } = {},
  ): Promise<R[]> {
    const { batchSize = 10, continueOnError = true, onProgress } = options;
    const results: R[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      const batchPromises = batch.map(async (item, batchIndex) => {
        const globalIndex = i + batchIndex;
        try {
          const result = await processor(item, globalIndex);
          this.stats.processedChunks++;
          return { result, error: null, index: globalIndex };
        } catch (error) {
          this.stats.errors++;
          if (continueOnError) {
            return { result: null, error, index: globalIndex };
          }
          throw error;
        }
      });

      const batchResults = await Promise.all(batchPromises);

      batchResults.forEach(({ result, error, index }) => {
        if (error && !continueOnError) {
          throw error;
        }
        if (result !== null) {
          results[index] = result;
        }
      });

      if (onProgress) {
        onProgress(Math.min(i + batchSize, items.length), items.length);
      }
    }

    return results;
  }

  /**
   * Safe model execution with retry
   */
  protected async executeModel<T>(
    input: string,
    options: {
      maxRetries?: number;
      timeout?: number;
      fallback?: () => T;
    } = {},
  ): Promise<T> {
    const { maxRetries = 2, timeout = 30000, fallback } = options;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (!this.model) {
          throw new Error('Model not available');
        }

        const promise = this.model(input) as Promise<T>;

        if (timeout > 0) {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Model execution timeout')),
              timeout,
            ),
          );
          return await Promise.race([promise, timeoutPromise]);
        }

        return await promise;
      } catch (error: Error | any) {
        if (attempt === maxRetries) {
          if (fallback) {
            console.warn(
              `Model execution failed, using fallback: ${error.message}`,
            );
            return fallback();
          }
          throw error;
        }
        console.warn(
          `Model execution attempt ${attempt + 1} failed, retrying: ${error.message}`,
        );
        await this.sleep(1000 * (attempt + 1)); // Exponential backoff
      }
    }

    throw new Error('Model execution failed after all retries');
  }

  /**
   * Confidence calculation utilities
   */
  protected calculateConfidence(scores: number[]): number {
    if (scores.length === 0) return 0;

    const validScores = scores.filter(
      (score) => !isNaN(score) && score >= 0 && score <= 1,
    );
    if (validScores.length === 0) return 0;

    return (
      validScores.reduce((sum, score) => sum + score, 0) / validScores.length
    );
  }

  protected calculateConfidenceGap(scores: number[]): number {
    if (scores.length < 2) return 0;

    const sortedScores = scores.filter((s) => !isNaN(s)).sort((a, b) => b - a);
    return sortedScores.length >= 2 ? sortedScores[0] - sortedScores[1] : 0;
  }

  /**
   * Text analysis utilities
   */
  protected extractKeyTerms(text: string, count: number = 10): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3);

    const frequency = new Map<string, number>();
    words.forEach((word) => {
      frequency.set(word, (frequency.get(word) || 0) + 1);
    });

    return Array.from(frequency.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, count)
      .map(([word]) => word);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get processor statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Reset processor statistics
   */
  resetStats(): void {
    this.stats = {
      processedChunks: 0,
      totalProcessingTime: 0,
      errors: 0,
    };
  }

  async dispose(): Promise<void> {
    this.removeAllListeners();
    // Override in subclasses for specific cleanup
  }
}

export { BaseProcessor };
export type { TaskProcessor };
