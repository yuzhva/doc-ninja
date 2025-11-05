// Unified file system structure types
export interface FileSystemItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number; // Only for files
  extension?: string; // Only for files
  modifiedAt?: string; // ISO string
  children?: FileSystemItem[]; // Only for directories
}

export interface FileContent {
  item: FileSystemItem;
  content: string; // File content for processing
}

export interface ProcessingResult {
  structure: FileSystemItem;
  files: FileContent[]; // Flat list of all files with content
}

// Types for processed files (for API responses)
export interface ProcessedFileData {
  name: string;
  content: string;
  relativePath: string;
  originalPath?: string;
}

export class FileSystemAPIProcessor {
  /**
   * Process a single file and return unified structure
   */
  static async processSingleFile(
    fileHandle: FileSystemFileHandle,
  ): Promise<ProcessingResult> {
    const file = await fileHandle.getFile();
    const content = await file.text();

    const fileItem: FileSystemItem = {
      name: file.name,
      path: `/${file.name}`,
      type: 'file',
      size: file.size,
      extension: FileSystemAPIProcessor.getFileExtension(file.name),
      modifiedAt: new Date(file.lastModified).toISOString(),
    };

    return {
      structure: fileItem,
      files: [
        {
          item: fileItem,
          content,
        },
      ],
    };
  }

  /**
   * Process an entire directory and return unified structure
   */
  static async processDirectory(
    directoryHandle: FileSystemDirectoryHandle,
    basePath = '',
  ): Promise<ProcessingResult> {
    const allFiles: FileContent[] = [];

    const processDirectoryRecursive = async (
      handle: FileSystemDirectoryHandle,
      currentPath: string,
      isRoot: boolean = false,
    ): Promise<FileSystemItem> => {
      const children: FileSystemItem[] = [];

      for await (const [name, entry] of handle.entries()) {
        // For root level, don't include the directory name in the path
        const itemPath = isRoot ? `/${name}` : `${currentPath}/${name}`;

        if (entry.kind === 'directory') {
          // Recursively process subdirectory
          const subdirItem = await processDirectoryRecursive(
            entry,
            itemPath,
            false,
          );
          children.push(subdirItem);
        } else if (entry.kind === 'file') {
          // Process file
          const file = await entry.getFile();
          // Read as ArrayBuffer for safe handling of all file types
          const arrayBuffer = await file.arrayBuffer();
          // Convert to base64 to send in JSON
          const content = btoa(
            new Uint8Array(arrayBuffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              '',
            ),
          );

          const fileItem: FileSystemItem = {
            name: file.name,
            path: itemPath,
            type: 'file',
            size: file.size,
            extension: FileSystemAPIProcessor.getFileExtension(file.name),
            modifiedAt: new Date(file.lastModified).toISOString(),
          };

          children.push(fileItem);
          allFiles.push({
            item: fileItem,
            content,
          });
        }
      }

      return {
        name: handle.name,
        path: isRoot ? '/' : currentPath,
        type: 'directory',
        children: children.sort((a, b) => {
          // Sort directories first, then files
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        }),
      };
    };

    // Start processing from root with isRoot=true to exclude root directory name from paths
    const structure = await processDirectoryRecursive(
      directoryHandle,
      '',
      true,
    );

    return {
      structure,
      files: allFiles,
    };
  }

  /**
   * Write processed files back to file system maintaining structure
   */
  static async writeProcessedFiles(
    processedFiles: ProcessedFileData[],
    destinationHandle: FileSystemDirectoryHandle,
    subfolderPath?: string,
  ): Promise<void> {
    for (const file of processedFiles) {
      await this.writeFileToPath(file, destinationHandle, subfolderPath);
    }
  }

  /**
   * Helper: Write a single file to the correct path in destination
   */
  private static async writeFileToPath(
    file: ProcessedFileData,
    destinationHandle: FileSystemDirectoryHandle,
    subfolderPath?: string,
  ): Promise<void> {
    // Start with the destination handle
    let currentDir = destinationHandle;

    // Create subfolder structure if specified (handle nested paths)
    if (subfolderPath) {
      const subfolderParts = subfolderPath
        .split('/')
        .filter((part) => part !== '');

      for (const folderName of subfolderParts) {
        try {
          currentDir = await currentDir.getDirectoryHandle(folderName, {
            create: true,
          });
          console.log(`📁 Created/using subfolder: ${folderName}`);
        } catch (error) {
          console.warn(`Could not create subfolder '${folderName}':`, error);
          break; // Stop creating nested folders if one fails
        }
      }
    }

    // Parse the file's relative path to navigate/create directory structure
    const pathParts = file.relativePath
      .split('/')
      .filter((part) => part !== '');
    const fileName = pathParts.pop()!;

    // Navigate/create nested directories from the file's original structure
    for (const dirName of pathParts) {
      try {
        currentDir = await currentDir.getDirectoryHandle(dirName, {
          create: true,
        });
      } catch (error) {
        console.warn(`Could not create directory ${dirName}:`, error);
      }
    }

    // Write the file
    const fileHandle = await currentDir.getFileHandle(fileName, {
      create: true,
    });
    const writable = await fileHandle.createWritable();

    // Check if content is base64 (for binary files like Excel)
    const fileExtension =
      FileSystemAPIProcessor.getFileExtension(fileName).toLowerCase(); // Use public method
    const isBinaryFile = [
      'xlsx',
      'xlsm',
      'xls',
      'docx',
      'pdf',
      'png',
      'jpg',
      'jpeg',
    ].includes(fileExtension);

    if (isBinaryFile && this.isBase64String(file.content)) {
      // Convert base64 to binary data for Excel/binary files
      try {
        const binaryString = atob(file.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Create blob with appropriate MIME type
        const mimeType = this.getMimeType(fileExtension);
        const blob = new Blob([bytes], { type: mimeType });

        await writable.write(blob);
        console.log(
          `✅ Binary file written: ${fileName} (${bytes.length} bytes)`,
        );
      } catch (error) {
        console.error(`❌ Failed to decode base64 for ${fileName}:`, error);
        // Fallback to text writing
        await writable.write(file.content);
      }
    } else {
      // Write as text for non-binary files
      await writable.write(file.content);
    }

    await writable.close();
  }

  /**
   * Helper: Check if string is base64 encoded
   */
  private static isBase64String(str: string): boolean {
    try {
      // Basic check: base64 strings are typically long and contain only valid base64 characters
      return (
        str.length > 100 &&
        /^[A-Za-z0-9+/=]+$/.test(str) &&
        str.length % 4 === 0
      );
    } catch {
      return false;
    }
  }

  /**
   * Helper: Get MIME type for file extension
   */
  private static getMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      xls: 'application/vnd.ms-excel',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      txt: 'text/plain',
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }

  /**
   * Helper: Extract file extension (make public so it can be accessed by other methods)
   */
  static getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    return lastDot > 0 ? fileName.substring(lastDot + 1) : '';
  }

  /**
   * Helper: Get total file count from structure
   */
  static getFileCount(structure: FileSystemItem): number {
    if (structure.type === 'file') {
      return 1;
    }

    if (structure.type === 'directory' && structure.children) {
      return structure.children.reduce((count, child) => {
        return count + this.getFileCount(child);
      }, 0);
    }

    return 0;
  }

  /**
   * Helper: Get all file paths from structure (for progress tracking)
   */
  static getAllFilePaths(structure: FileSystemItem): string[] {
    if (structure.type === 'file') {
      return [structure.path];
    }

    if (structure.type === 'directory' && structure.children) {
      return structure.children.flatMap((child) => this.getAllFilePaths(child));
    }

    return [];
  }
}
