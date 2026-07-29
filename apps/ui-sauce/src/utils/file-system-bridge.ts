import type {
  FileSystemItem,
  FileSystemProcessedResult,
} from 'toolkit--local/browser';
import { FileScannerBrowser, FileSystemService } from 'toolkit--local/browser';

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface PickFileOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: FilePickerAcceptType[];
  id?: string;
  startIn?: any;
}

interface PickDirectoryOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: any;
}

// Define the ElectronAPI interface using unified types
interface ElectronAPI {
  showDirectoryPicker: () => Promise<{
    name: string;
    filePath: string;
    files: FileSystemItem[];
  } | null>;
  showOpenFilePicker: (
    options?: PickFileOptions,
  ) => Promise<FileSystemItem | null>;
  fetch: (url: string, options?: any) => Promise<any>;
  readFile: (path: string) => Promise<Buffer>;
  openPath: (path: string) => Promise<string>;
}

// Extend the Window interface
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

class FileSystemBridge {
  static isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return !!window.electronAPI || 'showDirectoryPicker' in window;
  }

  /**
   * Helper to reconstruct a FileSystemItem object from the raw DTO received from Electron.
   * This attaches the behavior (getFileContent) which cannot be passed via IPC.
   *
   * `item.path` is relative to the scanned root (it later gets rewritten to a
   * `/relative/path` form by FileSystemService.processDirectory for tree building),
   * so the real absolute path has to be reconstructed here using the root path
   * returned alongside the scan, otherwise Electron's main process tries to read
   * a relative path from its own cwd and fails with ENOENT.
   */
  private static hydrateElectronFileSystemItem(
    item: FileSystemItem,
    rootPath: string,
  ) {
    const relativePath = item.path;
    return {
      ...item,
      getFileContent: () => {
        return window.electronAPI!.readFile(`${rootPath}/${relativePath}`);
      },
    };
  }

  /**
   * Hydrates a browser file item by attaching a getFileContent that traverses
   * from the root dirHandle down to the specific file to read it.
   */
  private static hydrateBrowserFileSystemItem(
    item: FileSystemItem,
    rootHandle: FileSystemDirectoryHandle,
  ) {
    return {
      ...item,
      getFileContent: async () => {
        // Split path into segments using standard separator
        // We filter out empty segments and current directory indicators
        const segments = item.path.split('/').filter((p) => p && p !== '.');

        // If the path includes the root directory name at the start (common in scan results),
        // we skip it because 'rootHandle' is already that directory.
        const traversalPath =
          segments.length > 0 && segments[0] === rootHandle.name
            ? segments.slice(1)
            : segments;

        let currentHandle = rootHandle;

        // Traverse sub-directories
        for (let i = 0; i < traversalPath.length - 1; i++) {
          currentHandle = await currentHandle.getDirectoryHandle(
            traversalPath[i],
          );
        }

        // Get the specific file handle and reading the file
        const fileName = traversalPath[traversalPath.length - 1];
        const fileHandle = await currentHandle.getFileHandle(fileName);
        return await fileHandle.getFile();
      },
    };
  }

  static async pickFile(options: PickFileOptions = {}) {
    if (!this.isSupported()) {
      console.warn('File System Access API not supported');
      return null;
    }

    try {
      let result: FileSystemProcessedResult | null = null;

      if (window.electronAPI) {
        const fileData = await window.electronAPI.showOpenFilePicker(options);
        if (fileData) {
          result = FileSystemService.processSingleFile({
            name: fileData.name,
            path: fileData.path,
            size: fileData.size,
            modifiedAt: fileData.modifiedAt,
            getFileContent: () => window.electronAPI!.readFile(fileData.path),
          });
        }
      } else {
        const [fileHandle] = await window.showOpenFilePicker({
          multiple: false,
          ...options,
        });

        const file = await fileHandle.getFile();

        result = FileSystemService.processSingleFile({
          name: file.name,
          path: `./${file.name}`,
          size: file.size,
          modifiedAt: new Date(file.lastModified),
          // getFileContent: () => FileScannerBrowser.readFileAsBase64(file),
          getFileContent: () => file,
        });
      }

      if (!result) return null;

      return result;
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error selecting file:', error);
        throw error;
      }
      return null;
    }
  }

  static async pickDirectory(options: PickDirectoryOptions = {}) {
    if (!this.isSupported()) {
      console.warn('File System Access API not supported');
      return null;
    }

    try {
      if (window.electronAPI && options.mode !== 'readwrite') {
        const dirResult = await window.electronAPI.showDirectoryPicker();
        if (!dirResult) return null;

        // Hydrate files with getFileContent
        const scannedFiles = dirResult.files.map((file) =>
          this.hydrateElectronFileSystemItem(file, dirResult.filePath),
        );

        const result = await FileSystemService.processDirectory(scannedFiles, {
          rootDirectoryName: dirResult.name,
          rootPath: dirResult.filePath,
          includeFiles: false,
        });

        return {
          ...result,
          browserFSAPIhandle: null,
        };
      } else {
        const dirHandle: FileSystemDirectoryHandle | null =
          await window.showDirectoryPicker(options);
        if (!dirHandle) return null;

        const rawScannedFiles = await FileScannerBrowser.scanFiles(dirHandle);

        // Map over scanned files to attach the live file reading logic using the directory handle
        const scannedFiles = rawScannedFiles.map((file) =>
          this.hydrateBrowserFileSystemItem(file, dirHandle),
        );

        const result = await FileSystemService.processDirectory(scannedFiles, {
          rootDirectoryName: dirHandle.name,
          includeFiles: false,
        });

        return {
          ...result,
          browserFSAPIhandle: dirHandle,
        };
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error selecting directory:', error);
        throw error;
      }
      return null;
    }
  }
}

export { FileSystemBridge };
export type { PickDirectoryOptions, PickFileOptions };
