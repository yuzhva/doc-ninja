import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  AdaptiveLearningResult,
  AnalysisTask,
  LearningContext,
  LearningOpportunity,
} from '../types.mjs';

interface LearningConfiguration {
  enabled: boolean;
  learningRate: number;
  confidenceThresholds: Record<AnalysisTask, number>;
  maxFeedbackHistory: number;
  learningDataPath: string;
  autoSave: boolean;
  saveInterval: number; // ms
}

interface FeedbackHistory {
  opportunityId: string;
  task: AnalysisTask;
  originalPrediction: any;
  userCorrection?: any;
  isCorrect: boolean;
  confidence: number;
  weight: number;
  timestamp: number;
  context: LearningContext;
}

interface TaskLearningStats {
  totalFeedback: number;
  correctPredictions: number;
  accuracy: number;
  averageConfidence: number;
  confidenceThreshold: number;
  lastLearningSession: number;
  modelAdjustments: number;
}

class AdaptiveLearningManager extends EventEmitter {
  private config: LearningConfiguration;
  private feedbackHistory: FeedbackHistory[] = [];
  private taskStats = new Map<AnalysisTask, TaskLearningStats>();
  private confidenceAdjustments = new Map<string, number>(); // Model-specific adjustments
  private saveTimer?: NodeJS.Timeout;

  constructor(config: Partial<LearningConfiguration> = {}) {
    super();

    this.config = {
      enabled: true,
      learningRate: 0.1,
      confidenceThresholds: {
        sentiment: 0.8,
        entities: 0.85,
        classification: 0.75,
        summary: 0.7,
        keywords: 0.6,
        'language-detection': 0.9,
        readability: 0.7,
      },
      maxFeedbackHistory: 10000,
      learningDataPath: path.join(process.cwd(), '.cache/nlp'),
      autoSave: true,
      saveInterval: 30000, // 30 seconds
      ...config,
    };

    if (this.config.enabled) {
      this.initialize();
    }
  }

  private async initialize(): Promise<void> {
    try {
      await this.loadLearningData();

      if (this.config.autoSave) {
        this.startAutoSave();
      }

      console.log('🧠 Adaptive learning manager initialized');
      console.log(`📊 Loaded ${this.feedbackHistory.length} feedback entries`);
    } catch (error) {
      console.log('📁 No existing learning data found, starting fresh');
    }
  }

  /**
   * Generate learning opportunities from analysis results
   */
  generateLearningOpportunities(
    tasks: Record<AnalysisTask, any>,
    content: string,
    chunks: any[],
  ): LearningOpportunity[] {
    const opportunities: LearningOpportunity[] = [];

    Object.entries(tasks).forEach(([task, result]) => {
      const taskOpportunities = this.generateTaskOpportunities(
        task as AnalysisTask,
        result,
        content,
        chunks,
      );
      opportunities.push(...taskOpportunities);
    });

    return opportunities;
  }

  private generateTaskOpportunities(
    task: AnalysisTask,
    result: any,
    content: string,
    chunks: any[],
  ): LearningOpportunity[] {
    const opportunities: LearningOpportunity[] = [];

    switch (task) {
      case 'sentiment':
        opportunities.push(
          ...this.generateSentimentOpportunities(result, content),
        );
        break;
      case 'entities':
        opportunities.push(
          ...this.generateEntityOpportunities(result, content),
        );
        break;
      case 'classification':
        opportunities.push(
          ...this.generateClassificationOpportunities(result, content),
        );
        break;
      default:
        // Generic opportunity for custom tasks
        if (result && typeof result === 'object') {
          opportunities.push(
            this.generateGenericOpportunity(task, result, content),
          );
        }
    }

    return opportunities;
  }

  private generateClassificationOpportunities(
    result: any,
    content: string,
  ): LearningOpportunity[] {
    const opportunities: LearningOpportunity[] = [];

    if (result.topCategory) {
      // ✅ Fixed: Better handling of NaN scores
      let score = result.topCategory.score;

      // Handle NaN scores more robustly
      if (isNaN(score) || score === null || score === undefined) {
        score = 0.1; // Very low confidence for invalid scores
      }

      // Generate opportunities for low confidence or invalid classifications
      if (score < 0.85 || result.topCategory.label.includes('LABEL_')) {
        opportunities.push({
          id: `classification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'classification',
          context: {
            originalText: content,
            prediction: { label: result.topCategory.label, score: score },
            confidence: score,
          },
          metadata: {
            modelUsed: 'classification-model',
            processingTime: 0,
            fallbackUsed: score < 0.2, // Mark as fallback if very low confidence
            taskSpecific: {
              allCategories: result.categories?.slice(0, 3) || [],
              confidenceGap: Math.max(
                0,
                (result.categories?.[0]?.score || 0) -
                  (result.categories?.[1]?.score || 0),
              ),
              hasValidScore: !isNaN(result.topCategory.score),
            },
          },
        });
      }
    }

    return opportunities;
  }

  private generateEntityOpportunities(
    result: any,
    content: string,
  ): LearningOpportunity[] {
    const opportunities: LearningOpportunity[] = [];

    if (result.entities && Array.isArray(result.entities)) {
      result.entities.forEach((entity, index) => {
        // Generate opportunities for entities with medium confidence or new entities
        if (entity.confidence > 0.5 && entity.confidence < 0.9) {
          opportunities.push({
            id: `entity_${index}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'entity',
            context: {
              originalText: entity.text,
              prediction: {
                label: entity.label,
                confidence: entity.confidence,
                position: { start: entity.start, end: entity.end },
              },
              confidence: entity.confidence,
              position: entity.start,
            },
            metadata: {
              modelUsed: 'entity-model',
              processingTime: 0,
              fallbackUsed: false,
              taskSpecific: {
                entityType: entity.label,
                contextWindow: content.substring(
                  Math.max(0, entity.start - 50),
                  Math.min(content.length, entity.end + 50),
                ),
              },
            },
          });
        }
      });
    }

    return opportunities;
  }

  private generateSentimentOpportunities(
    result: any,
    content: string,
  ): LearningOpportunity[] {
    const opportunities: LearningOpportunity[] = [];

    // ✅ Fixed: More selective opportunity generation
    if (result.overall) {
      // Only generate opportunities for uncertain sentiment (not 100% confident)
      if (result.overall.score < 0.95) {
        // Only generate if not very confident
        opportunities.push({
          id: `sentiment_overall_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'sentiment',
          context: {
            originalText: content,
            prediction: result.overall,
            confidence: result.overall.score,
          },
          metadata: {
            modelUsed: 'sentiment-model',
            processingTime: 0,
            fallbackUsed: false,
            taskSpecific: {
              sentimentType: 'overall',
              chunkCount: result.chunks?.length || 0,
              textLength: content.length,
              // textType: this.classifyTextType(content), // Add text type classification
            },
          },
        });
      }
    }

    return opportunities;
  }

  private generateGenericOpportunity(
    task: AnalysisTask,
    result: any,
    content: string,
  ): LearningOpportunity {
    return {
      id: `${task}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'custom',
      context: {
        originalText: content,
        prediction: result,
        confidence: result.confidence || 0.5,
      },
      metadata: {
        modelUsed: `${task}-model`,
        processingTime: 0,
        fallbackUsed: false,
        taskSpecific: { task, resultType: typeof result },
      },
    };
  }

  /**
   * Apply learning from user-reviewed opportunities
   */
  async learn(
    opportunities: LearningOpportunity[],
    context?: LearningContext,
  ): Promise<AdaptiveLearningResult> {
    if (!this.config.enabled) {
      return {
        learnedOpportunities: 0,
        skippedOpportunities: opportunities.length,
        modelUpdates: {},
        learningStats: this.getGlobalLearningStats(),
      };
    }

    let learned = 0;
    let skipped = 0;
    const modelUpdates: Record<string, any> = {};

    for (const opportunity of opportunities) {
      if (opportunity.isCorrect === undefined) {
        skipped++;
        continue;
      }

      // Add to feedback history
      const feedback: FeedbackHistory = {
        opportunityId: opportunity.id,
        task: opportunity.type as AnalysisTask,
        originalPrediction: opportunity.context.prediction,
        userCorrection: opportunity.suggestedCorrection,
        isCorrect: opportunity.isCorrect,
        confidence: opportunity.context.confidence,
        weight: opportunity.weight || 1.0,
        timestamp: Date.now(),
        context: context || {
          documentId: 'unknown',
          analysisTimestamp: Date.now(),
          modelVersions: {},
        },
      };

      this.feedbackHistory.push(feedback);
      learned++;

      // Update task-specific learning
      await this.updateTaskLearning(opportunity, feedback);

      // Update model adjustments
      const modelKey = opportunity.metadata?.modelUsed || opportunity.type;
      if (!modelUpdates[modelKey]) {
        modelUpdates[modelKey] = { adjustments: 0, newThreshold: 0 };
      }
      modelUpdates[modelKey].adjustments++;

      this.emit('learning-applied', {
        opportunityId: opportunity.id,
        task: opportunity.type,
        wasCorrect: opportunity.isCorrect,
        confidence: opportunity.context.confidence,
      });
    }

    // Cleanup old feedback if needed
    this.cleanupFeedbackHistory();

    // Auto-save if enabled
    if (this.config.autoSave) {
      await this.saveLearningData();
    }

    const stats = this.getGlobalLearningStats();

    this.emit('learning-session-complete', {
      learned,
      skipped,
      modelUpdates,
      stats,
    });

    console.log(
      `🧠 Learning session completed: ${learned} opportunities learned, ${skipped} skipped`,
    );

    return {
      learnedOpportunities: learned,
      skippedOpportunities: skipped,
      modelUpdates,
      learningStats: stats,
    };
  }

  private async updateTaskLearning(
    opportunity: LearningOpportunity,
    feedback: FeedbackHistory,
  ): Promise<void> {
    const task = opportunity.type as AnalysisTask;
    let stats = this.taskStats.get(task);

    if (!stats) {
      stats = {
        totalFeedback: 0,
        correctPredictions: 0,
        accuracy: 0,
        averageConfidence: 0,
        confidenceThreshold: this.config.confidenceThresholds[task] || 0.8,
        lastLearningSession: Date.now(),
        modelAdjustments: 0,
      };
    }

    // Update statistics
    stats.totalFeedback++;
    if (feedback.isCorrect) {
      stats.correctPredictions++;
    }
    stats.accuracy = stats.correctPredictions / stats.totalFeedback;
    stats.lastLearningSession = Date.now();

    // Adaptive threshold adjustment
    const oldThreshold = stats.confidenceThreshold;
    if (feedback.isCorrect && feedback.confidence < stats.confidenceThreshold) {
      // Lower threshold slightly for correct low-confidence predictions
      stats.confidenceThreshold = Math.max(
        0.5,
        stats.confidenceThreshold - this.config.learningRate * 0.01,
      );
      stats.modelAdjustments++;
    } else if (
      !feedback.isCorrect &&
      feedback.confidence > stats.confidenceThreshold
    ) {
      // Raise threshold for incorrect high-confidence predictions
      stats.confidenceThreshold = Math.min(
        0.95,
        stats.confidenceThreshold + this.config.learningRate * 0.02,
      );
      stats.modelAdjustments++;
    }

    // Update average confidence
    const recentFeedback = this.feedbackHistory
      .filter((f) => f.task === task)
      .slice(-100); // Last 100 feedback entries

    stats.averageConfidence =
      recentFeedback.reduce((sum, f) => sum + f.confidence, 0) /
      Math.max(1, recentFeedback.length);

    this.taskStats.set(task, stats);

    if (stats.confidenceThreshold !== oldThreshold) {
      console.log(
        `🎯 Adjusted confidence threshold for ${task}: ${oldThreshold.toFixed(3)} → ${stats.confidenceThreshold.toFixed(3)}`,
      );
    }
  }

  /**
   * Get confidence threshold for a task (adjusted by learning)
   */
  getConfidenceThreshold(task: AnalysisTask): number {
    const stats = this.taskStats.get(task);
    return (
      stats?.confidenceThreshold ||
      this.config.confidenceThresholds[task] ||
      0.8
    );
  }

  /**
   * Check if a prediction should generate a learning opportunity
   */
  shouldGenerateOpportunity(task: AnalysisTask, confidence: number): boolean {
    const threshold = this.getConfidenceThreshold(task);

    // Generate opportunities for:
    // 1. Low confidence predictions (below threshold)
    // 2. Medium confidence predictions (borderline cases)
    return (
      confidence < threshold ||
      (confidence > threshold && confidence < threshold + 0.1)
    );
  }

  /**
   * Get learning statistics
   */
  getLearningStats(): Record<string, any> {
    const taskStats: Record<string, TaskLearningStats> = {};
    this.taskStats.forEach((stats, task) => {
      taskStats[task] = { ...stats };
    });

    return {
      enabled: this.config.enabled,
      totalFeedback: this.feedbackHistory.length,
      taskStatistics: taskStats,
      globalAccuracy: this.calculateGlobalAccuracy(),
      learningRate: this.config.learningRate,
      lastUpdate: Math.max(
        ...Array.from(this.taskStats.values()).map(
          (s) => s.lastLearningSession,
        ),
      ),
    };
  }

  private getGlobalLearningStats(): any {
    return {
      totalFeedback: this.feedbackHistory.length,
      accuracyImprovement: this.calculateAccuracyImprovement(),
      confidenceAdjustments: this.getConfidenceAdjustmentsSummary(),
    };
  }

  private calculateGlobalAccuracy(): number {
    if (this.feedbackHistory.length === 0) return 0;

    const correct = this.feedbackHistory.filter((f) => f.isCorrect).length;
    return correct / this.feedbackHistory.length;
  }

  private calculateAccuracyImprovement(): number {
    // Calculate accuracy improvement over time
    const recent = this.feedbackHistory.slice(-100);
    const older = this.feedbackHistory.slice(-200, -100);

    if (recent.length === 0) return 0;

    const recentAccuracy =
      recent.filter((f) => f.isCorrect).length / recent.length;
    const olderAccuracy =
      older.length > 0
        ? older.filter((f) => f.isCorrect).length / older.length
        : recentAccuracy;

    return recentAccuracy - olderAccuracy;
  }

  private getConfidenceAdjustmentsSummary(): Record<string, number> {
    const adjustments: Record<string, number> = {};
    this.taskStats.forEach((stats, task) => {
      adjustments[task] = stats.modelAdjustments;
    });
    return adjustments;
  }

  private cleanupFeedbackHistory(): void {
    if (this.feedbackHistory.length > this.config.maxFeedbackHistory) {
      const excess =
        this.feedbackHistory.length - this.config.maxFeedbackHistory;

      // ✅ Optimized: Remove oldest entries more efficiently
      this.feedbackHistory.splice(0, excess);

      // ✅ Force garbage collection hint for large cleanups
      if (excess > 1000) {
        if (global.gc) {
          global.gc();
        }
      }

      console.log(`🧹 Cleaned up ${excess} old feedback entries`);
    }
  }

  private startAutoSave(): void {
    // ✅ Optimized: Only save if there are changes
    let lastSaveSize = 0;

    this.saveTimer = setInterval(async () => {
      try {
        const currentSize = this.feedbackHistory.length;
        if (currentSize !== lastSaveSize) {
          await this.saveLearningData();
          lastSaveSize = currentSize;
        }
      } catch (error) {
        console.warn('⚠️ Auto-save of learning data failed:', error);
      }
    }, this.config.saveInterval);
  }

  private async saveLearningData(): Promise<void> {
    try {
      await fs.mkdir(this.config.learningDataPath, { recursive: true });

      const data = {
        config: this.config,
        feedbackHistory: this.feedbackHistory,
        taskStats: Object.fromEntries(this.taskStats),
        confidenceAdjustments: Object.fromEntries(this.confidenceAdjustments),
        savedAt: new Date().toISOString(),
        version: '1.0',
      };

      const filePath = path.join(
        this.config.learningDataPath,
        'learning-data.json',
      );
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));

      this.emit('learning-data-saved', {
        filePath,
        entriesCount: this.feedbackHistory.length,
      });
    } catch (error) {
      console.error('❌ Failed to save learning data:', error);
      throw error;
    }
  }

  private async loadLearningData(): Promise<void> {
    const filePath = path.join(
      this.config.learningDataPath,
      'learning-data.json',
    );

    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      this.feedbackHistory = data.feedbackHistory || [];

      if (data.taskStats) {
        Object.entries(data.taskStats).forEach(([task, stats]) => {
          this.taskStats.set(task as AnalysisTask, stats as TaskLearningStats);
        });
      }

      if (data.confidenceAdjustments) {
        Object.entries(data.confidenceAdjustments).forEach(([key, value]) => {
          this.confidenceAdjustments.set(key, value as number);
        });
      }

      console.log(`📖 Loaded learning data from ${filePath}`);
      this.emit('learning-data-loaded', {
        entriesCount: this.feedbackHistory.length,
        tasksCount: this.taskStats.size,
      });
    } catch (error) {
      throw new Error(`Failed to load learning data: ${error.message}`);
    }
  }

  async exportLearningData(): Promise<any> {
    return {
      feedbackHistory: this.feedbackHistory,
      taskStats: Object.fromEntries(this.taskStats),
      confidenceAdjustments: Object.fromEntries(this.confidenceAdjustments),
      exportedAt: new Date().toISOString(),
    };
  }

  async importLearningData(data: any): Promise<void> {
    if (data.feedbackHistory) {
      this.feedbackHistory = [...this.feedbackHistory, ...data.feedbackHistory];
    }

    if (data.taskStats) {
      Object.entries(data.taskStats).forEach(([task, stats]) => {
        this.taskStats.set(task as AnalysisTask, stats as TaskLearningStats);
      });
    }

    if (data.confidenceAdjustments) {
      Object.entries(data.confidenceAdjustments).forEach(([key, value]) => {
        this.confidenceAdjustments.set(key, value as number);
      });
    }

    this.cleanupFeedbackHistory();

    if (this.config.autoSave) {
      await this.saveLearningData();
    }

    console.log('📥 Imported learning data successfully');
  }

  dispose(): void {
    console.log('🧠 Disposing adaptive learning manager...');

    // ✅ Fix: Stop auto-save timer immediately
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = undefined;
    }

    // Clear all data structures
    this.feedbackHistory = [];
    this.taskStats.clear();
    this.confidenceAdjustments.clear();

    // Remove all event listeners
    this.removeAllListeners();

    console.log('✅ Adaptive learning manager disposed');
  }
}

export { AdaptiveLearningManager };
export type { LearningConfiguration, FeedbackHistory, TaskLearningStats };
