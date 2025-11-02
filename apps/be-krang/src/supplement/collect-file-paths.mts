import fs from 'fs/promises';
import path from 'path';

/**
 * Recursively collects .doc / .docx files with full paths
 */
async function collectFilePaths(
  folder: string,
  targetExts = ['.doc', '.docx'],
) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFilePaths(fullPath, targetExts)));
    } else if (targetExts.includes(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

export { collectFilePaths };
