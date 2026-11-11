/**
 * File reads and writes for the window, in the picked files and folders only
 * (see picked-paths.mts) — what the UI's Electron file handles run on (see
 * ui-sauce's electron-file-system-handles.ts).
 *
 * Why not the browser's File System Access API, which the UI uses in a
 * browser: Electron can't make a security-scoped bookmark for a folder that
 * API picked, so in the Mac App Store build every remembered folder and
 * template file turned unwritable/unreadable after a restart. The open dialog
 * gives that bookmark, and the reads and writes happen here.
 *
 * Every call resolves to `{ ok: true, value }` or `{ ok: false, code,
 * message }`, never rejects: an error thrown across IPC reaches the renderer
 * as a plain Error with the code lost, and the handles need it to raise the
 * DOMException the File System Access API would (NotFoundError, ...).
 */
import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

import { isWithinPickedPath } from './picked-paths.mjs';

type Result<T> =
  { ok: true; value: T } | { ok: false; code: string; message: string };

class FileSystemIpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const run = async <T,>(work: () => Promise<T>): Promise<Result<T>> => {
  try {
    return { ok: true, value: await work() };
  } catch (error: any) {
    return {
      ok: false,
      code: error?.code ?? 'UNKNOWN',
      message: error?.message ?? String(error),
    };
  }
};

const assertPicked = (target: string) => {
  if (!isWithinPickedPath(target)) {
    throw new FileSystemIpcError(
      'NOT_PICKED',
      `${target} is outside every file and folder picked in this app`,
    );
  }
};

/** An entry's own name: one path segment, as the File System Access API allows. */
const assertEntryName = (name: string) => {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new FileSystemIpcError('INVALID_NAME', `Invalid name: "${name}"`);
  }
};

const kindOf = (stats: fs.Stats) =>
  stats.isDirectory() ? 'directory' : 'file';

const registerFileSystemIpc = () => {
  /**
   * The child `name` of folder `parentPath`, as getFileHandle /
   * getDirectoryHandle resolve it: there already with that kind, or created
   * (an empty file, a folder) when `create` is set. Resolves to its path.
   */
  ipcMain.handle(
    'fileSystem:getChild',
    (
      _event,
      parentPath: string,
      name: string,
      kind: 'file' | 'directory',
      create: boolean,
    ) =>
      run(async () => {
        assertEntryName(name);
        const childPath = path.join(parentPath, name);
        assertPicked(childPath);

        const stats = await fs.promises.stat(childPath).catch((error) => {
          if (error.code === 'ENOENT' && create) return null;
          throw error;
        });
        if (stats && kindOf(stats) !== kind) {
          throw new FileSystemIpcError(
            'TYPE_MISMATCH',
            `${childPath} is not a ${kind}`,
          );
        }
        if (!stats) {
          if (kind === 'directory') await fs.promises.mkdir(childPath);
          else await fs.promises.writeFile(childPath, new Uint8Array());
        }
        return childPath;
      }),
  );

  ipcMain.handle('fileSystem:readDirectory', (_event, directoryPath: string) =>
    run(async () => {
      assertPicked(directoryPath);
      const entries = await fs.promises.readdir(directoryPath, {
        withFileTypes: true,
      });
      return entries
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? 'directory' : 'file',
          path: path.join(directoryPath, entry.name),
        }));
    }),
  );

  ipcMain.handle('fileSystem:readFile', (_event, filePath: string) =>
    run(async () => {
      assertPicked(filePath);
      const [data, stats] = await Promise.all([
        fs.promises.readFile(filePath),
        fs.promises.stat(filePath),
      ]);
      return { data: new Uint8Array(data), lastModified: stats.mtimeMs };
    }),
  );

  ipcMain.handle(
    'fileSystem:writeFile',
    (_event, filePath: string, data: Uint8Array) =>
      run(async () => {
        assertPicked(filePath);
        await fs.promises.writeFile(filePath, data);
      }),
  );
};

export { registerFileSystemIpc };
