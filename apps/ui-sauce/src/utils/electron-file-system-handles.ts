/**
 * File and folder handles for the desktop app, shaped like the browser's
 * File System Access API ones — FileSystemBridge hands these out in Electron
 * and real ones in a browser, so everything past the bridge (writing files,
 * remembering a folder in IndexedDB, re-checking it later) is one code path.
 *
 * Why Electron doesn't use the browser's own: a file or folder picked through
 * it can't get a security-scoped bookmark, so in the Mac App Store build it
 * turned unreadable/unwritable after every restart. These are picked through
 * Electron's open dialog (which makes that bookmark — see the electron app's
 * picked-paths.mts) and read and written by the main process
 * (file-system-ipc.mts), in the picked files and folders only.
 *
 * Covers the part of the API this app uses: `kind`, `name`,
 * queryPermission/requestPermission, isSameEntry, getFileHandle /
 * getDirectoryHandle (with `create`), values(), getFile() and createWritable()
 * with write()/close()/abort(). Failures are DOMExceptions with the names the
 * real API uses (NotFoundError, NotAllowedError, TypeMismatchError, ...).
 *
 * Stored in IndexedDB they come back as plain objects (a structured clone
 * keeps the fields, not the class) — FileSystemBridge.reviveStoredHandle turns
 * them back into handles.
 */

type FileSystemIpcResult<T> =
  { ok: true; value: T } | { ok: false; code: string; message: string };

/** What the preload exposes as window.electronAPI.fileSystem. */
interface ElectronFileSystemApi {
  getChild: (
    parentPath: string,
    name: string,
    kind: 'file' | 'directory',
    create: boolean,
  ) => Promise<FileSystemIpcResult<string>>;
  readDirectory: (
    directoryPath: string,
  ) => Promise<
    FileSystemIpcResult<
      { name: string; kind: 'file' | 'directory'; path: string }[]
    >
  >;
  readFile: (
    filePath: string,
  ) => Promise<FileSystemIpcResult<{ data: Uint8Array; lastModified: number }>>;
  writeFile: (
    filePath: string,
    data: Uint8Array,
  ) => Promise<FileSystemIpcResult<void>>;
}

// The DOMException names the File System Access API raises for the same cases
const domExceptionNameByCode: Record<string, string> = {
  ENOENT: 'NotFoundError',
  ENOTDIR: 'TypeMismatchError',
  EISDIR: 'TypeMismatchError',
  TYPE_MISMATCH: 'TypeMismatchError',
  EACCES: 'NotAllowedError',
  EPERM: 'NotAllowedError',
  NOT_PICKED: 'NotAllowedError',
  EROFS: 'NoModificationAllowedError',
  INVALID_NAME: 'TypeError',
};

const unwrap = async <T, _ = unknown>(
  pending: Promise<FileSystemIpcResult<T>>,
): Promise<T> => {
  const result = await pending;
  if (result.ok) return result.value;
  const name = domExceptionNameByCode[result.code] ?? 'InvalidStateError';
  if (name === 'TypeError') throw new TypeError(result.message);
  throw new DOMException(result.message, name);
};

const fileSystemApi = (): ElectronFileSystemApi => {
  const api = (window as any).electronAPI?.fileSystem;
  if (!api) {
    throw new DOMException(
      'Not running in the desktop app',
      'NotSupportedError',
    );
  }
  return api;
};

// Picked with the user's consent and remembered by the main process, so there
// is nothing left to ask: always granted, like a browser handle once allowed.
const grantedPermission = async (): Promise<PermissionState> => 'granted';

class ElectronFileHandle {
  readonly kind = 'file' as const;

  constructor(
    readonly name: string,
    readonly electronPath: string,
  ) {}

  // Methods, not fields: a function field would stop IndexedDB storing it
  queryPermission() {
    return grantedPermission();
  }

  requestPermission() {
    return grantedPermission();
  }

  async isSameEntry(other: { electronPath?: string }): Promise<boolean> {
    return other?.electronPath === this.electronPath;
  }

  async getFile(): Promise<File> {
    const { data, lastModified } = await unwrap(
      fileSystemApi().readFile(this.electronPath),
    );
    return new File([data as Uint8Array<ArrayBuffer>], this.name, {
      lastModified,
    });
  }

  /** Everything written is kept here and saved on close(), like the real one. */
  async createWritable() {
    const chunks: BlobPart[] = [];
    const filePath = this.electronPath;
    return {
      async write(data: any) {
        // write({ type: 'write', data }) — the only WriteParams form used here
        chunks.push(
          data && typeof data === 'object' && 'type' in data && 'data' in data
            ? data.data
            : data,
        );
      },
      async close() {
        const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
        await unwrap(fileSystemApi().writeFile(filePath, bytes));
      },
      async abort() {
        chunks.length = 0;
      },
    };
  }
}

class ElectronDirectoryHandle {
  readonly kind = 'directory' as const;

  constructor(
    readonly name: string,
    readonly electronPath: string,
  ) {}

  // Methods, not fields: a function field would stop IndexedDB storing it
  queryPermission() {
    return grantedPermission();
  }

  requestPermission() {
    return grantedPermission();
  }

  async isSameEntry(other: { electronPath?: string }): Promise<boolean> {
    return other?.electronPath === this.electronPath;
  }

  async getFileHandle(
    name: string,
    { create = false }: { create?: boolean } = {},
  ): Promise<ElectronFileHandle> {
    const childPath = await unwrap(
      fileSystemApi().getChild(this.electronPath, name, 'file', create),
    );
    return new ElectronFileHandle(name, childPath);
  }

  async getDirectoryHandle(
    name: string,
    { create = false }: { create?: boolean } = {},
  ): Promise<ElectronDirectoryHandle> {
    const childPath = await unwrap(
      fileSystemApi().getChild(this.electronPath, name, 'directory', create),
    );
    return new ElectronDirectoryHandle(name, childPath);
  }

  async *values(): AsyncGenerator<
    ElectronFileHandle | ElectronDirectoryHandle
  > {
    const entries = await unwrap(
      fileSystemApi().readDirectory(this.electronPath),
    );
    for (const entry of entries) {
      yield entry.kind === 'directory'
        ? new ElectronDirectoryHandle(entry.name, entry.path)
        : new ElectronFileHandle(entry.name, entry.path);
    }
  }
}

type ElectronHandle = ElectronFileHandle | ElectronDirectoryHandle;

const isElectronHandle = (value: unknown): value is ElectronHandle =>
  value instanceof ElectronFileHandle ||
  value instanceof ElectronDirectoryHandle;

/**
 * An Electron handle back from IndexedDB (fields only) as a handle again;
 * anything else — a browser handle, null — as it is.
 */
const reviveElectronHandle = <T, _ = unknown>(value: T): T => {
  const stored = value as any;
  if (
    !stored ||
    isElectronHandle(stored) ||
    typeof stored.electronPath !== 'string'
  ) {
    return value;
  }
  return (
    stored.kind === 'directory'
      ? new ElectronDirectoryHandle(stored.name, stored.electronPath)
      : new ElectronFileHandle(stored.name, stored.electronPath)
  ) as T;
};

export {
  ElectronDirectoryHandle,
  ElectronFileHandle,
  isElectronHandle,
  reviveElectronHandle,
};
export type { ElectronFileSystemApi, ElectronHandle };
