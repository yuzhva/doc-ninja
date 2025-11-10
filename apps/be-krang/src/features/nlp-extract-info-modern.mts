import fs from 'fs/promises';
import path from 'path';
import type { AnalysisResult, TextMetadata } from 'toolkit--local/node';
import { createNLPAnalyzer } from 'toolkit--local/node';
import * as XLSX from 'xlsx';

import type { ExtractedInfo } from '../nlp/information-extractor.mts';
import { InformationExtractor } from '../nlp/information-extractor.mts';
import { readExcelData } from '../nlp/utils/excel-utils.mts';
import { runtimePathById } from '../supplement/index.mts';

interface ModernNameMatch {
  name: string;
  foundVariant: string;
  position: { start: number; end: number };
  confidence: number;
  matchType: 'entity' | 'semantic' | 'pattern';
  documentPath?: string;
  extractedInfo?: ExtractedInfo;
  nlpContext?: {
    sentimentScore?: number;
    entityContext?: string;
    processingTime?: number;
  };
}

type SourceType = 'documents' | 'index';

interface ProcessingConfig {
  sourceType: SourceType;
  sourcePath: string;
  fileExtension: string;
  outputFilename: string;
}

function getProcessingConfig(
  { sourceType }: { sourceType: ProcessingConfig['sourceType'] } = {
    sourceType: 'documents',
  },
): ProcessingConfig {
  // Check command line arguments
  const args = process.argv.slice(2);
  const sourceArg = args.find((arg) => arg.startsWith('--source='));
  const sourceTypeParam: SourceType =
    sourceType || (sourceArg?.split('=')[1] as SourceType) || 'documents';

  if (sourceTypeParam === 'index') {
    return {
      sourceType: 'index',
      sourcePath: path.join(runtimePathById.assets, 'nlp-index'),
      fileExtension: '.json',
      outputFilename: 'extracted_info_modern_from_index.xlsx',
    };
  } else {
    return {
      sourceType: 'documents',
      sourcePath: path.join(runtimePathById.assets, 'docs-for-nlp'),
      fileExtension: '.txt',
      outputFilename: 'extracted_info_modern_from_documents.xlsx',
    };
  }
}

async function extractInformationModern() {
  const config = getProcessingConfig();

  // Start timing
  const startTime = Date.now();

  console.log('🚀 Starting MODERN NLP information extraction...');
  console.log(`📂 Source type: ${config.sourceType}`);
  console.log(`📁 Source path: ${config.sourcePath}`);
  console.log(`🔧 Using: Advanced NLP Analyzer with Ukrainian processor`);
  console.log(`⏱️ Started at: ${new Date().toLocaleTimeString()}`);

  let analyzer;

  try {
    // 1. Read input names from Excel
    const inputPath = path.join(runtimePathById.assets, 'nlp-input/data.xlsx');
    const allBaseNames = await readExcelData(inputPath);
    console.log(`📊 Loaded ${allBaseNames.length} names from input file.`);

    // Remove duplicates
    const baseNames = [...new Set(allBaseNames)];
    if (baseNames.length < allBaseNames.length) {
      console.log(
        `ℹ️ Removed ${allBaseNames.length - baseNames.length} duplicate names. Processing ${baseNames.length} unique names.`,
      );
    }

    // 2. Initialize Modern NLP Analyzer
    console.log('🧠 Initializing Modern NLP Analyzer...');
    analyzer = await createNLPAnalyzer({
      cacheEnabled: true,
      useWorkers: false,
      enableMonitoring: true,
      enableRetries: true,
      enableAdaptiveLearning: true,
      // modelsPath removed - uses default: process.cwd()/models
    });

    console.log('✅ Modern NLP Analyzer initialized successfully');

    // 3. Get all files to process
    let sourceFiles = await collectAllSourceFiles(
      config.sourcePath,
      config.fileExtension,
    );

    // Sort by newest first
    sourceFiles.sort((a, b) => {
      if (config.sourceType === 'index') {
        const timeA = parseInt(path.basename(a).split('-')[0], 10);
        const timeB = parseInt(path.basename(b).split('-')[0], 10);
        return timeB - timeA;
      } else {
        const dateA = extractDateFromPath(a);
        const dateB = extractDateFromPath(b);
        if (dateA && dateB) {
          return dateB.getTime() - dateA.getTime();
        }
        if (dateA) return -1;
        if (dateB) return 1;
        return 0;
      }
    });

    console.log(
      `🗂️ Found ${sourceFiles.length} ${config.sourceType} files to process.`,
    );

    // 4. Process files with modern NLP approach
    const allMatches: ModernNameMatch[] = [];

    await processNameAcrossFilesModern(
      sourceFiles,
      config,
      baseNames,
      analyzer,
      allMatches,
    );

    // 5. Write results to Excel
    await writeModernResultsToExcel(
      allMatches,
      analyzer,
      config.outputFilename,
    );

    // Display completion timing
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    const minutes = Math.floor(totalTime / 60000);
    const seconds = Math.floor((totalTime % 60000) / 1000);

    console.log(`\n⏱️ Modern processing completed in: ${minutes}m ${seconds}s`);
    console.log(`🏁 Finished at: ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    console.error('❌ Error during modern information extraction:', error);
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    console.log(`⏱️ Failed after: ${totalTime}ms`);
  } finally {
    // Clean up analyzer
    if (analyzer) {
      try {
        console.log('🧹 Disposing Modern NLP Analyzer...');
        await analyzer.dispose();
        console.log('✅ Analyzer disposed successfully');
      } catch (disposeError) {
        console.warn('⚠️ Error disposing analyzer:', disposeError);
      }
    }
  }
}

async function processNameAcrossFilesModern(
  sourceFiles: string[],
  config: ProcessingConfig,
  baseNames: string[],
  analyzer: any,
  allMatches: ModernNameMatch[],
) {
  let remainingNames = [...baseNames];

  console.log(
    `\n🔎 Modern search for ${remainingNames.length} names across ${sourceFiles.length} files...`,
  );

  for (const sourceFile of sourceFiles) {
    if (remainingNames.length === 0) {
      console.log('✅ All names found with modern analyzer. Stopping search.');
      break;
    }

    const { content, originalPath } = await getFileContent(
      sourceFile,
      config.sourceType,
    );

    console.log(
      `\n📄 Modern analyzing: "${originalPath}" for ${remainingNames.length} remaining names.`,
    );

    if (!content.trim()) {
      console.log(`  ⚠️ No content found, skipping.`);
      continue;
    }

    // Create document metadata
    const metadata: TextMetadata = {
      id: path.basename(originalPath, path.extname(originalPath)),
      title: originalPath,
      size: content.length,
      format: 'text',
    };

    // Use modern NLP analysis with Ukrainian processor
    try {
      const analysisResult: AnalysisResult = await analyzer.analyze(
        content,
        metadata,
        {
          tasks: ['entities', 'sentiment'], // Focus on entity extraction
          chunkSize: 1024, // Larger chunks for Ukrainian
          useCache: true,
          modelConfig: {
            device: 'cpu',
            quantized: true,
          },
        },
      );

      console.log(
        `  🧠 Modern NLP Analysis completed in ${analysisResult.metadata.processingTime}ms`,
      );
      console.log(
        `  📊 Confidence: ${(analysisResult.metadata.confidence * 100).toFixed(1)}%`,
      );

      // Find matches using modern approach
      const matchesInFile = findModernNameMatches(
        content,
        remainingNames,
        analysisResult,
        originalPath,
      );

      if (matchesInFile.length > 0) {
        console.log(
          `  🎯 Modern analyzer found ${matchesInFile.length} potential match(es).`,
        );
        const namesFoundInThisFile = new Set<string>();

        for (const match of matchesInFile) {
          namesFoundInThisFile.add(match.name);
          allMatches.push(match);

          console.log(
            `    📝 Modern match: "${match.name}" → "${match.foundVariant}" (${(match.confidence * 100).toFixed(1)}%)`,
          );
        }

        // Update remaining names
        remainingNames = remainingNames.filter(
          (name) => !namesFoundInThisFile.has(name),
        );
      } else {
        console.log(`  ⚪️ No modern matches found in this file.`);
      }
    } catch (analysisError) {
      console.error(
        `  ❌ Modern analysis failed for ${originalPath}:`,
        analysisError.message,
      );
    }
  }

  // Sort matches by original input order
  allMatches.sort((a, b) => {
    const nameAIndex = baseNames.indexOf(a.name);
    const nameBIndex = baseNames.indexOf(b.name);
    if (nameAIndex !== nameBIndex) {
      return nameAIndex - nameBIndex;
    }
    return a.position.start - b.position.start;
  });

  if (remainingNames.length > 0) {
    console.log(
      `\n❌ Modern analyzer could not find ${remainingNames.length} name(s):`,
    );
    remainingNames.forEach((name) => console.log(`  - ${name}`));
  }
}

function findModernNameMatches(
  content: string,
  targetNames: string[],
  analysisResult: AnalysisResult,
  documentPath: string,
): ModernNameMatch[] {
  const matches: ModernNameMatch[] = [];

  // Extract entities from modern NLP analysis
  const entities = analysisResult.tasks.entities?.entities || [];
  const sentiment = analysisResult.tasks.sentiment?.overall;

  console.log(`    🔍 Modern NLP found ${entities.length} entities to analyze`);

  // Method 1: Entity-based matching (most accurate)
  for (const targetName of targetNames) {
    const nameParts = targetName.split(' ').filter((part) => part.length > 2);

    for (const entity of entities) {
      if (entity.label === 'PERSON' && entity.confidence > 0.7) {
        const similarity = calculateNameSimilarity(entity.text, targetName);

        if (similarity > 0.75) {
          // Threshold for entity matches
          const match: ModernNameMatch = {
            name: targetName,
            foundVariant: entity.text,
            position: { start: entity.start, end: entity.end },
            confidence: Math.min(similarity, entity.confidence),
            matchType: 'entity',
            documentPath,
            nlpContext: {
              sentimentScore: sentiment?.score,
              entityContext: extractEntityContext(
                content,
                entity.start,
                entity.end,
              ),
              processingTime: analysisResult.metadata.processingTime,
            },
          };

          // Extract additional information
          match.extractedInfo = InformationExtractor.extract(content, {
            name: targetName,
            declension: entity.text,
            position: entity.start,
            confidence: similarity,
          });

          matches.push(match);
          console.log(
            `    ✅ Entity match: "${targetName}" → "${entity.text}" (${(similarity * 100).toFixed(1)}%)`,
          );
        }
      }
    }
  }

  // Method 2: Semantic pattern matching (fallback for missed entities)
  for (const targetName of targetNames) {
    if (matches.some((m) => m.name === targetName)) {
      continue; // Already found via entity matching
    }

    const patternMatches = findUkrainianPatternMatches(content, targetName);
    for (const patternMatch of patternMatches) {
      const match: ModernNameMatch = {
        name: targetName,
        foundVariant: patternMatch.text,
        position: patternMatch.position,
        confidence: patternMatch.confidence,
        matchType: 'pattern',
        documentPath,
        nlpContext: {
          sentimentScore: sentiment?.score,
          processingTime: analysisResult.metadata.processingTime,
        },
      };

      // Extract additional information
      match.extractedInfo = InformationExtractor.extract(content, {
        name: targetName,
        declension: patternMatch.text,
        position: patternMatch.position.start,
        confidence: patternMatch.confidence,
      });

      matches.push(match);
      console.log(
        `    🔍 Pattern match: "${targetName}" → "${patternMatch.text}" (${(patternMatch.confidence * 100).toFixed(1)}%)`,
      );
    }
  }

  return matches;
}

function calculateNameSimilarity(
  entityText: string,
  targetName: string,
): number {
  const entityParts = entityText.toLowerCase().split(/\s+/);
  const targetParts = targetName.toLowerCase().split(/\s+/);

  let matchingParts = 0;
  let totalComparisons = 0;

  for (const targetPart of targetParts) {
    for (const entityPart of entityParts) {
      totalComparisons++;
      const similarity = stringSimilarity(targetPart, entityPart);
      if (similarity > 0.8) {
        matchingParts++;
      }
    }
  }

  // Base similarity on matching parts
  const baseSimilarity =
    totalComparisons > 0
      ? matchingParts / Math.max(targetParts.length, entityParts.length)
      : 0;

  // Boost if lengths are similar
  const lengthBoost =
    Math.abs(entityParts.length - targetParts.length) === 0 ? 0.1 : 0;

  return Math.min(1.0, baseSimilarity + lengthBoost);
}

function stringSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1)
    .fill(null)
    .map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator,
      );
    }
  }

  return matrix[str2.length][str1.length];
}

function findUkrainianPatternMatches(
  content: string,
  targetName: string,
): Array<{
  text: string;
  position: { start: number; end: number };
  confidence: number;
}> {
  const matches: Array<{
    text: string;
    position: { start: number; end: number };
    confidence: number;
  }> = [];

  const [surname, name, patronymic] = targetName.split(' ');

  if (!surname || !name) return matches;

  // Ukrainian declension patterns for genitive case (most common)
  const patterns = [
    // Full name with genitive endings
    `${surname.slice(0, -1)}[аи]\\s+${name.slice(0, -1)}[аи]\\s+${patronymic ? patronymic.slice(0, -1) + '[аи]' : '\\w+'}`,
    // Surname + Name (2-part)
    `${surname.slice(0, -1)}[аи]\\s+${name.slice(0, -1)}[аи]`,
    // Exact match
    targetName.replace(/\s+/g, '\\s+'),
  ];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'gi');
    let match;

    while ((match = regex.exec(content)) !== null) {
      const matchText = match[0];
      const similarity = calculateNameSimilarity(matchText, targetName);

      if (similarity > 0.7) {
        matches.push({
          text: matchText,
          position: { start: match.index, end: match.index + matchText.length },
          confidence: similarity,
        });
      }
    }
  }

  return matches;
}

function extractEntityContext(
  content: string,
  start: number,
  end: number,
): string {
  const contextStart = Math.max(0, start - 100);
  const contextEnd = Math.min(content.length, end + 100);
  return content
    .substring(contextStart, contextEnd)
    .replace(/\s+/g, ' ')
    .trim();
}

async function writeModernResultsToExcel(
  matches: ModernNameMatch[],
  analyzer: any,
  filename: string,
) {
  const outputPath = path.join(runtimePathById.assets, 'nlp-output', filename);

  const data = [
    [
      'Input Name',
      'Found In Document',
      'Document Date',
      'Found Variant',
      'Match Type',
      'Section Title',
      'Content',
      'Action Date Content',
      'Reason',
      'Summary',
      'Action Date',
      'Confidence',
      'NLP Sentiment',
      'Entity Context',
      'Processing Time (ms)',
    ],
  ];

  for (const match of matches) {
    const summaryParts: string[] = [];
    if (match.extractedInfo?.sectionTitle) {
      summaryParts.push(match.extractedInfo.sectionTitle);
    }
    if (match.extractedInfo?.content) {
      summaryParts.push('', match.extractedInfo.content);
    }
    if (match.extractedInfo?.actionDateContent) {
      summaryParts.push(match.extractedInfo.actionDateContent);
    }
    if (match.extractedInfo?.reason) {
      summaryParts.push(match.extractedInfo.reason);
    }
    const summary = summaryParts.join('\n');

    const sentimentLabel = match.nlpContext?.sentimentScore
      ? `${(match.nlpContext.sentimentScore * 100).toFixed(1)}%`
      : 'N/A';

    data.push([
      match.name,
      match.documentPath || 'N/A',
      match.extractedInfo?.documentDate || 'N/A',
      match.foundVariant,
      match.matchType.toUpperCase(),
      match.extractedInfo?.sectionTitle || 'N/A',
      match.extractedInfo?.content || 'N/A',
      match.extractedInfo?.actionDateContent || 'N/A',
      match.extractedInfo?.reason || 'N/A',
      summary,
      match.extractedInfo?.actionDate || 'N/A',
      `${(match.confidence * 100).toFixed(2)}%`,
      sentimentLabel,
      match.nlpContext?.entityContext || 'N/A',
      match.nlpContext?.processingTime?.toString() || 'N/A',
    ]);
  }

  // Add summary section
  data.push([]);
  data.push(['=== MODERN NLP ANALYSIS SUMMARY ===']);
  data.push(['Total Matches Found:', matches.length]);
  data.push([
    'Entity Matches:',
    matches.filter((m) => m.matchType === 'entity').length,
  ]);
  data.push([
    'Pattern Matches:',
    matches.filter((m) => m.matchType === 'pattern').length,
  ]);
  data.push([
    'Average Confidence:',
    `${((matches.reduce((sum, m) => sum + m.confidence, 0) / Math.max(1, matches.length)) * 100).toFixed(1)}%`,
  ]);

  // Get analyzer stats if available
  try {
    const cacheStats = analyzer.getCacheStats?.();
    if (cacheStats) {
      data.push(['Cache Hit Rate:', `${cacheStats.hitRate.toFixed(1)}`]);
      data.push(['Cache Size:', `${cacheStats.size}/${cacheStats.maxSize}`]);
    }
  } catch (error) {
    // Ignore if cache stats not available
  }

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  worksheet['!cols'] = [
    { wch: 25 }, // Input Name
    { wch: 50 }, // Found In Document
    { wch: 15 }, // Document Date
    { wch: 30 }, // Found Variant
    { wch: 12 }, // Match Type
    { wch: 40 }, // Section Title
    { wch: 50 }, // Content
    { wch: 30 }, // Action Date Content
    { wch: 40 }, // Reason
    { wch: 60 }, // Summary
    { wch: 15 }, // Action Date
    { wch: 12 }, // Confidence
    { wch: 12 }, // NLP Sentiment
    { wch: 40 }, // Entity Context
    { wch: 15 }, // Processing Time
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Modern NLP Results');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  XLSX.writeFile(workbook, outputPath);

  console.log(`\n✅ Modern results saved to: ${outputPath}`);
  console.log(`📊 Found ${matches.length} matches using modern NLP approach`);
}

// ...existing helper functions...

async function getFileContent(
  filePath: string,
  sourceType: SourceType,
): Promise<{ content: string; originalPath: string }> {
  const contentBuffer = await fs.readFile(filePath, 'utf-8');
  const relativePath = path.basename(filePath);

  if (sourceType === 'index') {
    const indexData = JSON.parse(contentBuffer);
    const originalDocPath = path.join(
      runtimePathById.assets,
      indexData.originalPath,
    );

    try {
      const originalContent = await fs.readFile(originalDocPath, 'utf-8');
      return { content: originalContent, originalPath: indexData.originalPath };
    } catch (error) {
      const sortedChunks = (indexData.indexedWords || [])
        .filter((doc: any) => doc.text && doc.text.trim())
        .sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
      const reconstructedContent = sortedChunks
        .map((doc: any) => doc.text.trim())
        .join(' ');
      return {
        content: reconstructedContent,
        originalPath: indexData.originalPath,
      };
    }
  }
  return { content: contentBuffer, originalPath: relativePath };
}

async function collectAllSourceFiles(
  sourcePath: string,
  extension: string,
): Promise<string[]> {
  const allFiles: string[] = [];

  async function processFolder(folderPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(folderPath, entry.name);

        if (entry.isDirectory()) {
          await processFolder(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(extension)) {
          allFiles.push(fullPath);
        }
      }
    } catch (error) {
      console.log(`⚠️ Could not read directory ${folderPath}:`, error);
    }
  }

  try {
    await fs.access(sourcePath);
    await processFolder(sourcePath);
  } catch (error) {
    console.log(
      `⚠️ Source path ${sourcePath} does not exist or is not accessible`,
    );
  }

  return [...new Set(allFiles)];
}

function extractDateFromPath(filePath: string): Date | null {
  const basename = path.basename(filePath);

  const dateMatch = basename.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dateMatch) {
    const [, day, month, year] = dateMatch;
    return new Date(`${year}-${month}-${day}`);
  }

  const yearMatch = filePath.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    return new Date(yearMatch[1]);
  }

  return null;
}

export { extractInformationModern };
