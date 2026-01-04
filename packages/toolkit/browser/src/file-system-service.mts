interface FileProcessedShape {
  name: string;
  path: string;
  size?: number;
  extension?: string;
  modifiedAt?: string | Date;
}

// Unified file system structure types
interface FileSystemItem extends FileProcessedShape {
  fsItemType: 'file' | 'directory';
  fsNestedItems?: FileSystemItem[]; // Only for directories
  fsFileCount?: number; // Only for directories
}

interface FileSystemProcessedResult {
  structure: FileSystemItem;
  files: FileSystemItem[];
}

interface ProcessSingleFileParams extends FileProcessedShape {
  getFileContent?: () => Promise<Buffer>;
}

class FileSystemService {
  /**
   * Helper: Extract file extension (make public so it can be accessed by other methods)
   */
  static getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    return lastDot > 0 ? fileName.substring(lastDot + 1) : '';
  }

  /**
   * Check if file should be skipped (temp files, system files, etc.)
   */
  static shouldSkipFile(
    fileName: string,
    fileSize?: number,
    maxFileSize: number = 50 * 1024 * 1024,
  ): boolean {
    // Skip Microsoft Office temp files
    if (fileName.startsWith('~$')) return true;

    // Skip system files
    if (fileName.startsWith('.') || fileName.startsWith('~')) return true;

    if (fileSize !== undefined) {
      if (fileSize > maxFileSize) return true;
      if (fileSize === 0) return true;
    }

    return false;
  }

  /**
   * Process a single file and return unified structure
   */
  static processSingleFile(fileParams: ProcessSingleFileParams) {
    const fileItem: FileSystemItem = {
      ...fileParams,
      extension: this.getFileExtension(fileParams.name),
      fsItemType: 'file',
    };

    return {
      structure: fileItem,
      files: [fileItem],
    };
  }

  /**
   * Process an entire directory and return unified structure
   */
  static async processDirectory(
    scannedFiles: FileSystemItem[],
    {
      rootDirectoryName,
      rootPath,
      includeFiles = true,
    }: {
      rootDirectoryName: string;
      rootPath?: string;
      includeFiles?: boolean;
    },
  ): Promise<FileSystemProcessedResult> {
    // 1. Initialize root structure
    const rootStructure: FileSystemItem = {
      name: rootDirectoryName,
      path: rootPath || `./${rootDirectoryName}`,
      fsItemType: 'directory',
      fsNestedItems: [],
      fsFileCount: 0,
    };

    // 2. Build tree structure synchronously from already processed results
    for (const file of scannedFiles) {
      const item = file;
      // The path in the item is currently the relative path (e.g. "sub/file.txt")
      const relativePath = item.path;

      this.addItemToTree(rootStructure, item, relativePath, includeFiles);

      // Update path to be absolute relative to root (e.g. "/sub/file.txt")
      item.path = `/${relativePath}`;
    }

    // 3. Sort the tree
    this.sortFileSystemItem(rootStructure);

    return {
      structure: rootStructure,
      files: scannedFiles,
    };
  }

  /**
   * Helper to add a file item to the directory tree based on its relative path
   */
  private static addItemToTree(
    root: FileSystemItem,
    item: FileSystemItem,
    relativePath: string,
    includeFiles: boolean,
  ) {
    const parts = relativePath.split('/');
    parts.pop(); // Remove filename

    let current = root;

    // Increment count for root
    if (current.fsFileCount === undefined) current.fsFileCount = 0;
    current.fsFileCount++;

    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!current.fsNestedItems) current.fsNestedItems = [];

      let child = current.fsNestedItems.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: `/${currentPath}`,
          fsItemType: 'directory',
          fsNestedItems: [],
          fsFileCount: 0,
        };
        current.fsNestedItems.push(child);
      }
      current = child;

      // Increment count for current directory
      if (current.fsFileCount === undefined) current.fsFileCount = 0;
      current.fsFileCount++;
    }

    if (includeFiles) {
      if (!current.fsNestedItems) current.fsNestedItems = [];
      current.fsNestedItems.push(item);
    }
  }

  /**
   * Helper to sort the file system tree (directories first, then files)
   */
  private static sortFileSystemItem(item: FileSystemItem) {
    if (item.fsNestedItems) {
      item.fsNestedItems.sort((a, b) => {
        if (a.fsItemType !== b.fsItemType)
          return a.fsItemType === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      item.fsNestedItems.forEach((c) => this.sortFileSystemItem(c));
    }
  }
}

export { FileSystemService };
export type { FileProcessedShape, FileSystemItem, FileSystemProcessedResult };
