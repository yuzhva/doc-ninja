/**
 * The snapshot file format, shared by snapshot.mts and compare.mts — on its
 * own, so comparing two snapshots doesn't load the search engine.
 */

/** One search as consumers see it. */
type SearchRecord = {
  total: number;
  page: Array<{
    doc: string;
    score: number;
    /** `match@charStart` per snippet: what parser-config extraction reads. */
    snippets: string[];
    highlights: number;
  }>;
  /** How long the search took, in milliseconds. */
  ms: number;
};

type Snapshot = {
  meta: {
    createdAt: string;
    /** The commit the snapshot was taken with, and whether it was edited. */
    commit: string;
    indexVersion: number;
    documents: number;
    searches: number;
    indexingMs: number;
    searchingMs: number;
  };
  /** Search key (see searchKey) → what it returned. */
  results: Record<string, SearchRecord>;
};

/** One key per query group, query and option set. */
const searchKey = (group: string, query: string, optionSet: string) =>
  [group, query, optionSet].join('\u0000');

const parseSearchKey = (key: string) => {
  const [group, query, optionSet] = key.split('\u0000');
  return { group, query, optionSet };
};

export { parseSearchKey, searchKey };
export type { SearchRecord, Snapshot };
