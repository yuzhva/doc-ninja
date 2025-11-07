import path from 'path';

import { createMegaSearch } from './mega-search';

interface MegaSearch {
  search(query: string, limit: number): Promise<SearchResult[]>;
}

interface SearchResult {
  doc?: {
    fileName: string;
  };
  score: number;
  snippet: string;
}

async function batchSearch(
  megaSearch: MegaSearch,
  queries: string[],
  batchSize: number = 16,
): Promise<SearchResult[][]> {
  const results: SearchResult[][] = [];
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((q) => megaSearch.search(q, 5)),
    );
    results.push(...batchResults);
    console.log(
      `Processed ${Math.min(i + batchSize, queries.length)}/${queries.length} queries`,
    );
  }
  return results;
}

async function main() {
  const megaSearch = await createMegaSearch({
    rootDirectory: path.join(__dirname, 'documents'),
    concurrency: 4,
  });

  // Single example query from CLI or default
  const queries = [process.argv.slice(2).join(' ') || 'начальник управління'];

  const allResults = await batchSearch(megaSearch, queries, 16);

  allResults.forEach((resultArr, idx) => {
    console.log(`\nQuery #${idx + 1}: "${queries[idx]}"`);
    resultArr.forEach((result, rIdx) => {
      console.log(`Result #${rIdx + 1}:`);
      console.log(`File: ${result.doc?.fileName}`);
      console.log(`Score: ${result.score.toFixed(2)}`);
      console.log(`Snippet: ${result.snippet}`);
      console.log('---');
    });
  });
}

main().catch(console.error);
