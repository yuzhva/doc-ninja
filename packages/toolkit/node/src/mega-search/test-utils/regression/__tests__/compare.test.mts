import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareSnapshots, formatComparison } from '../compare.mjs';
import { searchKey } from '../snapshot-format.mjs';
import type { SearchRecord, Snapshot } from '../snapshot-format.mjs';

const record = (overrides: Partial<SearchRecord> = {}): SearchRecord => ({
  total: 1,
  page: [{ doc: 'a.txt', score: 1.5, snippets: ['Наказ@0'], highlights: 1 }],
  ms: 10,
  ...overrides,
});

const entry = (overrides: Partial<SearchRecord['page'][number]>) => ({
  ...record().page[0],
  ...overrides,
});

const snapshotOf = (results: Record<string, SearchRecord>): Snapshot => ({
  meta: {
    createdAt: '2026-11-06T00:00:00.000Z',
    commit: 'test',
    indexVersion: 3,
    documents: 1,
    searches: Object.keys(results).length,
    indexingMs: 0,
    searchingMs: 0,
  },
  results,
});

/** The same search, changed in one way after — keyed by that change. */
const CHANGES: Record<string, [before: SearchRecord, after: SearchRecord]> = {
  same: [record(), record({ ms: 99 })],
  fewer: [record(), record({ total: 0, page: [] })],
  more: [
    record(),
    record({ total: 2, page: [entry({}), entry({ doc: 'b.txt' })] }),
  ],
  'order≠': [record(), record({ page: [entry({ doc: 'b.txt' })] })],
  'scores≠': [record(), record({ page: [entry({ score: 1.6 })] })],
  'snippets≠': [record(), record({ page: [entry({ snippets: ['Наказ@7'] })] })],
  'highlights≠': [record(), record({ page: [entry({ highlights: 2 })] })],
};

const pairOf = (changes: Record<string, [SearchRecord, SearchRecord]>) => {
  const before: Record<string, SearchRecord> = {};
  const after: Record<string, SearchRecord> = {};
  for (const [change, [a, b]] of Object.entries(changes)) {
    before[searchKey('word', change, 'ui:default')] = a;
    after[searchKey('word', change, 'ui:default')] = b;
  }
  return [snapshotOf(before), snapshotOf(after)] as const;
};

describe('compareSnapshots()', () => {
  it('sorts each search by its most visible change', () => {
    const { counts, examples } = compareSnapshots(...pairOf(CHANGES));

    const expected = Object.fromEntries(
      Object.keys(CHANGES).map((change) => [change, 1]),
    );
    assert.deepEqual(counts.get('ui:default'), expected);
    assert.deepEqual(counts.get('group:word'), expected);
    assert.equal(examples.length, Object.keys(CHANGES).length - 1);
  });

  it('counts searches "after" lacks, and adds up search time per option set', () => {
    const [before, after] = pairOf({ same: CHANGES.same });
    before.results[searchKey('word', 'наказ', 'ui:default')] = record();

    const { missing, timing } = compareSnapshots(before, after);

    assert.equal(missing, 1);
    assert.deepEqual(timing.get('ui:default'), { before: 10, after: 99 });
  });

  it('shows where the first page starts to differ', () => {
    const [before, after] = pairOf({ 'snippets≠': CHANGES['snippets≠'] });

    const report = formatComparison(
      before,
      after,
      compareSnapshots(before, after),
    );

    assert.match(report, /#1 before \[Наказ@0\]/);
    assert.match(report, /#1 after {2}\[Наказ@7\]/);
  });
});
