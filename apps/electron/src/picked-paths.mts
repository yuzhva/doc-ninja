/**
 * The files and folders the user picked in the open dialog, remembered
 * across restarts — the only places the window may read or write through
 * the file system IPC (see file-system-ipc.mts).
 *
 * Mac App Store build: in the App Sandbox a pick grants access only until
 * the app quits, after which the very same path is denied (a search folder
 * rescanned to nothing, a remembered output folder refused every write). A
 * security-scoped bookmark, made at the pick, gets that access back on the
 * next launch. Elsewhere (Windows, Linux, the darwin zip, `start`) there is
 * no sandbox, and a path is all there is to remember.
 *
 * Access is opened in this (main) process; the backend's process, which scans
 * the search folders, shares the app's sandbox and gets it too — the same way
 * it reads a folder picked during the session.
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const isMas = process.mas === true;

/** By path; a bookmark only in the Mac App Store build. */
type PickedPaths = Record<string, { bookmark?: string }>;

let pickedPaths: PickedPaths | null = null;

const pickedPathsFile = () =>
  path.join(app.getPath('userData'), 'picked-paths.json');

const readPickedPaths = (): PickedPaths => {
  if (pickedPaths) return pickedPaths;
  try {
    pickedPaths = JSON.parse(fs.readFileSync(pickedPathsFile(), 'utf8'));
  } catch {
    // None yet (or unreadable): the folders get picked again
    pickedPaths = {};
  }
  return pickedPaths!;
};

/**
 * Remembers a file or folder the user just picked, with its bookmark
 * (`bookmarks[0]` of dialog.showOpenDialog with `securityScopedBookmarks`) in
 * the Mac App Store build. The pick itself already gives access for this
 * session.
 */
const rememberPickedPath = (pickedPath: string, bookmark?: string) => {
  const paths = readPickedPaths();
  paths[path.resolve(pickedPath)] = isMas && bookmark ? { bookmark } : {};
  try {
    fs.writeFileSync(pickedPathsFile(), JSON.stringify(paths, null, 2));
  } catch (error) {
    console.warn('⚠️ Failed to remember a picked path:', error);
  }
};

/** Whether `target` is a picked file or folder, or inside a picked folder. */
const isWithinPickedPath = (target: string) => {
  const resolved = path.resolve(target);
  return Object.keys(readPickedPaths()).some((picked) => {
    const relative = path.relative(picked, resolved);
    return (
      relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative))
    );
  });
};

/**
 * Regains access to everything picked in an earlier session (Mac App Store
 * build). Called before the window loads, as the UI rescans its folders as
 * soon as it starts.
 */
const restorePickedPathsAccess = () => {
  if (!isMas) return;

  const stopAccessing: Array<() => void> = [];
  for (const [pickedPath, { bookmark }] of Object.entries(readPickedPaths())) {
    if (!bookmark) continue;
    try {
      stopAccessing.push(
        app.startAccessingSecurityScopedResource(bookmark) as () => void,
      );
    } catch (error) {
      // Deleted since: whatever reads it next reports it as gone
      console.warn(`⚠️ No access to ${pickedPath} restored:`, error);
    }
  }

  app.on('will-quit', () => {
    for (const stop of stopAccessing) stop();
  });
};

export { isWithinPickedPath, rememberPickedPath, restorePickedPathsAccess };
