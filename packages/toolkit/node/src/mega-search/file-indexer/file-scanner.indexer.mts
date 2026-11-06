import * as fs from 'fs';
import * as path from 'path';
import { FileSystemService } from 'toolkit--local/browser';

import { resolveCachePaths } from '../cache-paths.mjs';
import type { ResolvedCachePaths } from '../cache-paths.mjs';
import { Logger } from '../shared/logger.mjs';
import { DocumentMetadata, SearchConfig } from '../types.mjs';
import { FileScannerNode } from './file-scanner.node.mjs';

class FileScannerIndexer {
  private cachePaths: ResolvedCachePaths;

  constructor(
    private config: SearchConfig,
    private logger: Logger,
  ) {
    this.cachePaths = resolveCachePaths(this.config);
  }

  private getTextCachePath(filePath: string): string {
    const rel = path.relative(this.config.rootDirectory, filePath);
    return path.join(this.cachePaths.txtCacheRoot, `${rel}.txt`);
  }

  async discoverFiles(): Promise<DocumentMetadata[]> {
    try {
      this.logger.debug(`Starting file discovery ${this.config.rootDirectory}`);

      const items = await FileScannerNode.scanDirectory(
        this.config.rootDirectory,
        {
          extensions: this.config.extensions,
          maxFileSize: this.config.maxFileSize,
          excludeAbsoluteDirs: this.cachePaths.excludeAbsoluteDirs,
        },
      );

      // Map FileSystemItem to the internal format expected by processFileInfos
      const fileInfos = items.map((item) => ({
        // Reconstruct absolute path from relative path returned by FileScannerNode
        filePath: path.resolve(this.config.rootDirectory, item.path),
        fileName: item.name,
        size: item.size,
        // Ensure timestamp format
        lastModified:
          item.modifiedAt instanceof Date
            ? item.modifiedAt.getTime()
            : new Date(item.modifiedAt || 0).getTime(),
      }));

      return this.processFileInfos(fileInfos);
    } catch (error) {
      this.logger.error('File discovery failed', error);
      throw new Error(
        `Failed to discover files: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Discovers files from a specific list of paths (files or directories).
   * Used for Scoped Indexing.
   */
  async discoverSpecificPaths(paths: string[]): Promise<DocumentMetadata[]> {
    const allFileInfos: any[] = [];

    for (const p of paths) {
      // Ensure path is absolute
      const fullPath = path.resolve(p);

      try {
        const stats = await fs.promises.stat(fullPath);
        if (stats.isDirectory()) {
          const items = await FileScannerNode.scanDirectory(fullPath, {
            extensions: this.config.extensions,
            maxFileSize: this.config.maxFileSize,
            excludeAbsoluteDirs: this.cachePaths.excludeAbsoluteDirs,
          });

          const infos = items.map((item) => ({
            filePath: path.resolve(fullPath, item.path),
            fileName: item.name,
            size: item.size,
            lastModified:
              item.modifiedAt instanceof Date
                ? item.modifiedAt.getTime()
                : new Date(item.modifiedAt || 0).getTime(),
          }));

          allFileInfos.push(...infos);
        } else if (stats.isFile()) {
          const ext = path.extname(fullPath).toLowerCase();
          if (this.config.extensions.includes(ext)) {
            allFileInfos.push({
              filePath: fullPath,
              fileName: path.basename(fullPath),
              size: stats.size,
              lastModified: stats.mtimeMs,
              isDirectory: false,
            });
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to access path: ${fullPath}`, error);
      }
    }

    return this.processFileInfos(allFileInfos);
  }

  private processFileInfos(fileInfos: any[]): DocumentMetadata[] {
    // Filter out temp and system files using the shared service
    const filteredFileInfos = fileInfos.filter(
      (file) =>
        !FileSystemService.shouldSkipFile(
          file.fileName,
          file.size,
          this.config.maxFileSize,
        ),
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
  }
}

export { FileScannerIndexer };
