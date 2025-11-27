import * as fs from 'fs/promises';
import * as path from 'path';

interface FileInfo {
  filePath: string;
  fileName: string;
  lastModified: number;
  size: number;
  extension: string;
}

/**
 * Recursively scan directory for files with specific extensions
 */
async function scanDirectory(
  directory: string,
  extensions: string[],
  options: {
    maxFileSize?: number;
    excludeDirs?: string[];
  } = {},
): Promise<FileInfo[]> {
  const { maxFileSize = Infinity, excludeDirs = ['.cache', 'node_modules'] } =
    options;
  const files: FileInfo[] = [];

  async function scan(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            await scan(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();

          if (extensions.includes(ext)) {
            try {
              const stats = await fs.stat(fullPath);

              if (stats.size <= maxFileSize) {
                files.push({
                  filePath: fullPath,
                  fileName: entry.name,
                  lastModified: stats.mtimeMs,
                  size: stats.size,
                  extension: ext,
                });
              }
            } catch (error) {
              console.warn(`Cannot stat file ${entry.name}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Cannot read directory ${dir}:`, error);
    }
  }

  await scan(directory);
  return files;
}

/**
 * Extract date from file path with multiple strategies
 */
function extractDateFromPath(filePath: string): Date | null {
  const basename = path.basename(filePath);

  // Strategy 1: DD.MM.YYYY format
  const dateMatch = basename.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dateMatch) {
    const [, day, month, year] = dateMatch;
    return new Date(`${year}-${month}-${day}`);
  }

  // Strategy 2: YYYY-MM-DD format
  const isoMatch = basename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(isoMatch[0]);
  }

  // Strategy 3: 4-digit year in path
  const yearMatch = filePath.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    return new Date(yearMatch[1]);
  }

  return null;
}

/**
 * Safe file operations with proper error handling
 */
async function safeReadFile(
  filePath: string,
  encoding: BufferEncoding = 'utf8',
): Promise<string> {
  try {
    await fs.access(filePath, fs.constants.R_OK);
    return await fs.readFile(filePath, encoding);
  } catch (error) {
    throw new Error(
      `Cannot read file ${path.basename(filePath)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

async function safeWriteFile(filePath: string, content: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot write file ${path.basename(filePath)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

export { extractDateFromPath, safeReadFile, safeWriteFile, scanDirectory };

export type { FileInfo };
