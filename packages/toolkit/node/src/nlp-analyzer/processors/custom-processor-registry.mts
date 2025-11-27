import { Pipeline } from '@huggingface/transformers';

import { TaskProcessor } from '../managers/model-manager.mjs';
import { AnalysisTask } from '../types.mjs';

interface ProcessorDefinition {
  name: string;
  task: AnalysisTask | string;
  description: string;
  requiresModel: boolean;
  defaultModelId?: string;
  defaultTaskType?: string;
  processorClass: new (model?: Pipeline, config?: any) => TaskProcessor;
}

class CustomProcessorRegistry {
  private static instance: CustomProcessorRegistry;
  private processors = new Map<string, ProcessorDefinition>();

  private constructor() {}

  static getInstance(): CustomProcessorRegistry {
    if (!CustomProcessorRegistry.instance) {
      CustomProcessorRegistry.instance = new CustomProcessorRegistry();
    }
    return CustomProcessorRegistry.instance;
  }

  /**
   * Register a custom processor
   */
  register(definition: ProcessorDefinition): void {
    this.processors.set(definition.name, definition);
    console.log(`📋 Registered custom processor: ${definition.name}`);
  }

  /**
   * Get processor definition by name
   */
  get(name: string): ProcessorDefinition | undefined {
    return this.processors.get(name);
  }

  /**
   * Check if processor is registered
   */
  has(name: string): boolean {
    return this.processors.has(name);
  }

  /**
   * List all registered processors
   */
  list(): ProcessorDefinition[] {
    return Array.from(this.processors.values());
  }

  /**
   * Create processor instance
   */
  createProcessor(
    name: string,
    model?: Pipeline,
    config?: any,
  ): TaskProcessor | undefined {
    const definition = this.processors.get(name);
    if (!definition) {
      console.warn(`Processor definition not found for: ${name}`);
      return undefined;
    }

    try {
      // Validate that processorClass is a constructor
      if (typeof definition.processorClass !== 'function') {
        throw new Error(
          `processorClass for ${name} is not a constructor function`,
        );
      }

      // Check if model is required but not provided
      if (definition.requiresModel && !model) {
        throw new Error(
          `Model required for processor ${name} but not provided`,
        );
      }

      return new definition.processorClass(model, config);
    } catch (error) {
      console.error(`Failed to create processor ${name}:`, error);
      throw error;
    }
  }

  /**
   * Remove processor from registry
   */
  unregister(name: string): boolean {
    return this.processors.delete(name);
  }
}

export { CustomProcessorRegistry };
export type { ProcessorDefinition };
