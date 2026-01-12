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
   */
  private static hydrateFileSystemItem(item: FileSystemItem) {
    return {
      ...item,
      getFileContent: () => {
        return window.electronAPI!.readFile(item.path);
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
        const scannedFiles = dirResult.files.map(this.hydrateFileSystemItem);

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

        const scannedFiles = await FileScannerBrowser.scanFiles(dirHandle);

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
