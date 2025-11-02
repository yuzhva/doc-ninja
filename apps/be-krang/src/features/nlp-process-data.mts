import fs from 'fs/promises';
import path from 'path';
import type { NameMatch } from '../nlp/index.mts';
import { UkrainianNameMatcher, readExcelData, writeExcelResults } from '../nlp/index.mts';
import {
  collectFilePaths,
  getFoldersRecursive,
  runtimePathById,
} from '../supplement/index.mts';

interface ProcessingResult {
  inputName: string;
  matches: NameMatch[];
  documentsSearched: number;
  totalMatches: number;
}

interface SearchConfig {
  stopAtFirstMatch: boolean;
  maxDocumentsPerName?: number;
  maxMatchesPerName?: number;
}

const searchConfig: SearchConfig = {
  stopAtFirstMatch: true, // Set to false to search all documents
  maxDocumentsPerName: 1000, // Optional: limit search scope
  maxMatchesPerName: 5, // Optional: stop after N matches
};

async function processNLPData() {
  console.log('🚀 Starting NLP data processing...');

  try {
    // 1. Read input names from Excel
    const inputPath = path.join(
      runtimePathById.assets,
      'nlp-input/data.xlsx'
    );
    const baseNames = await readExcelData(inputPath);
    console.log(`📊 Loaded ${baseNames.length} names from input file`);

    // 2. Get all individual index files
    const indexPath = path.join(runtimePathById.assets, 'nlp-index');
    const indexFiles = await collectAllDocumentFiles(indexPath, '.json');
    console.log(`‍🗂️ Found ${indexFiles.length} index files to process.`);

    // 3. Initialize NLP matcher
    const matcher = new UkrainianNameMatcher();
    console.log('🧠 Initializing NLP models...');
    await matcher.initialize();

    // 4. Process each name against the document index
    const results: ProcessingResult[] = [];

    for (let i = 0; i < baseNames.length; i++) {
      const baseName = baseNames[i];
      console.log(
        `\n🔍 Processing "${baseName}" (${i + 1}/${baseNames.length})`
      );

      const nameMatches: NameMatch[] = [];
      let documentsSearched = 0;
      let matchFound = false;

      // Search through the indexed documents
      for (const indexDocPath of indexFiles) {
        try {
          documentsSearched++;
          const indexedWords = JSON.parse(
            await fs.readFile(indexDocPath, 'utf-8')
          );
          const matches = await matcher.findNamesInIndexedDocument(
            indexedWords,
            [baseName]
          );

          if (matches.length > 0) {
            // Add document context to matches
            const relativePath = path
              .relative(indexPath, indexDocPath)
              .replace('.json', '');
            matches.forEach((match) => {
              match.documentPath = relativePath;
            });

            nameMatches.push(...matches);
            matchFound = true;
            console.log(
              `   🎯 Found ${matches.length} matches in "${path.basename(
                relativePath
              )}" - stopping search for this name`
            );
            if (searchConfig.stopAtFirstMatch) {
              break; // Exit the document loop for this name
            }
          }
        } catch (error) {
          console.warn(
            `   ⚠️ Failed to process index file ${path.basename(
              indexDocPath
            )}:`,
            error.message
          );
        }
      }

      results.push({
        inputName: baseName,
        matches: nameMatches,
        documentsSearched,
        totalMatches: nameMatches.length,
      });

      if (matchFound) {
        console.log(
          `   ✅ Found ${nameMatches.length} matches after searching ${documentsSearched} documents`
        );
      } else {
        console.log(
          `   ❌ No matches found after searching all ${documentsSearched} documents`
        );
      }
    }

    // 5. Write results to Excel
    const outputPath = path.join(runtimePathById.assets, 'nlp-output');
    await fs.mkdir(outputPath, { recursive: true });

    const resultPath = path.join(outputPath, 'result.xlsx');
    await writeExcelResults(results, resultPath);

    // 6. Print summary
    console.log('\n📋 Processing Summary:');
    console.log(`   Names processed: ${results.length}`);
    console.log(`   Documents searched: ${indexFiles.length}`);
    console.log(
      `   Total matches found: ${results.reduce(
        (sum, r) => sum + r.totalMatches,
        0
      )}`
    );
    console.log(`   Results saved to: ${resultPath}`);
  } catch (error) {
    console.error('❌ Error processing NLP data:', error);
    throw error;
  }
}

/**
 * Collect all .txt files from docs-for-nlp folder and subfolders using existing utilities
 */
async function collectAllDocumentFiles(
  docsPath: string,
  extension = '.txt'
): Promise<string[]> {
  const allFiles: string[] = [];

  try {
    await fs.access(docsPath);
  } catch {
    console.warn(`⚠️ Directory ${docsPath} does not exist`);
    return allFiles;
  }

  // Use existing utility to collect files from root folder
  const rootFiles = await collectFilePaths(docsPath, [extension]);
  const rootTxtFiles = rootFiles.filter(
    (file) => path.extname(file).toLowerCase() === extension
  );
  allFiles.push(...rootTxtFiles);

  // Use existing utility to get all subfolders recursively
  const folders = getFoldersRecursive(docsPath);

  // Process each folder recursively
  async function processFolder(folderStructure: any[], basePath: string) {
    for (const folder of folderStructure) {
      const folderPath = path.join(basePath, folder.name);

      // Collect files from this folder
      const files = await collectFilePaths(folderPath, [extension]);
      const txtFiles = files.filter(
        (file) => path.extname(file).toLowerCase() === extension
      );
      allFiles.push(...txtFiles);

      // Process subfolders if they exist
      if (folder.subFolders && folder.subFolders.length > 0) {
        await processFolder(folder.subFolders, folderPath);
      }
    }
  }

  await processFolder(folders, docsPath);
  return [...new Set(allFiles)];
}

// Add document path to NameMatch type extension
declare module './nlp/name-matcher.mts' {
  interface NameMatch {
    documentPath?: string;
  }
}

// Run the processing
if (import.meta.url === `file://${process.argv[1]}`) {
  processNLPData().catch(console.error);
}
