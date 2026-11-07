import type {
  DocumentFilter,
  InvertedIndexEntry,
  PostingsReader,
} from '../types.mjs';

/**
 * A memory-efficient implementation of Inverted Index.
 * Uses integer Document IDs and flat arrays to reduce memory footprint.
 * Replaces Map<string, InvertedIndexEntry[]> which has high object overhead.
 *
 * Searches read it in place, so an index searches can read is never changed:
 * an update changes a fork() of it, and the fork goes in whole.
 */
export class InvertedIndex implements PostingsReader {
  // Stores flat list of integers: [docId, freq, pos1, pos2, ..., docId, freq, ...]
  private index = new Map<string, number[]>();
  /**
   * The lists this index made. The others it shares with the index it was
   * forked from, which searches may still read: they're copied before a
   * change.
   */
  private ownLists = new WeakSet<number[]>();

  // Document Registry for integer ID mapping
  private docIdMap = new Map<string, number>();
  private idDocMap: string[] = [];

  constructor() {}

  clear() {
    this.index = new Map();
    this.docIdMap = new Map();
    this.idDocMap = [];
  }

  /**
   * A copy to change while searches read this one. It shares every term's
   * list with this index and copies a list only to change it, so it costs
   * one entry per term, not the postings.
   */
  fork(): InvertedIndex {
    const fork = new InvertedIndex();
    fork.index = new Map(this.index);
    fork.docIdMap = new Map(this.docIdMap);
    fork.idDocMap = [...this.idDocMap];
    return fork;
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
    if (!list || !this.ownLists.has(list)) {
      list = list ? [...list] : [];
      this.ownLists.add(list);
      this.index.set(term, list);
    }

    list.push(docId);
    list.push(freq);
    for (const pos of positions) {
      list.push(pos);
    }
  }

  /**
   * Removes every posting of the given documents, and the terms no document
   * holds any more. One pass over the index, in memory. A document keeps its
   * integer id, so adding it back reuses it.
   * @returns the removed terms
   */
  removeDocuments(docPaths: Iterable<string>): string[] {
    const docIds = new Set<number>();
    for (const docPath of docPaths) {
      const docId = this.docIdMap.get(docPath);
      if (docId !== undefined) docIds.add(docId);
    }
    if (docIds.size === 0) return [];

    const removedTerms: string[] = [];
    for (const [term, list] of this.index) {
      // [docId, freq, ...positions] per document; copied only once a
      // posting to drop shows up
      let kept: number[] | null = null;
      for (let i = 0; i < list.length;) {
        const end = i + 2 + list[i + 1];
        if (docIds.has(list[i])) {
          kept ??= list.slice(0, i);
        } else if (kept) {
          for (let j = i; j < end; j++) kept.push(list[j]);
        }
        i = end;
      }

      if (!kept) continue;
      if (kept.length === 0) {
        this.index.delete(term);
        removedTerms.push(term);
      } else {
        this.ownLists.add(kept);
        this.index.set(term, kept);
      }
    }
    return removedTerms;
  }

  /**
   * The term's postings, decoded: of every document holding it, or of those
   * in `documents` only — a search in a few folders of many reads only theirs.
   */
  get(
    term: string,
    documents?: DocumentFilter,
  ): InvertedIndexEntry[] | undefined {
    const list = this.index.get(term);
    if (!list) return undefined;

    const entries: InvertedIndexEntry[] = [];
    let i = 0;
    while (i < list.length) {
      const docId = list[i++];
      const freq = list[i++];
      if (documents && !documents.has(this.idDocMap[docId])) {
        i += freq;
        continue;
      }
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

  /**
   * How many documents hold at least one of the terms, of all indexed:
   * counted from the postings, with no positions decoded.
   */
  countDocuments(terms: Iterable<string>): number {
    const lists: number[][] = [];
    for (const term of terms) {
      const list = this.index.get(term);
      if (list) lists.push(list);
    }

    // [docId, freq, ...positions] per document; a document is in a term's
    // list once, but may be in several lists
    const docIds = new Set<number>();
    let count = 0;
    for (const list of lists) {
      for (let i = 0; i < list.length; i += 2 + list[i + 1]) {
        if (lists.length === 1) count++;
        else docIds.add(list[i]);
      }
    }
    return lists.length === 1 ? count : docIds.size;
  }

  /**
   * Delete a term from the index.
   */
  delete(term: string): boolean {
    return this.index.delete(term);
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
