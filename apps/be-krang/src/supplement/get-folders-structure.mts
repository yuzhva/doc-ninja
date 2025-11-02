import fs from 'fs';
import path from 'path';

type FoldersStructure = Array<{ name: string; subFolders?: any[] }>;

/**
 * Recursively builds a folder tree.
 * @param {string} dirPath - Path to the directory to scan
 * @returns {Array<{ name: string, subFolders?: any[] }>}
 */
function getFoldersRecursive(dirPath: string): FoldersStructure {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      const subFolders = getFoldersRecursive(fullPath);

      return subFolders.length
        ? { name: entry.name, subFolders }
        : { name: entry.name };
    });
}

export { getFoldersRecursive };

export type { FoldersStructure };
