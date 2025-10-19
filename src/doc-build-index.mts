import fs from 'fs/promises';
import path from 'path';
import { UkrainianNameMatcher } from './nlp/name-matcher.mts';
import {
  collectFilePaths,
  getFoldersRecursive,
  runtimePathById,
} from './supplement/index.mts';

/**
 * Recursively collects all .txt files from a directory.
 */
async function collectAllDocumentFiles(docsPath: string): Promise<string[]> {
  const allFiles: string[] = [];
  try {
    await fs.access(docsPath);
  } catch {
    console.warn(`⚠️ Directory ${docsPath} does not exist`);
    return allFiles;
  }

  const rootFiles = (await collectFilePaths(docsPath, ['.txt'])).filter(
    (file) => path.extname(file).toLowerCase() === '.txt'
  );
  allFiles.push(...rootFiles);

  const folders = getFoldersRecursive(docsPath);
  async function processFolder(folderStructure: any[], basePath: string) {
    for (const folder of folderStructure) {
      const folderPath = path.join(basePath, folder.name);
      const files = (await collectFilePaths(folderPath, ['.txt'])).filter(
        (file) => path.extname(file).toLowerCase() === '.txt'
      );
      allFiles.push(...files);
      if (folder.subFolders && folder.subFolders.length > 0) {
        await processFolder(folder.subFolders, folderPath);
      }
    }
  }

  await processFolder(folders, docsPath);
  return [...new Set(allFiles)];
}

/**
 * Main function to build and save the document index.
 */
async function buildIndex() {
  console.log('🚀 Starting index building process...');

  const docsPath = path.join(runtimePathById.root, 'assets/docs-for-nlp');
  const indexPath = path.join(runtimePathById.root, 'assets/nlp-index');

  try {
    // 1. Get all document files
    const documentFiles = await collectAllDocumentFiles(docsPath);
    console.log(`\n📁 Found ${documentFiles.length} document files to index.`);

    if (documentFiles.length === 0) {
      console.log('No documents to index. Exiting.');
      return;
    }

    // 2. Initialize NLP matcher
    const matcher = new UkrainianNameMatcher();
    console.log('🧠 Initializing NLP models...');
    await matcher.initialize();

    // 3. Index each document and save to its own file
    console.log('‍🗂️ Indexing all documents...');
    let indexedCount = 0;
    for (let i = 0; i < documentFiles.length; i++) {
      const docPath = documentFiles[i];
      process.stdout.write(
        `\r   📄 Indexing document ${i + 1}/${
          documentFiles.length
        } (${path.basename(docPath)})`
      );
      try {
        const content = await fs.readFile(docPath, 'utf-8');
        const indexedWords = await matcher.indexDocument(content);

        // Create a parallel path in the index directory
        const relativePath = path.relative(docsPath, docPath);
        const indexDocPath = path.join(indexPath, `${relativePath}.json`);

        // Ensure the directory exists and save the file
        await fs.mkdir(path.dirname(indexDocPath), { recursive: true });
        await fs.writeFile(indexDocPath, JSON.stringify(indexedWords, null, 2));
        indexedCount++;
      } catch (error: any) {
        console.warn(`\n   ⚠️ Failed to index ${docPath}:`, error.message);
      }
    }

    console.log(`\n\n✅ Indexing complete!`);
    console.log(
      `   Index for ${indexedCount} documents saved to: ${indexPath}`
    );
  } catch (error: any) {
    console.error('\n❌ Error building index:', error);
    throw error;
  }
}

// Run the indexing process
buildIndex().catch(console.error);
