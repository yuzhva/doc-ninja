import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import * as path from 'path';

import { AdaptiveLearningManager } from './managers/adaptive-learning-manager.mjs';
import { CacheManager } from './managers/cache-manager.mjs';
import { ModelManager } from './managers/model-manager.mjs';
import { ResourceMonitor } from './managers/resource-monitor.mjs';
import { RetryManager } from './managers/retry-manager.mjs';
import { WorkflowManager } from './managers/workflow-manager.mjs';
import { PostProcessorPipeline } from './post-processor-pipeline.mjs';
import { TextProcessor } from './processors/text-processor.mjs';
import {
  AdaptiveLearningResult,
  AdaptiveTextAnalyzer,
  AnalysisConfig,
  AnalysisResult,
  AnalysisResultWithLearning,
  AnalysisTask,
  DocumentAnalyzer,
  DocumentChunk,
  DocumentMetadata,
  LearningContext,
  LearningOpportunity,
  ModelConfig,
  PostProcessor,
  ProcessingProgress,
  WorkflowCallbacks,
} from './types.mjs';
import { WorkerPool } from './worker-pool.mjs';

class NLPAnalyzer extends EventEmitter implements AdaptiveTextAnalyzer {
  private textProcessor: TextProcessor;
  private modelManager: ModelManager;
  private cacheManager: CacheManager;
  private isDisposed = false;
  private workerPool?: WorkerPool;
  private useWorkers: boolean;
  private resourceMonitor?: ResourceMonitor;
  private retryManager?: RetryManager;
  private postProcessorPipeline: PostProcessorPipeline;
  private workflowManager: WorkflowManager;
  private adaptiveLearningManager?: AdaptiveLearningManager;

  // Add explicit property declarations
  private maxWorkers: number;
  private cacheEnabled: boolean;
  private modelsPath?: string;

  constructor(
    maxWorkers = 4,
    cacheEnabled = true,
    modelsPath?: string,
    useWorkers = true,
    enableMonitoring = true,
    enableRetries = true,
    postProcessors: PostProcessor[] = [],
    workflowCallbacks: WorkflowCallbacks = {},
    enableAdaptiveLearning = true,
  ) {
    super();

    // Assign parameters to properties
    this.maxWorkers = maxWorkers;
    this.cacheEnabled = cacheEnabled;
    this.modelsPath = modelsPath;

    // Set environment variables for offline-only operation
    if (modelsPath) {
      process.env.HF_HOME = modelsPath;
      process.env.TRANSFORMERS_CACHE = path.join(modelsPath, 'transformers');
    }

    // Disable any potential network calls
    process.env.HF_HUB_DISABLE_TELEMETRY = '1';
    process.env.TRANSFORMERS_OFFLINE = '1';

    this.textProcessor = new TextProcessor();
    this.modelManager = new ModelManager(modelsPath);
    this.cacheManager = new CacheManager(cacheEnabled);
    this.useWorkers = useWorkers;

    // Initialize worker pool if enabled
    if (this.useWorkers) {
      this.workerPool = new WorkerPool(maxWorkers, modelsPath);
      this.setupWorkerPoolEvents();
    }

    // Initialize resource monitoring
    if (enableMonitoring) {
      this.resourceMonitor = new ResourceMonitor({
        enabled: true,
        interval: 5000,
        alerts: {
          cpuThreshold: 80,
          memoryThreshold: 85,
          queueThreshold: 50,
          processingTimeThreshold: 30000,
        },
      });

      this.setupResourceMonitoring();
    }

    // Initialize retry manager
    if (enableRetries) {
      this.retryManager = new RetryManager({
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffStrategy: 'exponential',
        jitter: true,
        retryableErrors: [
          'Model loading failed',
          'Analysis failed',
          'Worker error',
          'Processing timeout',
          'ECONNRESET',
          'ENOTFOUND',
        ],
        circuitBreaker: {
          enabled: true,
          failureThreshold: 5,
          recoveryTimeout: 60000,
          monitoringWindow: 120000,
        },
      });

      this.setupRetryManager();
    }

    // Initialize post-processor pipeline
    this.postProcessorPipeline = new PostProcessorPipeline(postProcessors);
    this.setupPostProcessorEvents();

    // Initialize workflow manager
    this.workflowManager = new WorkflowManager(workflowCallbacks);
    this.setupWorkflowEvents();

    // Initialize adaptive learning manager
    if (enableAdaptiveLearning) {
      this.adaptiveLearningManager = new AdaptiveLearningManager({
        enabled: true,
        learningDataPath: path.join(modelsPath || process.cwd(), '.cache/nlp'),
      });

      this.setupAdaptiveLearningEvents();
    }

    // Log privacy confirmation
    console.log('🔒 NLP Analyzer initialized in OFFLINE-ONLY mode');
    console.log('✅ Your data will NEVER leave this machine');
  }

  private setupWorkflowEvents(): void {
    this.workflowManager.on('workflow-executed', (data) => {
      this.emit('workflow-executed', data);
    });

    this.workflowManager.on('workflow-error', (data) => {
      this.emit('workflow-error', data);
    });

    this.workflowManager.on('rule-executed', (data) => {
      this.emit('workflow-rule-executed', data);
    });

    this.workflowManager.on('rule-error', (data) => {
      this.emit('workflow-rule-error', data);
    });
  }

  private setupResourceMonitoring(): void {
    if (!this.resourceMonitor) return;

    this.resourceMonitor.on('alert', (alert) => {
      this.emit('resource-alert', alert);
      // Execute workflow callback
      this.workflowManager.executeResourceAlert({
        type: alert.type,
        level: alert.level,
        message: alert.message,
        value: alert.value,
      });
    });

    this.resourceMonitor.on('metrics', (metrics) => {
      this.emit('resource-metrics', metrics);
    });
  }

  private setupRetryManager(): void {
    if (!this.retryManager) return;

    this.retryManager.on('attempt-start', (data) => {
      // ✅ Only log retries in debug mode - this was causing major slowdown
      if (process.env.DEBUG) {
        console.log(
          `🔄 Retry attempt ${data.attempt}/${data.maxAttempts} for ${data.context}`,
        );
      }
    });

    this.retryManager.on('attempt-failed', (data) => {
      // ✅ Only warn about failed attempts in debug mode
      if (process.env.DEBUG) {
        console.warn(
          `⚠️ Attempt ${data.attempt} failed for ${data.context}: ${data.error.message}`,
        );
      }
    });

    this.retryManager.on('circuit-breaker-opened', (data) => {
      // ✅ Keep critical errors but make them less verbose
      console.error(
        `🚨 Circuit breaker OPENED for ${data.context} (${data.failures} failures)`,
      );
      this.emit('circuit-breaker-opened', data);
      this.workflowManager.executeCircuitBreakerTripped(
        data.context,
        data.failures,
      );
    });

    this.retryManager.on('circuit-breaker-closed', (data) => {
      // ✅ Comment out success messages
      // console.log(`✅ Circuit breaker CLOSED for ${data.context}`);
      this.emit('circuit-breaker-closed', data);
    });

    this.retryManager.on('all-attempts-failed', (data) => {
      console.error(
        `❌ All attempts failed for ${data.context} (${data.totalTime}ms)`,
      );
    });
  }

  private setupPostProcessorEvents(): void {
    this.postProcessorPipeline.on('pipeline-start', (data) => {
      this.emit('post-processing-start', data);
    });

    this.postProcessorPipeline.on('processor-complete', (data) => {
      this.emit('post-processor-complete', data);
    });

    this.postProcessorPipeline.on('processor-error', (data) => {
      this.emit('post-processor-error', data);
    });

    this.postProcessorPipeline.on('pipeline-complete', (data) => {
      this.emit('post-processing-complete', data);
    });
  }

  private setupAdaptiveLearningEvents(): void {
    if (!this.adaptiveLearningManager) return;

    this.adaptiveLearningManager.on('learning-applied', (data) => {
      this.emit('adaptive-learning-applied', data);
    });

    this.adaptiveLearningManager.on('learning-session-complete', (data) => {
      this.emit('adaptive-learning-session-complete', data);
    });

    this.adaptiveLearningManager.on('learning-data-saved', (data) => {
      this.emit('adaptive-learning-data-saved', data);
    });
  }

  private setupWorkerPoolEvents(): void {
    if (!this.workerPool) return;

    this.workerPool.on('worker-error', (data) => {
      this.emit('worker-error', data);
    });

    this.workerPool.on('model-loaded', (data) => {
      this.emit('model-loaded', data);
    });

    this.workerPool.on('initialized', (data) => {
      console.log(
        `👥 Worker pool initialized: ${data.workerCount} workers ready`,
      );
    });
  }

  private generateCacheKey(content: string, config: AnalysisConfig): string {
    const hash = crypto
      .createHash('md5')
      .update(content + JSON.stringify(config))
      .digest('hex');
    return `analysis_${hash}`;
  }

  async analyze(
    content: string,
    metadata: DocumentMetadata,
    config: AnalysisConfig,
  ): Promise<AnalysisResult> {
    if (this.isDisposed) {
      throw new Error('Analyzer has been disposed');
    }

    const document = { content, metadata };

    // ✅ Skip workflow execution for simple analysis to improve speed
    if (!config.enableWorkflows) {
      await this.workflowManager.executeAnalysisStart(document, config);
    }

    const analyzeOperation = async (): Promise<AnalysisResult> => {
      const startTime = Date.now();

      // ✅ Optimize cache key generation
      const cacheKey =
        config.useCache !== false
          ? this.generateCacheKey(content, config)
          : undefined;

      // Check cache first
      if (cacheKey && this.cacheManager.has(cacheKey)) {
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) {
          // ✅ Skip post-processing for cached results to improve speed
          if (this.postProcessorPipeline.getProcessorCount() === 0) {
            return cached;
          }
          return await this.postProcessorPipeline.execute(
            cached,
            { content, metadata },
            config,
          );
        }
      }

      // ✅ Optimize chunking - use larger chunks for better performance
      const chunks = await this.textProcessor.chunkText(
        content,
        config.chunkSize || 1024, // ✅ Increased default from 512 to 1024
      );

      // Load required models with retry
      await this.loadModelsWithRetry(config.tasks, config.modelConfig);

      // Process each task with retry
      const taskResults: Record<string, any> = {};

      // ✅ Process tasks in parallel for better performance
      const taskPromises = config.tasks.map(async (task) => {
        try {
          const result = await this.processTaskWithRetry(
            task,
            chunks,
            config,
            metadata.id,
          );
          return { task, result };
        } catch (error) {
          console.error(`Task ${task} failed:`, error.message);
          return { task, result: null };
        }
      });

      const taskResultsArray = await Promise.all(taskPromises);
      taskResultsArray.forEach(({ task, result }) => {
        if (result !== null) {
          taskResults[task] = result;
        }
      });

      let result: AnalysisResult = {
        documentId: metadata.id,
        tasks: taskResults,
        metadata: {
          processingTime: Date.now() - startTime,
          modelVersions: this.modelManager.getLoadedModelVersions(),
          confidence: this.calculateOverallConfidence(taskResults),
        },
      };

      // Apply post-processing pipeline only if needed
      if (this.postProcessorPipeline.getProcessorCount() > 0) {
        result = await this.postProcessorPipeline.execute(
          result,
          { content, metadata },
          config,
        );
      }

      // ✅ Skip workflow execution for simple analysis
      if (!config.enableWorkflows) {
        await this.workflowManager.executeAnalysisComplete(
          result,
          document,
          config,
        );
      }

      // Record processing metrics
      if (this.resourceMonitor) {
        this.resourceMonitor.recordDocumentProcessed(
          result.metadata.processingTime,
        );

        // ✅ Skip worker stats update if not using workers
        if (this.useWorkers) {
          const workerStats = this.getWorkerStats();
          if (workerStats) {
            this.resourceMonitor.updateWorkerStats(
              workerStats.busyWorkers,
              workerStats.queuedTasks,
            );
          }
        }
      }

      // Cache result (after post-processing)
      if (cacheKey && config.useCache !== false) {
        await this.cacheManager.set(cacheKey, result);
      }

      return result;
    };

    if (this.retryManager) {
      const retryResult = await this.retryManager.executeWithRetry(
        analyzeOperation,
        `analyze-${metadata.id}`,
        {
          maxAttempts: 2, // ✅ Reduced from 3 to 2
          baseDelay: 1000, // ✅ Reduced from 2000 to 1000
        },
      );

      if (!retryResult.success) {
        if (!config.enableWorkflows) {
          await this.workflowManager.executeAnalysisError(
            retryResult.error!,
            document,
            config,
          );
        }

        this.emit('error', {
          documentId: metadata.id,
          error: retryResult.error,
        });
        throw retryResult.error;
      }

      return retryResult.result!;
    } else {
      try {
        return await analyzeOperation();
      } catch (error) {
        if (!config.enableWorkflows) {
          await this.workflowManager.executeAnalysisError(
            error as Error,
            document,
            config,
          );
        }

        this.emit('error', { documentId: metadata.id, error });
        throw error;
      }
    }
  }

  async analyzeBatch(
    documents: Array<{ content: string; metadata: DocumentMetadata }>,
    config: AnalysisConfig,
    onProgress?: (progress: ProcessingProgress) => void,
  ): Promise<AnalysisResult[]> {
    // Execute workflow: batch start
    await this.workflowManager.executeBatchStart(documents, config);

    const results: AnalysisResult[] = [];
    const batchSize = config.batchSize || 10;

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);

      // Process batch through core analysis (without post-processing)
      const batchPromises = batch.map((doc) =>
        this.analyzeCoreOnly(doc.content, doc.metadata, config),
      );

      const batchResults = await Promise.all(batchPromises);

      // Apply post-processing to the entire batch
      const postProcessedResults =
        await this.postProcessorPipeline.executeBatch(
          batchResults,
          batch,
          config,
        );

      results.push(...postProcessedResults);

      // Execute workflow: batch progress
      const progress = {
        completed: Math.min(i + batchSize, documents.length),
        total: documents.length,
        percentage: Math.min(100, ((i + batchSize) / documents.length) * 100),
      };

      await this.workflowManager.executeBatchProgress(progress, config);

      if (onProgress) {
        onProgress({
          documentId: 'batch',
          stage: 'processing',
          progress: progress.percentage,
        });
      }
    }

    // Execute workflow: batch complete
    await this.workflowManager.executeBatchComplete(results, documents, config);

    return results;
  }

  /**
   * Core analysis without post-processing (for batch optimization)
   */
  private async analyzeCoreOnly(
    content: string,
    metadata: DocumentMetadata,
    config: AnalysisConfig,
  ): Promise<AnalysisResult> {
    const startTime = Date.now();

    // Check cache first
    const cacheKey = this.generateCacheKey(content, config);
    if (config.useCache && this.cacheManager.has(cacheKey)) {
      const cached = await this.cacheManager.get(cacheKey);
      if (cached) return cached;
    }

    // Core processing (same as analyze but without post-processing)
    const chunks = await this.textProcessor.chunkText(
      content,
      config.chunkSize || 512,
    );

    await this.loadModelsWithRetry(config.tasks, config.modelConfig);

    const taskResults: Record<string, any> = {};
    for (const task of config.tasks) {
      taskResults[task] = await this.processTaskWithRetry(
        task,
        chunks,
        config,
        metadata.id,
      );
    }

    const result: AnalysisResult = {
      documentId: metadata.id,
      tasks: taskResults,
      metadata: {
        processingTime: Date.now() - startTime,
        modelVersions: this.modelManager.getLoadedModelVersions(),
        confidence: this.calculateOverallConfidence(taskResults),
      },
    };

    // Cache result (before post-processing)
    if (config.useCache) {
      await this.cacheManager.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Add a post-processor to the pipeline
   */
  addPostProcessor(processor: PostProcessor): void {
    this.postProcessorPipeline.addProcessor(processor);
  }

  /**
   * Remove a post-processor by index
   */
  removePostProcessor(index: number): boolean {
    return this.postProcessorPipeline.removeProcessor(index);
  }

  /**
   * Clear all post-processors
   */
  clearPostProcessors(): void {
    this.postProcessorPipeline.clearProcessors();
  }

  /**
   * Get post-processor pipeline stats
   */
  getPostProcessorStats(): any {
    return this.postProcessorPipeline.getStats();
  }

  private async loadModelsWithRetry(
    tasks: AnalysisTask[],
    config?: ModelConfig,
  ): Promise<void> {
    if (!this.retryManager) {
      return this.modelManager.loadModels(tasks, config);
    }

    const loadOperation = () => this.modelManager.loadModels(tasks, config);

    // ✅ Reduce retry attempts for faster performance
    const retryResult = await this.retryManager.executeWithRetry(
      loadOperation,
      'model-loading',
      {
        maxAttempts: 2, // ✅ Reduced from 3 to 2
        baseDelay: 2000, // ✅ Reduced from 5000 to 2000
        maxDelay: 15000, // ✅ Reduced from 30000 to 15000
      },
    );

    if (!retryResult.success) {
      throw retryResult.error;
    }
  }

  private async processTaskWithRetry(
    task: string,
    chunks: DocumentChunk[],
    config: AnalysisConfig,
    documentId: string,
  ): Promise<any> {
    if (!this.retryManager) {
      return this.processTask(task, chunks, config);
    }

    const processOperation = () => this.processTask(task, chunks, config);

    // ✅ Reduce task retry attempts for faster performance
    const retryResult = await this.retryManager.executeWithRetry(
      processOperation,
      `process-${task}-${documentId}`,
      {
        maxAttempts: 2, // ✅ Reduced from 2 to 1 for non-critical tasks
        baseDelay: 500, // ✅ Reduced from 1000 to 500
      },
    );

    if (!retryResult.success) {
      // Try fallback strategies
      if (process.env.DEBUG) {
        console.warn(`Task ${task} failed after retries, attempting fallback`);
      }
      return this.attemptTaskFallback(task, chunks, config);
    }

    return retryResult.result!;
  }

  private async attemptTaskFallback(
    task: string,
    chunks: DocumentChunk[],
    config: AnalysisConfig,
  ): Promise<any> {
    // Implement fallback strategies for different tasks
    switch (task) {
      case 'sentiment':
        // Fallback: Simple rule-based sentiment
        return this.fallbackSentimentAnalysis(chunks);

      case 'entities':
        // Fallback: Simple regex-based entity extraction
        return this.fallbackEntityExtraction(chunks);

      case 'classification':
        // Fallback: Return unknown classification
        return {
          categories: [{ label: 'unknown', score: 0.1 }],
          topCategory: { label: 'unknown', score: 0.1 },
          confidence: 0.1,
        };

      default:
        throw new Error(`No fallback available for task: ${task}`);
    }
  }

  private fallbackSentimentAnalysis(chunks: DocumentChunk[]): any {
    // Simple rule-based sentiment analysis as fallback
    const positiveWords = [
      'good',
      'great',
      'excellent',
      'amazing',
      'wonderful',
      'fantastic',
    ];
    const negativeWords = [
      'bad',
      'terrible',
      'awful',
      'horrible',
      'disappointing',
      'unacceptable',
    ];

    let positiveScore = 0;
    let negativeScore = 0;

    const chunkResults = chunks.map((chunk) => {
      const text = chunk.text.toLowerCase();
      let chunkPositive = 0;
      let chunkNegative = 0;

      positiveWords.forEach((word) => {
        if (text.includes(word)) chunkPositive++;
      });

      negativeWords.forEach((word) => {
        if (text.includes(word)) chunkNegative++;
      });

      positiveScore += chunkPositive;
      negativeScore += chunkNegative;

      const sentiment =
        chunkPositive > chunkNegative
          ? 'positive'
          : chunkNegative > chunkPositive
            ? 'negative'
            : 'neutral';

      return {
        text: chunk.text.substring(0, 100) + '...',
        sentiment,
        score: Math.max(chunkPositive, chunkNegative) * 0.3 + 0.1,
      };
    });

    const overall =
      positiveScore > negativeScore
        ? { label: 'positive' as const, score: 0.6 }
        : negativeScore > positiveScore
          ? { label: 'negative' as const, score: 0.6 }
          : { label: 'neutral' as const, score: 0.5 };

    return { overall, chunks: chunkResults };
  }

  private fallbackEntityExtraction(chunks: DocumentChunk[]): any {
    // Simple regex-based entity extraction as fallback
    const entities: any[] = [];

    chunks.forEach((chunk) => {
      // Simple patterns for common entities
      const patterns = {
        PERSON: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g,
        ORGANIZATION: /\b[A-Z][a-z]+ (?:Inc|Corp|Corporation|LLC|Ltd)\b/g,
        LOCATION: /\b[A-Z][a-z]+(?:, [A-Z][a-z]+)?\b/g,
      };

      Object.entries(patterns).forEach(([label, regex]) => {
        let match;
        while ((match = regex.exec(chunk.text)) !== null) {
          entities.push({
            text: match[0],
            label,
            confidence: 0.5, // Lower confidence for fallback
            start: chunk.start + match.index,
            end: chunk.start + match.index + match[0].length,
          });
        }
      });
    });

    // Generate summary
    const summary = entities.reduce((acc, entity) => {
      acc[entity.label] = (acc[entity.label] || 0) + 1;
      return acc;
    }, {});

    return { entities, summary };
  }

  private postProcessWorkerResults(
    task: string,
    results: any,
    chunks: DocumentChunk[],
  ): any {
    switch (task) {
      case 'sentiment':
        return this.postProcessSentimentResults(results);
      case 'entities':
        return this.postProcessEntityResults(results);
      case 'classification':
        return this.postProcessClassificationResults(results);
      default:
        return results;
    }
  }

  private postProcessSentimentResults(results: any[]): any {
    const chunks = results.map((r) => ({
      text: r.text,
      sentiment: r.sentiment,
      score: r.score,
    }));

    // Calculate overall sentiment
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    let totalScore = 0;

    results.forEach((r) => {
      sentimentCounts[r.sentiment] =
        (sentimentCounts[r.sentiment] || 0) + r.score;
      totalScore += r.score;
    });

    const overall = Object.entries(sentimentCounts).reduce(
      (max, [sentiment, score]) =>
        score > max.score
          ? { label: sentiment as any, score: score / totalScore }
          : max,
      { label: 'neutral' as any, score: 0 },
    );

    return { overall, chunks };
  }

  private postProcessEntityResults(results: any[]): any {
    const entities = results.filter((e) => e.confidence >= 0.7);
    const summary = entities.reduce((acc, entity) => {
      acc[entity.label] = (acc[entity.label] || 0) + 1;
      return acc;
    }, {});

    return { entities, summary };
  }

  private postProcessClassificationResults(results: any[]): any {
    // Aggregate classification results
    const aggregated = {};
    let validResults = 0;

    results.forEach((r) => {
      if (r.classifications && Array.isArray(r.classifications)) {
        r.classifications.forEach((c) => {
          if (c.label && typeof c.score === 'number' && !isNaN(c.score)) {
            aggregated[c.label] = (aggregated[c.label] || 0) + c.score;
            validResults++;
          }
        });
      }
    });

    // ✅ Fixed: Better handling when no valid results
    if (validResults === 0 || Object.keys(aggregated).length === 0) {
      return {
        categories: [{ label: 'UNKNOWN', score: 0.1 }],
        topCategory: { label: 'UNKNOWN', score: 0.1 },
        confidence: 0.1,
      };
    }

    const avgDivisor = Math.max(1, results.length);
    const categories = Object.entries(aggregated)
      .map(([label, score]) => ({
        label,
        score: (score as number) / avgDivisor,
      }))
      .sort((a, b) => b.score - a.score);

    const topCategory = categories[0];
    const confidence = isNaN(topCategory.score) ? 0.1 : topCategory.score;

    return {
      categories: categories.slice(0, 5),
      topCategory: { label: topCategory.label, score: confidence },
      confidence,
    };
  }

  private calculateOverallConfidence(taskResults: Record<string, any>): number {
    const confidenceValues: number[] = [];

    Object.values(taskResults).forEach((result) => {
      if (result?.overall?.score) {
        confidenceValues.push(result.overall.score);
      } else if (result?.confidence) {
        confidenceValues.push(result.confidence);
      } else if (Array.isArray(result?.entities)) {
        const avgConfidence =
          result.entities.reduce(
            (sum: number, entity: any) => sum + entity.confidence,
            0,
          ) / result.entities.length;
        if (!isNaN(avgConfidence)) confidenceValues.push(avgConfidence);
      }
    });

    return confidenceValues.length > 0
      ? confidenceValues.reduce((sum, val) => sum + val, 0) /
          confidenceValues.length
      : 0.85;
  }

  /**
   * Analyze with learning opportunities
   */
  async analyzeWithLearning(
    content: string,
    metadata: DocumentMetadata,
    config: AnalysisConfig,
  ): Promise<AnalysisResultWithLearning> {
    // Perform regular analysis
    const result = await this.analyze(content, metadata, config);

    // Generate learning opportunities if adaptive learning is enabled
    let learningOpportunities: LearningOpportunity[] = [];

    if (this.adaptiveLearningManager) {
      const chunks = await this.textProcessor.chunkText(
        content,
        config.chunkSize || 512,
      );

      learningOpportunities =
        this.adaptiveLearningManager.generateLearningOpportunities(
          result.tasks,
          content,
          chunks,
        );
    }

    return {
      result,
      learningOpportunities,
    };
  }

  /**
   * Batch analysis with learning opportunities
   */
  async analyzeBatchWithLearning(
    documents: Array<{ content: string; metadata: DocumentMetadata }>,
    config: AnalysisConfig,
    onProgress?: (progress: ProcessingProgress) => void,
  ): Promise<AnalysisResultWithLearning[]> {
    const results: AnalysisResultWithLearning[] = [];

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const resultWithLearning = await this.analyzeWithLearning(
        doc.content,
        doc.metadata,
        config,
      );

      results.push(resultWithLearning);

      if (onProgress) {
        onProgress({
          documentId: 'batch',
          stage: 'processing',
          progress: ((i + 1) / documents.length) * 100,
        });
      }
    }

    return results;
  }

  /**
   * Apply learning from user feedback
   */
  async learn(
    opportunities: LearningOpportunity[],
    context?: LearningContext,
  ): Promise<AdaptiveLearningResult> {
    if (!this.adaptiveLearningManager) {
      throw new Error('Adaptive learning is not enabled for this analyzer');
    }

    return await this.adaptiveLearningManager.learn(opportunities, context);
  }

  /**
   * Get learning statistics
   */
  getLearningStats(): any {
    if (!this.adaptiveLearningManager) {
      return { enabled: false, message: 'Adaptive learning not enabled' };
    }

    return this.adaptiveLearningManager.getLearningStats();
  }

  /**
   * Export learning data for backup or transfer
   */
  async exportLearningData(): Promise<any> {
    if (!this.adaptiveLearningManager) {
      throw new Error('Adaptive learning is not enabled');
    }

    return await this.adaptiveLearningManager.exportLearningData();
  }

  /**
   * Import learning data from backup or another instance
   */
  async importLearningData(data: any): Promise<void> {
    if (!this.adaptiveLearningManager) {
      throw new Error('Adaptive learning is not enabled');
    }

    await this.adaptiveLearningManager.importLearningData(data);
  }

  /**
   * Get confidence threshold for a task (may be adjusted by learning)
   */
  getConfidenceThreshold(task: string): number {
    if (!this.adaptiveLearningManager) {
      return 0.8; // Default threshold
    }

    return this.adaptiveLearningManager.getConfidenceThreshold(task as any);
  }

  async dispose(): Promise<void> {
    this.isDisposed = true;

    console.log('🧹 Disposing NLP Analyzer...');

    // ✅ Fix: Dispose adaptive learning manager first to stop async operations
    if (this.adaptiveLearningManager) {
      try {
        console.log('🧠 Disposing adaptive learning manager...');
        this.adaptiveLearningManager.dispose();
        this.adaptiveLearningManager = undefined;
      } catch (error) {
        console.warn('⚠️ Error disposing adaptive learning manager:', error);
      }
    }

    if (this.workflowManager) {
      try {
        this.workflowManager.clear();
      } catch (error) {
        console.warn('⚠️ Error clearing workflow manager:', error);
      }
    }

    if (this.retryManager) {
      try {
        this.retryManager.dispose();
      } catch (error) {
        console.warn('⚠️ Error disposing retry manager:', error);
      }
    }

    if (this.resourceMonitor) {
      try {
        this.resourceMonitor.dispose();
      } catch (error) {
        console.warn('⚠️ Error disposing resource monitor:', error);
      }
    }

    if (this.workerPool) {
      try {
        await this.workerPool.dispose();
      } catch (error) {
        console.warn('⚠️ Error disposing worker pool:', error);
      }
    }

    try {
      await this.modelManager.dispose();
    } catch (error) {
      console.warn('⚠️ Error disposing model manager:', error);
    }

    try {
      await this.cacheManager.dispose();
    } catch (error) {
      console.warn('⚠️ Error disposing cache manager:', error);
    }

    this.removeAllListeners();
    console.log('✅ NLP Analyzer disposed');
  }

  private async processTask(
    task: string,
    chunks: DocumentChunk[],
    config: AnalysisConfig,
  ): Promise<any> {
    // Check if this is a custom processor that doesn't require models/workers
    const customProcessorRegistry =
      this.modelManager.getCustomProcessorRegistry();
    if (customProcessorRegistry?.has(task)) {
      const definition = customProcessorRegistry.get(task);
      if (definition && !definition.requiresModel) {
        // For custom processors that don't require models, always use main thread
        const processor = this.modelManager.getProcessor(task);
        if (!processor) {
          throw new Error(`No processor available for task: ${task}`);
        }
        return processor.process(chunks, config);
      }
    }

    // Use workers for parallel processing when:
    // 1. Workers are enabled and available
    // 2. We have multiple chunks OR CPU-intensive tasks
    // 3. Task benefits from parallelization
    // 4. Task is not a custom processor without model requirements
    const shouldUseWorkers =
      this.useWorkers &&
      this.workerPool &&
      (chunks.length > 1 || this.isIntensiveTask(task));

    if (shouldUseWorkers) {
      return this.processTaskInWorker(task, chunks, config);
    }

    // Fallback to main thread processing
    const processor = this.modelManager.getProcessor(task);
    if (!processor) {
      throw new Error(`No processor available for task: ${task}`);
    }

    return processor.process(chunks, config);
  }

  private async processTaskInWorker(
    task: string,
    chunks: DocumentChunk[],
    config: AnalysisConfig,
  ): Promise<any> {
    const modelInfo = this.getModelInfo(task, config.modelConfig);

    try {
      // Calculate task priority based on chunk count and task type
      const priority = this.calculateTaskPriority(task, chunks.length);

      const results = await this.workerPool!.processTask(
        chunks,
        task as any,
        modelInfo.modelId,
        modelInfo.taskType,
        config,
        priority,
      );

      // Post-process results to match expected format
      return this.postProcessWorkerResults(task, results, chunks);
    } catch (error) {
      // If workers are not available, fallback gracefully
      const errorMessage = (error as Error).message;

      if (errorMessage.includes('Workers not available')) {
        console.log(
          `🔧 Using main thread processing for ${task} (workers not available)`,
        );
      } else {
        console.warn(
          `Worker processing failed for ${task}, falling back to main thread:`,
          error,
        );
      }

      // Fallback to main thread
      const processor = this.modelManager.getProcessor(task);
      if (!processor) {
        throw error;
      }
      return processor.process(chunks, config);
    }
  }

  private calculateTaskPriority(task: string, chunkCount: number): number {
    // Higher priority for larger tasks that benefit most from parallelization
    let priority = 1;

    if (chunkCount > 10) priority += 2; // Large tasks get higher priority
    if (chunkCount > 5) priority += 1; // Medium tasks get some priority

    // Task-specific priorities
    switch (task) {
      case 'entities':
        priority += 2;
        break; // Entity extraction is CPU intensive
      case 'sentiment':
        priority += 1;
        break; // Sentiment is moderately intensive
      case 'summary':
        priority += 3;
        break; // Summary is very intensive
      case 'classification':
        priority += 1;
        break;
    }

    return priority;
  }

  private isIntensiveTask(task: string): boolean {
    // Tasks that benefit from worker isolation even with single chunks
    return ['entities', 'summary', 'classification'].includes(task);
  }

  private getModelInfo(
    task: string,
    modelConfig?: any,
  ): { modelId: string; taskType: string } {
    // First check if this is a custom processor with its own model info
    const customProcessorRegistry =
      this.modelManager.getCustomProcessorRegistry();
    if (customProcessorRegistry?.has(task)) {
      const definition = customProcessorRegistry.get(task);
      if (definition?.defaultModelId && definition?.defaultTaskType) {
        return {
          modelId: definition.defaultModelId,
          taskType: definition.defaultTaskType,
        };
      }
    }

    // Fallback to built-in model mappings
    const modelMappings: Record<string, { modelId: string; taskType: string }> =
      {
        sentiment: {
          modelId:
            modelConfig?.sentimentModel ||
            'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
          taskType: 'sentiment-analysis',
        },
        entities: {
          modelId: modelConfig?.entityModel || 'Xenova/bert-base-NER',
          taskType: 'token-classification',
        },
        classification: {
          modelId:
            modelConfig?.classificationModel ||
            'Xenova/distilbert-base-uncased',
          taskType: 'text-classification',
        },
        summary: {
          modelId: modelConfig?.summaryModel || 'Xenova/distilbart-cnn-6-6',
          taskType: 'summarization',
        },
      };

    return (
      modelMappings[task] || {
        modelId: 'unknown',
        taskType: 'text-classification',
      }
    );
  }

  getWorkerStats(): any {
    if (!this.workerPool) {
      return {
        totalWorkers: 0,
        busyWorkers: 0,
        queuedTasks: 0,
        loadedModels: {},
        workersDisabled: true,
        processingMode: 'main-thread',
      };
    }
    return this.workerPool.getStats();
  }

  getResourceMetrics(): any {
    return this.resourceMonitor?.getCurrentMetrics() || null;
  }

  getResourceReport(): string {
    return (
      this.resourceMonitor?.generateReport() ||
      'Resource monitoring not enabled'
    );
  }

  getRetryStats(): any {
    return this.retryManager?.getCircuitBreakerStats() || null;
  }

  resetCircuitBreakers(): void {
    this.retryManager?.resetAllCircuitBreakers();
  }

  /**
   * Add a workflow rule
   */
  addWorkflowRule(rule: {
    id: string;
    name: string;
    description: string;
    condition: (
      result: AnalysisResult,
      document: { content: string; metadata: DocumentMetadata },
    ) => boolean;
    action: (
      result: AnalysisResult,
      document: { content: string; metadata: DocumentMetadata },
      config: AnalysisConfig,
    ) => Promise<void> | void;
    priority?: number;
    enabled?: boolean;
  }): void {
    this.workflowManager.addRule({
      ...rule,
      priority: rule.priority || 1,
      enabled: rule.enabled !== false,
    });
  }

  /**
   * Remove a workflow rule
   */
  removeWorkflowRule(ruleId: string): boolean {
    return this.workflowManager.removeRule(ruleId);
  }

  /**
   * Set workflow callbacks
   */
  setWorkflowCallbacks(callbacks: WorkflowCallbacks): void {
    this.workflowManager.setCallbacks(callbacks);
  }

  /**
   * Get workflow statistics
   */
  getWorkflowStats(): any {
    return this.workflowManager.getStats();
  }

  /**
   * Get workflow rules
   */
  getWorkflowRules(): any[] {
    return this.workflowManager.getRules();
  }
}

export { NLPAnalyzer };
