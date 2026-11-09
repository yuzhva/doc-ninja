import type { FileSystemItem } from 'toolkit--local/browser';

import { reconcileSelectedPaths } from './directory-structure';

/**
 * A source folder the search page searches in, and how what's found there is
 * parsed. Its path, `structure.path`, is what the backend searches by and what
 * tells the folders apart.
 *
 * Only the tree is kept, not the files a pick lists: the tree is what the page
 * shows and scopes a search by, and the list of a large folder's files would
 * soon fill localStorage once several folders are kept.
 *
 * The tree's folders go by their full paths (see withFullPaths), where a pick
 * or a rescan names them relative to the source folder ("/2024"): two source
 * folders can each hold a "/2024", and the ticks of all of them share one set.
 */
type SearchSource = {
  /** Directories only, each with its file count (see directory-structure). */
  structure: FileSystemItem;
  /** The parser config what's found in it is extracted with; '' for none. */
  parserConfigName: string;
  /**
   * Whether its section in the form is folded. Kept with the folder so the
   * list opens as it was left; a folder just added starts open.
   */
  isCollapsed?: boolean;
};

/** What the form changes about a source folder, as opposed to its tree. */
type SearchSourceChanges = Partial<
  Pick<SearchSource, 'parserConfigName' | 'isCollapsed'>
>;

/** What a search request sends for one source folder. */
type SearchSourcePayload = {
  sourcePath: string;
  /** Where in it to search: all of it when empty. */
  searchScopedPaths: string[];
  /** The parser config itself; none means the backend's default. */
  extractorSchema?: any;
};

const SEARCH_SOURCES_STORAGE_KEY = 'docNinja_searchSources';
const SELECTED_PATHS_STORAGE_KEY = 'docNinja_selectedPaths';

// Where the one source folder, and its parser config, were kept before several
// could be searched together. Read once to carry them over.
const LEGACY_DIRECTORY_DATA_STORAGE_KEY = 'docNinja_directoryData';
const LEGACY_PARSER_CONFIG_NAME_STORAGE_KEY =
  'docNinja_selectedParserConfigName';

/** The separator a source folder's own path is written with. */
const separatorOf = (rootPath: string) =>
  rootPath.includes('\\') ? '\\' : '/';

/**
 * A folder's full path, from its path relative to the source folder as a pick
 * or a rescan names it ("/2024/Q1"). Not for a full path: on a POSIX system
 * one can't be told apart from a relative one.
 */
const toFullPath = (relativePath: string, rootPath: string) => {
  const separator = separatorOf(rootPath);
  const relativeParts = relativePath.split(/[/\\]+/).filter(Boolean);
  return [rootPath.replace(/[/\\]+$/, ''), ...relativeParts].join(separator);
};

/**
 * A folder's path relative to its source folder ("/2024/Q1"), as the backend
 * takes a search scope — what the tree's paths were before they went full.
 */
const toRootRelativePath = (folderPath: string, rootPath: string) =>
  '/' +
  folderPath
    .slice(rootPath.replace(/[/\\]+$/, '').length)
    .split(/[/\\]+/)
    .filter(Boolean)
    .join('/');

/**
 * A tree as a pick or a rescan builds it, with every folder under its full
 * path; see SearchSource.
 */
const withFullPaths = (structure: FileSystemItem): FileSystemItem => {
  const withFullPathsBelow = (node: FileSystemItem): FileSystemItem => ({
    ...node,
    path: toFullPath(node.path, structure.path),
    fsNestedItems: node.fsNestedItems?.map(withFullPathsBelow),
  });
  return {
    ...structure,
    fsNestedItems: structure.fsNestedItems?.map(withFullPathsBelow),
  };
};

const isSearchSource = (value: any): value is SearchSource =>
  typeof value?.structure?.path === 'string' &&
  typeof value?.parserConfigName === 'string';

/** The single-folder version's folder, while it hasn't been carried over. */
const readLegacyStructure = (): FileSystemItem | null => {
  if (localStorage.getItem(SEARCH_SOURCES_STORAGE_KEY)) return null;

  const legacyDirectoryData = localStorage.getItem(
    LEGACY_DIRECTORY_DATA_STORAGE_KEY,
  );
  const legacyStructure = legacyDirectoryData
    ? JSON.parse(legacyDirectoryData)?.structure
    : null;
  return typeof legacyStructure?.path === 'string' ? legacyStructure : null;
};

const readStoredSearchSources = (): SearchSource[] => {
  if (typeof window === 'undefined') return [];

  try {
    // Stored with full paths already. A folder in twice (not from this page,
    // which re-reads one picked again) would show twice and be searched twice:
    // the first one stays.
    const saved = localStorage.getItem(SEARCH_SOURCES_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(isSearchSource)
        .filter(
          (source, index, all) =>
            all.findIndex((other) =>
              isSamePath(other.structure.path, source.structure.path),
            ) === index,
        );
    }

    const legacyStructure = readLegacyStructure();
    if (!legacyStructure) return [];

    return [
      {
        structure: withFullPaths(legacyStructure),
        parserConfigName:
          localStorage.getItem(LEGACY_PARSER_CONFIG_NAME_STORAGE_KEY) || '',
      },
    ];
  } catch {
    return [];
  }
};

const readStoredSelectedPaths = (): Set<string> => {
  if (typeof window === 'undefined') return new Set();

  try {
    const saved = JSON.parse(
      localStorage.getItem(SELECTED_PATHS_STORAGE_KEY) || '[]',
    );
    const paths: string[] = Array.isArray(saved)
      ? saved.filter((path): path is string => typeof path === 'string')
      : [];

    // The single-folder version kept its ticks relative to its folder — all
    // but the folder itself
    const legacyStructure = readLegacyStructure();
    return new Set(
      legacyStructure
        ? paths.map((path) =>
            path === legacyStructure.path
              ? path
              : toFullPath(path, legacyStructure.path),
          )
        : paths,
    );
  } catch {
    return new Set();
  }
};

const storeSelectedPaths = (selectedPaths: Set<string>) => {
  try {
    localStorage.setItem(
      SELECTED_PATHS_STORAGE_KEY,
      JSON.stringify(Array.from(selectedPaths)),
    );
  } catch (e) {
    console.warn('Failed to save ticked folders to storage', e);
  }
};

const storeSearchSources = (sources: SearchSource[]) => {
  try {
    localStorage.setItem(
      SEARCH_SOURCES_STORAGE_KEY,
      JSON.stringify(
        sources.map(({ structure, parserConfigName, isCollapsed }) => ({
          structure,
          parserConfigName,
          isCollapsed: isCollapsed === true,
        })),
      ),
    );
    // Carried over by now: kept, they'd only go stale
    localStorage.removeItem(LEGACY_DIRECTORY_DATA_STORAGE_KEY);
    localStorage.removeItem(LEGACY_PARSER_CONFIG_NAME_STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to save search folders to storage', e);
  }
};

/**
 * A path in one spelling: forward slashes, no trailing one, and lower case
 * for a Windows path, which doesn't tell case apart.
 */
const comparablePath = (filePath: string) => {
  const slashed = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(slashed) || slashed.startsWith('//')
    ? slashed.toLowerCase()
    : slashed;
};

/** Whether `filePath` is `folderPath` or lies within it. */
const isPathWithin = (filePath: string, folderPath: string) => {
  const inner = comparablePath(filePath);
  const outer = comparablePath(folderPath);
  return inner === outer || inner.startsWith(`${outer}/`);
};

const isSamePath = (a: string, b: string) =>
  comparablePath(a) === comparablePath(b);

/**
 * The source folder that `folderPath` lies within, or that lies within it —
 * searching both would find the documents they share twice.
 */
const findOverlappingSource = (
  sources: SearchSource[],
  folderPath: string,
): SearchSource | undefined =>
  sources.find(
    ({ structure }) =>
      isPathWithin(folderPath, structure.path) ||
      isPathWithin(structure.path, folderPath),
  );

/** Every folder in the tree, the root included. */
const collectFolderPaths = (node: FileSystemItem): string[] => [
  node.path,
  ...(node.fsNestedItems ?? []).flatMap(collectFolderPaths),
];

/**
 * The ticked folders in the tree that no ticked folder holds: each takes in
 * everything below it, as the backend scopes a search by path prefix.
 */
const topMostSelectedFolders = (
  node: FileSystemItem,
  selectedPaths: Set<string>,
): FileSystemItem[] =>
  selectedPaths.has(node.path)
    ? [node]
    : (node.fsNestedItems ?? []).flatMap((child) =>
        topMostSelectedFolders(child, selectedPaths),
      );

/**
 * How many files the next search reads. With nothing ticked that's every
 * folder whole; otherwise the ticked folders, each counted once with
 * everything below it (`fsFileCount` takes that in already).
 */
const countSearchedFiles = (
  sources: SearchSource[],
  selectedPaths: Set<string>,
) =>
  sources.reduce(
    (sum, { structure }) =>
      sum +
      (selectedPaths.size === 0
        ? (structure.fsFileCount ?? 0)
        : topMostSelectedFolders(structure, selectedPaths).reduce(
            (folderSum, folder) => folderSum + (folder.fsFileCount ?? 0),
            0,
          )),
    0,
  );

/**
 * What a search sends for each source folder it reads. With nothing ticked
 * that's every folder, whole. Otherwise only the folders with something
 * ticked: whole when the source folder itself is, or else its top-most
 * ticked subfolders — relative to it, as the backend takes them.
 */
const buildSearchSourcesPayload = (
  sources: SearchSource[],
  selectedPaths: Set<string>,
  parserConfigs: any[],
): SearchSourcePayload[] =>
  sources.flatMap(({ structure, parserConfigName }) => {
    const isWhole =
      selectedPaths.size === 0 || selectedPaths.has(structure.path);
    const scopedPaths = isWhole
      ? []
      : topMostSelectedFolders(structure, selectedPaths).map((folder) =>
          toRootRelativePath(folder.path, structure.path),
        );

    if (!isWhole && scopedPaths.length === 0) return [];

    return [
      {
        sourcePath: structure.path,
        searchScopedPaths: scopedPaths,
        extractorSchema: parserConfigs.find(
          (config: any) => config.name === parserConfigName,
        ),
      },
    ];
  });

/**
 * A selection carried over to the folders' trees as they are now: see
 * reconcileSelectedPaths. A path in none of them drops out.
 */
const reconcileSelectedPathsAcross = (
  previousSelectedPaths: Set<string>,
  sources: SearchSource[],
) =>
  new Set(
    sources.flatMap(({ structure }) => [
      ...reconcileSelectedPaths(previousSelectedPaths, structure),
    ]),
  );

export {
  buildSearchSourcesPayload,
  collectFolderPaths,
  countSearchedFiles,
  findOverlappingSource,
  isPathWithin,
  isSamePath,
  readStoredSearchSources,
  readStoredSelectedPaths,
  reconcileSelectedPathsAcross,
  storeSearchSources,
  storeSelectedPaths,
  toRootRelativePath,
  withFullPaths,
};
export type { SearchSource, SearchSourceChanges, SearchSourcePayload };
