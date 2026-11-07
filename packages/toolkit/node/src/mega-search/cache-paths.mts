import * as path from 'path';

import { DocumentMetadata, SearchConfig } from './types.mjs';

interface ResolvedCachePaths {
  /** Absolute path to the shared cache root directory. */
  cacheRoot: string;
  /** Absolute path to the directory holding extracted per-document text cache. */
  txtCacheRoot: string;
  /** Absolute path to the directory holding per-document vocab/positions cache. */
  indexCacheRoot: string;
  /** Absolute path to the compressed global inverted index file. */
  globalIndexPath: string;
  /**
   * Absolute directories to exclude from document scanning, so cache
   * artifacts (extracted .txt files, per-doc index json, the global index)
   * are never picked up and re-indexed as if they were source documents.
   * Deduplicated, and only includes directories that actually live inside
   * rootDirectory — an explicit globalIndexPath pointed elsewhere doesn't
   * need excluding, since the scan starting at rootDirectory would never
   * reach it anyway.
   */
  excludeAbsoluteDirs: string[];
}

/**
 * Single source of truth for where cache artifacts live, given a
 * SearchConfig. Every reader/writer of cache files (FileScannerIndexer,
 * DocumentProcessor, IndexStorage, FileIndexer.clearCache) must go through
 * this — previously each of those hardcoded its own '.cache/txt' /
 * '.cache/index' default independently of `cacheRoot`, so a custom
 * `cacheRoot` (or a custom txt/index subdir without a matching `cacheRoot`)
 * would silently desync the scanner's exclusion list from where cache files
 * actually got written, causing cache artifacts to be re-indexed as if they
 * were source documents.
 */
function resolveCachePaths(config: SearchConfig): ResolvedCachePaths {
  const root = config.rootDirectory;
  const cacheRoot = path.resolve(root, config.cacheRoot || '.cache');

  // txt/index subdirs are always nested *within* cacheRoot (per their doc
  // comments in types.mts) — so relocating cacheRoot alone is enough to
  // relocate both, without needing to also override these two.
  const txtCacheRoot = path.join(cacheRoot, config.txtCacheSubdir || 'txt');
  const indexCacheRoot = path.join(
    cacheRoot,
    config.indexCacheSubdir || 'index',
  );

  // globalIndexPath is documented as a "full path" override, independent of
  // cacheRoot — only falls back to living under cacheRoot by default.
  const globalIndexPath = config.globalIndexPath
    ? path.resolve(root, config.globalIndexPath)
    : path.join(cacheRoot, 'global-inverted-index.json.gz');

  const isInsideRoot = (dir: string) => {
    const rel = path.relative(root, dir);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };

  const excludeAbsoluteDirs = Array.from(
    new Set([cacheRoot, path.dirname(globalIndexPath)].filter(isInsideRoot)),
  );

  return {
    cacheRoot,
    txtCacheRoot,
    indexCacheRoot,
    globalIndexPath,
    excludeAbsoluteDirs,
  };
}

/**
 * A document's metadata as the caches save it: its path from the folder
 * indexed, and no path to its text, which follows from that one.
 */
type SavedMetadata = Omit<
  DocumentMetadata,
  'originalFilePath' | 'textFilePath'
> & {
  /** From the folder indexed, with "/" between names. */
  relativeFilePath: string;
};

/**
 * Documents' paths as the caches save them, and back: from the folder
 * indexed, with "/" between names, so a cache reads the same wherever the
 * folder is. Saved whole, a cache written with the folder elsewhere — as
 * be-krang in Docker sees it, at /usr/src/…, or before the folder was renamed
 * or its drive came back under another letter — held paths to nothing: the
 * documents' words were indexed under those, the documents under their real
 * paths, and searches found none of them.
 */
class SavedPaths {
  /** The folder indexed, and its text cache: each ending in a separator. */
  private readonly root: string;
  private readonly txtRoot: string;

  constructor(
    config: SearchConfig,
    cachePaths: ResolvedCachePaths = resolveCachePaths(config),
  ) {
    this.root = path.join(path.resolve(config.rootDirectory), path.sep);
    this.txtRoot = path.join(cachePaths.txtCacheRoot, path.sep);
  }

  /** `filePath`, a document's absolute path, as saved. */
  save(filePath: string): string {
    const relative = path.relative(this.root, filePath);
    return path.sep === '/' ? relative : relative.replace(/\\/g, '/');
  }

  /**
   * The absolute path of the document saved as `savedPath`, as the scanner
   * finds it there. Joined as strings: path.join takes 2–4 µs a path on
   * Windows, ~20 ms of every start with 7,000 documents.
   */
  read(savedPath: string): string {
    const relative = this.native(savedPath);
    return this.isPlain(relative)
      ? this.root + relative
      : path.resolve(this.root, relative);
  }

  saveMetadata({
    originalFilePath,
    textFilePath,
    ...metadata
  }: DocumentMetadata): SavedMetadata {
    return { ...metadata, relativeFilePath: this.save(originalFilePath) };
  }

  readMetadata({
    relativeFilePath,
    ...metadata
  }: SavedMetadata): DocumentMetadata {
    const relative = this.native(relativeFilePath);
    return {
      ...metadata,
      originalFilePath: this.read(relativeFilePath),
      textFilePath: this.isPlain(relative)
        ? `${this.txtRoot}${relative}.txt`
        : path.join(this.txtRoot, `${relative}.txt`),
    };
  }

  private native(savedPath: string): string {
    return path.sep === '/' ? savedPath : savedPath.replace(/\//g, '\\');
  }

  /** Whether `relative` is inside the folder: not outside it, nor on another drive. */
  private isPlain(relative: string): boolean {
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }
}

export { resolveCachePaths, SavedPaths };
export type { ResolvedCachePaths, SavedMetadata };
