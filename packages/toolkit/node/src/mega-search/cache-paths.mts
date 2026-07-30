import * as path from 'path';

import { SearchConfig } from './types.mjs';

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

export { resolveCachePaths };
export type { ResolvedCachePaths };
