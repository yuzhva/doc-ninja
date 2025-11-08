import { UkrainianNameMatcher } from '../nlp/name-matcher.mts';

async function runInlineExample() {
  const matcher = new UkrainianNameMatcher();

  // Your base names (nominative case)
  const baseNames = ['Іван Богуслав', 'Микола Бобер'];

  // Sample Ukrainian text with declensions
  const content = `
    У вівторок на засіданні ради підприємців виступав представник аграрного кооперативу з Полтавщини.
    У своїй промові він неодноразово посилався на досвід Миколи Бобера, відомого фермера, який запровадив сучасні системи зрошення на своїх теплицях.
    За словами доповідача, саме завдяки ідеям Бобера вдалося підвищити врожайність на понад двадцять відсотків,
    і тепер його методи вивчають у кількох аграрних коледжах країни.
  `;

  try {
    // Method 1: Using NER (Named Entity Recognition)
    console.log('=== Using NER approach ===');
    const nerMatches = await matcher.findNames(content, baseNames);
    console.log(`NER found ${nerMatches.length} matches`);

    if (nerMatches.length === 0) {
      console.log('No NER matches found. This might be due to:');
      console.log('- Model not recognizing Ukrainian names as entities');
      console.log('- Different entity labels than expected');
      console.log('- Limited Ukrainian language support in the model');
    }

    nerMatches.forEach((match) => {
      console.log(
        `Found: "${match.declension}" (base: ${match.name}) at position ${
          match.position
        }, confidence: ${match.confidence.toFixed(3)}`,
      );
    });

    // Method 2: Using semantic similarity
    console.log('\n=== Using Similarity approach ===');
    const simMatches = await matcher.findNamesWithSimilarity(
      content,
      baseNames,
    );
    console.log(`Similarity approach found ${simMatches.length} matches`);
    simMatches.forEach((match) => {
      console.log(
        `Found: "${match.declension}" (base: ${match.name}) at position ${
          match.position
        }, confidence: ${match.confidence.toFixed(3)}`,
      );
    });
  } catch (error) {
    console.error('Error finding names:', error);
  }
}

// Run the example
runInlineExample();
