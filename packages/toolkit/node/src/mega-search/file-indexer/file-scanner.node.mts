import * as fs from 'fs/promises';
import * as path from 'path';
import type { FileSystemItem } from 'toolkit--local/browser';
import { FileSystemService } from 'toolkit--local/browser';

interface ScanOptions {
  extensions?: string[];
  maxFileSize?: number;
  excludeDirs?: string[];
}

class FileScannerNode {
  /**
   * Recursively scan directory and return unified FileSystemItems.
   * Used by both Electron Dialog and Search Indexer.
   *
   * @param directoryPath Absolute path to the directory to scan
   * @param options Filtering options
   */
  static async scanDirectory(
    directoryPath: string,
    options: ScanOptions = {},
  ): Promise<FileSystemItem[]> {
    const {
      extensions,
      maxFileSize = Infinity,
      excludeDirs = ['.cache'],
    } = options;

    const files: FileSystemItem[] = [];

    const traverse = async (currentPath: string) => {
      try {
        const entries = await fs.readdir(currentPath, {
          withFileTypes: true,
        });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);

          // Skip hidden files/directories by default
          if (entry.name.startsWith('.')) continue;

          if (entry.isDirectory()) {
            if (excludeDirs.includes(entry.name)) continue;
            await traverse(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (extensions && !extensions.includes(ext)) continue;

            try {
              const stats = await fs.stat(fullPath);

              if (
                FileSystemService.shouldSkipFile(
                  entry.name,
                  stats.size,
                  maxFileSize,
                )
              ) {
                continue;
              }

              // Calculate relative path from root directoryPath for FileSystemService
              // e.g. if directoryPath is /a/b and file is /a/b/c/d.txt, relative is c/d.txt
              const relativePath = path.relative(directoryPath, fullPath);
              const normalizedPath = relativePath.split(path.sep).join('/');

              const { structure } = FileSystemService.processSingleFile({
                name: entry.name,
                path: normalizedPath,
                size: stats.size,
                modifiedAt: stats.mtime,
              });

              files.push(structure);
            } catch (e) {
              // Ignore access errors
            }
          }
        }
      } catch (e) {
        // Ignore directory access errors
      }
    };

    await traverse(directoryPath);
    return files;
  }

  /**
   * Safe file operations with proper error handling.
   * Returns a Buffer (Uint8Array) which is efficient for IPC transport.
   */
  static async safeReadFile(filePath: string): Promise<Buffer> {
    try {
      await fs.access(filePath, fs.constants.R_OK);
      return await fs.readFile(filePath);
    } catch (error) {
      throw new Error(
        `Cannot read file ${path.basename(filePath)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

export { FileScannerNode };
export type { ScanOptions };
