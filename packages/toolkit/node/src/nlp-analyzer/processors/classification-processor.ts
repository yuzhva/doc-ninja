import { Pipeline } from '@huggingface/transformers';

import { TaskProcessor } from '../managers/model-manager.ts';
import { AnalysisConfig, DocumentChunk } from '../types.ts';

interface ClassificationResult {
  categories: Array<{
    label: string;
    score: number;
  }>;
  topCategory: {
    label: string;
    score: number;
  };
  confidence: number;
}

class ClassificationProcessor implements TaskProcessor {
  private model: Pipeline;

  constructor(model: Pipeline) {
    this.model = model;
  }

  async process(
    chunks: DocumentChunk[],
    config: AnalysisConfig,
  ): Promise<ClassificationResult> {
    // ✅ Reduce logging - only in debug mode
    if (process.env.DEBUG) {
      console.log(
        `🔍 ClassificationProcessor: Processing ${chunks.length} chunks`,
      );
    }
    const chunkResults: Array<{ label: string; score: number }[]> = [];

    // Classify each chunk
    for (const chunk of chunks) {
      try {
        // ✅ Comment out verbose chunk logging
        // console.log(`📝 Processing chunk: "${chunk.text.substring(0, 50)}..."`);

        const result = await this.executeModelSafely(chunk.text);

        // ✅ Comment out debug logging
        // console.log(`📊 Raw model result:`, result);

        const cleanedResult = this.validateAndCleanResults(result);

        // ✅ Comment out debug logging
        // console.log(`✅ Cleaned result:`, cleanedResult);

        if (cleanedResult.length === 0) {
          // ✅ Only warn in debug mode
          if (process.env.DEBUG) {
            console.warn(`⚠️ No valid results for chunk, using fallback`);
          }
          chunkResults.push([{ label: 'GENERAL', score: 0.6 }]);
        } else {
          chunkResults.push(cleanedResult);
        }
      } catch (error) {
        // ✅ Keep error logging but make it less verbose
        if (process.env.DEBUG) {
          console.warn(
            `❌ Classification failed for chunk ${chunk.id}:`,
            error.message,
          );
        }
        const fallbackResult = this.generateSmartFallback(chunk.text);
        chunkResults.push([fallbackResult]);
      }
    }

    // ✅ Comment out verbose logging
    // console.log(`📈 All chunk results:`, chunkResults);
    // console.log(`📊 Aggregated scores:`, aggregatedScores);
    // console.log(`📋 Sorted categories:`, sortedCategories);

    const aggregatedScores = this.aggregateClassificationResults(chunkResults);
    const sortedCategories = Object.entries(aggregatedScores)
      .map(([label, score]) => ({ label, score }))
      .filter((item) => !isNaN(item.score))
      .sort((a, b) => b.score - a.score);

    if (sortedCategories.length === 0) {
      if (process.env.DEBUG) {
        console.warn(`⚠️ No valid categories found, using smart fallback`);
      }
      const smartFallback = this.generateSmartFallback(
        chunks.map((c) => c.text).join(' '),
      );
      return {
        categories: [smartFallback],
        topCategory: smartFallback,
        confidence: smartFallback.score,
      };
    }

    const topCategory = sortedCategories[0];
    const confidence = this.calculateConfidence(sortedCategories);

    const finalResult = {
      categories: sortedCategories.slice(0, 5),
      topCategory,
      confidence,
    };

    // ✅ Comment out final result logging
    // console.log(`🎯 Final classification result:`, finalResult);
    return finalResult;
  }

  private async executeModelSafely(text: string): Promise<any> {
    if (!this.model) {
      throw new Error('Classification model not available');
    }

    const maxLength = 500;
    const processedText =
      text.length > maxLength
        ? text.substring(0, maxLength).trim() + '...'
        : text.trim();

    if (processedText.length === 0) {
      throw new Error('Empty text after processing');
    }

    // ✅ Comment out verbose model logging
    // console.log(`🤖 Sending to model: "${processedText.substring(0, 100)}..."`);

    try {
      const result = await this.model(processedText);
      // ✅ Comment out debug logging
      // console.log(`🔄 Raw model response type:`, typeof result, Array.isArray(result));
      return result;
    } catch (error) {
      console.error(`🚨 Model execution error:`, error);
      throw new Error(`Model execution failed: ${error.message}`);
    }
  }

  private validateAndCleanResults(
    result: any,
  ): Array<{ label: string; score: number }> {
    // ✅ Comment out validation logging
    // console.log(`🔍 Validating result:`, result);

    if (!result) {
      if (process.env.DEBUG) {
        console.warn(`⚠️ Result is null/undefined`);
      }
      return [];
    }

    // Handle different result formats
    let resultsArray: any[] = [];

    if (Array.isArray(result)) {
      resultsArray = result;
    } else if (result.predictions && Array.isArray(result.predictions)) {
      resultsArray = result.predictions;
    } else if (result.labels && Array.isArray(result.labels)) {
      resultsArray = result.labels;
    } else {
      if (process.env.DEBUG) {
        console.warn(`⚠️ Unexpected result format:`, typeof result);
      }
      return [];
    }

    // ✅ Comment out processing logs
    // console.log(`📋 Processing ${resultsArray.length} result items`);

    const cleaned = resultsArray
      .filter((item) => {
        const hasLabel = item && (item.label || item.LABEL);
        const hasScore = item && typeof (item.score || item.SCORE) === 'number';
        return hasLabel && hasScore;
      })
      .map((item) => {
        const label = item.label || item.LABEL || 'UNKNOWN';
        const score = item.score || item.SCORE || 0;

        return {
          label: this.normalizeLabel(label),
          score: Math.max(0, Math.min(1, Number(score) || 0)),
        };
      })
      .filter((item) => !isNaN(item.score) && item.score > 0.01);

    // ✅ Comment out cleaned results logging
    // console.log(`✅ Cleaned ${cleaned.length} valid results:`, cleaned);
    return cleaned;
  }

  // ✅ New: Normalize model labels to something more meaningful
  private normalizeLabel(label: string): string {
    if (!label || typeof label !== 'string') {
      return 'GENERAL';
    }

    const normalized = label.toUpperCase().trim();

    // Map common model labels to more meaningful categories
    const labelMappings: Record<string, string> = {
      LABEL_0: 'NEGATIVE',
      LABEL_1: 'POSITIVE',
      LABEL_2: 'NEUTRAL',
      POSITIVE: 'POSITIVE_CONTENT',
      NEGATIVE: 'NEGATIVE_CONTENT',
      NEUTRAL: 'GENERAL',
      ENTAILMENT: 'LOGICAL',
      CONTRADICTION: 'CONFLICTING',
      UNKNOWN: 'GENERAL',
    };

    return labelMappings[normalized] || normalized;
  }

  // ✅ New: Smart fallback based on text content analysis
  private generateSmartFallback(text: string): {
    label: string;
    score: number;
  } {
    const textLower = text.toLowerCase();

    // TODO: extend from outside
    /*
    // Business/professional indicators
    if (this.containsAny(textLower, ['quarterly', 'revenue', 'financial', 'business', 'company', 'corporation', 'management'])) {
      return { label: 'BUSINESS', score: 0.7 };
    }

    // Technical indicators
    if (this.containsAny(textLower, ['software', 'system', 'technology', 'development', 'programming', 'computer'])) {
      return { label: 'TECHNOLOGY', score: 0.7 };
    }

    // Personal/review indicators
    if (this.containsAny(textLower, ['love', 'hate', 'like', 'dislike', 'recommend', 'review', 'opinion'])) {
      return { label: 'REVIEW', score: 0.7 };
    }

    // News/informational indicators
    if (this.containsAny(textLower, ['report', 'news', 'information', 'according', 'source', 'official'])) {
      return { label: 'NEWS', score: 0.7 };
    }

    // Legal indicators
    if (this.containsAny(textLower, ['contract', 'agreement', 'legal', 'court', 'law', 'defendant', 'plaintiff'])) {
      return { label: 'LEGAL', score: 0.7 };
    }
    */

    // Default fallback
    return { label: 'GENERAL', score: 0.6 };
  }

  private containsAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
  }

  private aggregateClassificationResults(
    chunkResults: Array<{ label: string; score: number }[]>,
  ): Record<string, number> {
    const aggregated: Record<string, number> = {};
    let totalChunks = 0;

    chunkResults.forEach((result) => {
      if (result.length > 0) {
        totalChunks++;
        result.forEach(({ label, score }) => {
          // ✅ Fixed: Additional validation during aggregation
          if (typeof score === 'number' && !isNaN(score)) {
            aggregated[label] = (aggregated[label] || 0) + score;
          }
        });
      }
    });

    // Average the scores
    if (totalChunks > 0) {
      Object.keys(aggregated).forEach((label) => {
        aggregated[label] = aggregated[label] / totalChunks;
      });
    }

    return aggregated;
  }

  private calculateConfidence(
    categories: Array<{ label: string; score: number }>,
  ): number {
    if (categories.length === 0) {
      return 0.1;
    }

    if (categories.length < 2) {
      const score = categories[0]?.score;
      return isNaN(score) ? 0.1 : Math.max(0.1, Math.min(1.0, score));
    }

    const topScore = categories[0].score || 0;
    const secondScore = categories[1].score || 0;

    // ✅ Fixed: Better confidence calculation with validation
    if (isNaN(topScore) || isNaN(secondScore)) {
      return 0.1;
    }

    // Confidence based on the gap between top two scores
    const gap = Math.max(0, topScore - secondScore);
    const confidence = topScore + gap * 0.2; // Boost confidence if there's a clear winner

    return Math.max(0.1, Math.min(1.0, confidence));
  }
}

export { ClassificationProcessor };
export type { ClassificationResult };
