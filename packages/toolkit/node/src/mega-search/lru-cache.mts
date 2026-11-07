/**
 * Keeps the most recently used entries, as many as `maxSize` allows: that
 * many entries, or — with `sizeOf` — entries whose sizes add up to at most
 * that much (the characters of a text, say).
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private totalSize = 0;

  constructor(
    private maxSize: number,
    private sizeOf: (value: V) => number = () => 1,
  ) {}

  /** How many entries it holds. */
  get size(): number {
    return this.cache.size;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  delete(key: K): void {
    if (!this.cache.has(key)) return;
    this.totalSize -= this.sizeOf(this.cache.get(key)!);
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.totalSize = 0;
  }

  /**
   * Keeps the entry, dropping the least recently used ones until all fit.
   * An entry bigger than maxSize on its own isn't kept.
   */
  set(key: K, value: V) {
    this.delete(key);
    this.cache.set(key, value);
    this.totalSize += this.sizeOf(value);
    // Least recently used first, the entry just set last
    for (const [oldestKey, oldest] of this.cache) {
      if (this.totalSize <= this.maxSize) break;
      this.cache.delete(oldestKey);
      this.totalSize -= this.sizeOf(oldest);
    }
  }
}

export { LRUCache };
