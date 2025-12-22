import type {
  AnalysisConfig,
  AnalysisResult,
  PostProcessor,
  TextMetadata,
} from '../../src/index.mjs';
import { createNLPAnalyzer } from '../../src/index.mjs';

// Define extended metadata type for our custom processors
interface EnhancedMetadata {
  wordCount?: number;
  readingTimeMinutes?: number;
  enhancedAt?: string;
  textCharacteristics?: {
    averageWordsPerSentence: number;
    sentenceCount: number;
    paragraphCount: number;
  };
  humanSummary?: string;
  timestampProcessedAt?: number;
  [key: string]: any; // Allow other dynamic properties
}

// Define custom post-processors
const confidenceBoostProcessor: PostProcessor = (
  result: AnalysisResult,
  document: { content: string; metadata: TextMetadata },
  config: AnalysisConfig,
): AnalysisResult => {
  console.log('🔧 Running confidence boost processor...');

  // Boost confidence for results that seem very certain
  const boostedResult = { ...result };

  if (boostedResult.tasks.sentiment?.overall) {
    const sentiment = boostedResult.tasks.sentiment.overall;
    // If sentiment is very positive or negative, boost confidence
    if (sentiment.score > 0.8) {
      sentiment.score = Math.min(0.95, sentiment.score * 1.1);
    }
  }

  if (boostedResult.tasks.entities?.entities) {
    // Boost confidence for entities that appear multiple times
    const entityCounts = new Map<string, number>();
    boostedResult.tasks.entities.entities.forEach((entity: any) => {
      entityCounts.set(entity.text, (entityCounts.get(entity.text) || 0) + 1);
    });

    boostedResult.tasks.entities.entities.forEach((entity: any) => {
      const count = entityCounts.get(entity.text) || 1;
      if (count > 1) {
        entity.confidence = Math.min(0.95, entity.confidence * 1.2);
      }
    });
  }

  return boostedResult;
};

const metadataEnhancerProcessor: PostProcessor = (
  result: AnalysisResult,
  document: { content: string; metadata: TextMetadata },
  config: AnalysisConfig,
): AnalysisResult => {
  console.log('📊 Running metadata enhancer processor...');

  // Create enhanced metadata object
  const enhancedMetadata: EnhancedMetadata = {
    ...result.metadata,
    // Add word count and reading time
    wordCount: document.content.split(/\s+/).length,
    readingTimeMinutes: Math.ceil(document.content.split(/\s+/).length / 200), // Avg 200 words/min

    // Add text characteristics
    textCharacteristics: {
      averageWordsPerSentence: calculateAverageWordsPerSentence(
        document.content,
      ),
      sentenceCount: document.content.split(/[.!?]+/).filter((s) => s.trim())
        .length,
      paragraphCount: document.content.split(/\n\s*\n/).filter((p) => p.trim())
        .length,
    },

    // Enhanced at timestamp
    enhancedAt: new Date().toISOString(),
  };

  return {
    ...result,
    metadata: enhancedMetadata as any, // Cast to any to satisfy strict AnalysisResult type
  };
};

const resultSummarizerProcessor: PostProcessor = (
  result: AnalysisResult,
  document: { content: string; metadata: TextMetadata },
  config: AnalysisConfig,
): AnalysisResult => {
  console.log('📝 Running result summarizer processor...');

  // Create summarized metadata
  const summarizedMetadata: EnhancedMetadata = {
    ...result.metadata,
  };

  // Create a human-readable summary
  const summaryParts: string[] = [];

  if (result.tasks.sentiment?.overall) {
    const sentiment = result.tasks.sentiment.overall;
    summaryParts.push(
      `The document has a ${sentiment.label} sentiment (${(sentiment.score * 100).toFixed(1)}% confidence)`,
    );
  }

  if (result.tasks.entities?.entities?.length > 0) {
    const entityTypes = new Set(
      result.tasks.entities.entities.map((e: any) => e.label),
    );
    summaryParts.push(
      `Contains ${result.tasks.entities.entities.length} entities of types: ${Array.from(entityTypes).join(', ')}`,
    );
  }

  if (result.tasks.classification?.topCategory) {
    const category = result.tasks.classification.topCategory;
    summaryParts.push(
      `Classified as ${category.label} (${(category.score * 100).toFixed(1)}% confidence)`,
    );
  }

  // Add summary to metadata
  summarizedMetadata.humanSummary = summaryParts.join('. ') + '.';

  return {
    ...result,
    metadata: summarizedMetadata as any,
  };
};

function calculateAverageWordsPerSentence(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim());
  const totalWords = text.split(/\s+/).length;
  return sentences.length > 0 ? totalWords / sentences.length : 0;
}

async function postProcessorsExample() {
  console.log('🔄 Starting Post-Processors Example');

  // Create analyzer with post-processors - modelsPath will use default
  const analyzer = createNLPAnalyzer({
    maxWorkers: 2,
    cacheEnabled: true,
    useWorkers: false,
    // modelsPath removed - uses default
    postProcessors: [
      confidenceBoostProcessor,
      metadataEnhancerProcessor,
      resultSummarizerProcessor,
    ],
  });

  try {
    // Sample document with rich content
    const content = `
      Apple Inc. is a multinational technology company headquartered in Cupertino, California.
      The company was founded by Steve Jobs, Steve Wozniak, and Ronald Wayne in 1976.
      Apple is known for its innovative products like the iPhone, iPad, and MacBook.

      In recent years, Apple has focused heavily on services and sustainability.
      The company's revenue has grown significantly, making it one of the most valuable
      companies in the world. CEO Tim Cook has led the company since 2011.

      Apple's commitment to privacy and environmental responsibility has been outstanding.
      Their products are loved by millions of customers worldwide.
    `;

    const metadata = {
      id: 'apple-overview',
      title: 'Apple Inc. Company Overview',
      size: content.length,
      format: 'text' as const,
    };

    console.log('📄 Analyzing document with post-processors...');

    // Analyze with post-processing
    const result = await analyzer.analyze(content, metadata, {
      tasks: ['sentiment', 'entities', 'classification'],
      chunkSize: 512,
      useCache: false, // Disable cache to see post-processing effects
    });

    // Cast metadata to our enhanced type for access
    const enhancedMeta = result.metadata as unknown as EnhancedMetadata;

    console.log('\n✅ Analysis Results (Post-Processed):');
    console.log('📊 Processing Time:', result.metadata.processingTime, 'ms');
    console.log(
      '🎯 Overall Confidence:',
      (result.metadata.confidence * 100).toFixed(1),
      '%',
    );

    // Show enhanced metadata
    console.log('\n📊 Enhanced Metadata:');
    console.log('  Word Count:', enhancedMeta.wordCount);
    console.log('  Reading Time:', enhancedMeta.readingTimeMinutes, 'minutes');
    console.log('  Enhanced At:', enhancedMeta.enhancedAt);

    if (enhancedMeta.textCharacteristics) {
      const chars = enhancedMeta.textCharacteristics;
      console.log('  Text Characteristics:');
      console.log(
        '    Average Words/Sentence:',
        chars.averageWordsPerSentence.toFixed(1),
      );
      console.log('    Sentence Count:', chars.sentenceCount);
      console.log('    Paragraph Count:', chars.paragraphCount);
    }

    // Show human summary
    if (enhancedMeta.humanSummary) {
      console.log('\n📝 Human Summary:');
      console.log('  ', enhancedMeta.humanSummary);
    }

    // Show individual results
    if (result.tasks.sentiment) {
      console.log('\n😊 Sentiment (Post-Processed):');
      console.log(
        '  Overall:',
        result.tasks.sentiment.overall.label,
        `(${(result.tasks.sentiment.overall.score * 100).toFixed(1)}%)`,
      );
    }

    if (result.tasks.entities && result.tasks.entities.entities.length > 0) {
      console.log('\n🏷️  Top Entities (Post-Processed):');
      result.tasks.entities.entities
        .sort((a: any, b: any) => b.confidence - a.confidence)
        .slice(0, 5)
        .forEach((entity: any) => {
          console.log(
            `  ${entity.label}: "${entity.text}" (${(entity.confidence * 100).toFixed(1)}%)`,
          );
        });
    }

    // Test post-processor pipeline stats
    const pipelineStats = analyzer.getPostProcessorStats();
    console.log('\n🔄 Post-Processor Pipeline Stats:');
    console.log('  Processor Count:', pipelineStats.processorCount);
    pipelineStats.processors.forEach((proc: any) => {
      console.log(`  - ${proc.name} (index: ${proc.index})`);
    });

    // Demonstrate dynamic post-processor management
    console.log('\n🔧 Testing dynamic post-processor management...');

    // Add another processor
    const timestampProcessor: PostProcessor = (result) => {
      console.log('⏰ Adding timestamp processor...');
      return {
        ...result,
        metadata: {
          ...result.metadata,
          timestampProcessedAt: Date.now(),
        } as any,
      };
    };

    analyzer.addPostProcessor(timestampProcessor);

    // Analyze again with the additional processor
    const secondResult = await analyzer.analyze(content, metadata, {
      tasks: ['sentiment'],
      useCache: false,
    });

    const secondMeta = secondResult.metadata as unknown as EnhancedMetadata;

    console.log('  Timestamp Added:', !!secondMeta.timestampProcessedAt);

    // Clear all processors and test
    analyzer.clearPostProcessors();
    const finalStats = analyzer.getPostProcessorStats();
    console.log('  Processors After Clear:', finalStats.processorCount);
  } catch (error: Error | any) {
    console.error('❌ Analysis failed:', error.message);
  } finally {
    console.log('\n🧹 Cleaning up...');
    await analyzer.dispose();
    console.log('✅ Post-processors example completed');
  }
}

// Run the example
postProcessorsExample().catch(console.error);
