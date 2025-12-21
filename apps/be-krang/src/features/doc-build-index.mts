import fs from 'fs/promises';
import path from 'path';

import { UkrainianNameMatcher } from '../nlp/name-matcher.mjs';
import { runtimePathById } from '../supplement/index.mjs';

/**
 * Recursively collects all .txt files from a directory.
 */
async function collectAllDocumentFiles(docsPath: string): Promise<string[]> {
  const allFiles: string[] = [];
  try {
    const entries = await fs.readdir(docsPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(docsPath, entry.name);
      if (entry.isDirectory()) {
        allFiles.push(...(await collectAllDocumentFiles(fullPath)));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) {
        allFiles.push(fullPath);
      }
    }
  } catch (error) {
    console.warn(`⚠️ Could not read directory ${docsPath}:`, error);
  }
  return [...new Set(allFiles)];
}

/**
 * Main function to build and save the document index.
 */
async function buildIndex(
  docsPath = path.join(runtimePathById.assets, 'docs-for-nlp'),
  indexPath = path.join(runtimePathById.assets, 'nlp-index'),
) {
  console.log('🚀 Starting index building process...');

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
        } (${path.basename(docPath)})`,
      );
      try {
        const content = await fs.readFile(docPath, 'utf-8');
        const indexedWords = await matcher.indexDocument(content);

        // Get file stats for last modified time
        const stats = await fs.stat(docPath);
        const lastModified = stats.mtime.getTime();

        // Use timestamp and a sanitized relative path for a unique, readable filename
        const relativeDocPath = path.relative(docsPath, docPath);
        const sanitizedRelativePath = relativeDocPath
          .replace(/[\/\\]/g, '_')
          .replace(/\.txt$/i, '');
        const indexDocPath = path.join(
          indexPath,
          `${lastModified}-${sanitizedRelativePath}.json`,
        );

        const indexData = {
          originalPath: relativeDocPath,
          indexedWords: indexedWords,
        };

        // Ensure the root index directory exists and save the file
        await fs.mkdir(indexPath, { recursive: true });
        await fs.writeFile(indexDocPath, JSON.stringify(indexData, null, 2));
        indexedCount++;
      } catch (error: any) {
        console.warn(`\n   ⚠️ Failed to index ${docPath}:`, error.message);
      }
    }

    console.log(`\n\n✅ Indexing complete!`);
    console.log(
      `   Index for ${indexedCount} documents saved to: ${indexPath}`,
    );
  } catch (error: any) {
    console.error('\n❌ Error building index:', error);
    throw error;
  }
}

export { buildIndex };
