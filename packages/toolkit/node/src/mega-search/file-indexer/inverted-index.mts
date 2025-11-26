import { InvertedIndexEntry } from '../types.mjs';

/**
 * A memory-efficient implementation of Inverted Index.
 * Uses integer Document IDs and flat arrays to reduce memory footprint.
 * Replaces Map<string, InvertedIndexEntry[]> which has high object overhead.
 */
export class InvertedIndex {
  // Stores flat list of integers: [docId, freq, pos1, pos2, ..., docId, freq, ...]
  private index = new Map<string, number[]>();

  // Document Registry for integer ID mapping
  private docIdMap = new Map<string, number>();
  private idDocMap: string[] = [];

  constructor() {}

  clear() {
    this.index.clear();
    this.docIdMap.clear();
    this.idDocMap = [];
  }

  get size() {
    return this.index.size;
  }

  private getDocId(path: string): number {
    let id = this.docIdMap.get(path);
    if (id === undefined) {
      id = this.idDocMap.length;
      this.idDocMap.push(path);
      this.docIdMap.set(path, id);
    }
    return id;
  }

  addEntry(term: string, docPath: string, positions: number[]) {
    const docId = this.getDocId(docPath);
    const freq = positions.length;

    let list = this.index.get(term);
    if (!list) {
      list = [];
      this.index.set(term, list);
    }

    list.push(docId);
    list.push(freq);
    for (const pos of positions) {
      list.push(pos);
    }
  }

  get(term: string): InvertedIndexEntry[] | undefined {
    const list = this.index.get(term);
    if (!list) return undefined;

    const entries: InvertedIndexEntry[] = [];
    let i = 0;
    while (i < list.length) {
      const docId = list[i++];
      const freq = list[i++];
      const positions: number[] = [];
      for (let j = 0; j < freq; j++) {
        positions.push(list[i++]);
      }

      entries.push({
        documentId: this.idDocMap[docId],
        frequency: freq,
        positions,
      });
    }
    return entries;
  }

  has(term: string): boolean {
    return this.index.has(term);
  }

  forEach(callback: (value: InvertedIndexEntry[], key: string) => void) {
    for (const [term, _] of this.index) {
      const entries = this.get(term);
      if (entries) callback(entries, term);
    }
  }

  // For serialization
  getRawIndex() {
    return this.index;
  }

  getDocMapping() {
    return this.idDocMap;
  }

  // Restore from raw data
  restore(rawIndex: Map<string, number[]>, docMapping: string[]) {
    this.index = rawIndex;
    this.idDocMap = docMapping;
    this.docIdMap.clear();
    docMapping.forEach((path, id) => this.docIdMap.set(path, id));
  }

  // Legacy compatibility
  toLegacyMap(): Map<string, InvertedIndexEntry[]> {
    const map = new Map<string, InvertedIndexEntry[]>();
    this.forEach((entries, term) => {
      map.set(term, entries);
    });
    return map;
  }
}
