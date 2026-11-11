/**
 * Keeps the Mac App Store build's access to the folders the user picked.
 *
 * In the App Sandbox, picking a folder in the open dialog grants access to it
 * only until the app quits: after a restart the very same path is denied, so
 * the rescan of a search folder found nothing ("no files in this folder").
 * A security-scoped bookmark, made at the pick, is what gets that access back
 * on the next launch. Everything here is a no-op outside the MAS build — no
 * sandbox, nothing to restore (Windows, Linux, the darwin zip, `start`).
 *
 * The access is opened in this (main) process; the backend's process, which
 * does the scanning, shares the app's sandbox and gets it too — the same way
 * it reads a folder picked during the session.
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const isMas = process.mas === true;

/** Bookmarks by folder path, the path being what the UI stores and rescans. */
type Bookmarks = Record<string, string>;

const bookmarksFile = () =>
  path.join(app.getPath('userData'), 'security-scoped-bookmarks.json');

const readBookmarks = (): Bookmarks => {
  try {
    return JSON.parse(fs.readFileSync(bookmarksFile(), 'utf8'));
  } catch {
    // None yet (or unreadable): the folders get picked again
    return {};
  }
};

/**
 * Stores the bookmark of a folder the user just picked (`bookmarks[0]` of
 * dialog.showOpenDialog with `securityScopedBookmarks: true`). The pick itself
 * already gives access for this session.
 */
const saveSecurityScopedBookmark = (folderPath: string, bookmark?: string) => {
  if (!isMas || !bookmark) return;
  const bookmarks = readBookmarks();
  bookmarks[folderPath] = bookmark;
  fs.writeFileSync(bookmarksFile(), JSON.stringify(bookmarks, null, 2));
};

/**
 * Regains access to every folder picked in an earlier session. Called before
 * the window loads, as the UI rescans its folders as soon as it starts.
 */
const restoreSecurityScopedAccess = () => {
  if (!isMas) return;

  const stopAccessing: Array<() => void> = [];
  for (const [folderPath, bookmark] of Object.entries(readBookmarks())) {
    try {
      stopAccessing.push(
        app.startAccessingSecurityScopedResource(bookmark) as () => void,
      );
    } catch (error) {
      // A folder deleted since: its rescan reports it as gone
      console.warn(`⚠️ No access to ${folderPath} restored:`, error);
    }
  }

  app.on('will-quit', () => {
    for (const stop of stopAccessing) stop();
  });
};

export { restoreSecurityScopedAccess, saveSecurityScopedBookmark };
