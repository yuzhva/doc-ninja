# 🔍 Mega Search - Advanced Document Search Engine

A production-ready, feature-rich document search system with Ukrainian language support, advanced scoring algorithms, and UI-ready highlighting capabilities.

## ✨ Features

### 🎯 **Core Search Features**

- **BM25 Scoring**: Industry-standard relevance ranking (used by Elasticsearch)
- **Fuzzy Search**: every inflected form of a word, plus typo tolerance (edit distance, a swap of two letters counting as one typo), and optionally related words (derived words, surnames derived from the one searched)
- **Phrase Search**: Exact phrase matching with quotes (`"начальник управління"`)
- **Multi-language Support**: Ukrainian and English with proper stemming
- **Multiple Snippets**: Shows multiple context snippets per document

### 🚀 **Performance & Scalability**

- **Incremental Indexing**: Only reprocesses changed files
- **No Vocabulary Scans**: a query word's forms, related words and typos are looked up, not compared with every word in the index — typos by the letter pairs they share (see `vocabulary-index.mts`)
- **Disk Caching**: Intelligent caching of text extraction and indexes
- **Compact Document Indexes**: each word's place is saved as the gap from the word before and its length, not where it starts and ends — half the size (see `token-positions.mts`)
- **LRU Memory Management**: Efficient memory usage for large corpora
- **Compressed Storage**: Compressed inverted index storage
- **Pagination**: Efficient result pagination for large result sets

### 🎨 **UI Integration Ready**

- **Character-level Highlighting**: Precise positions for UI highlighting
- **Confidence Scoring**: Match quality metrics for fuzzy results
- **Rich Metadata**: Document language detection and metadata
- **Snippet Context**: Contextual text excerpts with highlighted matches

### 📄 **Document Processing**

- **Multiple Formats**: .doc, .docx, .txt support
- **Ukrainian Text Processing**: Proper tokenization, stemming, function words
- **Language Detection**: Automatic detection of document language
- **Error Resilience**: Graceful handling of corrupted files

## 🛠 Installation & Setup

```bash
# Install dependencies
npm install

# Initialize the search system
import { createMegaSearch } from './mega-search';

const megaSearch = await createMegaSearch({
  rootDirectory: './documents',
  extensions: ['.doc', '.docx', '.txt'],
  useBM25: true
});
```

## 💻 Usage Examples

### Basic Search

```typescript
import { createMegaSearch } from './mega-search';

const megaSearch = await createMegaSearch({
  rootDirectory: './documents',
});

// Simple search
const results = await megaSearch.search('начальник управління');

console.log(`Found ${results.pagination.totalResults} results`);
results.results.forEach((result) => {
  console.log(`📄 ${result.doc.fileName} (score: ${result.score})`);
  result.snippets.forEach((snippet) => {
    console.log(`  💬 ${snippet}`);
  });
});
```

### Advanced Search Options

```typescript
// Advanced search with all options
const results = await megaSearch.search('документ', {
  topN: 50, // Search through top 50 results
  isInflectedWordFormsAllowed: true, // "Allow fuzzy match": any inflected form of a word
  isRelatedWordsAllowed: false, // Not "Бондарук" for "Бондар" (on by default)
  maxTypoDistance: 1, // Allow 1 typo per word (fuzzy match on or off)
  snippetsLimit: 5, // Show up to 5 snippets per result
  page: 1, // First page
  pageSize: 10, // 10 results per page
});

// Access pagination info
const { pagination } = results;
console.log(`Page ${pagination.currentPage} of ${pagination.totalPages}`);
console.log(`Total results: ${pagination.totalResults}`);
```

### Phrase Search

```typescript
// Exact phrase matching
const results = await megaSearch.search('"начальник управління"');

// The system will only return documents containing the exact phrase
```

### UI Highlighting Integration

```typescript
const results = await megaSearch.search('управління');

results.results.forEach((result) => {
  // Use highlights for precise UI highlighting
  result.highlights.forEach((highlight) => {
    console.log(
      `Highlight "${highlight.originalWord}" at characters ${highlight.charStart}-${highlight.charEnd}`,
    );
    console.log(`Confidence: ${(highlight.confidence * 100).toFixed(1)}%`);

    // Use in UI framework
    highlightTextInDocument(
      highlight.charStart,
      highlight.charEnd,
      highlight.originalWord,
      highlight.confidence,
    );
  });
});
```

### Configuration Options

```typescript
const megaSearch = await createMegaSearch({
  // Document settings
  rootDirectory: './documents',
  extensions: ['.doc', '.docx', '.txt'],
  maxFileSize: 50 * 1024 * 1024, // 50MB limit

  // BM25 scoring (advanced users)
  useBM25: true,
  bm25K1: 1.2, // Term frequency saturation
  bm25B: 0.75, // Document length normalization

  // Performance
  concurrency: 4, // Parallel processing threads
  watchFiles: false, // refresh() lists the files only after the folder watcher saw a change
  rescanAfterMs: 60000, // ...or once this long went by, in case it missed one

  // Caching
  cacheRoot: '.cache',
  txtCacheSubdir: '.cache/txt',
  indexCacheSubdir: '.cache/index',
});
```

## 🎯 CLI Usage

```bash
# Basic search
node test--mega-search.ts "your search query"

# Advanced options via environment variables
FUZZY=false node test--mega-search.ts "exact match only"
TOP_N=20 node test--mega-search.ts "query"
PAGE=2 PAGE_SIZE=5 node test--mega-search.ts "query"
SNIPPETS_LIMIT=ALL node test--mega-search.ts "query"

# BM25 tuning
USE_BM25=false node test--mega-search.ts "query"  # Use TF-IDF instead
BM25_K1=1.5 BM25_B=0.8 node test--mega-search.ts "query"
```

## 📊 Performance Stats

```typescript
const stats = megaSearch.getStats();

console.log(`📚 Corpus: ${stats.documentsCount} documents`);
console.log(`🔤 Terms: ${stats.termsCount} unique terms`);
console.log(`📝 Tokens: ${stats.totalTokens.toLocaleString()}`);
```

## 🔧 API Reference

### MegaSearch Class

#### `search(query: string, options?: SearchOptions): Promise<PaginatedSearchResult>`

Main search method with full feature support.

**Parameters:**

- `query` - Search query (supports phrase search with quotes)
- `options` - Search configuration object

**SearchOptions:**

```typescript
{
  topN?: number;                    // Max results to process (default: 50)
  isInflectedWordFormsAllowed?: boolean; // "Allow fuzzy match": any inflected form; off = the form typed (default: true)
  isRelatedWordsAllowed?: boolean;   // With fuzzy match: also stems ±2 letters — "столяр" → "столярного", "Бондар" → "Бондарук" (default: true)
  maxTypoDistance?: number;          // Typo edits per word, fuzzy match on or off; 0 = none (default: 1)
  isPhraseProximityEnabled?: boolean; // Every query is a phrase, quoted or not (default: false)
  maxWordsInPhraseDistance?: number; // Words allowed between phrase words, 0 = adjacent (default: 0)
  snippetsLimit?: number | 'ALL';   // Snippets per result (default: 3)
  page?: number;                    // Page number (default: 1)
  pageSize?: number;                // Results per page (default: 10)
}
```

**Returns:**

```typescript
{
  results: Array<{
    doc: DocumentMetadata; // File info and metadata
    score: number; // Relevance score
    snippets: string[]; // Context excerpts with <b> highlighting
    highlights: HighlightInfo[]; // Precise character positions for UI
  }>;
  pagination: {
    currentPage: number;
    totalPages: number;
    totalResults: number;
    resultsPerPage: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  }
}
```

#### Other Methods

- `getStats()` - Get corpus statistics
- `reindex()` - Force complete reindexing
- `refresh(searchScopedPaths?)` - Bring the index up to date, cheaply: with `watchFiles`, it lists
  the files only after a change (or `rescanAfterMs`). With `searchScopedPaths`, only the files in
  those folders — what a search in them reads
- `close()` - Stop watching the folder

## 🌟 Advanced Features

### Ukrainian Language Processing

The system includes sophisticated Ukrainian language processing:

- **Stemming**: Handles Ukrainian morphology (управління → управлінн)
- **Every Word Indexed**: nothing is left out as a stop word. Function words (prepositions,
  conjunctions, particles: "про", "та", "лише") match only as typed, don't count toward phrase
  distance, and a word-by-word search skips them unless the query holds nothing else — a phrase
  holds them as written ("наказ про відпустку" is not "наказ на відпустку")
- **Case Handling**: Proper Unicode case normalization
- **Mixed Alphabets**: a word typed with look-alike letters of both alphabets ("Мiнiстерство" with a
  Latin "i") reads in the alphabet most of its letters are in, so a query typed in one finds it
- **Mixed Language**: Handles documents with both Ukrainian and English

### Numbers, Dates & Codes

A run of digits is indexed as a token of its own, apart from the letters and separators around it:
`вх№36088 від 22.12.2024` → `вх`, `36088`, `22`, `12`, `2024`.

- `36088`, `№36088`, `вх№36088` and `2024` all find that text.
- A number the query writes glued together (`22.12.2024`, `12.2024`, `248/9240`, `вх№36088`) is
  found as written: its parts side by side, glued by the same characters. `22.12.2024` doesn't
  find `12.01.2024, 22`, `22/12/2024` or `22 12 2024`; `15/2` doesn't find `пункти 15, 2`;
  `вх№36088` doesn't find `вх. № 36088`, while `36088` does. With proximity off it's still searched
  as one. Each document's index keeps these joints: the characters between a number and the token
  glued to it, where no whitespace parts them.
- Numbers match exactly, in every mode: `2024` never finds `2023` or `20245`, whatever the typo
  distance or fuzzy match.
- The query is searched as written: `5.12.2024` doesn't find `05.12.2024`.
- Wherever distance is counted in words (phrase gaps, snippet context and sentence ends, BM25
  document length), numbers don't count. Searches for words find, rank and show what they did
  before numbers were indexed; only token indices (`matchStartTokenIndex`, `tokenIndex`) shift.

### BM25 vs TF-IDF

The system uses BM25 by default (like modern search engines):

- **BM25 Benefits**: Better relevance, length normalization, term frequency saturation
- **TF-IDF Option**: Available for comparison or specific use cases
- **Tunable Parameters**: Adjust k1 and b parameters for your corpus

### Caching Strategy

Multi-level intelligent caching:

1. **Text Extraction Cache**: Saves .txt files to avoid re-parsing
2. **Document Index Cache**: Saves each document's words and where they are
3. **Global Inverted Index**: Compressed full-text search index
4. **LRU Memory Cache**: Hot data in memory for fast access

Levels 2 and 3 are stamped with `INDEX_VERSION` (`file-indexer/index-version.mts`). Bump it with any
change that indexes the same text differently (tokenizer, normalization, function words, stemmer): the
next start rebuilds both from the cached text (level 1), so no document is parsed again.

Levels 2 and 3 save documents' paths relative to `rootDirectory`, with `/` between names, and
read them back as absolute paths: a cache works wherever the folder is — moved, renamed, on a
drive under another letter, or seen from Docker at another path. In memory, and in search
results, `originalFilePath` and `textFilePath` are absolute, as before.

A few changed or deleted files update the inverted index for those documents only. A full rebuild,
which reads every document, happens once `indexRebuildThreshold` (default 20%) of the documents
changed.

Searches read the index in place, never a copy of it, and never see an update half-done: until
it's complete they read the index from before it, snippets included. An update never changes what
a search reads. It works on a copy that shares what didn't change (a term's postings are copied
only to change them), and the copy goes in whole. Updates (`reindex()`, `indexSpecificPaths()`,
`clearCache()`) run one at a time; `reindex()` calls made during an update share one more update,
run after it.

Results are cached per index version: a `reindex()` that finds nothing changed keeps them, so an
engine refreshed before every search (as be-krang does) still answers a repeated search at once.
With `watchFiles`, `refresh()` doesn't even list the folder's files until the watcher reports a
change, or `rescanAfterMs` (default a minute) goes by — fs.watch can miss changes, on a network
share for one, so it's a hint, never the only check.

A search in some folders (`searchScopedPaths`) reads only their documents, and needs only theirs
indexed: `refresh(searchScopedPaths)` lists and indexes the files in those folders alone, and
drops only their deleted ones. The other folders' documents stay in the index as they were, until
a refresh takes them in. be-krang creates its engines with
`createMegaSearch(config, { indexFolder: false })`, which indexes nothing up front, and refreshes
the folders searched before each search: on a large folder, the first search in one of its
folders waits for that folder to be indexed, not for all of them. Word statistics for scoring are of all documents indexed, so a
document scores the same whichever folders are searched.

## 🚀 Production Deployment

### Performance Tuning

```typescript
const megaSearch = await createMegaSearch({
  // For large corpora
  concurrency: 8,
  maxFileSize: 100 * 1024 * 1024, // 100MB

  // Memory optimization
  maxCachedDocuments: 500,
  maxCachedTexts: 200,

  // BM25 tuning for your corpus
  bm25K1: 1.5, // Higher for more term frequency importance
  bm25B: 0.8, // Higher for more length normalization
});
```

### Integration Examples

#### Express.js API

```typescript
app.get('/search', async (req, res) => {
  const { q, page = 1, size = 10 } = req.query;

  const results = await megaSearch.search(q, {
    page: parseInt(page),
    pageSize: parseInt(size),
    snippetsLimit: 3,
  });

  res.json(results);
});
```

#### React Component

```typescript
function SearchResults({ query }) {
  const [results, setResults] = useState(null);

  useEffect(() => {
    megaSearch.search(query, { pageSize: 10 })
      .then(setResults);
  }, [query]);

  return (
    <div>
      {results?.results.map(result => (
        <div key={result.doc.filePath}>
          <h3>{result.doc.fileName}</h3>
          {result.highlights.map(highlight => (
            <HighlightedText
              start={highlight.charStart}
              end={highlight.charEnd}
              confidence={highlight.confidence}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
```

## 🛠 Development & Debugging

Enable verbose logging:

```bash
DEBUG=true node test--mega-search.ts "query"
```

The system provides extensive logging for:

- Tokenization process
- Stemming results
- Scoring calculations
- Cache hit/miss ratios
- Performance metrics

## 🧪 Testing

Tests use the built-in `node:test` runner (through `tsx`). Run them from `packages/toolkit`:

```bash
pnpm test                 # all *.test.mts files
pnpm test:watch           # re-run on change
LOG_LEVEL=DEBUG pnpm test # show engine logs (tests default to ERROR)
```

- Tests live in a `__tests__/` folder beside the modules they cover, and are named
  `<module>.test.mts` (e.g. `file-indexer/__tests__/inverted-index.test.mts`). Each layer is
  tested on its own: pure units (`fuzzy`, `bm25-scorer`, `text-processor`, …), matching/snippets
  on in-memory indexes (`buildSearchData`), `file-indexer/*` against temp folders, and
  `__tests__/mega-search.test.mts` through the public `createMegaSearch()` API.
- Shared fixtures live in `test-utils/`. Use `createTempCorpus()` for a document folder in the
  OS temp dir and `createSearchFixture()` for a corpus plus an initialized `MegaSearch`.
  Fixture files get a fixed past mtime, so pass `later()` as the mtime when you simulate an edit.
- `__tests__/` and `test-utils/` are excluded from `dist` by `tsconfig.build.json` /
  `tsconfig.build-type.json`. `tsconfig.json` still includes them for type-checking.

**Known bugs.** A defect that is confirmed but not fixed yet gets a test that asserts the
_intended_ behaviour and is marked with `knownBug('<cause>')`. The test still runs, and it is
reported as `# TODO KNOWN BUG …` without failing the suite. Once the fix lands the test passes;
remove the marker then, so it guards against regressions.

### Regression check on a real corpus

Unit tests can't show what a change does to hundreds of real searches. The snapshot tool
(`test-utils/regression/`) samples queries from a corpus — words, word pairs, names as written
and in lowercase, typos, swapped letters, quoted phrases, numbers and dates, a number between
two words — and records what consumers see for each: totals, the first page's documents and
scores, each snippet's `match@charStart` (what parser-config extraction reads) and highlight
counts. It does so under every option set the UI can send through be-krang, plus the main API
modes:

```bash
pnpm mega-search:snapshot <corpusDir> before.json   # add --queries names.txt for your own list
# …make the change…
pnpm mega-search:snapshot <corpusDir> after.json
pnpm mega-search:compare before.json after.json
```

The comparison counts, per option set and per query group, the searches that are the same and
those that find fewer or more documents, rank or score them differently, or return other
snippets or highlights, with examples, and adds up the search time of each. A refactoring or a
speed-up should leave every search the same; a behaviour change should differ only where it
means to.

- The same corpus text always gives the same queries, so two snapshots ask the same things.
- The index is kept in a folder of the OS temp dir per corpus, so the corpus folder isn't
  touched. Pass `--cache <corpusDir>/.cache` to use the app's own index instead.
- Search times are only comparable between warm runs: a run that builds the index, right after
  the documents were read from a cold disk, searched 8–28% slower than the next one on the same
  code. Before timing a speed-up, take a throw-away snapshot first, and compare runs that both
  loaded the index (indexing well under a second).
- Snapshots hold document names and text: they go to the OS temp dir unless you name a file,
  and must never be committed.

## 📈 Future Roadmap

- [ ] REST API endpoints
- [ ] Boolean query support (AND, OR, NOT)
- [ ] Real-time indexing
- [ ] Distributed search
- [ ] Machine learning ranking
- [ ] Semantic search capabilities

## 🤝 Contributing

1. Run tests: `pnpm test` (in `packages/toolkit`, see [Testing](#-testing))
2. Check performance: `npm run benchmark`
3. Lint code: `npm run lint`

---

**Built with ❤️ for high-performance document search in Ukrainian and multilingual environments.**
