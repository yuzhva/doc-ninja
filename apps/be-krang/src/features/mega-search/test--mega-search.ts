import path from 'path';

import { createMegaSearch } from './mega-search';
import { testMegaSearch } from './mega-search.ts';

function testCaseOne() {
  testMegaSearch({ rootDirectory: path.join(__dirname, 'documents') });
}

async function main() {
  const megaSearch = await createMegaSearch({
    rootDirectory: path.join(__dirname, 'documents'), // adjust if needed
  });

  const query = process.argv.slice(2).join(' ') || 'начальник управління'; // or any English query
  console.log(`\nSearching for: "${query}"\n`);

  const results = await megaSearch.search(query, 5);

  results.forEach((result, idx) => {
    console.log(`Result #${idx + 1}:`);
    console.log(`File: ${result.doc?.fileName}`);
    console.log(`Score: ${result.score.toFixed(2)}`);
    console.log(`Snippet: ${result.snippet}`);
    console.log('---');
  });
}

// testCaseOne()
main().catch(console.error);
