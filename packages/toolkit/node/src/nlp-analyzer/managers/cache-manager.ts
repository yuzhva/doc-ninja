import * as fs from 'fs/promises';
import * as path from 'path';

import { AnalysisResult } from '../types';

interface CacheConfig {
  enabled: boolean;
  maxSize: number; // Maximum cache entries
  maxAge: number; // Maximum age in milliseconds
  persistToDisk: boolean;
  cacheDir?: string;
}

interface CacheEntry {
  key: string;
  data: AnalysisResult;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
}

class CacheManager {
  private cache = new Map<string, CacheEntry>();
  private config: CacheConfig;
  private cacheDir: string;
  private hitCount = 0;
  private missCount = 0;

  constructor(enabled: boolean = true, customConfig?: Partial<CacheConfig>) {
    this.config = {
      enabled,
      maxSize: 1000,
      maxAge: 60 * 60 * 1000, // 1 hour
      persistToDisk: false,
      ...customConfig,
    };

    this.cacheDir =
      this.config.cacheDir || path.join(process.cwd(), '.cache', 'nlp');

    if (this.config.enabled && this.config.persistToDisk) {
      this.loadCacheFromDisk();
    }

    console.log(
      `💾 Cache manager initialized (enabled: ${this.config.enabled})`,
    );
  }

  has(key: string): boolean {
    if (!this.config.enabled) return false;

    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this.config.maxAge) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  async get(key: string): Promise<AnalysisResult | null> {
    if (!this.config.enabled || !this.has(key)) return null;

    const entry = this.cache.get(key)!;
    entry.accessCount++;
    entry.lastAccessed = Date.now();

    this.hitCount++;
    return entry.data;
  }

  async set(key: string, data: AnalysisResult): Promise<void> {
    if (!this.config.enabled) return;

    // Clean up old entries if cache is full
    if (this.cache.size >= this.config.maxSize) {
      this.evictLeastRecentlyUsed();
    }

    const entry: CacheEntry = {
      key,
      data,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
    };

    this.cache.set(key, entry);

    if (this.config.persistToDisk) {
      await this.saveCacheToDisk();
    }
  }

  private evictLeastRecentlyUsed(): void {
    if (this.cache.size === 0) return;

    // Find the least recently used entry
    let oldestEntry: { key: string; lastAccessed: number } | null = null;

    for (const [key, entry] of this.cache.entries()) {
      if (!oldestEntry || entry.lastAccessed < oldestEntry.lastAccessed) {
        oldestEntry = { key, lastAccessed: entry.lastAccessed };
      }
    }

    if (oldestEntry) {
      this.cache.delete(oldestEntry.key);
    }
  }

  private async loadCacheFromDisk(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const cacheFile = path.join(this.cacheDir, 'analysis-cache.json');

      const data = await fs.readFile(cacheFile, 'utf-8');
      const cacheData = JSON.parse(data);

      // Restore cache entries
      for (const entry of cacheData.entries || []) {
        // Skip expired entries
        if (Date.now() - entry.timestamp <= this.config.maxAge) {
          this.cache.set(entry.key, entry);
        }
      }

      console.log(`📁 Loaded ${this.cache.size} entries from cache`);
    } catch (error) {
      // Cache file doesn't exist or is corrupted, start fresh
      console.log('📁 Starting with fresh cache');
    }
  }

  private async saveCacheToDisk(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const cacheFile = path.join(this.cacheDir, 'analysis-cache.json');

      const cacheData = {
        version: '1.0',
        savedAt: new Date().toISOString(),
        entries: Array.from(this.cache.values()),
      };

      await fs.writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
    } catch (error) {
      console.warn('⚠️ Failed to save cache to disk:', error);
    }
  }

  getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    memoryUsageMB: number;
    oldestEntry?: number;
    newestEntry?: number;
  } {
    const entries = Array.from(this.cache.values());
    const timestamps = entries.map((e) => e.timestamp);

    // ✅ Calculate approximate memory usage
    const estimatedMemoryMB =
      entries.reduce((total, entry) => {
        const entrySize = JSON.stringify(entry.data).length * 2; // Rough estimation
        return total + entrySize;
      }, 0) /
      (1024 * 1024);

    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitRate:
        entries.length > 0
          ? entries.reduce((sum, e) => sum + e.accessCount, 0) / entries.length
          : 0,
      memoryUsageMB: estimatedMemoryMB,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
    };
  }

  clear(): void {
    this.cache.clear();
  }

  async dispose(): Promise<void> {
    if (this.config.persistToDisk) {
      await this.saveCacheToDisk();
    }
    this.clear();
  }
}

export { CacheManager };
export type { CacheConfig, CacheEntry };
