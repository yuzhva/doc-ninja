import type { SummarizationPipeline } from '@huggingface/transformers';

import { TaskProcessor } from '../managers/model-manager.mjs';
import { AnalysisConfig, DocumentChunk } from '../types.mjs';

interface SummaryResult {
  summary: string;
  originalLength: number;
  summaryLength: number;
  compressionRatio: number;
  chunkSummaries?: Array<{
    chunkId: string;
    summary: string;
  }>;
}

class SummaryProcessor implements TaskProcessor {
  private model: SummarizationPipeline;

  constructor(model: SummarizationPipeline) {
    this.model = model;
  }

  async process(
    chunks: DocumentChunk[],
    config: AnalysisConfig,
  ): Promise<SummaryResult> {
    const maxLength = 512; // Most summarization models have token limits
    const chunkSummaries: Array<{ chunkId: string; summary: string }> = [];

    // Combine all chunks into full text
    const fullText = chunks.map((chunk) => chunk.text).join(' ');
    const originalLength = fullText.length;

    try {
      let finalSummary: string;

      if (fullText.length <= maxLength) {
        // Text is short enough to summarize directly
        const result = (await this.model(fullText)) as Array<{
          summary_text: string;
        }>;
        finalSummary = result[0]?.summary_text || 'Unable to generate summary';
      } else {
        // Process each chunk separately then combine
        for (const chunk of chunks) {
          try {
            const result = (await this.model(chunk.text)) as Array<{
              summary_text: string;
            }>;
            const chunkSummary = result[0]?.summary_text || '';

            if (chunkSummary) {
              chunkSummaries.push({
                chunkId: chunk.id,
                summary: chunkSummary,
              });
            }
          } catch (error) {
            console.warn(`Summary failed for chunk ${chunk.id}:`, error);
          }
        }

        // Combine chunk summaries
        const combinedSummaries = chunkSummaries
          .map((cs) => cs.summary)
          .join(' ');

        if (combinedSummaries.length <= maxLength) {
          // Summarize the combined summaries
          const result = (await this.model(combinedSummaries)) as Array<{
            summary_text: string;
          }>;
          finalSummary = result[0]?.summary_text || combinedSummaries;
        } else {
          // If still too long, truncate and summarize
          const truncated = combinedSummaries.substring(0, maxLength);
          const result = (await this.model(truncated)) as Array<{
            summary_text: string;
          }>;
          finalSummary = result[0]?.summary_text || truncated;
        }
      }

      return {
        summary: finalSummary,
        originalLength,
        summaryLength: finalSummary.length,
        compressionRatio:
          originalLength > 0 ? finalSummary.length / originalLength : 0,
        chunkSummaries: chunkSummaries.length > 0 ? chunkSummaries : undefined,
      };
    } catch (error) {
      console.warn('Summary generation failed:', error);

      // Fallback: extract first few sentences as summary
      const sentences = fullText
        .split(/[.!?]+/)
        .filter((s) => s.trim().length > 0);
      const fallbackSummary = sentences.slice(0, 3).join('. ') + '.';

      return {
        summary: fallbackSummary,
        originalLength,
        summaryLength: fallbackSummary.length,
        compressionRatio:
          originalLength > 0 ? fallbackSummary.length / originalLength : 0,
      };
    }
  }
}

export { SummaryProcessor };
export type { SummaryResult };
