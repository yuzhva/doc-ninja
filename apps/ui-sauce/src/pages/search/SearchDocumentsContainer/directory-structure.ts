import type {
  FileSystemItem,
  FileSystemProcessedResult,
} from 'toolkit--local/browser';
import { FileSystemService } from 'toolkit--local/browser';

import { fetchRequest } from '../../../utils';

/**
 * Everything the search page needs to keep its directory tree honest after the
 * folder was picked.
 *
 * A pick (FileSystemBridge.pickDirectory, via useDirectoryPicker) is a one-shot
 * snapshot: the tree it produced is mirrored into `directoryData` + localStorage
 * and then never re-read, so a folder created or emptied on disk afterwards is
 * invisible until the user re-picks. These helpers re-read that same folder
 * without a picker dialog and carry the existing selection across.
 *
 * Deliberately kept out of FileSystemBridge: that layer is the unified
 * "how do I reach the file system in this environment" API, while everything
 * here is shaped around what this page's tree and search scope need.
 */

/** The shape a directory pick produces, and what a rescan has to match. */
type DirectoryData = FileSystemProcessedResult & {
  browserFSAPIhandle: FileSystemDirectoryHandle | null;
};

/**
 * Whether a stored directory path can be re-read without showing the picker
 * again. Only an Electron pick carries a real absolute path; a browser-mode
 * pick is stored as `./<name>` (see FileSystemService.processDirectory) and is
 * reachable only through its FileSystemDirectoryHandle, which does not survive
 * localStorage.
 */
const isRescannableDirectoryPath = (
  directoryPath?: string | null,
): directoryPath is string => !!directoryPath && !directoryPath.startsWith('.');

/**
 * Re-reads a folder picked earlier — the picker-less counterpart of
 * FileSystemBridge.pickDirectory, returning the same shape so one can replace
 * the other.
 *
 * Goes through the local backend (the same place the search itself runs)
 * rather than a dedicated Electron IPC call: inside Electron that backend is
 * in-process, and it reuses the very scan the search indexer runs, so the tree
 * cannot drift from what a search actually covers.
 *
 * `files` come back without `getFileContent` — unlike a fresh pick, but exactly
 * like the localStorage-restored data this replaces, and the tree itself only
 * ever renders directories.
 *
 * Throws when the folder is gone or unreadable.
 */
const rescanDirectoryStructure = async (
  sourcePath: string,
): Promise<DirectoryData> => {
  const scanResult = await fetchRequest(
    '/api-local/process/directory-structure',
    {
      method: 'POST',
      body: JSON.stringify({ sourcePath }),
    },
  );

  // fetchRequest resolves with the parsed body for error responses too, so a
  // failure surfaces as a payload without `files` rather than a rejection.
  if (!scanResult || !Array.isArray(scanResult.files)) {
    throw new Error(
      scanResult?.error?.message ||
        `Failed to read directory structure: ${sourcePath}`,
    );
  }

  const result = await FileSystemService.processDirectory(scanResult.files, {
    rootDirectoryName: scanResult.name,
    rootPath: scanResult.filePath,
    includeFiles: false,
  });

  return { ...result, browserFSAPIhandle: null };
};

/**
 * A comparable stand-in for "what the tree currently shows".
 *
 * `structure` is built deterministically — sorted, directories only, each with
 * its file count — so its JSON captures exactly the two changes that matter
 * here: a folder appearing/disappearing, and a folder's file count moving.
 *
 * There is no cheaper probe worth having: any fingerprint of a folder requires
 * walking it, and that walk (readdir + stat, no file contents) is the whole
 * cost of a rescan. This exists to avoid re-rendering the tree and churning the
 * selection when nothing moved — not to avoid the scan.
 */
const getDirectoryStructureFingerprint = (structure?: FileSystemItem) =>
  JSON.stringify(structure);

/**
 * Carries a tree selection over to a freshly scanned tree: paths that no longer
 * exist drop out, and directories that appeared under an already selected
 * parent become selected as well.
 *
 * That second half is not cosmetic — the backend scopes a search by path prefix
 * (MegaSearch.resolveScopedPaths), so a subfolder created under a checked
 * parent is already being searched; leaving its checkbox off would make the
 * tree misreport the real search scope.
 */
const reconcileSelectedPaths = (
  previousSelectedPaths: Set<string>,
  structure: FileSystemItem,
): Set<string> => {
  const nextSelectedPaths = new Set<string>();

  const traverse = (node: FileSystemItem, isParentSelected: boolean) => {
    const isSelected = isParentSelected || previousSelectedPaths.has(node.path);
    if (isSelected) nextSelectedPaths.add(node.path);
    node.fsNestedItems?.forEach((child) => traverse(child, isSelected));
  };

  traverse(structure, false);

  return nextSelectedPaths;
};

export {
  getDirectoryStructureFingerprint,
  isRescannableDirectoryPath,
  reconcileSelectedPaths,
  rescanDirectoryStructure,
};
export type { DirectoryData };
