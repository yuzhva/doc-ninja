import path from 'path';

import { MegaSearch, createMegaSearch } from './mega-search';

// Production-ready types that match the actual implementation
type SearchOptions = {
  topN?: number;
  fuzzy?: boolean;
  fuzzyThreshold?: number;
  snippetsLimit?: number | 'ALL';
};

type SearchResult = {
  doc?: {
    fileName: string;
    filePath: string;
    language: string;
    [key: string]: any;
  };
  score: number;
  snippets: string[];
};

// Production-ready batch processing function
async function batchSearch(
  megaSearch: MegaSearch,
  queries: string[],
  options: SearchOptions & { batchSize?: number } = {},
): Promise<Array<{ query: string; results: SearchResult[] }>> {
  const { batchSize = 16, ...searchOptions } = options;
  const allResults: Array<{ query: string; results: SearchResult[] }> = [];

  console.log(`[BATCH] Starting batch search for ${queries.length} queries`);
  console.log(
    `[BATCH] Batch size: ${batchSize}, Search options:`,
    searchOptions,
  );

  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    console.log(
      `[BATCH] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(queries.length / batchSize)}`,
    );

    const batchResults = await Promise.all(
      batch.map(async (query) => {
        console.log(`[BATCH] Searching for: "${query}"`);
        const results = await megaSearch.search(query, searchOptions);
        return { query, results };
      }),
    );

    allResults.push(...batchResults);
    console.log(
      `[BATCH] Processed ${Math.min(i + batchSize, queries.length)}/${queries.length} queries`,
    );
  }

  return allResults;
}

// Production-ready result formatter
function formatResults(
  queryResults: Array<{ query: string; results: SearchResult[] }>,
) {
  queryResults.forEach(({ query, results }, queryIdx) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Query #${queryIdx + 1}: "${query}"`);
    console.log(`Found ${results.length} result(s)`);
    console.log(`${'='.repeat(60)}`);

    if (results.length === 0) {
      console.log('No results found for this query.');
      return;
    }

    results.forEach((result, resultIdx) => {
      console.log(`\nResult #${resultIdx + 1}:`);
      console.log(`  📄 File: ${result.doc?.fileName || 'Unknown'}`);
      console.log(`  📊 Score: ${result.score.toFixed(3)}`);
      console.log(`  🌐 Language: ${result.doc?.language || 'Unknown'}`);

      if (result.snippets && result.snippets.length > 0) {
        console.log(`  📝 Found ${result.snippets.length} snippet(s):`);
        result.snippets.forEach((snippet, snippetIdx) => {
          // Clean up snippet for display (remove extra whitespace)
          const cleanSnippet = snippet.replace(/\s+/g, ' ').trim();
          console.log(`    ${snippetIdx + 1}. ${cleanSnippet}`);
        });
      } else {
        console.log(`  ⚠️  No snippets found.`);
      }

      if (resultIdx < results.length - 1) {
        console.log(`  ${'-'.repeat(40)}`);
      }
    });
  });
}

// Production-ready main function with flexible configuration
async function main() {
  try {
    console.log('🚀 Initializing Mega Search System...');

    const megaSearch = await createMegaSearch({
      rootDirectory: path.join(__dirname, 'documents'),
      concurrency: 4,
    });

    // Get search configuration from command line or environment
    const queries =
      process.argv.slice(2).length > 0
        ? [process.argv.slice(2).join(' ')]
        : ['начальник управління']; // default query

    const searchOptions: SearchOptions = {
      topN: Number(process.env.TOP_N) || 5,
      fuzzy: process.env.FUZZY !== 'false', // default true
      fuzzyThreshold: Number(process.env.FUZZY_THRESHOLD) || 1,
      snippetsLimit:
        process.env.SNIPPETS_LIMIT === 'ALL'
          ? 'ALL'
          : Number(process.env.SNIPPETS_LIMIT) || 3,
    };

    console.log('🔍 Search Configuration:');
    console.log(`  Queries: ${queries.map((q) => `"${q}"`).join(', ')}`);
    console.log(`  Options:`, searchOptions);

    // Perform batch search
    const startTime = Date.now();
    const queryResults = await batchSearch(megaSearch, queries, {
      ...searchOptions,
      batchSize: 16,
    });
    const endTime = Date.now();

    // Display results
    formatResults(queryResults);

    // Display performance summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 Performance Summary:');
    console.log(`  ⏱️  Total search time: ${endTime - startTime}ms`);
    console.log(
      `  📈 Average time per query: ${Math.round((endTime - startTime) / queries.length)}ms`,
    );

    const stats = megaSearch.getStats();
    console.log(
      `  📚 Corpus: ${stats.documentsCount} documents, ${stats.termsCount} unique terms`,
    );
    console.log(`  🔤 Total tokens: ${stats.totalTokens.toLocaleString()}`);

    // Usage examples
    console.log(`\n${'='.repeat(60)}`);
    console.log('💡 Usage Examples:');
    console.log(
      '  Basic search: node test--mega-search.ts "your search query"',
    );
    console.log(
      '  Show all snippets: SNIPPETS_LIMIT=ALL node test--mega-search.ts "query"',
    );
    console.log('  More results: TOP_N=10 node test--mega-search.ts "query"');
    console.log(
      '  Disable fuzzy search: FUZZY=false node test--mega-search.ts "query"',
    );
  } catch (error) {
    console.error('❌ Error during search:', error);
    process.exit(1);
  }
}

// Export for programmatic usage
export { batchSearch, formatResults, type SearchOptions, type SearchResult };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
