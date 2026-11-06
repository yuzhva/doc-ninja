import * as fs from 'fs';
import * as path from 'path';

/** One spelling per path: Windows paths don't tell case apart. */
const comparable = (filePath: string): string =>
  process.platform === 'win32' ? filePath.toLowerCase() : filePath;

/**
 * Tells whether a folder's files may have changed since they were last
 * looked at, so a refresh can skip listing them all when nothing did.
 *
 * It's a hint, never the only check: fs.watch can miss a change — on a
 * network share, or when the system drops events under load — so a look is
 * due anyway `maxAgeMs` after the last one, and always while watching can't
 * run (the folder is missing, or the system can't watch a folder tree).
 *
 * On Windows, reading a file reports it changed too: a look that indexed
 * files is followed by one more, which finds nothing to do.
 */
class FolderWatcher {
  private watcher: fs.FSWatcher | null = null;
  private changed = true;
  private lastLook = -Infinity;
  private closed = false;
  private readonly ignored: string[];

  /**
   * @param ignoredDirs absolute folders inside `directory` whose changes
   *   don't count: the index cache, which every update writes
   */
  constructor(
    private readonly directory: string,
    ignoredDirs: readonly string[],
    private readonly maxAgeMs: number,
  ) {
    this.ignored = ignoredDirs.map((dir) =>
      comparable(path.relative(directory, dir)),
    );
  }

  /** Whether the files may have changed since the last look began. */
  get isLookDue(): boolean {
    return (
      this.watcher === null ||
      this.changed ||
      Date.now() - this.lastLook >= this.maxAgeMs
    );
  }

  /**
   * To call as a look at the files begins: a change from here on makes the
   * next one due. Starts watching, if it isn't yet.
   */
  lookBegins(): void {
    this.start();
    this.changed = false;
    this.lastLook = Date.now();
  }

  /** Makes the next look due: the last one failed, or the index was cleared. */
  markChanged(): void {
    this.changed = true;
  }

  /** Stops watching for good: every look is due from now on. */
  close(): void {
    this.closed = true;
    this.stop();
  }

  private start(): void {
    if (this.watcher || this.closed) return;
    try {
      const watcher = fs.watch(
        this.directory,
        { recursive: true },
        (_event, fileName) => {
          if (fileName && this.isIgnored(fileName.toString())) return;
          this.changed = true;
        },
      );
      // The folder went away, or the system stopped reporting: the next
      // look starts watching again, if it can
      watcher.on('error', () => {
        if (this.watcher === watcher) this.stop();
      });
      // Watching is no reason to keep the process running
      watcher.unref();
      this.watcher = watcher;
    } catch {
      // No watching here: every look is due
    }
  }

  private stop(): void {
    this.watcher?.close();
    this.watcher = null;
    this.changed = true;
  }

  private isIgnored(relativePath: string): boolean {
    const changed = comparable(path.normalize(relativePath));
    return this.ignored.some(
      (dir) => changed === dir || changed.startsWith(dir + path.sep),
    );
  }
}

export { FolderWatcher };
