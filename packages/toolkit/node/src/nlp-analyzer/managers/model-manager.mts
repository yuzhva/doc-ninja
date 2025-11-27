import { Pipeline, pipeline } from '@huggingface/transformers';

import { ClassificationProcessor } from '../processors/classification-processor.mjs';
import { CustomProcessorRegistry } from '../processors/custom-processor-registry.mjs';
import { EntityProcessor } from '../processors/entity-processor.mjs';
import { KeywordsProcessor } from '../processors/keywords-processor.mjs';
import { SentimentProcessor } from '../processors/sentiment-processor.mjs';
import { SummaryProcessor } from '../processors/summary-processor.mjs';
import { AnalysisTask, ModelConfig } from '../types.mjs';

interface TaskProcessor {
  process(chunks: any[], config: any): Promise<any>;
}

class ModelManager {
  private loadedModels = new Map<string, Pipeline>();
  private processors = new Map<AnalysisTask, TaskProcessor>();
  private modelVersions = new Map<string, string>();
  private modelsPath?: string;

  // Default local model configurations
  private defaultModels = {
    sentiment: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    entities: 'Xenova/bert-base-NER',
    classification: 'Xenova/distilbert-base-uncased',
    summary: 'Xenova/distilbart-cnn-6-6',
    'language-detection': 'Xenova/lang-detector',
  };

  private customProcessorRegistry = CustomProcessorRegistry.getInstance();

  constructor(modelsPath?: string) {
    this.modelsPath = modelsPath;

    // Set local models path to avoid internet requests
    if (modelsPath) {
      process.env.HF_HOME = modelsPath;
    }
  }

  async loadModels(tasks: AnalysisTask[], config?: ModelConfig): Promise<void> {
    for (const task of tasks) {
      await this.loadModel(task, config);
    }
  }

  private async loadModel(
    task: AnalysisTask,
    config?: ModelConfig,
  ): Promise<void> {
    if (this.processors.has(task)) {
      return; // Already loaded
    }

    // Check if this is a custom processor that doesn't need a model
    if (this.customProcessorRegistry.has(task)) {
      const definition = this.customProcessorRegistry.get(task);
      if (definition && !definition.requiresModel) {
        // Create processor without model
        this.createProcessor(task, undefined as any);
        return;
      }
    }

    try {
      let modelName: string;
      let pipelineTask: string;

      // Handle custom processors with models
      if (this.customProcessorRegistry.has(task)) {
        const definition = this.customProcessorRegistry.get(task);
        if (definition?.defaultModelId && definition?.defaultTaskType) {
          modelName = definition.defaultModelId;
          pipelineTask = definition.defaultTaskType;
        } else {
          throw new Error(`Custom task ${task} missing model configuration`);
        }
      } else {
        // Handle built-in tasks
        switch (task) {
          case 'sentiment':
            modelName = config?.sentimentModel || this.defaultModels.sentiment;
            pipelineTask = 'sentiment-analysis';
            break;
          case 'entities':
            modelName = config?.entityModel || this.defaultModels.entities;
            pipelineTask = 'token-classification';
            break;
          case 'classification':
            modelName =
              config?.classificationModel || this.defaultModels.classification;
            pipelineTask = 'text-classification';
            break;
          case 'summary':
            modelName = config?.summaryModel || this.defaultModels.summary;
            pipelineTask = 'summarization';
            break;
          case 'language-detection':
            modelName = this.defaultModels['language-detection'];
            pipelineTask = 'text-classification';
            break;
          default:
            throw new Error(`Unsupported task: ${task}`);
        }
      }

      // ✅ Comment out verbose loading messages
      if (process.env.DEBUG) {
        console.log(`🔒 Loading model ${modelName} from local cache (OFFLINE)`);
      }

      // Load model pipeline with STRICT local-only settings
      const model = await pipeline(pipelineTask, modelName, {
        local_files_only: true, // 🔒 CRITICAL: NEVER download during analysis
        device: config?.device || 'cpu',
        quantized: config?.quantized !== false,
        cache_dir: process.env.TRANSFORMERS_CACHE, // Use local cache only
      });

      this.loadedModels.set(task, model);
      this.modelVersions.set(task, modelName);

      // Create task processor
      this.createProcessor(task, model);

      // ✅ Only log model loading in debug mode
      if (process.env.DEBUG) {
        console.log(`✅ Model ${modelName} loaded from local cache`);
      }
    } catch (error) {
      console.error(`Failed to load model for task ${task}:`, error);

      if ((error as Error).message.includes('local_files_only')) {
        throw new Error(
          `Model not found locally for ${task}. Please install models first:\n` +
            `  pnpm run install-models:default\n` +
            `Original error: ${(error as Error).message}`,
        );
      }

      throw new Error(
        `Model loading failed for ${task}: ${(error as Error).message}`,
      );
    }
  }

  private createProcessor(task: AnalysisTask, model?: Pipeline): void {
    let processor: TaskProcessor;

    // Check for custom processors first
    if (this.customProcessorRegistry.has(task)) {
      try {
        const customProcessor = this.customProcessorRegistry.createProcessor(
          task,
          model,
        );
        if (customProcessor) {
          this.processors.set(task, customProcessor);
          return;
        }
      } catch (error) {
        console.error(`Failed to create custom processor for ${task}:`, error);
        throw new Error(
          `Custom processor creation failed for ${task}: ${error.message}`,
        );
      }
    }

    // Ensure we have a model for built-in processors
    if (!model) {
      throw new Error(`Model required for built-in task: ${task}`);
    }

    // Fallback to built-in processors
    switch (task) {
      case 'sentiment':
        processor = new SentimentProcessor(model);
        break;
      case 'entities':
        processor = new EntityProcessor(model);
        break;
      case 'classification':
        processor = new ClassificationProcessor(model);
        break;
      case 'summary':
        processor = new SummaryProcessor(model);
        break;
      case 'keywords':
        processor = new KeywordsProcessor();
        break;
      case 'readability':
        processor = new KeywordsProcessor(); // Can reuse for readability metrics
        break;
      default:
        throw new Error(`No processor implementation for task: ${task}`);
    }

    this.processors.set(task, processor);
  }

  /**
   * Register a custom processor
   */
  registerCustomProcessor(
    taskName: string,
    processorClass: new (model?: Pipeline, config?: any) => TaskProcessor,
    options: {
      description?: string;
      requiresModel?: boolean;
      defaultModelId?: string;
      defaultTaskType?: string;
    } = {},
  ): void {
    this.customProcessorRegistry.register({
      name: taskName,
      task: taskName as AnalysisTask,
      description: options.description || `Custom processor for ${taskName}`,
      requiresModel: options.requiresModel ?? true,
      defaultModelId: options.defaultModelId,
      defaultTaskType: options.defaultTaskType || 'text-classification',
      processorClass,
    });
  }

  /**
   * Get list of available processors (built-in + custom)
   */
  getAvailableProcessors(): string[] {
    const builtIn = [
      'sentiment',
      'entities',
      'classification',
      'summary',
      'keywords',
      'readability',
    ];
    const custom = this.customProcessorRegistry.list().map((p) => p.name);
    return [...builtIn, ...custom];
  }

  getProcessor(task: AnalysisTask): TaskProcessor | undefined {
    return this.processors.get(task);
  }

  getLoadedModelVersions(): Record<string, string> {
    const versions: Record<string, string> = {};
    this.modelVersions.forEach((version, task) => {
      versions[task] = version;
    });
    return versions;
  }

  /**
   * Get the custom processor registry (for internal use by analyzer)
   */
  getCustomProcessorRegistry():
    | typeof CustomProcessorRegistry.prototype
    | undefined {
    return this.customProcessorRegistry;
  }

  async dispose(): Promise<void> {
    // Dispose of loaded models and processors
    this.loadedModels.clear();
    this.processors.clear();
    this.modelVersions.clear();
  }
}

export { ModelManager };
export type { TaskProcessor };
