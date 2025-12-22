import { EventEmitter } from 'events';

import { AnalysisConfig, AnalysisResult, TextMetadata } from '../types.mjs';

type WorkflowDocument = { content: string; metadata: TextMetadata };

type WorkflowBatchProgress = {
  completed: number;
  total: number;
  percentage: number;
};

type WorkflowResourceAlert = {
  type: string;
  level: string;
  message: string;
  value: number;
};

type WorkflowCallback = (
  result: AnalysisResult,
  document: WorkflowDocument,
  config: AnalysisConfig,
) => Promise<void> | void;

interface WorkflowCallbacks {
  onAnalysisStart?: (
    document: WorkflowDocument,
    config: AnalysisConfig,
  ) => Promise<void> | void;
  onAnalysisComplete?: WorkflowCallback;
  onAnalysisError?: (
    error: Error,
    document: WorkflowDocument,
    config: AnalysisConfig,
  ) => Promise<void> | void;
  onBatchStart?: (
    documents: Array<WorkflowDocument>,
    config: AnalysisConfig,
  ) => Promise<void> | void;
  onBatchComplete?: (
    results: AnalysisResult[],
    documents: Array<WorkflowDocument>,
    config: AnalysisConfig,
  ) => Promise<void> | void;
  onBatchProgress?: (
    progress: WorkflowBatchProgress,
    config: AnalysisConfig,
  ) => Promise<void> | void;
  onModelLoaded?: (modelId: string, task: string) => Promise<void> | void;
  onResourceAlert?: (alert: WorkflowResourceAlert) => Promise<void> | void;
  onCircuitBreakerTripped?: (
    context: string,
    failures: number,
  ) => Promise<void> | void;
}

interface WorkflowRule {
  id: string;
  name: string;
  description: string;
  condition: (result: AnalysisResult, document: WorkflowDocument) => boolean;
  action: WorkflowCallback;
  priority: number;
  enabled: boolean;
}

interface WorkflowExecutionResult {
  ruleId: string;
  success: boolean;
  executionTime: number;
  error?: Error;
}

class WorkflowManager extends EventEmitter {
  private callbacks: WorkflowCallbacks = {};
  private rules: Map<string, WorkflowRule> = new Map();
  private executionStats = new Map<
    string,
    { executions: number; failures: number; totalTime: number }
  >();

  constructor(callbacks?: WorkflowCallbacks) {
    super();
    if (callbacks) {
      this.callbacks = { ...callbacks };
    }
  }

  /**
   * Set workflow callbacks
   */
  setCallbacks(callbacks: WorkflowCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Add or update a specific callback
   */
  setCallback<K extends keyof WorkflowCallbacks>(
    event: K,
    callback: WorkflowCallbacks[K],
  ): void {
    this.callbacks[event] = callback;
  }

  /**
   * Add a workflow rule
   */
  addRule(rule: WorkflowRule): void {
    this.rules.set(rule.id, rule);
    this.executionStats.set(rule.id, {
      executions: 0,
      failures: 0,
      totalTime: 0,
    });

    this.emit('rule-added', { ruleId: rule.id, ruleName: rule.name });
  }

  /**
   * Remove a workflow rule
   */
  removeRule(ruleId: string): boolean {
    const removed = this.rules.delete(ruleId);
    if (removed) {
      this.executionStats.delete(ruleId);
      this.emit('rule-removed', { ruleId });
    }
    return removed;
  }

  /**
   * Enable/disable a workflow rule
   */
  toggleRule(ruleId: string, enabled: boolean): boolean {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = enabled;
      this.emit('rule-toggled', { ruleId, enabled });
      return true;
    }
    return false;
  }

  /**
   * Execute analysis start workflows
   */
  async executeAnalysisStart(
    document: WorkflowDocument,
    config: AnalysisConfig,
  ): Promise<void> {
    if (this.callbacks.onAnalysisStart) {
      try {
        await Promise.resolve(this.callbacks.onAnalysisStart(document, config));
        this.emit('workflow-executed', {
          event: 'onAnalysisStart',
          documentId: document.metadata.id,
        });
      } catch (error) {
        this.emit('workflow-error', {
          event: 'onAnalysisStart',
          error,
          documentId: document.metadata.id,
        });
        console.warn('Analysis start workflow failed:', error);
      }
    }
  }

  /**
   * Execute analysis complete workflows (callbacks + rules)
   */
  async executeAnalysisComplete(
    result: AnalysisResult,
    document: WorkflowDocument,
    config: AnalysisConfig,
  ): Promise<void> {
    // Execute callback first
    if (this.callbacks.onAnalysisComplete) {
      try {
        await Promise.resolve(
          this.callbacks.onAnalysisComplete(result, document, config),
        );
        this.emit('workflow-executed', {
          event: 'onAnalysisComplete',
          documentId: result.documentId,
        });
      } catch (error) {
        this.emit('workflow-error', {
          event: 'onAnalysisComplete',
          error,
          documentId: result.documentId,
        });
        console.warn('Analysis complete workflow failed:', error);
      }
    }

    // Execute matching rules
    await this.executeMatchingRules(result, document, config);
  }

  /**
   * Execute analysis error workflows
   */
  async executeAnalysisError(
    error: Error,
    document: WorkflowDocument,
    config: AnalysisConfig,
  ): Promise<void> {
    if (this.callbacks.onAnalysisError) {
      try {
        await Promise.resolve(
          this.callbacks.onAnalysisError(error, document, config),
        );
        this.emit('workflow-executed', {
          event: 'onAnalysisError',
          documentId: document.metadata.id,
        });
      } catch (workflowError) {
        this.emit('workflow-error', {
          event: 'onAnalysisError',
          error: workflowError,
          documentId: document.metadata.id,
        });
        console.warn('Analysis error workflow failed:', workflowError);
      }
    }
  }

  /**
   * Execute batch start workflows
   */
  async executeBatchStart(
    documents: Array<WorkflowDocument>,
    config: AnalysisConfig,
  ): Promise<void> {
    if (this.callbacks.onBatchStart) {
      try {
        await Promise.resolve(this.callbacks.onBatchStart(documents, config));
        this.emit('workflow-executed', {
          event: 'onBatchStart',
          batchSize: documents.length,
        });
      } catch (error) {
        this.emit('workflow-error', {
          event: 'onBatchStart',
          error,
          batchSize: documents.length,
        });
        console.warn('Batch start workflow failed:', error);
      }
    }
  }

  /**
   * Execute batch complete workflows
   */
  async executeBatchComplete(
    results: AnalysisResult[],
    documents: Array<WorkflowDocument>,
    config: AnalysisConfig,
  ): Promise<void> {
    if (this.callbacks.onBatchComplete) {
      try {
        await Promise.resolve(
          this.callbacks.onBatchComplete(results, documents, config),
        );
        this.emit('workflow-executed', {
          event: 'onBatchComplete',
          resultsCount: results.length,
        });
      } catch (error) {
        this.emit('workflow-error', {
          event: 'onBatchComplete',
          error,
          resultsCount: results.length,
        });
        console.warn('Batch complete workflow failed:', error);
      }
    }
  }

  /**
   * Execute batch progress workflows
   */
  async executeBatchProgress(
    progress: WorkflowBatchProgress,
    config: AnalysisConfig,
  ): Promise<void> {
    if (this.callbacks.onBatchProgress) {
      try {
        await Promise.resolve(this.callbacks.onBatchProgress(progress, config));
      } catch (error) {
        console.warn('Batch progress workflow failed:', error);
      }
    }
  }

  /**
   * Execute model loaded workflows
   */
  async executeModelLoaded(modelId: string, task: string): Promise<void> {
    if (this.callbacks.onModelLoaded) {
      try {
        await Promise.resolve(this.callbacks.onModelLoaded(modelId, task));
        this.emit('workflow-executed', {
          event: 'onModelLoaded',
          modelId,
          task,
        });
      } catch (error) {
        this.emit('workflow-error', {
          event: 'onModelLoaded',
          error,
          modelId,
          task,
        });
        console.warn('Model loaded workflow failed:', error);
      }
    }
  }

  /**
   * Execute resource alert workflows
   */
  async executeResourceAlert(alert: WorkflowResourceAlert): Promise<void> {
    if (this.callbacks.onResourceAlert) {
      try {
        await Promise.resolve(this.callbacks.onResourceAlert(alert));
        this.emit('workflow-executed', {
          event: 'onResourceAlert',
          alertType: alert.type,
        });
      } catch (error) {
        this.emit('workflow-error', {
          event: 'onResourceAlert',
          error,
          alertType: alert.type,
        });
        console.warn('Resource alert workflow failed:', error);
      }
    }
  }

  /**
   * Execute circuit breaker workflows
   */
  async executeCircuitBreakerTripped(
    context: string,
    failures: number,
  ): Promise<void> {
    if (this.callbacks.onCircuitBreakerTripped) {
      try {
        await Promise.resolve(
          this.callbacks.onCircuitBreakerTripped(context, failures),
        );
        this.emit('workflow-executed', {
          event: 'onCircuitBreakerTripped',
          context,
          failures,
        });
      } catch (error) {
        this.emit('workflow-error', {
          event: 'onCircuitBreakerTripped',
          error,
          context,
          failures,
        });
        console.warn('Circuit breaker workflow failed:', error);
      }
    }
  }

  /**
   * Execute rules that match the analysis result
   */
  private async executeMatchingRules(
    result: AnalysisResult,
    document: WorkflowDocument,
    config: AnalysisConfig,
  ): Promise<WorkflowExecutionResult[]> {
    const enabledRules = Array.from(this.rules.values())
      .filter((rule) => rule.enabled)
      .sort((a, b) => b.priority - a.priority); // Higher priority first

    const executionResults: WorkflowExecutionResult[] = [];

    for (const rule of enabledRules) {
      const startTime = Date.now();
      let success = false;
      let error: Error | undefined;

      try {
        // Check if rule condition matches
        if (rule.condition(result, document)) {
          console.log(`🎯 Executing workflow rule: ${rule.name}`);
          await Promise.resolve(rule.action(result, document, config));
          success = true;

          this.emit('rule-executed', {
            ruleId: rule.id,
            ruleName: rule.name,
            documentId: result.documentId,
          });
        }
      } catch (error: Error | any) {
        console.error(`❌ Workflow rule '${rule.name}' failed:`, error.message);
        console.error(`   Rule ID: ${rule.id}`);
        console.error(`   Document: ${result.documentId}`);

        this.emit('rule-error', {
          ruleId: rule.id,
          ruleName: rule.name,
          error,
          documentId: result.documentId,
        });
      }

      const executionTime = Date.now() - startTime;

      // Update stats
      const stats = this.executionStats.get(rule.id)!;
      stats.executions++;
      stats.totalTime += executionTime;
      if (!success) stats.failures++;

      executionResults.push({
        ruleId: rule.id,
        success,
        executionTime,
        error,
      });
    }

    return executionResults;
  }

  /**
   * Get workflow execution statistics
   */
  getStats(): Record<
    string,
    {
      executions: number;
      failures: number;
      avgExecutionTime: number;
      successRate: number;
    }
  > {
    const stats: Record<string, any> = {};

    this.executionStats.forEach((stat, ruleId) => {
      const rule = this.rules.get(ruleId);
      stats[ruleId] = {
        ruleName: rule?.name || 'Unknown',
        executions: stat.executions,
        failures: stat.failures,
        avgExecutionTime:
          stat.executions > 0 ? stat.totalTime / stat.executions : 0,
        successRate:
          stat.executions > 0
            ? ((stat.executions - stat.failures) / stat.executions) * 100
            : 0,
      };
    });

    return stats;
  }

  /**
   * Get all workflow rules
   */
  getRules(): WorkflowRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Clear all rules and callbacks
   */
  clear(): void {
    this.rules.clear();
    this.executionStats.clear();
    this.callbacks = {};
    this.removeAllListeners();
  }

  /**
   * Export workflow configuration
   */
  exportConfig(): { rules: WorkflowRule[]; stats: Record<string, any> } {
    return {
      rules: this.getRules(),
      stats: this.getStats(),
    };
  }
}

namespace WorkflowManager {
  export type Callback = WorkflowCallback;
  export type Callbacks = WorkflowCallbacks;
  export type Rule = WorkflowRule;
  export type ExecutionResult = WorkflowExecutionResult;
  export type Document = WorkflowDocument;
  export type BatchProgress = WorkflowBatchProgress;
  export type ResourceAlert = WorkflowResourceAlert;
}

export { WorkflowManager };
export type {
  WorkflowBatchProgress,
  WorkflowCallback,
  WorkflowCallbacks,
  WorkflowDocument,
  WorkflowExecutionResult,
  WorkflowResourceAlert,
  WorkflowRule,
};
