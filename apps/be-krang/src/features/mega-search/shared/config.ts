interface DocumentProcessingConfig {
  sourceDirectory: string;
  outputDirectory: string;
  extensions: string[];
  maxFileSize: number;
  concurrency: number;
  preserveParagraphs: boolean;
}

interface SearchConfig {
  rootDirectory: string;
  extensions: string[];
  maxFileSize: number;
  concurrency: number;
  ukrainianStemming: boolean;
  useBM25: boolean;
  bm25K1: number;
  bm25B: number;
  caching: {
    enabled: boolean;
    textCacheDir: string;
    indexCacheDir: string;
    globalIndexPath: string;
  };
}

interface NLPConfig {
  inputDirectory: string;
  outputDirectory: string;
  searchConfig: SearchConfig;
  adaptiveLearning: {
    enabled: boolean;
    feedbackThreshold: number;
    learningRate: number;
  };
}

// Centralized default configurations
const DEFAULT_DOCUMENT_CONFIG: DocumentProcessingConfig = {
  sourceDirectory: './docs-to-convert',
  outputDirectory: './docs-for-nlp',
  extensions: ['.doc', '.docx', '.txt'],
  maxFileSize: 50 * 1024 * 1024, // 50MB
  concurrency: 4,
  preserveParagraphs: true,
};

const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  rootDirectory: './documents',
  extensions: ['.doc', '.docx', '.txt'],
  maxFileSize: 50 * 1024 * 1024,
  concurrency: 4,
  ukrainianStemming: true,
  useBM25: true,
  bm25K1: 1.2,
  bm25B: 0.75,
  caching: {
    enabled: true,
    textCacheDir: '.cache/txt',
    indexCacheDir: '.cache/index',
    globalIndexPath: '.cache/global-inverted-index.json.gz',
  },
};

const DEFAULT_NLP_CONFIG: NLPConfig = {
  inputDirectory: './nlp-input',
  outputDirectory: './nlp-output',
  searchConfig: DEFAULT_SEARCH_CONFIG,
  adaptiveLearning: {
    enabled: true,
    feedbackThreshold: 0.8,
    learningRate: 0.1,
  },
};

// Configuration factory with environment variable support
function createConfig<T>(defaultConfig: T, envOverrides: Partial<T> = {}): T {
  return { ...defaultConfig, ...envOverrides };
}

export {
  createConfig,
  DEFAULT_DOCUMENT_CONFIG,
  DEFAULT_NLP_CONFIG,
  DEFAULT_SEARCH_CONFIG,
};

export type { DocumentProcessingConfig, NLPConfig, SearchConfig };
