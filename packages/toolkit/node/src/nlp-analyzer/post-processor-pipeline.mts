import { EventEmitter } from 'events';

import {
  AnalysisConfig,
  AnalysisResult,
  PostProcessingContext,
  PostProcessor,
  TextMetadata,
} from './types.mjs';

interface PostProcessorExecutionResult {
  success: boolean;
  result?: AnalysisResult;
  error?: Error;
  processorIndex: number;
  executionTime: number;
}

class PostProcessorPipeline extends EventEmitter {
  private processors: PostProcessor[] = [];

  constructor(processors: PostProcessor[] = []) {
    super();
    this.processors = [...processors];
  }

  /**
   * Add a post-processor to the pipeline
   */
  addProcessor(processor: PostProcessor): void {
    this.processors.push(processor);
  }

  /**
   * Remove a post-processor at the specified index
   */
  removeProcessor(index: number): boolean {
    if (index >= 0 && index < this.processors.length) {
      this.processors.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all post-processors
   */
  clearProcessors(): void {
    this.processors = [];
  }

  /**
   * Get the number of registered processors
   */
  getProcessorCount(): number {
    return this.processors.length;
  }

  /**
   * Execute all post-processors in sequence
   */
  async execute(
    initialResult: AnalysisResult,
    document: { content: string; metadata: TextMetadata },
    config: AnalysisConfig,
    context: PostProcessingContext = {},
  ): Promise<AnalysisResult> {
    if (this.processors.length === 0) {
      return initialResult;
    }

    let currentResult = initialResult;
    const pipelineStartTime = Date.now();

    this.emit('pipeline-start', {
      processorCount: this.processors.length,
      documentId: document.metadata.id,
      context,
    });

    for (let i = 0; i < this.processors.length; i++) {
      const processor = this.processors[i];
      const startTime = Date.now();

      try {
        this.emit('processor-start', {
          processorIndex: i,
          documentId: document.metadata.id,
          context,
        });

        // Execute processor (handle both sync and async)
        const processedResult = await Promise.resolve(
          processor(currentResult, document, config),
        );

        const executionTime = Date.now() - startTime;

        // Validate result structure
        if (!this.isValidAnalysisResult(processedResult)) {
          throw new Error(`Post-processor ${i} returned invalid result format`);
        }

        currentResult = processedResult;

        const executionResult: PostProcessorExecutionResult = {
          success: true,
          result: currentResult,
          processorIndex: i,
          executionTime,
        };

        this.emit('processor-complete', executionResult);
      } catch (error: Error | any) {
        const executionTime = Date.now() - startTime;
        const executionResult: PostProcessorExecutionResult = {
          success: false,
          error,
          processorIndex: i,
          executionTime,
        };

        this.emit('processor-error', executionResult);

        // Decide whether to continue or fail the pipeline
        if (this.shouldContinueOnError(error, i, config)) {
          console.warn(
            `Post-processor ${i} failed, continuing with previous result:`,
            error.message,
          );
          continue; // Continue with current result
        } else {
          // Fail the entire pipeline
          this.emit('pipeline-error', {
            error,
            failedProcessorIndex: i,
            totalTime: Date.now() - pipelineStartTime,
          });
          throw new Error(
            `Post-processing pipeline failed at processor ${i}: ${error.message}`,
          );
        }
      }
    }

    const totalTime = Date.now() - pipelineStartTime;

    this.emit('pipeline-complete', {
      totalTime,
      documentId: document.metadata.id,
      processorsExecuted: this.processors.length,
      context,
    });

    // Update processing time to include post-processing
    if (currentResult.metadata) {
      currentResult.metadata.processingTime += totalTime;
      currentResult.metadata.postProcessingTime = totalTime;
    }

    return currentResult;
  }

  /**
   * Execute processors in batch mode for multiple documents
   */
  async executeBatch(
    results: AnalysisResult[],
    documents: Array<{ content: string; metadata: TextMetadata }>,
    config: AnalysisConfig,
  ): Promise<AnalysisResult[]> {
    if (this.processors.length === 0) {
      return results;
    }

    const processedResults: AnalysisResult[] = [];
    const batchStartTime = Date.now();

    this.emit('batch-start', {
      documentCount: documents.length,
      processorCount: this.processors.length,
    });

    for (let i = 0; i < results.length; i++) {
      const context: PostProcessingContext = {
        documentIndex: i,
        batchSize: documents.length,
        totalDocuments: documents.length,
        processingStartTime: batchStartTime,
      };

      try {
        const processedResult = await this.execute(
          results[i],
          documents[i],
          config,
          context,
        );
        processedResults.push(processedResult);
      } catch (error) {
        console.error(`Batch post-processing failed for document ${i}:`, error);
        // Add original result without post-processing
        processedResults.push(results[i]);
      }
    }

    this.emit('batch-complete', {
      totalTime: Date.now() - batchStartTime,
      documentsProcessed: processedResults.length,
    });

    return processedResults;
  }

  /**
   * Validate that the result has the correct structure
   */
  private isValidAnalysisResult(result: any): result is AnalysisResult {
    return (
      result &&
      typeof result === 'object' &&
      typeof result.documentId === 'string' &&
      result.tasks &&
      typeof result.tasks === 'object' &&
      result.metadata &&
      typeof result.metadata === 'object' &&
      typeof result.metadata.processingTime === 'number'
    );
  }

  /**
   * Determine if pipeline should continue after an error
   */
  private shouldContinueOnError(
    error: Error,
    processorIndex: number,
    config: AnalysisConfig,
  ): boolean {
    // Continue on non-critical errors
    const nonCriticalErrors = [
      'timeout',
      'network',
      'temporary',
      'cache',
      'enhancement',
    ];

    const errorMessage = error.message.toLowerCase();
    return nonCriticalErrors.some((keyword) => errorMessage.includes(keyword));
  }

  /**
   * Get pipeline statistics
   */
  getStats(): {
    processorCount: number;
    processors: Array<{ index: number; name: string }>;
  } {
    return {
      processorCount: this.processors.length,
      processors: this.processors.map((processor, index) => ({
        index,
        name: processor.name || `Processor-${index}`,
      })),
    };
  }
}

export { PostProcessorPipeline };
export type { PostProcessorExecutionResult };
