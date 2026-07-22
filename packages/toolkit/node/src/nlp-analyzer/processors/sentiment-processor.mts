import type { TextClassificationPipeline } from '@huggingface/transformers';

import { TaskProcessor } from '../managers/model-manager.mjs';
import { AnalysisConfig, DocumentChunk, SentimentResult } from '../types.mjs';

class SentimentProcessor implements TaskProcessor {
  private model: TextClassificationPipeline;

  constructor(model: TextClassificationPipeline) {
    this.model = model;
  }

  async process(
    chunks: DocumentChunk[],
    config: AnalysisConfig,
  ): Promise<SentimentResult> {
    const chunkResults: Array<{
      text: string;
      sentiment: 'positive' | 'negative' | 'neutral';
      score: number;
    }> = [];
    let totalPositive = 0;
    let totalNegative = 0;
    let totalNeutral = 0;

    // Process each chunk
    for (const chunk of chunks) {
      try {
        const result = (await this.model(chunk.text)) as Array<{
          label: string;
          score: number;
        }>;

        // Handle different model output formats
        const sentiment = this.normalizeSentimentLabel(
          result[0]?.label || 'NEUTRAL',
        );
        const score = result[0]?.score || 0.5;

        chunkResults.push({
          text:
            chunk.text.substring(0, 100) +
            (chunk.text.length > 100 ? '...' : ''),
          sentiment,
          score,
        });

        // Accumulate scores for overall sentiment
        switch (sentiment) {
          case 'positive':
            totalPositive += score;
            break;
          case 'negative':
            totalNegative += score;
            break;
          default:
            totalNeutral += score;
        }
      } catch (error) {
        console.warn(`Sentiment analysis failed for chunk ${chunk.id}:`, error);
        chunkResults.push({
          text: chunk.text.substring(0, 100) + '...',
          sentiment: 'neutral',
          score: 0.5,
        });
        totalNeutral += 0.5;
      }
    }

    // Calculate overall sentiment
    const overall = this.calculateOverallSentiment(
      totalPositive,
      totalNegative,
      totalNeutral,
    );

    return {
      overall,
      chunks: chunkResults,
    };
  }

  private normalizeSentimentLabel(
    label: string,
  ): 'positive' | 'negative' | 'neutral' {
    const normalizedLabel = label.toLowerCase();

    if (normalizedLabel.includes('pos') || normalizedLabel === 'label_1') {
      return 'positive';
    } else if (
      normalizedLabel.includes('neg') ||
      normalizedLabel === 'label_0'
    ) {
      return 'negative';
    }

    return 'neutral';
  }

  private calculateOverallSentiment(
    positive: number,
    negative: number,
    neutral: number,
  ): {
    label: 'positive' | 'negative' | 'neutral';
    score: number;
  } {
    const total = positive + negative + neutral;

    if (total === 0) {
      return { label: 'neutral', score: 0.5 };
    }

    const posPercent = positive / total;
    const negPercent = negative / total;
    const neutPercent = neutral / total;

    if (posPercent > negPercent && posPercent > neutPercent) {
      return { label: 'positive', score: posPercent };
    } else if (negPercent > posPercent && negPercent > neutPercent) {
      return { label: 'negative', score: negPercent };
    }

    return { label: 'neutral', score: neutPercent };
  }
}

export { SentimentProcessor };
