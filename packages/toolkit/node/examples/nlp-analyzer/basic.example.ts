import { createNLPAnalyzer } from '../../src/index.mjs';

async function basicExample() {
  console.log('🚀 Starting Basic NLP Analyzer Example');

  // Create analyzer instance - modelsPath will use default
  const analyzer = createNLPAnalyzer({
    maxWorkers: 2,
    cacheEnabled: true,
    useWorkers: false, // Start with false for simplicity
    enableMonitoring: true,
    enableRetries: true,
    // modelsPath is now optional - uses default: process.cwd()/models
  });

  try {
    // Sample document
    const content = `
      Hello, my name is John Smith and I work at Microsoft Corporation in Seattle.
      I'm really excited about this new project! It's going to be amazing.
      We're planning to launch it next quarter in New York.
    `;

    const metadata = {
      id: 'example-doc-1',
      title: 'Sample Document',
      size: content.length,
      format: 'text' as const,
    };

    console.log('📄 Analyzing sample document...');

    // Analyze the document
    const result = await analyzer.analyze(content, metadata, {
      tasks: ['sentiment', 'entities', 'classification'],
      chunkSize: 512,
      useCache: true,
    });

    console.log('\n✅ Analysis Results:');
    console.log('📊 Processing Time:', result.metadata.processingTime, 'ms');
    console.log(
      '🎯 Confidence:',
      (result.metadata.confidence * 100).toFixed(1),
      '%',
    );

    // Display results
    if (result.tasks.sentiment) {
      console.log('\n😊 Sentiment Analysis:');
      console.log(
        '  Overall:',
        result.tasks.sentiment.overall.label,
        `(${(result.tasks.sentiment.overall.score * 100).toFixed(1)}%)`,
      );
    }

    if (result.tasks.entities) {
      console.log('\n🏷️  Named Entities:');
      result.tasks.entities.entities.forEach((entity: any) => {
        console.log(
          `  ${entity.label}: "${entity.text}" (${(entity.confidence * 100).toFixed(1)}%)`,
        );
      });
    }

    if (result.tasks.classification) {
      console.log('\n📂 Classification:');
      console.log(
        '  Top Category:',
        result.tasks.classification.topCategory.label,
        `(${(result.tasks.classification.topCategory.score * 100).toFixed(1)}%)`,
      );
    }

    // Show cache statistics
    const cacheStats = analyzer.getCacheStats?.();
    if (cacheStats) {
      console.log('\n💾 Cache Statistics:');
      console.log('  Hit Rate:', cacheStats.hitRate.toFixed(1));
      console.log('  Size:', `${cacheStats.size}/${cacheStats.maxSize}`);
    }
  } catch (error: Error | any) {
    console.error('❌ Analysis failed:', error.message);

    if (error.message.includes('local_files_only')) {
      console.error('\n💡 Solution: Install models first:');
      console.error('   pnpm run install-models:default');
    }
  } finally {
    console.log('\n🧹 Cleaning up...');
    await analyzer.dispose();
    console.log('✅ Example completed');
  }
}

// Run the example
basicExample().catch(console.error);
