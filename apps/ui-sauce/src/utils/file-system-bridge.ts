import type { FileSystemItem } from 'toolkit--local/browser';
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
  // Absolute path of a folder picked for writing (by folder name), or null
  // when the main process never saw it granted. The handle the picker gives
  // the UI has no path of its own — see main.mts.
  getWritableDirectoryPath: (name: string) => Promise<string | null>;
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

  /**
   * Checks (and requests, if not already granted) permission for a handle
   * at the given mode — the one piece of plumbing every stored file or
   * directory handle needs before being read from or written to.
   * queryPermission/requestPermission aren't in this project's TS DOM lib
   * (same gap as showOpenFilePicker/showDirectoryPicker elsewhere), hence
   * the `any` cast.
   */
  static async ensurePermission(
    handle: FileSystemHandle,
    mode: 'read' | 'readwrite',
  ): Promise<boolean> {
    const handleWithPermissions = handle as any;
    const currentPermission = await handleWithPermissions.queryPermission({
      mode,
    });
    if (currentPermission === 'granted') return true;
    const requestedPermission = await handleWithPermissions.requestPermission({
      mode,
    });
    return requestedPermission === 'granted';
  }

  /**
   * Whether a directory handle still points at a folder that exists on disk.
   *
   * Matters for a remembered folder (see template-store's
   * StoredOutputDirectoryRecord): a handle persisted weeks ago can outlive
   * the folder itself, and permission alone says nothing about that —
   * queryPermission/requestPermission answer "may this app reach it", not
   * "is it still there".
   *
   * Pulling a single directory entry is the cheapest non-destructive way to
   * force the handle to actually resolve: an existing folder answers
   * immediately (even an empty one, with done: true), while a deleted or
   * moved one throws NotFoundError. Unlike a getFileHandle/getDirectoryHandle
   * probe it cannot create anything, and unlike a full scan its cost doesn't
   * grow with the folder's size.
   *
   * Assumes read access was already granted (ensurePermission); `values()`
   * isn't in this project's TS DOM lib, hence the `any` cast.
   */
  static async isDirectoryReachable(
    handle: FileSystemDirectoryHandle,
  ): Promise<boolean> {
    try {
      await (handle as any).values().next();
      return true;
    } catch (error: any) {
      if (error?.name === 'NotFoundError') return false;
      throw error;
    }
  }

  /**
   * Re-reads a previously picked-and-remembered file later (e.g. a saved
   * template), as opposed to pickFile, which always shows a picker dialog.
   * pickFile always returns a real handle now (Electron included — see
   * pickFile below), so this is the only kind of stored reference a caller
   * can have.
   *
   * Throws a DOMException-shaped 'NotAllowedError' when permission was
   * denied (queryPermission/requestPermission never reject, they just
   * resolve 'denied', so this has to be raised by hand). A read that fails
   * because the file was moved/deleted propagates whatever NotFoundError
   * the browser raised, unchanged — see isFileNotFoundError callers.
   */
  static async readStoredFile(handle: FileSystemFileHandle): Promise<Blob> {
    const hasPermission = await this.ensurePermission(handle, 'read');
    if (!hasPermission) {
      const error: any = new Error('Permission to read the file was denied.');
      error.name = 'NotAllowedError';
      throw error;
    }
    return handle.getFile();
  }

  static async pickFile(options: PickFileOptions = {}) {
    if (!this.isSupported()) {
      console.warn('File System Access API not supported');
      return null;
    }

    try {
      // Always the native File System Access picker, Electron included —
      // same precedent as pickDirectory's readwrite branch below, which
      // already relies on Electron's Chromium supporting this API. Unlike
      // directory scanning (where Electron's own dialog + Node fs walk is
      // used deliberately, see the other branch of pickDirectory), a single
      // file pick has no such reason to prefer the Electron-specific path:
      // this way every pick, in every environment, comes back with a real
      // FileSystemFileHandle, so callers that need to remember a pick (e.g.
      // a docm template) never have to special-case Electron.
      const [fileHandle] = await window.showOpenFilePicker({
        multiple: false,
        ...options,
      });

      return this.toPickedFile(await fileHandle.getFile(), fileHandle);
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error selecting file:', error);
        throw error;
      }
      return null;
    }
  }

  /**
   * The same result as pickFile, for a file dragged onto the page.
   *
   * Must be called synchronously from the `drop` handler: a DataTransfer's
   * items can only be read while that event is being dispatched, so both
   * reads below start right away and only their results are awaited.
   *
   * The handle (Chromium and Electron) is what lets a later folder picker
   * open next to the dropped file; where the browser can't give one, the
   * file is still usable, just without that.
   */
  static readDroppedFile(
    dataTransfer: DataTransfer,
  ): Promise<ReturnType<typeof FileSystemBridge.toPickedFile> | null> {
    const item = [...dataTransfer.items].find((i) => i.kind === 'file');
    const file = item?.getAsFile() ?? null;
    // getAsFileSystemHandle isn't in this project's TS DOM lib.
    const pendingHandle: Promise<FileSystemHandle | null> | undefined = (
      item as any
    )?.getAsFileSystemHandle?.();

    return (async () => {
      if (!file) return null;
      const handle = await pendingHandle?.catch(() => null);
      return this.toPickedFile(
        file,
        handle?.kind === 'file' ? (handle as FileSystemFileHandle) : null,
      );
    })();
  }

  // Generic so each caller keeps its own handle type: always a handle for
  // pickFile, possibly none for a drop.
  private static toPickedFile<Handle extends FileSystemFileHandle | null>(
    file: File,
    fileHandle: Handle,
  ) {
    const result = FileSystemService.processSingleFile({
      name: file.name,
      path: `./${file.name}`,
      size: file.size,
      modifiedAt: new Date(file.lastModified),
      // getFileContent: () => FileScannerBrowser.readFileAsBase64(file),
      // The toolkit types this as Node's `() => Promise<Buffer>`; in the
      // browser the batch processor reads the File itself (as before, when
      // an untyped handle hid the mismatch).
      getFileContent: (() => file) as any,
    });

    return { ...result, browserFSAPIhandle: fileHandle };
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
