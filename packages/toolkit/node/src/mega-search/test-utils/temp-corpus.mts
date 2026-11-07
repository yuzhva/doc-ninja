import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Fixed, clearly-in-the-past mtime for fixture files.
 *
 * Change detection in the indexer compares source vs. cache mtimes. Pinning
 * sources to the past keeps "the cache is fresh" deterministic, and lets a
 * test simulate an edit by writing with `later()` instead of sleeping and
 * hoping the file-system clock ticked.
 */
const FIXTURE_MTIME = new Date('2024-01-01T00:00:00Z');

/** A moment safely after anything the indexer has written during the test. */
const later = (): Date => new Date(Date.now() + 60_000);

type TempCorpus = {
  /** Absolute path of the corpus root directory. */
  root: string;
  /** Absolute, platform-native path for a corpus-relative POSIX path. */
  pathOf: (relativePath: string) => string;
  /** Writes (or overwrites) a file, creating parent directories. */
  write: (
    relativePath: string,
    content: string,
    mtime?: Date,
  ) => Promise<string>;
  read: (relativePath: string) => Promise<string>;
  remove: (relativePath: string) => Promise<void>;
  exists: (relativePath: string) => boolean;
  cleanup: () => Promise<void>;
};

/**
 * Creates an isolated directory of documents under the OS temp dir.
 * Every test file runs in its own process, and every corpus in its own
 * directory, so tests never share index caches.
 */
async function createTempCorpus(
  files: Record<string, string> = {},
): Promise<TempCorpus> {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'mega-search-test-'),
  );

  const pathOf = (relativePath: string) =>
    path.join(root, ...relativePath.split('/'));

  const write = async (
    relativePath: string,
    content: string,
    mtime: Date = FIXTURE_MTIME,
  ) => {
    const filePath = pathOf(relativePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf8');
    await fs.promises.utimes(filePath, mtime, mtime);
    return filePath;
  };

  for (const [relativePath, content] of Object.entries(files)) {
    await write(relativePath, content);
  }

  return {
    root,
    pathOf,
    write,
    read: (relativePath) => fs.promises.readFile(pathOf(relativePath), 'utf8'),
    remove: (relativePath) =>
      fs.promises.rm(pathOf(relativePath), { recursive: true, force: true }),
    exists: (relativePath) => fs.existsSync(pathOf(relativePath)),
    cleanup: () =>
      fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3 }),
  };
}

export { createTempCorpus, FIXTURE_MTIME, later };
export type { TempCorpus };
