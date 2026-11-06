# 🔍 Mega Search - Advanced Document Search Engine

A production-ready, feature-rich document search system with Ukrainian language support, advanced scoring algorithms, and UI-ready highlighting capabilities.

## ✨ Features

### 🎯 **Core Search Features**

- **BM25 Scoring**: Industry-standard relevance ranking (used by Elasticsearch)
- **Fuzzy Search**: every inflected form of a word, plus typo tolerance (edit distance, a swap of two letters counting as one typo)
- **Phrase Search**: Exact phrase matching with quotes (`"начальник управління"`)
- **Multi-language Support**: Ukrainian and English with proper stemming
- **Multiple Snippets**: Shows multiple context snippets per document

### 🚀 **Performance & Scalability**

- **Incremental Indexing**: Only reprocesses changed files
- **Disk Caching**: Intelligent caching of text extraction and indexes
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
- **Ukrainian Text Processing**: Proper tokenization, stemming, stop words
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
- `testDocumentParsing()` - Test document parsing capabilities

## 🌟 Advanced Features

### Ukrainian Language Processing

The system includes sophisticated Ukrainian language processing:

- **Stemming**: Handles Ukrainian morphology (управління → управлінн)
- **Stop Words**: Comprehensive Ukrainian stop word list
- **Case Handling**: Proper Unicode case normalization
- **Mixed Language**: Handles documents with both Ukrainian and English

### BM25 vs TF-IDF

The system uses BM25 by default (like modern search engines):

- **BM25 Benefits**: Better relevance, length normalization, term frequency saturation
- **TF-IDF Option**: Available for comparison or specific use cases
- **Tunable Parameters**: Adjust k1 and b parameters for your corpus

### Caching Strategy

Multi-level intelligent caching:

1. **Text Extraction Cache**: Saves .txt files to avoid re-parsing
2. **Document Index Cache**: Saves tokenization and frequency data
3. **Global Inverted Index**: Compressed full-text search index
4. **LRU Memory Cache**: Hot data in memory for fast access

Levels 2 and 3 are stamped with `INDEX_VERSION` (`file-indexer/index-version.mts`). Bump it with any
change that indexes the same text differently (tokenizer, normalization, stop words, stemmer): the
next start rebuilds both from the cached text (level 1), so no document is parsed again.

A few changed files update the inverted index for those documents only. A full rebuild, which reads
every document, happens once `indexRebuildThreshold` (default 0.1%) of the documents changed.

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
