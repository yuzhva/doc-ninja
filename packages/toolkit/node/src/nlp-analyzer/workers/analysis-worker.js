const { pipeline } = require('@huggingface/transformers');
const { parentPort, workerData } = require('worker_threads');

// Worker implementation with better structure and error handling
class AnalysisWorker {
  constructor() {
    this.models = new Map();
    this.isReady = false;
    this.setupMessageHandler();
    this.initialize();
  }

  setupMessageHandler() {
    if (!parentPort) {
      throw new Error('Worker must be run in worker thread');
    }

    parentPort.on('message', async (message) => {
      try {
        switch (message.type) {
          case 'load-model':
            await this.loadModel(message.payload);
            break;
          case 'analyze':
            await this.analyze(message.payload);
            break;
          case 'dispose':
            await this.dispose();
            break;
          default:
            throw new Error(`Unknown message type: ${message.type}`);
        }
      } catch (error) {
        this.sendError(error);
      }
    });
  }

  async initialize() {
    try {
      if (workerData?.modelsPath) {
        process.env.HF_HOME = workerData.modelsPath;
        process.env.TRANSFORMERS_CACHE = `${workerData.modelsPath}/transformers`;
      }

      process.env.HF_HUB_DISABLE_TELEMETRY = '1';
      process.env.TRANSFORMERS_OFFLINE = '1';

      this.isReady = true;
      this.sendMessage('ready', { workerId: workerData?.workerId });
    } catch (error) {
      this.sendError(error);
    }
  }

  async loadModel(payload) {
    const { modelId, taskType, modelConfig } = payload;

    if (this.models.has(modelId)) {
      this.sendMessage('model-loaded', { modelId });
      return;
    }

    try {
      console.log(`Worker ${workerData?.workerId}: Loading model ${modelId}`);

      const model = await pipeline(taskType, modelId, {
        local_files_only: true,
        device: modelConfig?.device || 'cpu',
        quantized: modelConfig?.quantized !== false,
        cache_dir: process.env.TRANSFORMERS_CACHE,
      });

      this.models.set(modelId, model);
      this.sendMessage('model-loaded', { modelId });

      console.log(
        `Worker ${workerData?.workerId}: Model ${modelId} loaded successfully`,
      );
    } catch (error) {
      this.sendError(
        new Error(`Failed to load model ${modelId}: ${error.message}`),
      );
    }
  }

  async analyze(payload) {
    const { chunks, task, modelId, config } = payload;

    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(
        `Model ${modelId} not loaded in worker ${workerData?.workerId}`,
      );
    }

    try {
      console.log(
        `Worker ${workerData?.workerId}: Processing ${chunks.length} chunks for task ${task}`,
      );

      const results = await this.processChunks(chunks, task, model, config);

      this.sendMessage('analysis-complete', {
        task,
        results,
        chunks: chunks.length,
        workerId: workerData?.workerId,
      });

      console.log(
        `Worker ${workerData?.workerId}: Analysis completed for ${task}`,
      );
    } catch (error) {
      this.sendError(
        new Error(`Analysis failed for task ${task}: ${error.message}`),
      );
    }
  }

  async processChunks(chunks, task, model, config) {
    switch (task) {
      case 'sentiment':
        return this.processSentiment(chunks, model);
      case 'entities':
        return this.processEntities(chunks, model);
      case 'classification':
        return this.processClassification(chunks, model);
      case 'summary':
        return this.processSummary(chunks, model);
      default:
        throw new Error(`Unsupported task: ${task}`);
    }
  }

  async processSentiment(chunks, model) {
    const results = [];

    for (const chunk of chunks) {
      try {
        const result = await model(chunk.text);
        results.push({
          chunkId: chunk.id,
          sentiment: this.normalizeSentimentLabel(
            result[0]?.label || 'neutral',
          ),
          score: result[0]?.score || 0.5,
          text: chunk.text.substring(0, 100),
        });
      } catch (error) {
        results.push({
          chunkId: chunk.id,
          sentiment: 'neutral',
          score: 0.5,
          error: error.message,
        });
      }
    }

    return results;
  }

  async processEntities(chunks, model) {
    const allEntities = [];

    for (const chunk of chunks) {
      try {
        const result = await model(chunk.text);
        const entities = this.mergeEntityTokens(result);

        entities.forEach((entity) => {
          allEntities.push({
            text: entity.word,
            label: entity.entity.replace(/^[BI]-/, ''),
            confidence: entity.score,
            start: chunk.start + entity.start,
            end: chunk.start + entity.end,
            chunkId: chunk.id,
          });
        });
      } catch (error) {
        console.warn(`Entity processing failed for chunk ${chunk.id}:`, error);
      }
    }

    return allEntities;
  }

  async processClassification(chunks, model) {
    const results = [];

    for (const chunk of chunks) {
      try {
        const result = await model(chunk.text);
        results.push({
          chunkId: chunk.id,
          classifications: result.map((r) => ({
            label: r.label,
            score: r.score,
          })),
        });
      } catch (error) {
        results.push({
          chunkId: chunk.id,
          classifications: [{ label: 'unknown', score: 0.1 }],
          error: error.message,
        });
      }
    }

    return results;
  }

  async processSummary(chunks, model) {
    const results = [];

    for (const chunk of chunks) {
      try {
        const result = await model(chunk.text);
        results.push({
          chunkId: chunk.id,
          summary: result[0]?.summary_text || chunk.text.substring(0, 100),
        });
      } catch (error) {
        results.push({
          chunkId: chunk.id,
          summary: chunk.text.substring(0, 100),
          error: error.message,
        });
      }
    }

    return results;
  }

  normalizeSentimentLabel(label) {
    const normalizedLabel = label.toLowerCase();

    if (normalizedLabel.includes('pos') || normalizedLabel === 'label_1') {
      return 'positive';
    } else if (
      normalizedLabel.includes('neg') ||
      normalizedLabel === 'label_0'
    ) {
      return 'negative';
    }

    return 'neutral';
  }

  mergeEntityTokens(tokens) {
    if (!tokens || tokens.length === 0) return [];

    const merged = [];
    let currentEntity = tokens[0];

    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];

      if (
        token.entity === currentEntity.entity &&
        token.start <= currentEntity.end + 1 &&
        token.entity !== 'O'
      ) {
        currentEntity = {
          ...currentEntity,
          word: currentEntity.word + token.word.replace(/^##/, ''),
          end: token.end,
          score: Math.max(currentEntity.score, token.score),
        };
      } else {
        if (currentEntity.entity !== 'O') {
          merged.push(currentEntity);
        }
        currentEntity = token;
      }
    }

    if (currentEntity.entity !== 'O') {
      merged.push(currentEntity);
    }

    return merged;
  }

  async dispose() {
    try {
      console.log(`Worker ${workerData?.workerId}: Disposing models...`);

      for (const [modelId, model] of this.models) {
        if (typeof model.dispose === 'function') {
          await model.dispose();
        }
      }
      this.models.clear();

      this.sendMessage('disposed', { workerId: workerData?.workerId });
      process.exit(0);
    } catch (error) {
      this.sendError(error);
    }
  }

  sendMessage(type, payload) {
    if (parentPort) {
      parentPort.postMessage({ type, payload });
    }
  }

  sendError(error) {
    if (parentPort) {
      parentPort.postMessage({
        type: 'error',
        payload: {
          message: error.message,
          stack: error.stack,
          workerId: workerData?.workerId,
        },
      });
    }
  }
}

// Initialize worker
new AnalysisWorker();
