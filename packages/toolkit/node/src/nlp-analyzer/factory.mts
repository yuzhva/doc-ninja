import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { NLPAnalyzer } from './analyzer.mjs';
import {
  AdaptiveTextAnalyzer,
  ModelConfig,
  PostProcessor,
  WorkflowCallbacks,
} from './types.mjs';
import { PerformanceOptimizer } from './utils/performance-optimizer.mjs';

interface AnalyzerOptions {
  maxWorkers?: number;
  cacheEnabled?: boolean;
  modelsPath?: string;
  useWorkers?: boolean;
  enableMonitoring?: boolean;
  enableRetries?: boolean;
  defaultModelConfig?: ModelConfig;
  postProcessors?: PostProcessor[];
  workflowCallbacks?: WorkflowCallbacks;
  enableAdaptiveLearning?: boolean;
}

// ✅ Add default models path
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODELS_PATH = path.resolve(__dirname, '../../../models');

function createNLPAnalyzer(
  options: AnalyzerOptions = {},
): AdaptiveTextAnalyzer {
  // Auto-optimize configuration based on system resources
  const optimizer = PerformanceOptimizer.getInstance();
  const systemInfo = {
    cpuCores: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    documentCount: 100, // Default estimate
    avgDocumentSizeMB: 0.1, // 100KB default
  };

  const optimizations = optimizer.suggestOptimizations(systemInfo);

  // Apply optimizations if not explicitly set
  const finalOptions = {
    maxWorkers: optimizations.maxWorkers,
    useWorkers: optimizations.useWorkers,
    cacheEnabled: optimizations.cacheEnabled,
    modelsPath: DEFAULT_MODELS_PATH,
    ...options, // User options override optimizations (including modelsPath)
  };

  // ✅ Comment out verbose optimization logs
  // if (optimizations.recommendations.length > 0) {
  //   console.log('💡 Performance Recommendations:');
  //   optimizations.recommendations.forEach((rec) => console.log(`   - ${rec}`));
  // }

  // ✅ Reduce logging - only log models path in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`📁 Using models path: ${finalOptions.modelsPath}`);
  }

  // ✅ Use the existing NLPAnalyzer
  return new NLPAnalyzer(
    finalOptions.maxWorkers || 4,
    finalOptions.cacheEnabled !== false,
    finalOptions.modelsPath,
    finalOptions.useWorkers || false,
    finalOptions.enableMonitoring !== false,
    finalOptions.enableRetries !== false,
    finalOptions.postProcessors || [],
    finalOptions.workflowCallbacks || {},
    finalOptions.enableAdaptiveLearning !== false,
  ) as AdaptiveTextAnalyzer;
}

interface PerformancePreset {
  name: 'high-performance' | 'balanced' | 'feature-complete' | 'minimal';
  description: string;
  options: AnalyzerOptions;
}

const PERFORMANCE_PRESETS: Record<string, PerformancePreset> = {
  'high-performance': {
    name: 'high-performance',
    description: 'Maximum speed, minimal features',
    options: {
      maxWorkers: 1,
      cacheEnabled: true,
      useWorkers: false,
      enableMonitoring: false,
      enableRetries: false,
      enableAdaptiveLearning: false,
      postProcessors: [],
    },
  },

  balanced: {
    name: 'balanced',
    description: 'Good performance with essential features',
    options: {
      maxWorkers: 2,
      cacheEnabled: true,
      useWorkers: false,
      enableMonitoring: true,
      enableRetries: true,
      enableAdaptiveLearning: false,
      postProcessors: [],
    },
  },

  'feature-complete': {
    name: 'feature-complete',
    description: 'All features enabled (current default)',
    options: {
      maxWorkers: 4,
      cacheEnabled: true,
      useWorkers: false,
      enableMonitoring: true,
      enableRetries: true,
      enableAdaptiveLearning: true,
      postProcessors: [],
    },
  },
};

function createOptimizedAnalyzer(
  preset: keyof typeof PERFORMANCE_PRESETS = 'balanced',
  overrides: Partial<AnalyzerOptions> = {},
): AdaptiveTextAnalyzer {
  const presetOptions = PERFORMANCE_PRESETS[preset].options;
  const finalOptions = { ...presetOptions, ...overrides };

  console.log(`🚀 Creating ${preset} analyzer preset`);
  console.log(
    `📊 Features: monitoring=${finalOptions.enableMonitoring}, learning=${finalOptions.enableAdaptiveLearning}`,
  );

  return createNLPAnalyzer(finalOptions);
}

export {
  createNLPAnalyzer,
  createOptimizedAnalyzer,
  PERFORMANCE_PRESETS,
  DEFAULT_MODELS_PATH,
};
export type { AnalyzerOptions, PerformancePreset };
