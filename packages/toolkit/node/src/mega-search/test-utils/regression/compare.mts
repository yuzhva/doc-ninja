/**
 * Diffs two snapshots (see snapshot.mts): per option set and per query
 * group, how many searches are the same, find fewer or more documents, rank
 * the first page differently, score it differently, or return other snippets
 * or highlights — then examples of each difference, and how long searching
 * took in each.
 *
 * Usage (from packages/toolkit):
 *   pnpm mega-search:compare <before.json> <after.json> [maxExamples=40]
 */
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

import { parseSearchKey } from './snapshot-format.mjs';
import type { SearchRecord, Snapshot } from './snapshot-format.mjs';

/** What changed in a search, the most visible change first. */
const KINDS = [
  'fewer',
  'more',
  'order≠',
  'scores≠',
  'snippets≠',
  'highlights≠',
  'same',
] as const;
type Kind = (typeof KINDS)[number];
type Counts = Record<Kind, number>;

/** The least search time, in ms, a change in it is reported for. */
const MIN_MS_FOR_CHANGE = 100;

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

function classify(before: SearchRecord, after: SearchRecord): Kind {
  if (after.total < before.total) return 'fewer';
  if (after.total > before.total) return 'more';
  const pageOf = (
    record: SearchRecord,
    field: 'doc' | 'score' | 'snippets' | 'highlights',
  ) => record.page.map((entry) => entry[field]);
  if (!same(pageOf(before, 'doc'), pageOf(after, 'doc'))) return 'order≠';
  if (!same(pageOf(before, 'score'), pageOf(after, 'score'))) return 'scores≠';
  if (!same(pageOf(before, 'snippets'), pageOf(after, 'snippets'))) {
    return 'snippets≠';
  }
  if (!same(pageOf(before, 'highlights'), pageOf(after, 'highlights'))) {
    return 'highlights≠';
  }
  return 'same';
}

type Comparison = {
  /** Option set or `group:<name>` → how many searches changed which way. */
  counts: Map<string, Counts>;
  /** One line (or a few) per search that isn't the same. */
  examples: string[];
  /** Searches of `before` that `after` doesn't have. */
  missing: number;
  /** Option set → total search time before and after, in ms. */
  timing: Map<string, { before: number; after: number }>;
};

function compareSnapshots(before: Snapshot, after: Snapshot): Comparison {
  const counts = new Map<string, Counts>();
  const timing = new Map<string, { before: number; after: number }>();
  const examples: string[] = [];
  let missing = 0;

  for (const [key, a] of Object.entries(before.results)) {
    const b = after.results[key];
    if (!b) {
      missing++;
      continue;
    }
    const { group, query, optionSet } = parseSearchKey(key);
    const kind = classify(a, b);

    for (const row of [optionSet, `group:${group}`]) {
      const rowCounts =
        counts.get(row) ??
        (Object.fromEntries(KINDS.map((k) => [k, 0])) as Counts);
      rowCounts[kind]++;
      counts.set(row, rowCounts);
    }
    const time = timing.get(optionSet) ?? { before: 0, after: 0 };
    time.before += a.ms;
    time.after += b.ms;
    timing.set(optionSet, time);

    if (kind === 'same') continue;
    let example = `${kind.padEnd(12)} ${optionSet.padEnd(22)} ${group.padEnd(18)} ${JSON.stringify(query)}  total ${a.total}→${b.total}`;
    const at = a.page.findIndex((entry, i) => !same(entry, b.page[i]));
    if (at >= 0 && kind !== 'fewer' && kind !== 'more') {
      const show = (entry?: SearchRecord['page'][number]) =>
        kind === 'snippets≠'
          ? `[${entry?.snippets.slice(0, 4).join(', ')}]`
          : kind === 'highlights≠'
            ? String(entry?.highlights)
            : `${entry?.doc} (${entry?.score})`;
      const indent = ' '.repeat(14);
      example += `\n${indent}#${at + 1} before ${show(a.page[at])}\n${indent}#${at + 1} after  ${show(b.page[at])}`;
    }
    examples.push(example);
  }

  return { counts, examples, missing, timing };
}

function formatComparison(
  before: Snapshot,
  after: Snapshot,
  { counts, examples, missing, timing }: Comparison,
  maxExamples = 40,
): string {
  const lines = [
    `before: ${JSON.stringify(before.meta)}`,
    `after:  ${JSON.stringify(after.meta)}`,
    '',
    `${''.padEnd(28)}${KINDS.map((k) => k.padStart(12)).join('')}`,
  ];
  const rows = [...counts].sort(
    ([a], [b]) =>
      Number(a.startsWith('group:')) - Number(b.startsWith('group:')),
  );
  for (const [row, rowCounts] of rows) {
    lines.push(
      `${row.padEnd(28)}${KINDS.map((k) => String(rowCounts[k]).padStart(12)).join('')}`,
    );
  }
  if (missing > 0) {
    lines.push('', `${missing} searches of "before" are missing from "after"`);
  }

  lines.push('', 'search time (ms)            before       after');
  for (const [optionSet, time] of timing) {
    // Below that, a run's noise outweighs any change
    const change =
      time.before >= MIN_MS_FOR_CHANGE
        ? ` (${time.after >= time.before ? '+' : ''}${Math.round(((time.after - time.before) / time.before) * 100)}%)`
        : '';
    lines.push(
      `${optionSet.padEnd(28)}${String(Math.round(time.before)).padStart(6)}${String(Math.round(time.after)).padStart(12)}${change}`,
    );
  }

  lines.push(
    '',
    `${examples.length} searches not the same${examples.length > maxExamples ? ` (first ${maxExamples})` : ''}:`,
    ...examples.slice(0, maxExamples),
  );
  return lines.join('\n');
}

function main([beforeArg, afterArg, maxExamplesArg = '40']: string[]): void {
  if (!beforeArg || !afterArg) {
    console.error(
      'Usage: mega-search:compare <before.json> <after.json> [maxExamples=40]',
    );
    process.exit(1);
  }
  const read = (file: string): Snapshot =>
    JSON.parse(
      fs.readFileSync(
        path.resolve(process.env.INIT_CWD ?? process.cwd(), file),
        'utf8',
      ),
    );
  const before = read(beforeArg);
  const after = read(afterArg);
  console.log(
    formatComparison(
      before,
      after,
      compareSnapshots(before, after),
      Number(maxExamplesArg),
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2));
}

export { compareSnapshots, formatComparison };
export type { Comparison };
