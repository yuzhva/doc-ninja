import {
  AnalysisConfig,
  DocumentChunk,
  createNLPAnalyzer,
} from '../../src/index';
import { CustomProcessorRegistry } from '../../src/nlp-analyzer/processors/index';

// Define a custom processor for technical document analysis
class TechnicalDocumentProcessor {
  async process(chunks: DocumentChunk[], config: AnalysisConfig): Promise<any> {
    const fullText = chunks.map((chunk) => chunk.text).join(' ');

    // Technical keywords and patterns
    const technicalKeywords = [
      'API',
      'database',
      'server',
      'client',
      'framework',
      'library',
      'algorithm',
      'function',
      'method',
      'class',
      'interface',
      'module',
      'component',
      'service',
      'authentication',
      'authorization',
      'encryption',
    ];

    const programmingLanguages = [
      'JavaScript',
      'TypeScript',
      'Python',
      'Java',
      'C++',
      'C#',
      'Go',
      'Rust',
      'PHP',
      'Ruby',
      'Swift',
      'Kotlin',
      'Scala',
      'R',
      'MATLAB',
    ];

    // Count technical terms
    const techTerms = technicalKeywords.filter((keyword) =>
      fullText.toLowerCase().includes(keyword.toLowerCase()),
    );

    const languages = programmingLanguages.filter((lang) =>
      fullText.includes(lang),
    );

    // Calculate technical density
    const words = fullText.split(/\s+/).length;
    const technicalDensity = techTerms.length / Math.max(words, 1);

    // Determine document type
    let documentType = 'GENERAL';
    if (technicalDensity > 0.05) documentType = 'TECHNICAL';
    if (languages.length > 0) documentType = 'PROGRAMMING';
    if (fullText.toLowerCase().includes('specification'))
      documentType = 'SPECIFICATION';

    return {
      documentType,
      technicalDensity,
      confidence: Math.min(0.95, 0.5 + technicalDensity * 2),
      detectedKeywords: techTerms,
      programmingLanguages: languages,
      metrics: {
        totalWords: words,
        technicalTerms: techTerms.length,
        uniqueLanguages: languages.length,
      },
    };
  }
}

async function customProcessorsExample() {
  console.log('🔧 Starting Custom Processors Example');

  // Register our custom processor
  const registry = CustomProcessorRegistry.getInstance();
  registry.register({
    name: 'technical-analysis',
    task: 'technical-analysis',
    description: 'Analyzes technical documentation and code-related content',
    requiresModel: false, // This processor doesn't need ML models
    processorClass: TechnicalDocumentProcessor,
  });

  console.log('✅ Registered custom technical analysis processor');

  // Create analyzer - modelsPath will use default
  const analyzer = createNLPAnalyzer({
    maxWorkers: 2,
    cacheEnabled: true,
    useWorkers: false,
    // modelsPath removed - uses default
  });

  try {
    // Technical document sample
    const technicalContent = `
      This API specification describes the REST endpoints for user authentication.
      The service is implemented in TypeScript using Express.js framework.

      Authentication uses JWT tokens with RSA encryption. The database layer
      uses PostgreSQL with TypeORM for object-relational mapping.

      Key components include:
      - UserService class for user management
      - AuthController for handling authentication requests
      - JWT middleware for token validation
      - Database connection pool configuration
    `;

    const metadata = {
      id: 'tech-doc-1',
      title: 'API Authentication Specification',
      size: technicalContent.length,
      format: 'text' as const,
    };

    console.log('📄 Analyzing technical document...');

    // Analyze with custom processor
    const result = await analyzer.analyze(technicalContent, metadata, {
      // Include our custom task
      tasks: ['sentiment', 'entities', 'technical-analysis'],
      chunkSize: 512,
      useCache: true,
    });

    console.log('\n✅ Analysis Results:');
    console.log('📊 Processing Time:', result.metadata.processingTime, 'ms');

    // Show custom processor results
    if (result.tasks['technical-analysis']) {
      const techResults = result.tasks['technical-analysis'];
      console.log('\n🔧 Technical Analysis:');
      console.log('  Document Type:', techResults.documentType);
      console.log(
        '  Technical Density:',
        (techResults.technicalDensity * 100).toFixed(2),
        '%',
      );
      console.log(
        '  Confidence:',
        (techResults.confidence * 100).toFixed(1),
        '%',
      );
      console.log('  Keywords Found:', techResults.detectedKeywords.join(', '));
      console.log(
        '  Programming Languages:',
        techResults.programmingLanguages.join(', '),
      );
      console.log('  Metrics:', techResults.metrics);
    }

    // Standard results
    if (result.tasks.sentiment) {
      console.log('\n😊 Sentiment:', result.tasks.sentiment.overall.label);
    }

    if (result.tasks.entities && result.tasks.entities.entities.length > 0) {
      console.log(
        '\n🏷️  Entities Found:',
        result.tasks.entities.entities.length,
      );
    }

    // Test with non-technical document
    console.log('\n📄 Analyzing non-technical document for comparison...');

    const nonTechnicalContent = `
      Yesterday was a beautiful sunny day. I went to the park with my family
      and we had a wonderful picnic. The children played on the swings while
      we enjoyed sandwiches and fresh lemonade. It was such a relaxing afternoon.
    `;

    const nonTechResult = await analyzer.analyze(
      nonTechnicalContent,
      {
        id: 'family-doc-1',
        title: 'Family Picnic Story',
        size: nonTechnicalContent.length,
        format: 'text' as const,
      },
      {
        tasks: ['technical-analysis'],
        useCache: true,
      },
    );

    if (nonTechResult.tasks['technical-analysis']) {
      const nonTechResults = nonTechResult.tasks['technical-analysis'];
      console.log('\n🏠 Non-Technical Analysis (for comparison):');
      console.log('  Document Type:', nonTechResults.documentType);
      console.log(
        '  Technical Density:',
        (nonTechResults.technicalDensity * 100).toFixed(2),
        '%',
      );
      console.log(
        '  Confidence:',
        (nonTechResults.confidence * 100).toFixed(1),
        '%',
      );
    }
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
  } finally {
    console.log('\n🧹 Cleaning up...');
    await analyzer.dispose();
    console.log('✅ Custom processors example completed');
  }
}

// Run the example
customProcessorsExample().catch(console.error);
