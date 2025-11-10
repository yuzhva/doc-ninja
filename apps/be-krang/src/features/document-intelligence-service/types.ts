import type { ExtractedInfo } from '../../nlp/information-extractor.mts';

/**
 * Configuration for Document Intelligence Service
 */
export interface DocumentIntelligenceConfig {
  sourcePath: string;
  outputPath: string;
  inputPath: string;
  batchSize?: number;
  concurrency?: number;
  cacheEnabled?: boolean;
  enableMonitoring?: boolean;
  extensions?: string[];
  maxFileSize?: number;
  ukrainianStemming?: boolean;
  useBM25?: boolean;
  confidence?: {
    entityThreshold: number;
    nameMatchThreshold: number;
    contextThreshold: number;
  };
}

/**
 * Name match result with processing information
 */
export interface NameMatch {
  name: string;
  declension: string;
  position: number;
  confidence: number;
  processingMethod?: 'intelligent' | 'fallback' | 'search' | 'adaptive';
  documentPath?: string;
  extractedInfo?: ExtractedInfo;
  nlpContext?: {
    sentimentScore?: number;
    entityContext?: string;
    processingTime?: number;
    confidence?: number;
    hasDateContext?: boolean;
    hasActionContext?: boolean;
    hasPositionContext?: boolean;
    hasReasonContext?: boolean;
  };
}

/**
 * Processing result summary
 */
export interface ProcessingResult {
  matches: NameMatch[];
  totalProcessingTime: number;
  documentsProcessed: number;
  namesSearched: number;
  outputFile: string;
  stats: {
    megaSearchStats?: any;
    nlpAnalyzerStats?: any;
  };
}

/**
 * Processing statistics
 */
export interface ProcessingStats {
  totalMatches: number;
  successRate: number;
  averageConfidence: number;
  processingMethods: Record<string, number>;
  confidenceDistribution: {
    high: number;
    medium: number;
    low: number;
  };
}

/**
 * Document metadata for processing
 */
export interface DocumentMetadata {
  id: string;
  fileName: string;
  filePath: string;
  size: number;
  lastModified: string;
  language?: string;
  wordCount?: number;
}

/**
 * Search match from MegaSearch
 */
export interface SearchMatch {
  name: string;
  positions: number[];
  confidence: number;
  highlights?: Array<{
    term: string;
    originalWord: string;
    charStart: number;
    charEnd: number;
    confidence: number;
  }>;
}

/**
 * NLP Context information
 */
export interface NLPContext {
  sentimentScore?: number;
  entityContext?: string;
  processingTime?: number;
  confidence?: number;
  hasDateContext?: boolean;
  hasActionContext?: boolean;
  hasPositionContext?: boolean;
  hasReasonContext?: boolean;
}

/**
 * Processing method types
 */
export type ProcessingMethod =
  | 'intelligent'
  | 'fallback'
  | 'search'
  | 'adaptive';

/**
 * Confidence thresholds
 */
export interface ConfidenceThresholds {
  entityThreshold: number;
  nameMatchThreshold: number;
  contextThreshold: number;
}
