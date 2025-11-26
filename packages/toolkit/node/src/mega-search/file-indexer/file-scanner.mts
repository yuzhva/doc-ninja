import * as fs from 'fs';
import * as path from 'path';

import { scanDirectory } from '../shared/file-utils.mjs';
import { Logger } from '../shared/logger.mjs';
import { DocumentMetadata, SearchConfig } from '../types.mjs';

class FileScanner {
  private absoluteTxtCacheRoot: string;

  constructor(
    private config: SearchConfig,
    private logger: Logger,
  ) {
    const txtCacheRoot = this.config.txtCacheSubdir || '.cache/txt';
    this.absoluteTxtCacheRoot = path.resolve(
      this.config.rootDirectory,
      txtCacheRoot,
    );
  }

  private getTextCachePath(filePath: string): string {
    // Optimization: Use pre-calculated absolute cache root
    const rel = path.relative(this.config.rootDirectory, filePath);
    return path.join(this.absoluteTxtCacheRoot, `${rel}.txt`);
  }

  /**
   * Check if file should be skipped (temp files, system files, etc.)
   */
  private shouldSkipFile(
    fileName: string,
    filePath: string,
    fileSize?: number,
  ): boolean {
    // Skip Microsoft Office temp files
    if (fileName.startsWith('~$')) return true;

    // Skip system files
    if (fileName.startsWith('.') || fileName.startsWith('~')) return true;

    // Skip very large files that might cause memory issues
    try {
      const size =
        fileSize !== undefined ? fileSize : fs.statSync(filePath).size;

      if (size > (this.config.maxFileSize || 50 * 1024 * 1024)) return true;
      if (size === 0) return true;
    } catch (error) {
      return true;
    }

    return false;
  }

  async discoverFiles(): Promise<DocumentMetadata[]> {
    try {
      this.logger.info(`Starting file discovery ${this.config.rootDirectory}`);

      const fileInfos = await scanDirectory(
        this.config.rootDirectory,
        this.config.extensions,
        {
          maxFileSize: this.config.maxFileSize,
          excludeDirs: [this.config.cacheRoot || '.cache'],
        },
      );

      // Filter out temp and system files
      const filteredFileInfos = fileInfos.filter(
        (file) => !this.shouldSkipFile(file.fileName, file.filePath, file.size),
      );

      const documentMetadata: DocumentMetadata[] = filteredFileInfos.map(
        (file) => ({
          originalFilePath: file.filePath,
          fileName: file.fileName,
          lastModified: file.lastModified,
          size: file.size,
          indexed: false,
          language: 'mixed' as const,
          textFilePath: this.getTextCachePath(file.filePath),
        }),
      );

      this.logger.info('File discovery completed', {
        filesFound: documentMetadata.length,
        totalSize: documentMetadata.reduce((sum, f) => sum + f.size, 0),
        filteredOut: fileInfos.length - filteredFileInfos.length,
      });

      return documentMetadata;
    } catch (error) {
      this.logger.error('File discovery failed', error);
      throw new Error(
        `Failed to discover files: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

export { FileScanner };
