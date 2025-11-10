import { Pipeline } from '@huggingface/transformers';

import { AnalysisTask, ModelConfig } from '../types.ts';
import { TaskProcessor } from './base-processor.ts';
import { ClassificationProcessor } from './classification-processor.ts';
import { CustomProcessorRegistry } from './custom-processor-registry.ts';
import { EntityProcessor } from './entity-processor.ts';
import { KeywordsProcessor } from './keywords-processor.ts';
import { SentimentProcessor } from './sentiment-processor.ts';
import { SummaryProcessor } from './summary-processor.ts';

class ProcessorFactory {
  private customRegistry = CustomProcessorRegistry.getInstance();

  createProcessor(
    task: AnalysisTask,
    model?: Pipeline,
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
    model?: Pipeline,
    config?: ModelConfig,
  ): TaskProcessor {
    if (!model && this.requiresModel(task)) {
      throw new Error(`Model required for task: ${task}`);
    }

    switch (task) {
      case 'sentiment':
        return new SentimentProcessor(model!);
      case 'entities':
        return new EntityProcessor(model!);
      case 'classification':
        return new ClassificationProcessor(model!);
      case 'summary':
        return new SummaryProcessor(model!);
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
