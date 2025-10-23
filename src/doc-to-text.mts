import path from 'path';

import {
  getFoldersRecursive,
  processFolderAllDocs,
  runtimePathById,
} from './supplement/index.mts';

async function processFoldersTree(srcRoot: string, destRoot: string) {
  const folders = getFoldersRecursive(srcRoot);

  if (folders.length > 0) {
    for (const folder of folders) {
      const folderPath = path.join(srcRoot, folder.name);
      const processedFolderPath = path.join(destRoot, folder.name);

      // 1️⃣ Process all docs in this folder
      await processFolderAllDocs(folderPath, processedFolderPath);

      // 2️⃣ Recurse into subfolders
      if (folder.subFolders) {
        await processFoldersTree(folderPath, processedFolderPath);
      }
    }
  } else {
    // 1️⃣ Process all docs in this folder
    await processFolderAllDocs(srcRoot, destRoot);
  }
}

// Example usage:

processFoldersTree(
  path.join(runtimePathById.assets, 'docs-to-convert'),
  path.join(runtimePathById.assets, 'docs-for-nlp')
);
