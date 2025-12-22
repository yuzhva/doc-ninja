import fs from 'fs/promises';
import path from 'path';
import * as XLSX from 'xlsx';

import { AdaptiveUkrainianNameMatcher } from '../nlp/adaptive-matcher.mjs';
import type { NameMatch } from '../nlp/index.mjs';
import type { ExtractedInfo } from '../nlp/information-extractor.mjs';
import { InformationExtractor } from '../nlp/information-extractor.mjs';
import { readExcelData } from '../nlp/utils/excel-utils.mjs';
import {
  collectFilePaths,
  getFoldersRecursive,
  runtimePathById,
} from '../supplement/index.mjs';

// Extend NameMatch to include new extracted info
declare module './nlp/name-matcher.mjs' {
  interface NameMatch {
    documentPath?: string;
    extractedInfo?: ExtractedInfo;
  }
}

type SourceType = 'documents' | 'index';

interface ProcessingConfig {
  sourceType: SourceType;
  sourcePath: string;
  fileExtension: string;
  outputFilename: string;
}

function getProcessingConfig(
  {
    sourceType,
  }: {
    sourceType: ProcessingConfig['sourceType'];
  } = { sourceType: 'documents' },
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
      outputFilename: 'extracted_info_from_index.xlsx',
    };
  } else {
    return {
      sourceType: 'documents',
      sourcePath: path.join(runtimePathById.assets, 'docs-for-nlp'),
      fileExtension: '.txt',
      outputFilename: 'extracted_info_from_documents.xlsx',
    };
  }
}

async function extractInformation({ queries }: { queries?: string[] } = {}) {
  const config = getProcessingConfig();

  // Start timing
  const startTime = Date.now();

  console.log(
    '🚀 Starting NLP information extraction with adaptive learning...',
  );
  console.log(`📂 Source type: ${config.sourceType}`);
  console.log(`📁 Source path: ${config.sourcePath}`);
  console.log(`⏱️ Started at: ${new Date().toLocaleTimeString()}`);

  try {
    let allBaseNames: string[] = [];

    if (queries) {
      allBaseNames = queries;
    } else {
      // 1. Read input names from Excel
      const inputPath = path.join(
        runtimePathById.assets,
        'nlp-input/data.xlsx',
      );
      allBaseNames = await readExcelData(inputPath);
      console.log(`📊 Loaded ${allBaseNames.length} names from input file.`);
    }

    // Remove duplicates to process each unique name only once
    const baseNames = [...new Set(allBaseNames)];
    if (baseNames.length < allBaseNames.length) {
      console.log(
        `ℹ️ Removed ${
          allBaseNames.length - baseNames.length
        } duplicate names. Processing ${baseNames.length} unique names.`,
      );
    }

    // 2. Get all files to process
    let sourceFiles = await collectAllSourceFiles(
      config.sourcePath,
      config.fileExtension,
    );

    // sort by newest first
    sourceFiles.sort((a, b) => {
      if (config.sourceType === 'index') {
        const timeA = parseInt(path.basename(a).split('-')[0], 10);
        const timeB = parseInt(path.basename(b).split('-')[0], 10);
        return timeB - timeA; // Sort descending for index files
      } else {
        // For documents, use robust date extraction
        const dateA = extractDateFromPath(a);
        const dateB = extractDateFromPath(b);

        if (dateA && dateB) {
          return dateB.getTime() - dateA.getTime(); // Newest first
        }
        if (dateA) return -1; // A has a date, B doesn't, so A comes first
        if (dateB) return 1; // B has a date, A doesn't, so B comes first
        return 0; // Neither have a date, keep original order
      }
    });

    console.log(
      `🗂️ Found ${sourceFiles.length} ${config.sourceType} files to process.`,
    );

    // 3. Initialize ADAPTIVE NLP matcher
    const matcher = new AdaptiveUkrainianNameMatcher();
    await matcher.initialize();

    // Show current performance stats
    const stats = matcher.getPerformanceStats();
    console.log(
      `📈 Current performance: ${stats.recentAccuracy.toFixed(1)}% accuracy over ${stats.totalFeedback} feedback entries`,
    );
    console.log(
      `🎯 Current thresholds: 2-word=${stats.currentThresholds.twoWordMatch.toFixed(3)}, 3-word=${stats.currentThresholds.threeWordMatch.toFixed(3)}`,
    );

    // 4. Process files based on source type
    const allMatches: NameMatch[] = [];

    await processNameAcrossFiles(
      sourceFiles,
      config,
      baseNames,
      matcher,
      allMatches,
    );

    // 5. Write results to Excel with learning insights
    await writeResultsToExcel(allMatches, matcher, config.outputFilename);

    // Calculate and display timing
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    const minutes = Math.floor(totalTime / 60000);
    const seconds = Math.floor((totalTime % 60000) / 1000);
    const milliseconds = totalTime % 1000;

    console.log(
      `\n⏱️ Processing completed in: ${minutes}m ${seconds}s ${milliseconds}ms`,
    );
    console.log(`📊 Total time: ${totalTime}ms`);
    console.log(`🏁 Finished at: ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    console.error('❌ Error during information extraction:', error);

    // Show timing even on error
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    console.log(`⏱️ Failed after: ${totalTime}ms`);
  }
}

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
      console.log(
        `    📄 Using original document content for better context extraction`,
      );
      return { content: originalContent, originalPath: indexData.originalPath };
    } catch (error) {
      // Fallback: reconstruct from indexed chunks if original is missing
      const sortedChunks = (indexData.indexedWords || [])
        .filter((doc: any) => doc.text && doc.text.trim())
        .sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
      const reconstructedContent = sortedChunks
        .map((doc: any) => doc.text.trim())
        .join(' ');
      console.log(
        `    ⚠️ Using reconstructed content from index (may have limited context)`,
      );
      return {
        content: reconstructedContent,
        originalPath: indexData.originalPath,
      };
    }
  }
  return { content: contentBuffer, originalPath: relativePath };
}

async function processNameAcrossFiles(
  sourceFiles: string[],
  config: ProcessingConfig,
  baseNames: string[],
  matcher: AdaptiveUkrainianNameMatcher,
  allMatches: NameMatch[],
) {
  let remainingNames = [...baseNames];

  console.log(
    `\n🔎 Searching for ${remainingNames.length} names across ${sourceFiles.length} files...`,
  );

  for (const sourceFile of sourceFiles) {
    if (remainingNames.length === 0) {
      console.log('✅ All names have been found. Stopping search.');
      break;
    }

    const { content, originalPath } = await getFileContent(
      sourceFile,
      config.sourceType,
    );
    console.log(
      `\n📄 Checking in file: "${originalPath}" for ${remainingNames.length} remaining names.`,
    );

    if (!content.trim()) {
      console.log(`  ⚠️ No content found in file, skipping.`);
      continue;
    }

    // Find all remaining names in the current file
    const matchesInFile = await matcher.findNamesWithSimilarity(
      content,
      remainingNames,
    );

    if (matchesInFile.length > 0) {
      console.log(
        `  🎯 Found ${matchesInFile.length} potential match(es) in this file.`,
      );
      const namesFoundInThisFile = new Set<string>();

      // Process all matches found in this file
      for (const match of matchesInFile) {
        namesFoundInThisFile.add(match.name);

        match.documentPath = originalPath;
        match.extractedInfo = InformationExtractor.extract(content, match);
        allMatches.push(match);

        console.log(
          `    📝 Processed match for "${match.name}" (declension: "${match.declension}")`,
        );

        // Simulate adaptive learning
        await simulateFeedback(matcher, match);
      }

      // Update the list of names to search for in the next file
      remainingNames = remainingNames.filter(
        (name) => !namesFoundInThisFile.has(name),
      );
    } else {
      console.log(`  ⚪️ No matches found for remaining names in this file.`);
    }
  }

  // To preserve the original input order in the final Excel file
  allMatches.sort((a, b) => {
    const nameAIndex = baseNames.indexOf(a.name);
    const nameBIndex = baseNames.indexOf(b.name);
    if (nameAIndex !== nameBIndex) {
      return nameAIndex - nameBIndex;
    }
    // If names are the same, sort by their position in the document
    return a.position - b.position;
  });

  if (remainingNames.length > 0) {
    console.log(
      `\n❌ No match found for ${remainingNames.length} name(s) across all files:`,
    );
    remainingNames.forEach((name) => console.log(`  - ${name}`));
  }
}

/**
 * Simulate user feedback to demonstrate adaptive learning
 * In a real application, this would be actual user feedback
 */
async function simulateFeedback(
  matcher: AdaptiveUkrainianNameMatcher,
  match: NameMatch,
) {
  // Simulate feedback logic based on match quality indicators
  let isCorrect = true;

  // If confidence is very low, likely incorrect
  if (match.confidence < 0.8) {
    isCorrect = false;
  }

  // If we found contextual information, more likely correct
  if (match.extractedInfo?.reason || match.extractedInfo?.actionDate) {
    isCorrect = true;
  }

  // If confidence is borderline, simulate mixed feedback
  if (match.confidence > 0.85 && match.confidence < 0.92) {
    isCorrect = Math.random() > 0.3; // 70% correct for borderline cases
  }

  await matcher.addFeedback(match, isCorrect);
}

async function writeResultsToExcel(
  matches: NameMatch[],
  matcher: AdaptiveUkrainianNameMatcher,
  filename: string,
) {
  const outputPath = path.join(runtimePathById.assets, 'nlp-output', filename);

  // Get performance stats for the report
  const stats = matcher.getPerformanceStats();

  const data = [
    [
      'Input Name',
      'Found In Document',
      'Document Date',
      'Found Declension',
      'Section Title',
      'Content',
      'Action Date Content',
      'Reason',
      'Summary',
      'Action Date',
      'Confidence',
      'Learning Status',
    ],
  ];

  for (const match of matches) {
    const learningStatus =
      match.confidence > stats.currentThresholds.twoWordMatch
        ? '✅ Passed Adaptive Threshold'
        : '⚠️ Below Adaptive Threshold';

    const summaryParts: string[] = [];
    if (match.extractedInfo?.sectionTitle) {
      summaryParts.push(match.extractedInfo.sectionTitle);
    }
    if (match.extractedInfo?.content) {
      if (summaryParts.length > 0) {
        summaryParts.push(''); // Add a blank line for separation
      }
      summaryParts.push(match.extractedInfo.content);
    }
    if (match.extractedInfo?.actionDateContent) {
      summaryParts.push(match.extractedInfo.actionDateContent);
    }
    if (match.extractedInfo?.reason) {
      summaryParts.push(match.extractedInfo.reason);
    }
    const summary = summaryParts.join('\n');

    data.push([
      match.name,
      match.documentPath || 'N/A',
      match.extractedInfo?.documentDate || 'N/A',
      match.declension,
      match.extractedInfo?.sectionTitle || 'N/A',
      match.extractedInfo?.content || 'N/A',
      match.extractedInfo?.actionDateContent || 'N/A',
      match.extractedInfo?.reason || 'N/A',
      summary,
      match.extractedInfo?.actionDate || 'N/A',
      (match.confidence * 100).toFixed(2) + '%',
      learningStatus,
    ]);
  }

  // Add summary sheet with learning stats
  data.push([]);
  data.push(['=== ADAPTIVE LEARNING SUMMARY ===']);
  data.push(['Total Feedback Entries:', stats.totalFeedback]);
  data.push(['Recent Accuracy:', `${stats.recentAccuracy.toFixed(1)}%`]);
  data.push([
    'Current 2-Word Threshold:',
    stats.currentThresholds.twoWordMatch.toFixed(3),
  ]);
  data.push([
    'Current 3-Word Threshold:',
    stats.currentThresholds.threeWordMatch.toFixed(3),
  ]);
  data.push([
    'Individual Similarity Threshold:',
    stats.currentThresholds.individualSimilarity.toFixed(3),
  ]);

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  worksheet['!cols'] = [
    { wch: 25 },
    { wch: 50 },
    { wch: 40 },
    { wch: 50 },
    { wch: 50 },
    { wch: 50 },
    { wch: 20 },
    { wch: 50 },
    { wch: 20 },
    { wch: 50 },
    { wch: 15 },
    { wch: 25 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Adaptive Results');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  XLSX.writeFile(workbook, outputPath);

  console.log(`\n✅ Results saved to: ${outputPath}`);
  console.log(
    `📊 Final performance: ${stats.recentAccuracy.toFixed(1)}% accuracy`,
  );
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
          // Recursively process subdirectories
          await processFolder(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(extension)) {
          // Add matching files
          allFiles.push(fullPath);
        }
      }
    } catch (error) {
      console.log(`⚠️ Could not read directory ${folderPath}:`, error);
    }
  }

  // Check if the source path exists first
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

/**
 * Extracts a date from a file path, prioritizing full dates in the filename,
 * then falling back to the year in the path.
 */
function extractDateFromPath(filePath: string): Date | null {
  const basename = path.basename(filePath);

  // Regex to find DD.MM.YYYY format
  const dateMatch = basename.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dateMatch) {
    const [, day, month, year] = dateMatch;
    return new Date(`${year}-${month}-${day}`);
  }

  // Regex to find a 4-digit year in the entire path
  const yearMatch = filePath.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    return new Date(yearMatch[1]);
  }

  return null;
}

export { extractInformation };
