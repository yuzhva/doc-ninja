import path from 'path';
import type { MegaSearch } from 'toolkit--local/node';

type MegaSearchEnginesOptions = {
  /** Creates the folder's engine (createMegaSearch). */
  createEngine: (rootDirectory: string) => Promise<MegaSearch>;
  /** Deletes a folder's index cache with no engine (MegaSearch.clearCacheFor). */
  clearCacheOf: (rootDirectory: string) => Promise<void>;
  /** Stops what an engine let go of runs in the background (MegaSearch.close). */
  closeEngine?: (megaSearch: MegaSearch) => void;
  /** Folders kept at most; beyond that the least recently searched one goes. */
  maxEngines?: number;
  /** How long an engine nobody asks for is kept, in ms. */
  idleMs?: number;
};

type Engine = {
  megaSearch: Promise<MegaSearch>;
  idleTimer?: ReturnType<typeof setTimeout>;
};

/** One spelling per folder: Windows paths don't tell case apart. */
const folderKey = (rootDirectory: string): string => {
  const resolved = path.resolve(rootDirectory);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/**
 * One search engine per source folder, shared by every request. An engine
 * keeps its folder's index in memory and loads each document's words once,
 * the first time a search reads them. Created per request, it loaded the
 * whole index from disk each time, and every document each search read.
 *
 * A folder not searched for a while gives its memory back: an engine nobody
 * asked for in `idleMs` is let go, and so is the least recently searched one
 * beyond `maxEngines`.
 */
class MegaSearchEngines {
  // Insertion order is recency: least recently used first
  private engines = new Map<string, Engine>();
  // Cache deletes running for folders with no engine
  private clearing = new Map<string, Promise<void>>();
  private readonly maxEngines: number;
  private readonly idleMs: number;

  constructor(private options: MegaSearchEnginesOptions) {
    this.maxEngines = options.maxEngines ?? 3;
    this.idleMs = options.idleMs ?? 15 * 60_000;
  }

  /**
   * The folder's engine, created on first use. `isNew` tells whether this
   * call created it. Calls that come in together share one creation; a
   * failed one isn't kept, so the next call tries again.
   */
  async get(
    rootDirectory: string,
  ): Promise<{ megaSearch: MegaSearch; isNew: boolean }> {
    const key = folderKey(rootDirectory);
    let engine = this.engines.get(key);
    const isNew = !engine;

    if (engine) {
      this.engines.delete(key);
      clearTimeout(engine.idleTimer);
    } else {
      const created: Engine = {
        megaSearch: this.create(key, rootDirectory),
      };
      created.megaSearch.catch(() => this.drop(key, created));
      engine = created;
    }
    this.keep(key, engine);

    return { megaSearch: await engine.megaSearch, isNew };
  }

  /**
   * Deletes the folder's index cache, on disk and in memory. A live engine
   * deletes it itself, after the index update it may be running (which
   * would write the cache back), and stays: its next refresh indexes the
   * folder anew. With no engine, none is created for it, as that would read
   * the very cache being deleted; a search that comes in meanwhile waits.
   */
  clearCache(rootDirectory: string): Promise<void> {
    const key = folderKey(rootDirectory);
    const engine = this.engines.get(key);
    if (!engine) return this.clearWithoutEngine(key, rootDirectory);

    return engine.megaSearch.then(
      (megaSearch) => megaSearch.clearCache(),
      () => this.clearWithoutEngine(key, rootDirectory),
    );
  }

  /** Deletes the cache, with searches that come in meanwhile held back. */
  private async clearWithoutEngine(
    key: string,
    rootDirectory: string,
  ): Promise<void> {
    // Set before anything awaits, so no engine creation gets in first
    const clearing = this.options.clearCacheOf(rootDirectory);
    this.clearing.set(key, clearing);
    try {
      await clearing;
    } finally {
      if (this.clearing.get(key) === clearing) this.clearing.delete(key);
    }
  }

  private async create(
    key: string,
    rootDirectory: string,
  ): Promise<MegaSearch> {
    await this.clearing.get(key)?.catch(() => undefined);
    return this.options.createEngine(rootDirectory);
  }

  /** Puts the engine last in recency, and lets go of what's beyond the limits. */
  private keep(key: string, engine: Engine): void {
    engine.idleTimer = setTimeout(() => this.drop(key, engine), this.idleMs);
    // Waiting to let go of an engine is no reason to keep the process running
    engine.idleTimer.unref?.();
    this.engines.set(key, engine);

    for (const [oldestKey, oldest] of this.engines) {
      if (this.engines.size <= this.maxEngines) break;
      this.drop(oldestKey, oldest);
    }
  }

  /**
   * Lets go of the engine, if it's still the folder's: searches running on
   * it finish, and the next one gets a new engine. It stops watching its
   * folder.
   */
  private drop(key: string, engine: Engine): void {
    if (this.engines.get(key) !== engine) return;
    clearTimeout(engine.idleTimer);
    this.engines.delete(key);
    engine.megaSearch.then(
      (megaSearch) => this.options.closeEngine?.(megaSearch),
      () => undefined, // never created: nothing to close
    );
  }
}

export { MegaSearchEngines, folderKey };
export type { MegaSearchEnginesOptions };
