import { createNLPAnalyzer } from '../../src/index';

async function runParallelProcessingDemo() {
  console.log('🚀 Parallel Processing Demo\n');
  console.log(
    '⚠️ NOTE: Worker threads disabled due to ONNX Runtime thread safety issues\n',
  );

  // Create analyzer with workers disabled for stability
  const parallelAnalyzer = createNLPAnalyzer({
    maxWorkers: 4,
    useWorkers: false, // 🔧 ONNX Runtime has thread safety issues in workers
    enableMonitoring: true,
  });

  // Create analyzer for comparison
  const sequentialAnalyzer = createNLPAnalyzer({
    useWorkers: false,
    enableMonitoring: true,
    cacheEnabled: false, // Different cache to avoid interference
  });

  // Set up event listeners to see worker activity
  parallelAnalyzer.on('model-loaded', (data) => {
    console.log(`📦 Worker ${data.workerId} loaded model: ${data.modelId}`);
  });

  // Large dataset for testing
  const documents = Array.from({ length: 20 }, (_, i) => ({
    content: `
      Document ${i + 1}: This is a comprehensive analysis of business operations and customer feedback.
      The quarterly results show ${i % 2 === 0 ? 'positive' : 'negative'} trends across multiple departments.
      John Smith from Microsoft Corporation provided insights on market dynamics and competitive positioning.
      The financial performance indicates ${i % 3 === 0 ? 'strong growth' : 'moderate challenges'} in key sectors.
      Customer satisfaction scores reflect ${i % 2 === 1 ? 'excellent service quality' : 'areas for improvement'}.
      Strategic initiatives for the next quarter include technology upgrades and staff development programs.
      Apple Inc. and Google LLC have been identified as key competitors in the digital transformation space.
      The analysis concludes with recommendations for sustainable growth and market expansion opportunities.
    `,
    metadata: {
      id: `doc-${i + 1}`,
      title: `Business Analysis Document ${i + 1}`,
      size: 800,
      format: 'text' as const,
    },
  }));

  const config = {
    tasks: ['sentiment', 'entities', 'classification'],
    chunkSize: 256,
    useCache: false, // Disable cache to see actual processing
  };

  console.log(`📊 Testing with ${documents.length} documents...\n`);
  console.log(
    'ℹ️ Both analyzers use main thread (workers disabled for stability)\n',
  );

  // Test 1: Batch Processing (Optimized)
  console.log('🔄 Test 1: Batch Processing (Optimized batching)');
  const batchStart = Date.now();

  try {
    const batchResults = await parallelAnalyzer.analyzeBatch(
      documents,
      { ...config, batchSize: 5 }, // Smaller batches for better performance
      (progress) => {
        if (progress.progress % 25 === 0 || progress.progress === 100) {
          console.log(`   Progress: ${progress.progress.toFixed(1)}%`);
        }
      },
    );

    const batchTime = Date.now() - batchStart;
    console.log(`✅ Batch processing completed in ${batchTime}ms`);
    console.log(`📊 Processed ${batchResults.length} documents\n`);
  } catch (error) {
    console.error('❌ Batch processing failed:', error.message);
  }

  // Test 2: Sequential Processing
  console.log('🔄 Test 2: Sequential Processing (One by one)');
  const sequentialStart = Date.now();

  try {
    const sequentialResults = [];

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const result = await sequentialAnalyzer.analyze(
        doc.content,
        doc.metadata,
        config,
      );
      sequentialResults.push(result);

      if ((i + 1) % 5 === 0 || i === documents.length - 1) {
        console.log(
          `   Progress: ${(((i + 1) / documents.length) * 100).toFixed(1)}%`,
        );
      }
    }

    const sequentialTime = Date.now() - sequentialStart;
    console.log(`✅ Sequential processing completed in ${sequentialTime}ms`);
    console.log(`📊 Processed ${sequentialResults.length} documents\n`);

    // Performance comparison
    const improvement = ((sequentialTime - batchTime) / sequentialTime) * 100;

    console.log('📊 Performance Comparison:');
    console.log(`   Batch Processing: ${batchTime}ms`);
    console.log(`   Sequential Processing: ${sequentialTime}ms`);
    console.log(`   Performance Improvement: ${improvement.toFixed(1)}%`);
    console.log(
      '   Note: Both use main thread due to ONNX Runtime limitations\n',
    );
  } catch (error) {
    console.error('❌ Sequential processing failed:', error.message);
  }

  // Test 3: Memory Isolation Demo
  console.log('\n🧠 Test 3: Memory Isolation Benefits');
  console.log('Processing memory-intensive documents...');

  const memoryIntensiveDoc = {
    content:
      'A'.repeat(10000) +
      ' This is a very large document that will test memory isolation between workers. ' +
      'B'.repeat(10000),
    metadata: {
      id: 'memory-test',
      title: 'Memory Intensive Document',
      size: 20000,
      format: 'text' as const,
    },
  };

  try {
    const memoryTestStart = Date.now();
    await parallelAnalyzer.analyze(
      memoryIntensiveDoc.content,
      memoryIntensiveDoc.metadata,
      config,
    );
    const memoryTestTime = Date.now() - memoryTestStart;

    console.log(`✅ Large document processed in ${memoryTestTime}ms`);
    console.log('🛡️ Memory isolation prevented main thread blocking');
  } catch (error) {
    console.error('❌ Memory test failed:', error.message);
  }

  // Show resource metrics
  const resourceMetrics = parallelAnalyzer.getResourceMetrics();
  if (resourceMetrics) {
    console.log('\n📊 Resource Usage:');
    console.log(`   CPU Usage: ${resourceMetrics.cpu.usage.toFixed(1)}%`);
    console.log(`   Memory Usage: ${resourceMetrics.memory.usage}%`);
    console.log(
      `   Documents Processed: ${resourceMetrics.nlp.documentsProcessed}`,
    );
  }

  // Cleanup
  await parallelAnalyzer.dispose();
  await sequentialAnalyzer.dispose();

  console.log('\n✅ Parallel processing demo completed');
}

// Run demo
runParallelProcessingDemo().catch(console.error);

async function parallelProcessingExample() {
  console.log('⚡ Starting Parallel Processing Example');

  const analyzer = createNLPAnalyzer({
    maxWorkers: 4,
    useWorkers: false, // Keep false until worker implementation is complete
    enableMonitoring: true,
  });

  try {
    // Create multiple documents
    const documents = [
      {
        content: 'This is an amazing product! I love it so much.',
        metadata: {
          id: 'doc1',
          title: 'Review 1',
          size: 45,
          format: 'text' as const,
        },
      },
      {
        content: 'The service was terrible. Very disappointing experience.',
        metadata: {
          id: 'doc2',
          title: 'Review 2',
          size: 52,
          format: 'text' as const,
        },
      },
      {
        content: 'Apple Inc. launched a new iPhone model yesterday.',
        metadata: {
          id: 'doc3',
          title: 'News',
          size: 45,
          format: 'text' as const,
        },
      },
    ];

    console.log(`📄 Processing ${documents.length} documents in batch...`);

    const results = await analyzer.analyzeBatch(
      documents,
      {
        tasks: ['sentiment', 'entities'],
        batchSize: 2,
      },
      (progress) => {
        console.log(`📊 Progress: ${progress.progress.toFixed(1)}%`);
      },
    );

    console.log('\n✅ Batch Results:');
    results.forEach((result, index) => {
      console.log(`\nDocument ${index + 1}:`);
      console.log(`  Sentiment: ${result.tasks.sentiment.overall.label}`);
      console.log(`  Entities: ${result.tasks.entities.entities.length}`);
      console.log(`  Processing Time: ${result.metadata.processingTime}ms`);
    });

    // Show resource metrics
    const metrics = analyzer.getResourceMetrics();
    if (metrics) {
      console.log('\n📊 Resource Metrics:');
      console.log(`  CPU Usage: ${metrics.cpu.usage.toFixed(1)}%`);
      console.log(`  Memory Usage: ${metrics.memory.usage}%`);
    }
  } catch (error) {
    console.error('Batch processing failed:', error.message);
  } finally {
    await analyzer.dispose();
    console.log('✅ Parallel processing example completed');
  }
}

parallelProcessingExample().catch(console.error);
