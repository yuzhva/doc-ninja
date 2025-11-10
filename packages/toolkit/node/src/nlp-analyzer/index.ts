export { createNLPAnalyzer } from './factory';
export {
  CustomProcessorRegistry,
  LegalDocumentProcessor,
  MedicalDocumentProcessor,
} from './processors/index';
export type {
  AnalysisConfig,
  AnalysisResult,
  DocumentChunk,
  LearningOpportunity,
  PostProcessor,
  TextMetadata,
} from './types';
