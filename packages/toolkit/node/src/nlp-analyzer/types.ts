interface TextMetadata {
  id: string;
  title: string;
  size: number;
  format: 'text' | 'json' | 'xml' | 'csv';
  language?: string;
  encoding?: string;
  createdAt?: string;
  modifiedAt?: string;
  author?: string;
  source?: string;
}

// Keep backward compatibility
type DocumentMetadata = TextMetadata;

interface AnalysisConfig {
  tasks: AnalysisTask[];
  chunkSize?: number;
  batchSize?: number;
  useCache?: boolean;
  modelConfig?: ModelConfig;
  entityMapping?: any;
  targetNames?: string[];
  enableWorkflows?: boolean; // ✅ New: Allow disabling workflows for performance
  enablePostProcessing?: boolean; // ✅ New: Allow disabling post-processing
  fastMode?: boolean; // ✅ New: Enable fast mode (fewer retries, larger chunks)
}

interface ModelConfig {
  device?: 'cpu' | 'gpu' | 'auto';
  quantized?: boolean;
  sentimentModel?: string;
  entityModel?: string;
  classificationModel?: string;
  summaryModel?: string;
  maxTokens?: number;
  temperature?: number;
}

type AnalysisTask =
  | 'sentiment'
  | 'entities'
  | 'classification'
  | 'summary'
  | 'keywords'
  | 'language-detection'
  | 'readability'
  | string; // Allow custom task names

interface AnalysisResult {
  documentId: string;
  tasks: Record<string, any>;
  metadata: {
    processingTime: number;
    modelVersions: Record<string, string>;
    confidence: number;
    postProcessingTime?: number;
  };
}

interface SentimentResult {
  overall: {
    label: 'positive' | 'negative' | 'neutral';
    score: number;
  };
  chunks: Array<{
    text: string;
    sentiment: 'positive' | 'negative' | 'neutral';
    score: number;
  }>;
}

interface EntityResult {
  entities: Array<{
    text: string;
    label: string;
    confidence: number;
    start: number;
    end: number;
  }>;
  summary: Record<string, number>;
}

interface DocumentChunk {
  id: string;
  text: string;
  start: number;
  end: number;
  metadata?: {
    wordCount?: number;
    sentences?: number;
    language?: string;
  };
}

interface ProcessingProgress {
  documentId: string;
  stage: 'preprocessing' | 'processing' | 'postprocessing' | 'complete';
  progress: number; // 0-100
  message?: string;
  estimatedTimeRemaining?: number;
}

interface TextAnalyzer {
  analyze(
    content: string,
    metadata: TextMetadata,
    config: AnalysisConfig,
  ): Promise<AnalysisResult>;

  dispose(): Promise<void>;
}

// Keep backward compatibility
type DocumentAnalyzer = TextAnalyzer;

// Adaptive Learning Types
interface LearningOpportunity {
  id: string;
  type: AnalysisTask | 'custom';
  context: {
    originalText: string;
    prediction: any;
    confidence: number;
    position?: number;
  };
  metadata?: {
    modelUsed?: string;
    processingTime?: number;
    fallbackUsed?: boolean;
    taskSpecific?: Record<string, any>;
  };
  isCorrect?: boolean;
  suggestedCorrection?: any;
  weight?: number;
}

interface LearningContext {
  documentId: string;
  analysisTimestamp: number;
  modelVersions: Record<string, string>;
  userFeedback?: {
    userId?: string;
    sessionId?: string;
    reviewedAt?: number;
  };
}

interface AdaptiveLearningResult {
  learnedOpportunities: number;
  skippedOpportunities: number;
  modelUpdates: Record<string, any>;
  learningStats: any;
}

interface AnalysisResultWithLearning {
  result: AnalysisResult;
  learningOpportunities: LearningOpportunity[];
}

interface AdaptiveTextAnalyzer extends TextAnalyzer {
  analyzeWithLearning(
    content: string,
    metadata: TextMetadata,
    config: AnalysisConfig,
  ): Promise<AnalysisResultWithLearning>;

  learn(
    opportunities: LearningOpportunity[],
    context?: LearningContext,
  ): Promise<AdaptiveLearningResult>;

  getLearningStats(): any;
}

// Post-processing types
interface PostProcessingContext {
  documentIndex?: number;
  batchSize?: number;
  totalDocuments?: number;
  processingStartTime?: number;
  [key: string]: any;
}

type PostProcessor = (
  result: AnalysisResult,
  document: { content: string; metadata: TextMetadata },
  config: AnalysisConfig,
  context?: PostProcessingContext,
) => AnalysisResult | Promise<AnalysisResult>;

// Workflow types
type WorkflowCallback = (
  result: AnalysisResult,
  document: { content: string; metadata: TextMetadata },
  config: AnalysisConfig,
) => Promise<void> | void;

interface WorkflowCallbacks {
  onAnalysisStart?: (
    document: { content: string; metadata: TextMetadata },
    config: AnalysisConfig,
  ) => Promise<void> | void;
  onAnalysisComplete?: WorkflowCallback;
  onAnalysisError?: (
    error: Error,
    document: { content: string; metadata: TextMetadata },
    config: AnalysisConfig,
  ) => Promise<void> | void;
  onBatchStart?: (
    documents: Array<{ content: string; metadata: TextMetadata }>,
    config: AnalysisConfig,
  ) => Promise<void> | void;
  onBatchComplete?: (
    results: AnalysisResult[],
    documents: Array<{ content: string; metadata: TextMetadata }>,
    config: AnalysisConfig,
  ) => Promise<void> | void;
  onBatchProgress?: (
    progress: { completed: number; total: number; percentage: number },
    config: AnalysisConfig,
  ) => Promise<void> | void;
  onModelLoaded?: (modelId: string, task: string) => Promise<void> | void;
  onResourceAlert?: (alert: {
    type: string;
    level: string;
    message: string;
    value: number;
  }) => Promise<void> | void;
  onCircuitBreakerTripped?: (
    context: string,
    failures: number,
  ) => Promise<void> | void;
}

export type {
  DocumentMetadata,
  AnalysisConfig,
  AnalysisResultWithLearning,
  TextMetadata,
  ModelConfig,
  AnalysisTask,
  AnalysisResult,
  SentimentResult,
  EntityResult,
  DocumentChunk,
  ProcessingProgress,
  TextAnalyzer,
  DocumentAnalyzer,
  PostProcessor,
  PostProcessingContext,
  WorkflowCallback,
  WorkflowCallbacks,
  LearningOpportunity,
  LearningContext,
  AdaptiveLearningResult,
  AdaptiveTextAnalyzer,
};
