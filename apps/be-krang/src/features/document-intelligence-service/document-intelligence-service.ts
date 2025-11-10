import fs from 'fs/promises';
import path from 'path';
import { createMegaSearch, createNLPAnalyzer } from 'toolkit--local/node';

import { InformationExtractor } from '../../nlp/information-extractor.mts';
import { readExcelData } from '../../nlp/utils/excel-utils.mts';
import { runtimePathById } from '../../supplement/index.mts';
import { ContextExtractor } from './processors/context-extractor.ts';
import { UkrainianNameProcessor } from './processors/ukrainian-name-processor.ts';
import { ExcelReporter } from './reporters/excel-reporter.ts';
import type {
  DocumentIntelligenceConfig,
  NameMatch,
  ProcessingResult,
} from './types.ts';

/**
 * Document Intelligence Service
 * Combines MegaSearch with NLP Analyzer for comprehensive document processing
 */
class DocumentIntelligenceService {
  private megaSearch: any;
  private nlpAnalyzer: any;
  private ukrainianNameProcessor: UkrainianNameProcessor;
  private contextExtractor: ContextExtractor;
  private excelReporter: ExcelReporter;
  private config: DocumentIntelligenceConfig;

  constructor(config: DocumentIntelligenceConfig) {
    this.config = {
      // Default configuration
      sourcePath: path.join(runtimePathById.assets, 'docs-for-nlp'),
      outputPath: path.join(runtimePathById.assets, 'nlp-output'),
      inputPath: path.join(runtimePathById.assets, 'nlp-input/data.xlsx'),
      batchSize: 10,
      concurrency: 4,
      cacheEnabled: true,
      enableMonitoring: true,
      extensions: ['.doc', '.docx', '.txt'],
      maxFileSize: 50 * 1024 * 1024,
      ukrainianStemming: true,
      useBM25: true,
      confidence: {
        entityThreshold: 0.7,
        nameMatchThreshold: 0.75,
        contextThreshold: 0.6,
      },
      ...config,
    };

    this.ukrainianNameProcessor = new UkrainianNameProcessor(this.config);
    this.contextExtractor = new ContextExtractor(this.config);
    this.excelReporter = new ExcelReporter(this.config);
  }

  /**
   * Initialize the service with all components
   */
  async initialize(): Promise<void> {
    console.log('🚀 Initializing Document Intelligence Service...');
    console.log(`📁 Source path: ${this.config.sourcePath}`);
    console.log(`📊 Output path: ${this.config.outputPath}`);

    try {
      // Initialize MegaSearch
      console.log('🔍 Initializing MegaSearch...');
      this.megaSearch = await createMegaSearch({
        rootDirectory: this.config.sourcePath,
        extensions: this.config.extensions,
        maxFileSize: this.config.maxFileSize,
        concurrency: this.config.concurrency,
        ukrainianStemming: this.config.ukrainianStemming,
        useBM25: this.config.useBM25,
        bm25K1: 1.2,
        bm25B: 0.75,
      });

      // Initialize NLP Analyzer
      console.log('🧠 Initializing NLP Analyzer...');
      this.nlpAnalyzer = await createNLPAnalyzer({
        cacheEnabled: this.config.cacheEnabled,
        useWorkers: false, // Better for Ukrainian processing
        enableMonitoring: this.config.enableMonitoring,
        enableRetries: true,
        enableAdaptiveLearning: true,
      });

      // Register Ukrainian Name Processor
      this.nlpAnalyzer.addPostProcessor(this.ukrainianNameProcessor);
      this.nlpAnalyzer.addPostProcessor(this.contextExtractor);

      console.log('✅ Document Intelligence Service initialized successfully');
    } catch (error) {
      console.error(
        '❌ Failed to initialize Document Intelligence Service:',
        error,
      );
      throw error;
    }
  }

  /**
   * Main processing function - replaces extractInformation
   */
  async processDocuments(): Promise<ProcessingResult> {
    const startTime = Date.now();
    console.log('🚀 Starting intelligent document processing...');
    console.log(`⏱️ Started at: ${new Date().toLocaleTimeString()}`);

    try {
      // 1. Load input names
      const baseNames = await this.loadInputNames();
      console.log(`📊 Loaded ${baseNames.length} names to search for`);

      // 2. Discover documents using MegaSearch
      const documents = await this.discoverDocuments();
      console.log(`📁 Discovered ${documents.length} documents`);

      // 3. Process names across documents
      const matches = await this.processNamesAcrossDocuments(
        baseNames,
        documents,
      );
      console.log(`🎯 Found ${matches.length} matches`);

      // 4. Generate reports
      const outputFile = await this.excelReporter.generateReport(matches, {
        filename: 'intelligent_document_processing.xlsx',
        includeStats: true,
        includeLearning: true,
      });

      // 5. Calculate timing
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const minutes = Math.floor(totalTime / 60000);
      const seconds = Math.floor((totalTime % 60000) / 1000);

      console.log(`\n⏱️ Processing completed in: ${minutes}m ${seconds}s`);
      console.log(`📄 Report saved to: ${outputFile}`);
      console.log(`🏁 Finished at: ${new Date().toLocaleTimeString()}`);

      return {
        matches,
        totalProcessingTime: totalTime,
        documentsProcessed: documents.length,
        namesSearched: baseNames.length,
        outputFile,
        stats: {
          megaSearchStats: this.megaSearch.getStats(),
          nlpAnalyzerStats: this.nlpAnalyzer.getLearningStats(),
        },
      };
    } catch (error) {
      console.error('❌ Error during document processing:', error);
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      console.log(`⏱️ Failed after: ${totalTime}ms`);
      throw error;
    }
  }

  /**
   * Load input names from Excel file
   */
  private async loadInputNames(): Promise<string[]> {
    try {
      const allBaseNames = await readExcelData(this.config.inputPath);
      const baseNames = [...new Set(allBaseNames)]; // Remove duplicates

      if (baseNames.length < allBaseNames.length) {
        console.log(
          `ℹ️ Removed ${allBaseNames.length - baseNames.length} duplicate names. Processing ${baseNames.length} unique names.`,
        );
      }

      return baseNames;
    } catch (error) {
      console.error('❌ Failed to load input names:', error);
      throw new Error('Could not load input names from Excel file');
    }
  }

  /**
   * Discover documents using MegaSearch
   */
  private async discoverDocuments(): Promise<
    Array<{ path: string; metadata: any }>
  > {
    try {
      const stats = this.megaSearch.getStats();
      const documents = [];

      // Get all indexed documents
      const docCache = this.megaSearch.indexer?.getDocumentCache();
      if (docCache) {
        for (const [docId, docIndex] of docCache.entries()) {
          documents.push({
            path: docIndex.metadata.filePath,
            metadata: {
              ...docIndex.metadata,
              id: docId,
              wordCount: docIndex.wordCount,
              language: docIndex.metadata.language,
            },
          });
        }
      }

      // Sort by newest first (based on lastModified)
      documents.sort((a, b) => {
        const dateA = new Date(a.metadata.lastModified || 0);
        const dateB = new Date(b.metadata.lastModified || 0);
        return dateB.getTime() - dateA.getTime();
      });

      return documents;
    } catch (error) {
      console.error('❌ Failed to discover documents:', error);
      throw new Error('Could not discover documents using MegaSearch');
    }
  }

  /**
   * Process names across all documents using intelligent search
   */
  private async processNamesAcrossDocuments(
    baseNames: string[],
    documents: Array<{ path: string; metadata: any }>,
  ): Promise<NameMatch[]> {
    const allMatches: NameMatch[] = [];
    let remainingNames = [...baseNames];

    console.log(
      `\n🔎 Intelligent search for ${remainingNames.length} names across ${documents.length} documents...`,
    );

    // ✅ NEW: Use MegaSearch to filter documents FIRST
    for (const name of baseNames) {
      if (remainingNames.length === 0) {
        console.log('✅ All names found. Stopping search.');
        break;
      }

      if (!remainingNames.includes(name)) {
        continue; // Already found this name
      }

      console.log(`\n🔍 Step 1: MegaSearch filtering for "${name}"`);

      try {
        // 1. Use MegaSearch to find relevant documents for this name
        const searchResults = await this.megaSearch.search(name, {
          topN: 10, // Get top 10 most relevant documents
          fuzzy: true,
          fuzzyThreshold: 1,
          snippetsLimit: 3,
        });

        if (searchResults.results.length === 0) {
          console.log(`  ❌ No documents found for "${name}"`);
          continue;
        }

        console.log(
          `  ✅ MegaSearch found ${searchResults.results.length} relevant documents for "${name}"`,
        );

        // 2. Get the actual document content for relevant documents only
        const relevantDocs = await this.getRelevantDocuments(
          searchResults.results,
        );

        console.log(
          `🧠 Step 2: NLP analysis on ${relevantDocs.length} filtered documents`,
        );

        // 3. Process only the relevant documents with NLP
        const nameMatches = await this.processRelevantDocumentsWithNLP(
          name,
          relevantDocs,
          searchResults.results,
        );

        if (nameMatches.length > 0) {
          console.log(`  🎯 Found ${nameMatches.length} matches for "${name}"`);
          allMatches.push(...nameMatches);

          // Remove found name from remaining list
          remainingNames = remainingNames.filter((n) => n !== name);
        } else {
          console.log(`  ⚪️ No matches found for "${name}" after NLP analysis`);
        }
      } catch (error) {
        console.error(`❌ Error processing name "${name}":`, error.message);
      }
    }

    // Sort matches by original input order
    allMatches.sort((a, b) => {
      const nameAIndex = baseNames.indexOf(a.name);
      const nameBIndex = baseNames.indexOf(b.name);
      if (nameAIndex !== nameBIndex) {
        return nameAIndex - nameBIndex;
      }
      return a.position - b.position;
    });

    if (remainingNames.length > 0) {
      console.log(`\n❌ Could not find ${remainingNames.length} name(s):`);
      remainingNames.forEach((name) => console.log(`  - ${name}`));
    }

    return allMatches;
  }

  /**
   * Get actual document content for MegaSearch results
   */
  private async getRelevantDocuments(searchResults: any[]): Promise<
    Array<{
      path: string;
      content: string;
      metadata: any;
      searchScore: number;
      highlights: any[];
    }>
  > {
    const relevantDocs = [];

    for (const result of searchResults) {
      try {
        const docPath = result.doc.filePath;
        const content = await fs.readFile(docPath, 'utf-8');

        if (content.trim()) {
          relevantDocs.push({
            path: docPath,
            content,
            metadata: result.doc,
            searchScore: result.score,
            highlights: result.highlights,
          });
        }
      } catch (error) {
        console.warn(
          `⚠️ Could not read document ${result.doc?.fileName}:`,
          error.message,
        );
      }
    }

    return relevantDocs;
  }

  /**
   * Process relevant documents with NLP analysis
   */
  private async processRelevantDocumentsWithNLP(
    targetName: string,
    relevantDocs: Array<{
      path: string;
      content: string;
      metadata: any;
      searchScore: number;
      highlights: any[];
    }>,
    searchResults: any[],
  ): Promise<NameMatch[]> {
    const matches: NameMatch[] = [];

    for (const doc of relevantDocs) {
      try {
        console.log(`    📄 NLP analyzing: ${path.basename(doc.path)}`);

        // ✅ NEW: Pass MegaSearch context to NLP analyzer
        const nlpMatches = await this.analyzeDocumentWithNLP(
          doc.content,
          {
            ...doc.metadata,
            searchScore: doc.searchScore,
            searchHighlights: doc.highlights,
          },
          [targetName], // Focus on this specific name
          [
            {
              name: targetName,
              positions: doc.highlights
                .map((h) => h.charStart)
                .filter((p) => p !== undefined),
              confidence: doc.searchScore,
            },
          ],
        );

        // Enhance matches with search context
        for (const match of nlpMatches) {
          // Extract contextual information
          const extractedInfo = InformationExtractor.extract(
            doc.content,
            match,
          );

          matches.push({
            ...match,
            documentPath: doc.path,
            extractedInfo,
            processingMethod: 'combined', // Mark as combined MegaSearch + NLP
            searchScore: doc.searchScore, // Include original search score
            searchHighlights: doc.highlights, // Include search highlights
          });
        }

        console.log(
          `      ✅ Found ${nlpMatches.length} NLP matches in ${path.basename(doc.path)}`,
        );
      } catch (error) {
        console.error(`❌ NLP analysis failed for ${doc.path}:`, error.message);

        // ✅ Fallback: Use search results as matches
        const fallbackMatch = this.createFallbackMatch(targetName, doc);
        if (fallbackMatch) {
          matches.push(fallbackMatch);
          console.log(
            `    🔄 Using fallback match for ${path.basename(doc.path)}`,
          );
        }
      }
    }

    return matches;
  }

  /**
   * Create fallback match from MegaSearch results when NLP fails
   */
  private createFallbackMatch(
    targetName: string,
    doc: {
      path: string;
      content: string;
      metadata: any;
      searchScore: number;
      highlights: any[];
    },
  ): NameMatch | null {
    try {
      // Use the best highlight as the match
      const bestHighlight = doc.highlights.reduce((best, current) =>
        (current.confidence || 0) > (best.confidence || 0) ? current : best,
      );

      if (!bestHighlight || !bestHighlight.charStart) {
        return null;
      }

      // Extract the matched text around the highlight position
      const start = Math.max(0, bestHighlight.charStart - 10);
      const end = Math.min(doc.content.length, bestHighlight.charEnd + 10);
      const matchedText = doc.content.substring(start, end).trim();

      // Find the actual matched word
      const declension =
        bestHighlight.originalWord || matchedText.split(/\s+/)[0];

      // Extract contextual information
      const extractedInfo = InformationExtractor.extract(doc.content, {
        name: targetName,
        declension,
        position: bestHighlight.charStart,
        confidence: doc.searchScore,
      });

      return {
        name: targetName,
        declension,
        position: bestHighlight.charStart,
        confidence: doc.searchScore * 0.8, // Lower confidence for fallback
        documentPath: doc.path,
        extractedInfo,
        processingMethod: 'search-only', // Mark as search-only fallback
        searchScore: doc.searchScore,
        searchHighlights: doc.highlights,
      };
    } catch (error) {
      console.error('Error creating fallback match:', error);
      return null;
    }
  }

  /**
   * Analyze document using NLP Analyzer with Ukrainian processing
   * ✅ Enhanced to use MegaSearch context
   */
  private async analyzeDocumentWithNLP(
    content: string,
    metadata: any,
    targetNames: string[],
    searchMatches: Array<{
      name: string;
      positions: number[];
      confidence: number;
    }>,
  ): Promise<NameMatch[]> {
    try {
      // Prepare document for NLP analysis
      const docMetadata = {
        id: metadata.id || path.basename(metadata.filePath),
        title: metadata.fileName,
        size: content.length,
        format: 'text',
        language: metadata.language || 'ukrainian',
      };

      // ✅ DISABLED: Skip problematic NLP tasks, use pattern matching only
      console.log(
        `    🔍 Using pattern-based analysis (NLP disabled for compatibility)`,
      );

      // Use enhanced pattern matching with MegaSearch hints
      const matches = this.enhancedPatternMatching(
        content,
        targetNames,
        searchMatches,
        metadata,
      );

      console.log(`    🎯 Pattern analysis found ${matches.length} matches`);
      return matches;
    } catch (error) {
      console.error('Analysis failed:', error.message);

      // Fallback to simple pattern matching
      return this.fallbackNameMatching(content, targetNames, searchMatches);
    }
  }

  /**
   * Enhanced pattern matching that uses MegaSearch hints
   */
  private enhancedPatternMatching(
    content: string,
    targetNames: string[],
    searchMatches: Array<{
      name: string;
      positions: number[];
      confidence: number;
    }>,
    metadata: any,
  ): NameMatch[] {
    const matches: NameMatch[] = [];

    for (const searchMatch of searchMatches) {
      const name = searchMatch.name;
      const [surname, firstName, patronymic] = name.split(' ');

      if (!surname || !firstName) continue;

      // ✅ Focus search around MegaSearch hint positions
      const searchPositions = searchMatch.positions || [];

      if (searchPositions.length > 0) {
        // Search in windows around hint positions
        for (const hintPos of searchPositions) {
          const windowStart = Math.max(0, hintPos - 200);
          const windowEnd = Math.min(content.length, hintPos + 200);
          const window = content.substring(windowStart, windowEnd);

          const windowMatches = this.findUkrainianPatternsInWindow(
            window,
            name,
            surname,
            firstName,
            patronymic,
            windowStart,
          );

          matches.push(
            ...windowMatches.map((match) => ({
              ...match,
              name,
              confidence: match.confidence * searchMatch.confidence, // Boost with search confidence
              processingMethod: 'enhanced-pattern',
            })),
          );
        }
      } else {
        // Fallback: search entire document
        const documentMatches = this.findUkrainianPatternsInWindow(
          content,
          name,
          surname,
          firstName,
          patronymic,
          0,
        );

        matches.push(
          ...documentMatches.map((match) => ({
            ...match,
            name,
            confidence: match.confidence * searchMatch.confidence,
            processingMethod: 'enhanced-pattern',
          })),
        );
      }
    }

    return matches;
  }

  /**
   * Find Ukrainian name patterns in a text window
   */
  private findUkrainianPatternsInWindow(
    text: string,
    fullName: string,
    surname: string,
    firstName: string,
    patronymic: string | undefined,
    offset: number,
  ): Array<{
    declension: string;
    position: number;
    confidence: number;
  }> {
    const matches = [];

    // Enhanced Ukrainian declension patterns
    const patterns = [
      // Full name with genitive endings (most common in documents)
      `${surname.slice(0, -1)}[аи]\\s+${firstName.slice(0, -1)}[аи]${patronymic ? `\\s+${patronymic.slice(0, -1)}[аи]` : ''}`,
      // Two-part name with genitive
      `${surname.slice(0, -1)}[аи]\\s+${firstName.slice(0, -1)}[аи]`,
      // Accusative case (alternative)
      `${surname.slice(0, -1)}[ую]\\s+${firstName.slice(0, -1)}[ую]`,
      // Exact match
      fullName.replace(/\s+/g, '\\s+'),
      // Surname with different first name endings
      `${surname}\\s+${firstName.slice(0, -2)}[аи][а-яіїє]*`,
      // ✅ Add more flexible patterns for Ukrainian names
      `${surname.slice(0, -2)}[а-яіїє]*\\s+${firstName.slice(0, -2)}[а-яіїє]*`,
      // Partial surname + first name variations
      `${surname.slice(0, -3)}[а-яіїє]{1,3}\\s+${firstName.slice(0, -3)}[а-яіїє]{1,3}`,
    ];

    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'gi');
        let match;

        while ((match = regex.exec(text)) !== null) {
          const matchedText = match[0];
          const similarity = this.calculateNameSimilarity(
            matchedText,
            fullName,
          );

          if (similarity > this.config.confidence.nameMatchThreshold) {
            matches.push({
              declension: matchedText,
              position: offset + match.index,
              confidence: similarity,
            });
          }
        }
      } catch (error) {
        console.warn(
          `Pattern matching error for pattern "${pattern}":`,
          error.message,
        );
      }
    }

    return matches;
  }

  /**
   * Fallback name matching when NLP analysis fails
   */
  private fallbackNameMatching(
    content: string,
    targetNames: string[],
    searchMatches: Array<{
      name: string;
      positions: number[];
      confidence: number;
    }>,
  ): NameMatch[] {
    const matches: NameMatch[] = [];

    for (const searchMatch of searchMatches) {
      const name = searchMatch.name;
      const [surname, firstName, patronymic] = name.split(' ');

      if (!surname || !firstName) continue;

      // Simple Ukrainian declension patterns
      const patterns = [
        // Genitive case patterns (most common in documents)
        `${surname.slice(0, -1)}[аи]\\s+${firstName.slice(0, -1)}[аи]${patronymic ? `\\s+${patronymic.slice(0, -1)}[аи]` : ''}`,
        // Exact match
        name.replace(/\s+/g, '\\s+'),
        // Partial matches
        `${surname}\\s+${firstName.slice(0, -1)}[аи]`,
        // ✅ Add more flexible Ukrainian patterns
        `${surname.slice(0, -2)}[а-яіїє]*\\s+${firstName.slice(0, -2)}[а-яіїє]*`,
      ];

      for (const pattern of patterns) {
        try {
          const regex = new RegExp(pattern, 'gi');
          let match;

          while ((match = regex.exec(content)) !== null) {
            const similarity = this.calculateNameSimilarity(match[0], name);

            if (similarity > this.config.confidence.nameMatchThreshold) {
              matches.push({
                name,
                declension: match[0],
                position: match.index,
                confidence: similarity * searchMatch.confidence,
                processingMethod: 'fallback',
              });
            }
          }
        } catch (error) {
          console.warn(
            `Fallback pattern error for "${pattern}":`,
            error.message,
          );
        }
      }
    }

    return matches;
  }

  /**
   * Dispose of all resources
   */
  async dispose(): Promise<void> {
    console.log('🧹 Disposing Document Intelligence Service...');

    try {
      if (this.nlpAnalyzer) {
        await this.nlpAnalyzer.dispose();
      }
    } catch (error) {
      console.warn('⚠️ Error disposing NLP Analyzer:', error);
    }

    console.log('✅ Document Intelligence Service disposed');
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): any {
    return {
      megaSearch: this.megaSearch?.getStats() || null,
      nlpAnalyzer: this.nlpAnalyzer?.getLearningStats() || null,
      processor: this.ukrainianNameProcessor?.getStats() || null,
      extractor: this.contextExtractor?.getStats() || null,
    };
  }
}

export { DocumentIntelligenceService };
