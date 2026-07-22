import type {
  SummarizationPipeline,
  TextClassificationPipeline,
  TokenClassificationPipeline,
} from '@huggingface/transformers';

import { AnalysisTask, LoadedPipeline, ModelConfig } from '../types.mjs';
import { TaskProcessor } from './base-processor.mjs';
import { ClassificationProcessor } from './classification-processor.mjs';
import { CustomProcessorRegistry } from './custom-processor-registry.mjs';
import { EntityProcessor } from './entity-processor.mjs';
import { KeywordsProcessor } from './keywords-processor.mjs';
import { SentimentProcessor } from './sentiment-processor.mjs';
import { SummaryProcessor } from './summary-processor.mjs';

class ProcessorFactory {
  private customRegistry = CustomProcessorRegistry.getInstance();

  createProcessor(
    task: AnalysisTask,
    model?: LoadedPipeline,
    config?: ModelConfig,
  ): TaskProcessor {
    // Try custom processors first
    if (this.customRegistry.has(task)) {
      const processor = this.customRegistry.createProcessor(
        task,
        model,
        config,
      );
      if (processor) {
        return processor;
      }
    }

    // Fallback to built-in processors
    return this.createBuiltInProcessor(task, model, config);
  }

  private createBuiltInProcessor(
    task: AnalysisTask,
    model?: LoadedPipeline,
    config?: ModelConfig,
  ): TaskProcessor {
    if (!model && this.requiresModel(task)) {
      throw new Error(`Model required for task: ${task}`);
    }

    // Each built-in task loads a specific, statically-known pipeline type
    // (see ModelManager.loadModel), so the loosely-typed `model` here is
    // narrowed to the concrete class each processor actually expects.
    switch (task) {
      case 'sentiment':
        return new SentimentProcessor(model! as TextClassificationPipeline);
      case 'entities':
        return new EntityProcessor(model! as TokenClassificationPipeline);
      case 'classification':
        return new ClassificationProcessor(
          model! as TextClassificationPipeline,
        );
      case 'summary':
        return new SummaryProcessor(model! as SummarizationPipeline);
      case 'keywords':
        return new KeywordsProcessor();
      case 'readability':
        return new KeywordsProcessor(); // Reuse for readability metrics
      default:
        throw new Error(`Unknown task: ${task}`);
    }
  }

  private requiresModel(task: AnalysisTask): boolean {
    const modelRequiredTasks = [
      'sentiment',
      'entities',
      'classification',
      'summary',
    ];
    return modelRequiredTasks.includes(task);
  }

  getSupportedTasks(): string[] {
    const builtInTasks = [
      'sentiment',
      'entities',
      'classification',
      'summary',
      'keywords',
      'readability',
    ];
    const customTasks = this.customRegistry.list().map((p) => p.name);
    return [...builtInTasks, ...customTasks];
  }
}

export { ProcessorFactory };
