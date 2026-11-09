import React from 'react';
import type { FileSystemItem } from 'toolkit--local/browser';

import {
  getDirectoryStructureFingerprint,
  isRescannableDirectoryPath,
  rescanDirectoryStructure,
} from './directory-structure';
import { parserConfigsStore } from './search-configs-store';
import {
  collectFolderPaths,
  findOverlappingSource,
  isPathWithin,
  isSamePath,
  readStoredSearchSources,
  readStoredSelectedPaths,
  reconcileSelectedPathsAcross,
  storeSearchSources,
  storeSelectedPaths,
  toggleSelectedPath,
  withFullPaths,
  withKnownParserConfigs,
} from './search-sources';
import type { SearchSource, SearchSourceChanges } from './search-sources';

/**
 * The folders the search page searches in, and which of their folders are
 * ticked. Kept here rather than in a component so that a change re-renders
 * only what shows it: the form, with its trees, on every change — and the
 * results pane only when there comes to be a folder, or none any more. The
 * search reads them as it runs, without subscribing.
 *
 * Read from localStorage on first use, and saved to it on every change.
 */
interface SearchSourcesState {
  /** Each with its own parser config. */
  sources: SearchSource[];
  /**
   * The ticked folders, across all the trees. With none ticked, every folder
   * is searched whole.
   */
  selectedPaths: Set<string>;
}

let state: SearchSourcesState | null = null;
let isLoadSaved = false;
const listeners = new Set<() => void>();

const getState = (): SearchSourcesState => {
  if (state === null) {
    // Both are read before either is saved: carrying over the single-folder
    // version's ticks takes its folder, which saving the folders drops
    const sources = readStoredSearchSources();
    const selectedPaths = readStoredSelectedPaths();
    state = {
      sources: withKnownParserConfigs(sources, parserConfigsStore.get()),
      selectedPaths,
    };
  }
  return state;
};

const setState = (changes: Partial<SearchSourcesState>) => {
  const current = getState();
  const next = { ...current, ...changes };
  if (
    next.sources === current.sources &&
    next.selectedPaths === current.selectedPaths
  ) {
    return;
  }

  state = next;
  if (next.sources !== current.sources) storeSearchSources(next.sources);
  if (next.selectedPaths !== current.selectedPaths) {
    storeSelectedPaths(next.selectedPaths);
  }
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  // What was read is saved back once, on first use — that completes carrying
  // over the single-folder version's data, which saving drops
  if (!isLoadSaved) {
    isLoadSaved = true;
    const { sources, selectedPaths } = getState();
    storeSearchSources(sources);
    storeSelectedPaths(selectedPaths);
  }

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// A parser config renamed or removed in its settings can't parse a folder's
// documents any more: the folders that used it go back to none
parserConfigsStore.subscribe(() => {
  if (state === null) return;
  setState({
    sources: withKnownParserConfigs(state.sources, parserConfigsStore.get()),
  });
});

/**
 * Adds a folder just picked to the folders searched. Picked again, it's read
 * anew and keeps its parser config and ticks.
 *
 * Returns the folder already in the list that the picked one lies within or
 * holds, if there's one — then it isn't added: searching both would find the
 * documents they share twice.
 */
const addPickedFolder = (
  pickedStructure: FileSystemItem,
): SearchSource | null => {
  const structure = withFullPaths(pickedStructure);
  const { sources, selectedPaths } = getState();

  const pickedAgain = sources.find((source) =>
    isSamePath(source.structure.path, structure.path),
  );
  if (pickedAgain) {
    // Opened, like a folder just added: it's the one being looked at
    const nextSources = sources.map((source) =>
      source === pickedAgain
        ? { ...source, structure, isCollapsed: false }
        : source,
    );
    setState({
      sources: nextSources,
      selectedPaths: reconcileSelectedPathsAcross(selectedPaths, nextSources),
    });
    return null;
  }

  const overlapping = findOverlappingSource(sources, structure.path);
  if (overlapping) return overlapping;

  setState({
    sources: [
      ...sources,
      {
        structure,
        // Folders added one after another tend to hold the same kind of
        // documents, so the last one's parser config is the likeliest guess
        parserConfigName: sources[sources.length - 1]?.parserConfigName ?? '',
      },
    ],
    // With some folders ticked, only those are searched: the folder was added
    // to be searched, so it's ticked too. With none, every folder is already.
    selectedPaths:
      selectedPaths.size === 0
        ? selectedPaths
        : new Set([...selectedPaths, ...collectFolderPaths(structure)]),
  });
  return null;
};

/** Drops a folder from the list, with its ticks. Its cache stays on disk. */
const removeFolder = (sourcePath: string) => {
  const { sources, selectedPaths } = getState();
  const nextSelectedPaths = new Set(
    [...selectedPaths].filter((path) => !isPathWithin(path, sourcePath)),
  );
  setState({
    sources: sources.filter((source) => source.structure.path !== sourcePath),
    selectedPaths:
      nextSelectedPaths.size === selectedPaths.size
        ? selectedPaths
        : nextSelectedPaths,
  });
};

/** Changes what the form sets about a folder: its parser config, its fold. */
const changeFolder = (sourcePath: string, changes: SearchSourceChanges) => {
  setState({
    sources: getState().sources.map((source) =>
      source.structure.path === sourcePath ? { ...source, ...changes } : source,
    ),
  });
};

/** Ticks or unticks a folder in a tree; see toggleSelectedPath. */
const togglePath = (path: string, checked: boolean) => {
  const { sources, selectedPaths } = getState();
  setState({
    selectedPaths: toggleSelectedPath(selectedPaths, sources, path, checked),
  });
};

let pendingRefresh: Promise<SearchSourcesState> | null = null;

/**
 * Re-reads every folder, since the trees are snapshots of the moment each was
 * picked and go stale as soon as anything changes on disk. Swaps in the trees
 * whose fingerprint moved, carrying the ticks over to them.
 *
 * Resolves to the folders and ticks in effect afterwards, for a search to send
 * as they are. A refresh still running is joined rather than run again: two
 * at once (the page's first one, and a search) would scan twice and race over
 * the same state.
 */
const refresh = (): Promise<SearchSourcesState> => {
  if (pendingRefresh) return pendingRefresh;

  pendingRefresh = (async () => {
    try {
      const rescanned = await Promise.all(
        getState().sources.map(async ({ structure: { path } }) => {
          if (!isRescannableDirectoryPath(path)) return null;

          try {
            const { structure } = await rescanDirectoryStructure(path);
            return [path, withFullPaths(structure)] as const;
          } catch (error) {
            // A folder that was moved, deleted or became unreadable must not
            // block the search: the request that follows reports that far
            // better than a toast raised out of a background refresh would.
            console.warn('Failed to refresh directory structure:', error);
            return null;
          }
        }),
      );

      // Folders added or removed while the scans ran are as they are now:
      // only the trees of the ones still there are swapped in
      const { sources, selectedPaths } = getState();
      const changedStructureByPath = new Map(
        rescanned.filter(
          (entry): entry is NonNullable<typeof entry> =>
            !!entry &&
            sources.some(
              (source) =>
                source.structure.path === entry[0] &&
                getDirectoryStructureFingerprint(source.structure) !==
                  getDirectoryStructureFingerprint(entry[1]),
            ),
        ),
      );

      if (changedStructureByPath.size > 0) {
        const nextSources = sources.map((source) => {
          const structure = changedStructureByPath.get(source.structure.path);
          return structure ? { ...source, structure } : source;
        });
        setState({
          sources: nextSources,
          selectedPaths: reconcileSelectedPathsAcross(
            selectedPaths,
            nextSources,
          ),
        });
      }

      return getState();
    } finally {
      pendingRefresh = null;
    }
  })();

  return pendingRefresh;
};

const searchSourcesStore = {
  addPickedFolder,
  changeFolder,
  getState,
  refresh,
  removeFolder,
  togglePath,
};

// What a server render shows: no folders, nothing ticked. The same objects
// every time, as useSyncExternalStore needs of a snapshot that hasn't changed.
const NO_SOURCES: SearchSource[] = [];
const NO_SELECTED_PATHS = new Set<string>();

const getSources = () => getState().sources;
const getSelectedPaths = () => getState().selectedPaths;
const getHasSources = () => getState().sources.length > 0;

const useSearchSources = (): SearchSource[] =>
  React.useSyncExternalStore(subscribe, getSources, () => NO_SOURCES);

const useSelectedPaths = (): Set<string> =>
  React.useSyncExternalStore(
    subscribe,
    getSelectedPaths,
    () => NO_SELECTED_PATHS,
  );

/**
 * Whether there's a folder to search at all — re-rendering only when that
 * changes, not on every tick or fold.
 */
const useHasSearchSources = (): boolean =>
  React.useSyncExternalStore(subscribe, getHasSources, () => false);

export {
  searchSourcesStore,
  useHasSearchSources,
  useSearchSources,
  useSelectedPaths,
};
export type { SearchSourcesState };
