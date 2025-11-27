export { createNLPAnalyzer } from './factory.mjs';
export {
  CustomProcessorRegistry,
  LegalDocumentProcessor,
  MedicalDocumentProcessor,
} from './processors/index.mjs';
export type {
  AnalysisConfig,
  AnalysisResult,
  DocumentChunk,
  LearningOpportunity,
  PostProcessor,
  TextMetadata,
} from './types.mjs';
