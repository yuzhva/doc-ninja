import { createNLPAnalyzer } from '../../src/index.mjs';

async function adaptiveLearningExample() {
  console.log('🧠 Starting Adaptive Learning Example');

  // Create analyzer with adaptive learning enabled
  const analyzer = createNLPAnalyzer({
    useWorkers: false,
    enableAdaptiveLearning: true,
  });

  try {
    const content = `This product is absolutely terrible. I hate it completely.`;

    const result = await analyzer.analyzeWithLearning(
      content,
      {
        id: 'learning-test',
        title: 'Review',
        size: content.length,
        format: 'text' as const,
      },
      {
        tasks: ['sentiment'],
      },
    );

    console.log('📊 Analysis Result:');
    console.log('Sentiment:', result.result.tasks.sentiment.overall.label);
    console.log('Learning Opportunities:', result.learningOpportunities.length);

    // Show learning stats
    const stats = analyzer.getLearningStats();
    console.log('\n🧠 Learning Stats:', stats);
  } catch (error: Error | any) {
    console.error('Analysis failed:', error.message);
  } finally {
    await analyzer.dispose();
    console.log('✅ Adaptive learning example completed');
  }
}

adaptiveLearningExample().catch(console.error);
