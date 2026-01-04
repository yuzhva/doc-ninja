import type { FileSystemItem } from '../file-system-service.mjs';
import { FileSystemService } from '../file-system-service.mjs';
import {
  addScannedDirectoryPathToTree,
  sortDirectoryTree,
} from './file-scanner-browser.utils.mjs';

// Helper interface to fix missing values() in some TypeScript definitions
interface FileSystemDirectoryHandleWithIterator extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

class FileScannerBrowser {
  /**
   * Helper to read a File object as Base64
   */
  public static async readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:application/pdf;base64,") to get raw base64
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  }

  /**
   * Helper to create a unified object
   */
  private static createFileUnifiedFormat(file: File, path: string) {
    const { files: processedFiles } = FileSystemService.processSingleFile({
      name: file.name,
      path,
      size: file.size,
      modifiedAt: new Date(file.lastModified),
    });

    return processedFiles[0];
  }

  /**
   * Main entry point to scan a directory from FileSystemDirectoryHandle.
   */
  static async scan(
    dirHandle: FileSystemDirectoryHandle,
  ): Promise<FileSystemItem> {
    return this.scanFileSystemHandle(dirHandle);
  }

  /**
   * Scans a directory and returns a flat list of files with their relative paths.
   */
  static async scanFiles(
    dirHandle: FileSystemDirectoryHandle,
  ): Promise<FileSystemItem[]> {
    const files: FileSystemItem[] = [];
    await this.scanFileSystemHandleForFiles(dirHandle, '', files);
    return files;
  }

  private static async scanFileSystemHandleForFiles(
    handle: FileSystemDirectoryHandle,
    currentPath: string,
    files: FileSystemItem[],
  ) {
    // Skip hidden directories
    if (handle.name.startsWith('.')) return;

    for await (const entry of (
      handle as FileSystemDirectoryHandleWithIterator
    ).values()) {
      const entryPath = currentPath
        ? `${currentPath}/${entry.name}`
        : entry.name;

      if (entry.kind === 'file') {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();

        if (FileSystemService.shouldSkipFile(file.name, file.size)) continue;

        files.push(this.createFileUnifiedFormat(file, entryPath));
      } else if (entry.kind === 'directory') {
        const dirHandle = entry as FileSystemDirectoryHandle;
        await this.scanFileSystemHandleForFiles(dirHandle, entryPath, files);
      }
    }
  }

  private static async scanFileSystemHandle(
    handle: FileSystemDirectoryHandle,
  ): Promise<FileSystemItem> {
    const rootName = handle.name;
    const rootNode: FileSystemItem = {
      name: rootName,
      path: rootName,
      fsItemType: 'directory',
      fsNestedItems: [],
      fsFileCount: 0,
    };

    const processHandle = async (
      dirHandle: FileSystemDirectoryHandle,
      currentPath: string,
    ) => {
      // Skip hidden directories at the source level if possible
      if (dirHandle.name.startsWith('.')) return;

      for await (const entry of (
        dirHandle as FileSystemDirectoryHandleWithIterator
      ).values()) {
        const entryPath = `${currentPath}/${entry.name}`;

        if (entry.kind === 'file') {
          addScannedDirectoryPathToTree(rootNode, entryPath, rootName);
        } else if (entry.kind === 'directory') {
          const subDirHandle = entry as FileSystemDirectoryHandle;
          await processHandle(subDirHandle, entryPath);
        }
      }
    };

    await processHandle(handle, rootName);
    sortDirectoryTree(rootNode);
    return rootNode;
  }
}

export { FileScannerBrowser };
