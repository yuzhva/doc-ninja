import { BM25Scorer } from './bm25-scorer';
import { DocumentExtractor } from './document-parsers';
import { FileIndexer } from './file-indexer';
import { levenshtein } from './fuzzy';
import { UkrainianTextProcessor } from './text-processor';
import { SearchConfig, HighlightInfo } from './types';

type SearchOptions = {
  topN?: number;
  fuzzy?: boolean;
  fuzzyThreshold?: number;
  snippetsLimit?: number | 'ALL';
};

class MegaSearch {
  private indexer: FileIndexer;
  private textProcessor: UkrainianTextProcessor;
  private bm25Scorer: BM25Scorer;

  constructor(private config: SearchConfig) {
    this.indexer = new FileIndexer(config);
    this.textProcessor = new UkrainianTextProcessor();

    // Initialize BM25 scorer with config or defaults
    this.bm25Scorer = new BM25Scorer({
      k1: config.bm25K1 ?? 1.2,
      b: config.bm25B ?? 0.75,
    });
  }

  async initialize(): Promise<void> {
    console.log('Initializing Mega Search system...');
    console.log(`Root directory: ${this.config.rootDirectory}`);
    console.log(`Supported extensions: ${this.config.extensions.join(', ')}`);
    console.log(
      `Ukrainian stemming: ${this.config.ukrainianStemming ? 'enabled' : 'disabled'}`,
    );
    console.log(
      `Scoring method: ${this.config.useBM25 !== false ? this.bm25Scorer.getScoringMethod() : 'TF-IDF'}`,
    );

    await this.indexer.buildFullIndex();

    // Calculate average document length for BM25
    if (this.config.useBM25 !== false) {
      const docCache = this.indexer.getDocumentCache();
      this.bm25Scorer.calculateAverageDocLength(docCache);
    }

    const stats = this.indexer.getStats();
    console.log(
      `Indexing complete: ${stats.documentsCount} documents, ${stats.termsCount} unique terms`,
    );
  }

  async reindex(): Promise<void> {
    await this.indexer.buildFullIndex();
  }

  getStats() {
    return this.indexer.getStats();
  }

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<Array<{ doc: any; score: number; snippets: string[]; highlights: HighlightInfo[] }>> {
    const {
      topN = 10,
      fuzzy = true,
      fuzzyThreshold = 1,
      snippetsLimit = 3,
    } = options;

    console.log(`[SEARCH] Starting search for query: "${query}"`);
    console.log(`[SEARCH] Options:`, {
      topN,
      fuzzy,
      fuzzyThreshold,
      snippetsLimit,
    });
    console.log(
      `[SEARCH] Scoring method: ${this.config.useBM25 !== false ? this.bm25Scorer.getScoringMethod() : 'TF-IDF'}`,
    );

    // Phrase search: detect if query is wrapped in quotes
    const phraseMatch = query.match(/^"(.*)"$/);
    const isPhrase = !!phraseMatch;
    const phrase = isPhrase ? phraseMatch[1] : null;

    console.log(`[SEARCH] Phrase search: ${isPhrase}, phrase: "${phrase}"`);

    // Tokenize and stem the query
    const queryTokens = this.textProcessor
      .tokenize(isPhrase ? phrase! : query)
      .map((t) => this.textProcessor.stemWord(t.term));
    const uniqueQueryTokens = Array.from(new Set(queryTokens));

    console.log(`[SEARCH] Query tokens:`, queryTokens);
    console.log(`[SEARCH] Unique query tokens:`, uniqueQueryTokens);

    if (uniqueQueryTokens.length === 0) {
      console.log(`[SEARCH] No valid tokens found, returning empty results`);
      return [];
    }

    // Get index data
    const docCache = this.indexer.getDocumentCache();
    const invertedIndex = this.indexer.getInvertedIndex();
    const docCount = docCache.size;

    console.log(`[SEARCH] Document cache size: ${docCache.size}`);
    console.log(`[SEARCH] Inverted index size: ${invertedIndex.size}`);

    // Score documents using BM25 or TF-IDF
    const docScores = new Map<string, number>();
    const useBM25 = this.config.useBM25 !== false;

    for (const term of uniqueQueryTokens) {
      let candidateTerms: string[] = [term];
      if (fuzzy && !isPhrase) {
        candidateTerms = Array.from(invertedIndex.keys()).filter(
          (idxTerm) => levenshtein(term, idxTerm) <= fuzzyThreshold,
        );
      }

      console.log(
        `[SEARCH] For term "${term}", found ${candidateTerms.length} candidate terms:`,
        candidateTerms,
      );

      for (const idxTerm of candidateTerms) {
        const postings = invertedIndex.get(idxTerm);
        if (!postings) continue;

        const df = postings.length; // Document frequency

        console.log(`[SEARCH] Term "${idxTerm}" appears in ${df} documents`);

        for (const entry of postings) {
          const tf = entry.frequency; // Term frequency
          const doc = docCache.get(entry.documentId);

          if (!doc) continue;

          let score: number;

          if (useBM25) {
            // Use BM25 scoring
            score = this.bm25Scorer.calculateScore(
              tf,
              doc.wordCount,
              df,
              docCount,
            );
          } else {
            // Use traditional TF-IDF scoring
            score = this.bm25Scorer.calculateTfIdfScore(tf, df, docCount);
          }

          docScores.set(
            entry.documentId,
            (docScores.get(entry.documentId) || 0) + score,
          );

          console.log(
            `[SEARCH] Document "${entry.documentId.split('/').pop()}" TF: ${tf}, DF: ${df}, DocLen: ${doc.wordCount}, ${useBM25 ? 'BM25' : 'TF-IDF'} score: ${score.toFixed(3)}`,
          );
        }
      }
    }

    console.log(
      `[SEARCH] Document scores:`,
      Array.from(docScores.entries()).map(([doc, score]) => ({
        doc: doc.split('/').pop(),
        score: score.toFixed(3),
      })),
    );

    // If phrase search, filter to only docs containing the exact phrase
    let filteredDocIds: string[] = Array.from(docScores.keys());
    if (isPhrase) {
      console.log(`[SEARCH] Filtering for phrase search...`);
      filteredDocIds = filteredDocIds.filter((docId) => {
        const doc = docCache.get(docId);
        if (!doc) return false;
        const docText = doc.tokens.map((t) => t.term).join(' ');
        const phraseText = queryTokens.join(' ');
        const hasPhrase = docText.includes(phraseText);
        console.log(
          `[SEARCH] Document "${docId.split('/').pop()}" contains phrase: ${hasPhrase}`,
        );
        return hasPhrase;
      });
      console.log(
        `[SEARCH] After phrase filtering: ${filteredDocIds.length} documents remain`,
      );
    }

    // Sort and format results
    const results = filteredDocIds
      .map((docId) => [docId, docScores.get(docId) || 0] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([docId, score]) => {
        const doc = docCache.get(docId);
        let snippets: string[] = [];
        let highlights: HighlightInfo[] = [];

        console.log(
          `[SNIPPETS] Processing document: "${docId.split('/').pop()}", score: ${score.toFixed(3)}`,
        );

        if (doc) {
          // Extract highlights with character positions
          uniqueQueryTokens.forEach((queryToken) => {
            doc.tokens.forEach((docToken) => {
              const docTokenStem = this.textProcessor.stemWord(docToken.term);

              if (docTokenStem === queryToken) {
                highlights.push({
                  term: queryToken,
                  originalWord: docToken.term,
                  charStart: docToken.charStart,
                  charEnd: docToken.charEnd,
                  confidence: fuzzy ? this.calculateMatchConfidence(queryToken, docTokenStem) : 1.0,
                });
              }
            });
          });

          const text = doc.tokens.map((t) => t.term).join(' ');
          console.log(
            `[SNIPPETS] Document text length: ${text.length} characters`,
          );
          console.log(
            `[SNIPPETS] First 100 chars of text: "${text.substring(0, 100)}..."`,
          );

          if (isPhrase) {
            const phraseText = queryTokens.join(' ');
            console.log(`[SNIPPETS] Looking for phrase: "${phraseText}"`);

            // Find all occurrences of the phrase
            let idx = 0;
            let occurrenceCount = 0;
            while ((idx = text.indexOf(phraseText, idx)) !== -1) {
              occurrenceCount++;
              let rawSnippet = text.substring(
                Math.max(0, idx - 30),
                idx + phraseText.length + 40,
              );
              rawSnippet = rawSnippet.replace(
                new RegExp(phraseText, 'gi'),
                (match) => `<b>${match}</b>`,
              );
              snippets.push(rawSnippet + '...');
              idx += phraseText.length;

              console.log(
                `[SNIPPETS] Found phrase occurrence #${occurrenceCount} at position ${idx}`,
              );
            }
            console.log(
              `[SNIPPETS] Total phrase occurrences found: ${occurrenceCount}`,
            );
          } else {
            // For each query token, find all occurrences by matching stems
            const snippetSet = new Set<string>();

            console.log(
              `[SNIPPETS] Looking for stemmed tokens: ${uniqueQueryTokens.join(', ')}`,
            );

            uniqueQueryTokens.forEach((queryToken) => {
              let tokenOccurrences = 0;

              // Find all document tokens that stem to this query token
              doc.tokens.forEach((docToken, tokenIndex) => {
                const docTokenStem = this.textProcessor.stemWord(docToken.term);
                console.log(
                  `[SNIPPETS] Checking token "${docToken.term}" (stem: "${docTokenStem}") against query token "${queryToken}"`,
                );

                if (docTokenStem === queryToken) {
                  tokenOccurrences++;

                  // Create snippet using position in the token array
                  const startPos = Math.max(0, tokenIndex - 8);
                  const endPos = Math.min(doc.tokens.length, tokenIndex + 12);
                  const contextTokens = doc.tokens.slice(startPos, endPos);

                  let rawSnippet = contextTokens.map((t) => t.term).join(' ');

                  // Highlight the actual word found in the document
                  rawSnippet = rawSnippet.replace(
                    new RegExp(`\\b${docToken.term}\\b`, 'gi'),
                    (m) => `<b>${m}</b>`,
                  );

                  snippetSet.add(rawSnippet + '...');

                  console.log(
                    `[SNIPPETS] Found match: "${docToken.term}" at position ${tokenIndex}, created snippet`,
                  );
                }
              });

              console.log(
                `[SNIPPETS] Query token "${queryToken}" matched ${tokenOccurrences} document tokens`,
              );
            });

            snippets = Array.from(snippetSet);
            console.log(
              `[SNIPPETS] Generated ${snippets.length} unique snippets from token matches`,
            );
          }

          // Limit snippets if not 'ALL'
          const originalSnippetCount = snippets.length;
          if (snippetsLimit !== 'ALL' && typeof snippetsLimit === 'number') {
            snippets = snippets.slice(0, snippetsLimit);
          }

          console.log(
            `[SNIPPETS] Final snippet count: ${snippets.length} (originally ${originalSnippetCount})`,
          );
          if (snippets.length > 0) {
            console.log(
              `[SNIPPETS] Sample snippet: "${snippets[0].substring(0, 100)}..."`,
            );
          }
        } else {
          console.log(`[SNIPPETS] No document found in cache for: "${docId}"`);
        }

        return {
          doc: doc?.metadata,
          score,
          snippets,
          highlights,
        };
      });

    console.log(`[SEARCH] Returning ${results.length} results`);
    return results;
  }

  private calculateMatchConfidence(queryTerm: string, matchedTerm: string): number {
    if (queryTerm === matchedTerm) return 1.0;

    // Use Levenshtein distance for confidence calculation
    const distance = levenshtein(queryTerm, matchedTerm);
    const maxLength = Math.max(queryTerm.length, matchedTerm.length);

    return Math.max(0, (maxLength - distance) / maxLength);
  }

  async testDocumentParsing(): Promise<void> {
    console.log('Testing document parsing...');

    const files = await this.indexer.discoverFiles();
    console.log(`Found ${files.length} files to test`);

    for (const file of files.slice(0, 5)) {
      // Test first 5 files
      try {
        console.log(`\n${'='.repeat(50)}`);
        console.log(
          `Testing: ${file.fileName} (${(file.size / 1024).toFixed(1)} KB)`,
        );
        console.log(`File path: ${file.filePath}`);

        const extractor = new DocumentExtractor();
        const startTime = Date.now();
        const text = await extractor.extractText(file.filePath);
        const extractionTime = Date.now() - startTime;

        console.log(
          `Extracted ${text.length} characters in ${extractionTime}ms`,
        );

        if (text.length > 0) {
          // Detect language
          const language = this.textProcessor.detectLanguage(text);
          console.log(`Detected language: ${language}`);

          const preview = text.substring(0, 300).replace(/\s+/g, ' ');
          console.log(`Preview: "${preview}${text.length > 300 ? '...' : ''}"`);

          // Test tokenization
          const tokens = this.textProcessor.tokenize(text);
          console.log(`Tokenized into ${tokens.length} tokens`);

          if (tokens.length > 0) {
            console.log(
              `First 15 tokens: ${tokens
                .slice(0, 15)
                .map((t) => t.term)
                .join(', ')}`,
            );

            // Show token statistics
            const uniqueTokens = new Set(tokens.map((t) => t.term));
            console.log(`Unique tokens: ${uniqueTokens.size}`);

            // Test stemming if enabled
            if (this.config.ukrainianStemming) {
              const stemmedSample = tokens
                .slice(0, 5)
                .map(
                  (t) => `${t.term} -> ${this.textProcessor.stemWord(t.term)}`,
                );
              console.log(`Stemming sample: ${stemmedSample.join(', ')}`);
            }

            // Show language-specific analysis
            const ukrainianTokens = tokens.filter((t) =>
              /[а-яїієґ]/.test(t.term),
            );
            const englishTokens = tokens.filter(
              (t) => /[a-z]/.test(t.term) && !/[а-яїієґ]/.test(t.term),
            );
            console.log(
              `Language breakdown: ${ukrainianTokens.length} Ukrainian, ${englishTokens.length} English tokens`,
            );
          }
        } else {
          console.log(
            '⚠️  No text extracted - this file might be corrupted or use unsupported encoding',
          );
        }
      } catch (error) {
        console.error(
          `❌ Failed to parse ${file.fileName}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log('Document parsing test completed');
  }
}

// Default configuration for Ukrainian document search
const defaultConfig: SearchConfig = {
  rootDirectory: './documents',
  extensions: ['.doc', '.docx', '.txt'],
  maxFileSize: 50 * 1024 * 1024, // 50MB
  concurrency: 4,
  ukrainianStemming: true,

  // BM25 scoring parameters (best practice values)
  useBM25: true,
  bm25K1: 1.2, // Good balance for term frequency saturation
  bm25B: 0.75, // Standard length normalization
};

// Main factory function
async function createMegaSearch(
  config: Partial<SearchConfig> = {},
): Promise<MegaSearch> {
  const finalConfig = { ...defaultConfig, ...config };
  const megaSearch = new MegaSearch(finalConfig);

  await megaSearch.initialize();
  return megaSearch;
}

// Legacy compatibility
async function createFileIndexer(
  config: Partial<SearchConfig> = {},
): Promise<FileIndexer> {
  const finalConfig = { ...defaultConfig, ...config };
  const indexer = new FileIndexer(finalConfig);
  return indexer;
}

// Test function for CLI usage
async function testMegaSearch(
  config: Partial<SearchConfig> = {},
): Promise<void> {
  const finalConfig = { ...defaultConfig, ...config };
  const megaSearch = new MegaSearch(finalConfig);

  // Test without full indexing first
  await megaSearch.testDocumentParsing();
}

export {
  createFileIndexer,
  createMegaSearch,
  defaultConfig,
  MegaSearch,
  testMegaSearch,
};
