import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { resolveCachePaths } from '../cache-paths.mjs';
import type { SearchConfig } from '../types.mjs';

// Pure path arithmetic — nothing touches the disk. path.resolve keeps the
// expectations platform-native (C:\corpus on Windows, /corpus elsewhere).
const root = path.resolve('/corpus');
const outside = path.resolve('/elsewhere');

const resolveFor = (overrides: Partial<SearchConfig> = {}) =>
  resolveCachePaths({
    rootDirectory: root,
    extensions: ['.txt'],
    maxFileSize: Infinity,
    concurrency: 1,
    ...overrides,
  });

describe('resolveCachePaths()', () => {
  it('puts every cache artifact under <root>/.cache by default', () => {
    assert.deepEqual(resolveFor(), {
      cacheRoot: path.join(root, '.cache'),
      txtCacheRoot: path.join(root, '.cache', 'txt'),
      indexCacheRoot: path.join(root, '.cache', 'index'),
      globalIndexPath: path.join(
        root,
        '.cache',
        'global-inverted-index.json.gz',
      ),
      excludeAbsoluteDirs: [path.join(root, '.cache')],
    });
  });

  it('moves the txt/index caches and the scan exclusion together with a custom cacheRoot', () => {
    // Regression guard: these used to hardcode '.cache/txt' and '.cache/index',
    // so a custom cacheRoot desynced the scanner's exclusion list from where
    // cache files were written and cache artifacts got indexed as documents.
    const paths = resolveFor({ cacheRoot: 'search-cache' });

    assert.equal(paths.txtCacheRoot, path.join(root, 'search-cache', 'txt'));
    assert.equal(
      paths.indexCacheRoot,
      path.join(root, 'search-cache', 'index'),
    );
    assert.equal(
      paths.globalIndexPath,
      path.join(root, 'search-cache', 'global-inverted-index.json.gz'),
    );
    assert.deepEqual(paths.excludeAbsoluteDirs, [
      path.join(root, 'search-cache'),
    ]);
  });

  it('nests custom txt/index subdirectory names inside cacheRoot', () => {
    const paths = resolveFor({
      txtCacheSubdir: 'text',
      indexCacheSubdir: 'idx',
    });

    assert.equal(paths.txtCacheRoot, path.join(root, '.cache', 'text'));
    assert.equal(paths.indexCacheRoot, path.join(root, '.cache', 'idx'));
  });

  it('resolves a relative globalIndexPath against the root and excludes its folder too', () => {
    const paths = resolveFor({ globalIndexPath: 'meta/index.json.gz' });

    assert.equal(
      paths.globalIndexPath,
      path.join(root, 'meta', 'index.json.gz'),
    );
    assert.deepEqual(paths.excludeAbsoluteDirs, [
      path.join(root, '.cache'),
      path.join(root, 'meta'),
    ]);
  });

  it('lists the cache folder once when globalIndexPath lives inside it', () => {
    const paths = resolveFor({ globalIndexPath: '.cache/custom.json.gz' });

    assert.deepEqual(paths.excludeAbsoluteDirs, [path.join(root, '.cache')]);
  });

  it('does not exclude cache locations outside the root (the scan never reaches them)', () => {
    const paths = resolveFor({
      cacheRoot: path.join(outside, 'cache'),
      globalIndexPath: path.join(outside, 'global.json.gz'),
    });

    assert.equal(paths.cacheRoot, path.join(outside, 'cache'));
    assert.deepEqual(paths.excludeAbsoluteDirs, []);
  });
});
