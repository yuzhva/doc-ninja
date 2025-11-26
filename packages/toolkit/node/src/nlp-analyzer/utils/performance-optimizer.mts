import * as v8 from 'v8';

class PerformanceOptimizer {
  private static instance: PerformanceOptimizer;

  private memoryThresholds = {
    warning: 0.8, // 80% memory usage
    critical: 0.9, // 90% memory usage
  };

  static getInstance(): PerformanceOptimizer {
    if (!PerformanceOptimizer.instance) {
      PerformanceOptimizer.instance = new PerformanceOptimizer();
    }
    return PerformanceOptimizer.instance;
  }

  /**
   * Calculate optimal batch size based on available memory
   */
  calculateOptimalBatchSize(
    documentSize: number,
    availableMemoryMB: number = 1000,
    taskComplexity: 'low' | 'medium' | 'high' = 'medium',
  ): number {
    const complexityMultipliers = { low: 1, medium: 2, high: 4 };
    const memoryPerDocument =
      (documentSize / 1024) * complexityMultipliers[taskComplexity];

    const maxBatchSize = Math.floor(availableMemoryMB / memoryPerDocument);
    return Math.max(1, Math.min(50, maxBatchSize)); // Between 1 and 50
  }

  /**
   * Calculate optimal chunk size for document processing
   */
  calculateOptimalChunkSize(
    documentLength: number,
    modelMaxTokens: number = 512,
  ): number {
    // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
    const estimatedTokens = documentLength / 4;

    if (estimatedTokens <= modelMaxTokens) {
      return documentLength; // Process as single chunk
    }

    // Calculate chunk size to fit model limits with some buffer
    const chunkSize = Math.floor(modelMaxTokens * 4 * 0.9); // 90% of limit
    return Math.max(100, Math.min(2048, chunkSize));
  }

  /**
   * Suggest configuration optimizations
   */
  suggestOptimizations(systemInfo: {
    cpuCores: number;
    memoryGB: number;
    documentCount: number;
    avgDocumentSizeMB: number;
  }): {
    maxWorkers: number;
    batchSize: number;
    useWorkers: boolean;
    cacheEnabled: boolean;
    recommendations: string[];
  } {
    const { cpuCores, memoryGB, documentCount, avgDocumentSizeMB } = systemInfo;
    const recommendations: string[] = [];

    // Calculate optimal workers
    const maxWorkers = Math.min(cpuCores, Math.floor(memoryGB / 2)); // 2GB per worker

    // Calculate batch size
    const memoryPerBatchMB = avgDocumentSizeMB * 10; // Rough processing overhead
    const batchSize = Math.max(
      1,
      Math.floor((memoryGB * 1024 * 0.5) / memoryPerBatchMB),
    );

    // Worker recommendation
    const useWorkers = cpuCores > 2 && memoryGB >= 8;
    if (!useWorkers) {
      recommendations.push(
        'Consider upgrading to 8GB+ RAM for worker thread support',
      );
    }

    // Memory recommendations
    if (memoryGB < 4) {
      recommendations.push(
        'Increase RAM to at least 4GB for better performance',
      );
    }

    if (avgDocumentSizeMB > 1) {
      recommendations.push(
        'Consider splitting large documents for better memory usage',
      );
    }

    // Batch size recommendations
    if (documentCount > 1000) {
      recommendations.push(
        'Use streaming batch processing for large document collections',
      );
    }

    return {
      maxWorkers,
      batchSize,
      useWorkers,
      cacheEnabled: true, // Always recommend caching
      recommendations,
    };
  }

  /**
   * Monitor and log performance metrics
   */
  createPerformanceMonitor() {
    const startTime = process.hrtime.bigint();
    let lastGC = process.memoryUsage();

    return {
      checkpoint: (label: string) => {
        const currentTime = process.hrtime.bigint();
        const elapsed = Number(currentTime - startTime) / 1_000_000; // Convert to ms
        const memory = process.memoryUsage();

        console.log(
          `⏱️ [${label}] ${elapsed.toFixed(2)}ms | Memory: ${(memory.heapUsed / 1024 / 1024).toFixed(1)}MB`,
        );

        if (memory.heapUsed > lastGC.heapUsed * 1.5) {
          console.log('💡 Memory usage growing rapidly - checking pressure...');
        }

        lastGC = memory;
      },

      getStats: () => ({
        elapsedMs: Number(process.hrtime.bigint() - startTime) / 1_000_000,
        memoryMB: process.memoryUsage().heapUsed / 1024 / 1024,
      }),
    };
  }

  /**
   * Memory usage utilities
   */
  checkMemoryPressure(): {
    level: 'low' | 'medium' | 'high';
    recommendation: string;
  } {
    const heapUsed = process.memoryUsage().heapUsed;
    const heapLimit = v8.getHeapStatistics().heap_size_limit;
    const usedRatio = heapUsed / heapLimit;

    if (usedRatio > this.memoryThresholds.critical) {
      return {
        level: 'high',
        recommendation: 'Reduce batch size and pause for GC',
      };
    } else if (usedRatio > this.memoryThresholds.warning) {
      return {
        level: 'medium',
        recommendation: 'Monitor memory usage and reduce batch size if needed',
      };
    }

    return {
      level: 'low',
      recommendation: 'Memory usage is healthy',
    };
  }

  /**
   * Monitors memory usage and pauses execution if heap usage is high.
   * This allows V8's garbage collector to run naturally without blocking the main thread.
   */
  async manageMemoryPressure(): Promise<void> {
    const heapUsed = process.memoryUsage().heapUsed;
    const heapLimit = v8.getHeapStatistics().heap_size_limit;
    const usageRatio = heapUsed / heapLimit;

    if (usageRatio > this.memoryThresholds.critical) {
      console.warn(
        `⚠️ Critical memory usage (${(usageRatio * 100).toFixed(1)}%). Pausing for GC...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } else if (usageRatio > this.memoryThresholds.warning) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export { PerformanceOptimizer };
