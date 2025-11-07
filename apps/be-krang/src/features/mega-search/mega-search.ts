import { DocumentExtractor } from './document-parsers';
import { FileIndexer } from './file-indexer';
import { UkrainianTextProcessor } from './text-processor';
import { SearchConfig } from './types';

class MegaSearch {
  private indexer: FileIndexer;
  private textProcessor: UkrainianTextProcessor;

  constructor(private config: SearchConfig) {
    this.indexer = new FileIndexer(config);
    this.textProcessor = new UkrainianTextProcessor();
  }

  async initialize(): Promise<void> {
    console.log('Initializing Mega Search system...');
    console.log(`Root directory: ${this.config.rootDirectory}`);
    console.log(`Supported extensions: ${this.config.extensions.join(', ')}`);
    console.log(
      `Ukrainian stemming: ${this.config.ukrainianStemming ? 'enabled' : 'disabled'}`,
    );

    await this.indexer.buildFullIndex();

    const stats = this.indexer.getStats();
    console.log(
      `Indexing complete: ${stats.documentsCount} documents, ${stats.termsCount} unique terms`,
    );
  }

  async reindex(): Promise<void> {
    await this.indexer.buildFullIndex();
  }

  getStats() {
    return this.indexer.getStats();
  }

  // Placeholder for future search functionality
  async search(query: string): Promise<any[]> {
    // TODO: Implement search algorithm with TF-IDF scoring
    console.log(`Searching for: "${query}"`);
    return [];
  }

  async testDocumentParsing(): Promise<void> {
    console.log('Testing document parsing...');

    const files = await this.indexer.discoverFiles();
    console.log(`Found ${files.length} files to test`);

    for (const file of files.slice(0, 5)) { // Test first 5 files
      try {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Testing: ${file.fileName} (${(file.size / 1024).toFixed(1)} KB)`);
        console.log(`File path: ${file.filePath}`);

        const extractor = new DocumentExtractor();
        const startTime = Date.now();
        const text = await extractor.extractText(file.filePath);
        const extractionTime = Date.now() - startTime;

        console.log(`Extracted ${text.length} characters in ${extractionTime}ms`);

        if (text.length > 0) {
          // Detect language
          const language = this.textProcessor.detectLanguage(text);
          console.log(`Detected language: ${language}`);

          const preview = text.substring(0, 300).replace(/\s+/g, ' ');
          console.log(`Preview: "${preview}${text.length > 300 ? '...' : ''}"`);

          // Test tokenization
          const tokens = this.textProcessor.tokenize(text);
          console.log(`Tokenized into ${tokens.length} tokens`);

          if (tokens.length > 0) {
            console.log(`First 15 tokens: ${tokens.slice(0, 15).map(t => t.term).join(', ')}`);

            // Show token statistics
            const uniqueTokens = new Set(tokens.map(t => t.term));
            console.log(`Unique tokens: ${uniqueTokens.size}`);

            // Test stemming if enabled
            if (this.config.ukrainianStemming) {
              const stemmedSample = tokens.slice(0, 5).map(t =>
                `${t.term} -> ${this.textProcessor.stemWord(t.term)}`
              );
              console.log(`Stemming sample: ${stemmedSample.join(', ')}`);
            }

            // Show language-specific analysis
            const ukrainianTokens = tokens.filter(t => /[а-яїієґ]/.test(t.term));
            const englishTokens = tokens.filter(t => /[a-z]/.test(t.term) && !/[а-яїієґ]/.test(t.term));
            console.log(`Language breakdown: ${ukrainianTokens.length} Ukrainian, ${englishTokens.length} English tokens`);
          }
        } else {
          console.log('⚠️  No text extracted - this file might be corrupted or use unsupported encoding');
        }

      } catch (error) {
        console.error(`❌ Failed to parse ${file.fileName}:`, error instanceof Error ? error.message : String(error));
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log('Document parsing test completed');
  }
}

// Default configuration for Ukrainian document search
const defaultConfig: SearchConfig = {
  rootDirectory: './documents',
  extensions: ['.doc', '.docx', '.txt'],
  maxFileSize: 50 * 1024 * 1024, // 50MB
  concurrency: 4,
  ukrainianStemming: true,
};

// Main factory function
async function createMegaSearch(
  config: Partial<SearchConfig> = {},
): Promise<MegaSearch> {
  const finalConfig = { ...defaultConfig, ...config };
  const megaSearch = new MegaSearch(finalConfig);

  await megaSearch.initialize();
  return megaSearch;
}

// Legacy compatibility
async function createFileIndexer(
  config: Partial<SearchConfig> = {},
): Promise<FileIndexer> {
  const finalConfig = { ...defaultConfig, ...config };
  const indexer = new FileIndexer(finalConfig);
  return indexer;
}

// Test function for CLI usage
async function testMegaSearch(
  config: Partial<SearchConfig> = {},
): Promise<void> {
  const finalConfig = { ...defaultConfig, ...config };
  const megaSearch = new MegaSearch(finalConfig);

  // Test without full indexing first
  await megaSearch.testDocumentParsing();
}

export {
  createFileIndexer,
  createMegaSearch,
  defaultConfig,
  MegaSearch,
  testMegaSearch,
};
