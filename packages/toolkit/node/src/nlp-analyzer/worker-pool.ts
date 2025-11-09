import { EventEmitter } from 'events';
import path from 'path';
import { Worker } from 'worker_threads';

import { AnalysisConfig, DocumentChunk } from './types.ts';

interface WorkerTask {
  id: string;
  chunks: DocumentChunk[];
  task: string;
  modelId: string;
  taskType: string;
  config: AnalysisConfig;
  priority: number;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
}

interface WorkerInfo {
  id: string;
  worker: Worker;
  busy: boolean;
  loadedModels: Set<string>;
  currentTask?: string;
}

class WorkerPool extends EventEmitter {
  private workers: WorkerInfo[] = [];
  private taskQueue: WorkerTask[] = [];
  private isInitialized = false;

  // Add explicit property declarations
  private maxWorkers: number;
  private modelsPath?: string;

  constructor(maxWorkers: number = 4, modelsPath?: string) {
    super();

    // Assign parameters to properties
    this.maxWorkers = maxWorkers;
    this.modelsPath = modelsPath;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log(
      `👥 Initializing worker pool with ${this.maxWorkers} workers...`,
    );

    // Create workers
    for (let i = 0; i < this.maxWorkers; i++) {
      await this.createWorker(i);
    }

    this.isInitialized = true;
    this.emit('initialized', { workerCount: this.workers.length });
  }

  private async createWorker(id: number): Promise<void> {
    try {
      const workerPath = path.join(__dirname, 'workers/analysis-worker.js');

      const worker = new Worker(workerPath, {
        workerData: {
          workerId: id,
          modelsPath: this.modelsPath,
        },
      });

      const workerInfo: WorkerInfo = {
        id: `worker-${id}`,
        worker,
        busy: false,
        loadedModels: new Set(),
      };

      // Set up worker event handlers
      worker.on('message', (message) => {
        this.handleWorkerMessage(workerInfo, message);
      });

      worker.on('error', (error) => {
        console.error(`❌ Worker ${id} error:`, error);
        this.emit('worker-error', { workerId: id, error });
        this.restartWorker(workerInfo);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`❌ Worker ${id} exited with code ${code}`);
          this.restartWorker(workerInfo);
        }
      });

      this.workers.push(workerInfo);
      console.log(`✅ Worker ${id} created`);
    } catch (error) {
      console.error(`❌ Failed to create worker ${id}:`, error);
    }
  }

  private handleWorkerMessage(workerInfo: WorkerInfo, message: any): void {
    switch (message.type) {
      case 'ready':
        console.log(`✅ Worker ${workerInfo.id} ready`);
        break;

      case 'model-loaded':
        workerInfo.loadedModels.add(message.payload.modelId);
        this.emit('model-loaded', {
          workerId: workerInfo.id,
          modelId: message.payload.modelId,
        });
        break;

      case 'analysis-complete':
        this.handleTaskComplete(workerInfo, message.payload);
        break;

      case 'error':
        this.handleWorkerError(workerInfo, message.payload);
        break;

      default:
        console.warn(`Unknown message type from worker: ${message.type}`);
    }
  }

  private handleTaskComplete(workerInfo: WorkerInfo, result: any): void {
    workerInfo.busy = false;
    workerInfo.currentTask = undefined;

    // Find the corresponding task and resolve it
    // Note: In a real implementation, you'd track task IDs
    console.log(`✅ Task completed by ${workerInfo.id}`);

    // Process next task in queue
    this.processNextTask();
  }

  private handleWorkerError(workerInfo: WorkerInfo, error: any): void {
    console.error(`❌ Worker ${workerInfo.id} task error:`, error);

    workerInfo.busy = false;
    workerInfo.currentTask = undefined;

    // Process next task
    this.processNextTask();
  }

  async processTask(
    chunks: DocumentChunk[],
    task: string,
    modelId: string,
    taskType: string,
    config: AnalysisConfig,
    priority: number = 1,
  ): Promise<any> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const workerTask: WorkerTask = {
        id: taskId,
        chunks,
        task,
        modelId,
        taskType,
        config,
        priority,
        resolve,
        reject,
      };

      // Add to queue and try to process immediately
      this.taskQueue.push(workerTask);
      this.taskQueue.sort((a, b) => b.priority - a.priority);

      this.processNextTask();
    });
  }

  private processNextTask(): void {
    if (this.taskQueue.length === 0) return;

    // Find available worker
    const availableWorker = this.workers.find((w) => !w.busy);
    if (!availableWorker) return;

    const task = this.taskQueue.shift()!;
    availableWorker.busy = true;
    availableWorker.currentTask = task.task;

    // Send task to worker
    availableWorker.worker.postMessage({
      type: 'analyze',
      payload: {
        taskId: task.id,
        chunks: task.chunks,
        task: task.task,
        modelId: task.modelId,
        taskType: task.taskType,
        config: task.config,
      },
    });

    console.log(`📤 Sent ${task.task} task to ${availableWorker.id}`);
  }

  private async restartWorker(workerInfo: WorkerInfo): Promise<void> {
    try {
      // Find worker index
      const index = this.workers.findIndex((w) => w.id === workerInfo.id);
      if (index === -1) return;

      // Terminate old worker
      await workerInfo.worker.terminate();

      // Create new worker
      const workerId = parseInt(workerInfo.id.split('-')[1]);
      await this.createWorker(workerId);

      console.log(`🔄 Restarted worker ${workerInfo.id}`);
    } catch (error) {
      console.error(`❌ Failed to restart worker ${workerInfo.id}:`, error);
    }
  }

  getStats(): any {
    const busyWorkers = this.workers.filter((w) => w.busy).length;
    const loadedModels = new Set();

    this.workers.forEach((worker) => {
      worker.loadedModels.forEach((model) => loadedModels.add(model));
    });

    return {
      totalWorkers: this.workers.length,
      busyWorkers,
      queuedTasks: this.taskQueue.length,
      loadedModels: Array.from(loadedModels),
      workersDisabled: false,
      processingMode: 'worker-threads',
    };
  }

  async dispose(): Promise<void> {
    console.log('🧹 Disposing worker pool...');

    // Clear task queue
    this.taskQueue = [];

    // Terminate all workers
    const terminatePromises = this.workers.map(async (workerInfo) => {
      try {
        await workerInfo.worker.terminate();
        console.log(`✅ Terminated worker ${workerInfo.id}`);
      } catch (error) {
        console.warn(`⚠️ Error terminating worker ${workerInfo.id}:`, error);
      }
    });

    await Promise.all(terminatePromises);
    this.workers = [];
    this.isInitialized = false;

    console.log('✅ Worker pool disposed');
  }
}

export { WorkerPool };
export type { WorkerTask, WorkerInfo };
