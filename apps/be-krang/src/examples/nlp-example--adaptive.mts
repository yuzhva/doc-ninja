import { AdaptiveUkrainianNameMatcher } from '../nlp/adaptive-matcher.mts';

async function runAdaptiveDemo() {
  console.log('🧠 Starting Adaptive Ukrainian Name Matcher Demo...\n');

  // Initialize the adaptive matcher
  const adaptiveMatcher = new AdaptiveUkrainianNameMatcher();
  await adaptiveMatcher.initialize();

  // Your base names (nominative case)
  const baseNames = ['Іван Петренко', 'Марія Коваленко', 'Олександр Шевченко'];

  // Sample Ukrainian text with names in different declensions
  const content = `
    На засіданні комітету були присутні декілька важливих осіб.
    Іван Петренко виступив з доповіддю про розвиток інфраструктури.
    Марії Коваленко було доручено підготувати звіт до наступного тижня.
    Олександра Шевченка призначили головою підкомітету з питань освіти.
    Також на засіданні було відзначено внесок Петренка Івана у розвиток регіону.
    Коваленко Марія представила детальний аналіз бюджетних витрат.
  `;

  try {
    console.log('📋 Sample text:');
    console.log(content.trim());
    console.log('\n🔍 Searching for names using adaptive matching...\n');

    // Find names with adaptive matching
    const matches = await adaptiveMatcher.findNamesWithSimilarity(content, baseNames);

    console.log(`✅ Found ${matches.length} matches:\n`);

    matches.forEach((match, index) => {
      console.log(`${index + 1}. "${match.declension}"`);
      console.log(`   Base name: ${match.name}`);
      console.log(`   Position: ${match.position}`);
      console.log(`   Confidence: ${(match.confidence * 100).toFixed(1)}%`);
      console.log('');
    });

    // Show current performance stats
    const stats = adaptiveMatcher.getPerformanceStats();
    console.log('📊 Current Performance Stats:');
    console.log(`   Total feedback received: ${stats.totalFeedback}`);
    console.log(`   Recent accuracy: ${stats.recentAccuracy.toFixed(1)}%`);
    console.log(`   Current thresholds:`);
    console.log(`     - Two-word match: ${stats.currentThresholds.twoWordMatch.toFixed(3)}`);
    console.log(`     - Three-word match: ${stats.currentThresholds.threeWordMatch.toFixed(3)}`);
    console.log(`     - Individual similarity: ${stats.currentThresholds.individualSimilarity.toFixed(3)}`);

    // Simulate providing feedback
    console.log('\n🎓 Simulating user feedback...');

    if (matches.length > 0) {
      // Provide positive feedback for the first match
      await adaptiveMatcher.addFeedback(matches[0], true);

      // If there are more matches, provide mixed feedback
      if (matches.length > 1) {
        await adaptiveMatcher.addFeedback(matches[1], true);
      }

      if (matches.length > 2) {
        // Simulate negative feedback (maybe the confidence was too low for this match)
        await adaptiveMatcher.addFeedback(matches[2], false);
      }
    }

    // Show updated stats after feedback
    const updatedStats = adaptiveMatcher.getPerformanceStats();
    console.log('\n📈 Updated Performance Stats after feedback:');
    console.log(`   Total feedback received: ${updatedStats.totalFeedback}`);
    console.log(`   Recent accuracy: ${updatedStats.recentAccuracy.toFixed(1)}%`);
    console.log(`   Updated thresholds:`);
    console.log(`     - Two-word match: ${updatedStats.currentThresholds.twoWordMatch.toFixed(3)}`);
    console.log(`     - Three-word match: ${updatedStats.currentThresholds.threeWordMatch.toFixed(3)}`);
    console.log(`     - Individual similarity: ${updatedStats.currentThresholds.individualSimilarity.toFixed(3)}`);

    console.log('\n🎯 Demo completed! The adaptive matcher has learned from your feedback.');
    console.log('💾 Settings have been saved to assets/adaptive-settings.json');

  } catch (error) {
    console.error('❌ Error during adaptive matching:', error);
  }
}

// Run the demo
runAdaptiveDemo();
