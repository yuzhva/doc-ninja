import * as fs from 'fs';
import * as path from 'path';

/** One spelling per path: Windows paths don't tell case apart. */
const comparable = (filePath: string): string =>
  process.platform === 'win32' ? filePath.toLowerCase() : filePath;

/** Whether `filePath` is `folder`, or anything in it. */
const isWithin = (filePath: string, folder: string): boolean =>
  filePath === folder ||
  filePath.startsWith(folder.endsWith(path.sep) ? folder : folder + path.sep);

/**
 * Tells whether a folder's files may have changed since they were last
 * looked at — all of them, or those in one of its folders — so a refresh can
 * skip listing them when nothing did.
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
  /**
   * What was looked at — the folder, or folders and files in it — with when
   * the last look at each began. A change in one, or to a folder above it,
   * drops it: the next look at it is due.
   */
  private looks = new Map<string, number>();
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

  /**
   * Whether the files in `scope` — the folder, or a folder or file in it —
   * may have changed since a look at them, or at a folder holding them,
   * began.
   */
  isLookDue(scope: string = this.directory): boolean {
    if (this.watcher === null) return true;

    const target = comparable(path.resolve(scope));
    const now = Date.now();
    for (const [looked, since] of this.looks) {
      if (isWithin(target, looked) && now - since < this.maxAgeMs) {
        return false;
      }
    }
    return true;
  }

  /**
   * To call as a look at the files in `scope` begins: a change in it from
   * here on makes the next one due. Starts watching, if it isn't yet.
   */
  lookBegins(scope: string = this.directory): void {
    this.start();
    const looked = comparable(path.resolve(scope));
    // This look takes in the earlier ones at what the scope holds
    for (const earlier of this.looks.keys()) {
      if (isWithin(earlier, looked)) this.looks.delete(earlier);
    }
    this.looks.set(looked, Date.now());
  }

  /** Makes every next look due: the last one failed, or the index was cleared. */
  markChanged(): void {
    this.looks.clear();
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
          // Nothing tells where: it may be anywhere
          if (!fileName) return this.markChanged();
          const relativePath = fileName.toString();
          if (this.isIgnored(relativePath)) return;
          this.dropLooksAt(
            comparable(path.resolve(this.directory, relativePath)),
          );
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
    this.looks.clear();
  }

  /**
   * Drops the looks a change at `changedPath` makes due: at what holds it,
   * and at what it holds — a folder renamed or deleted takes its files along.
   */
  private dropLooksAt(changedPath: string): void {
    for (const looked of this.looks.keys()) {
      if (isWithin(changedPath, looked) || isWithin(looked, changedPath)) {
        this.looks.delete(looked);
      }
    }
  }

  private isIgnored(relativePath: string): boolean {
    const changed = comparable(path.normalize(relativePath));
    return this.ignored.some(
      (dir) => changed === dir || changed.startsWith(dir + path.sep),
    );
  }
}

export { FolderWatcher, isWithin };
