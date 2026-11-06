/**
 * Records what consumers of mega-search see on a real corpus, for queries
 * sampled from the corpus itself, under each option set the UI can send
 * through be-krang plus the main API modes: per search, the totals, the
 * first page's documents and scores, every snippet's `match@charStart` (what
 * parser-config extraction reads) and how many highlights each result has.
 *
 * Take a snapshot before a change and one after, then diff them with
 * compare.mts: a refactoring or a speed-up should leave every search the
 * same, a behaviour change should differ only where it means to.
 *
 * Snapshots hold document names and text — they're written to the OS temp
 * folder by default, and must never be committed.
 *
 * Usage (from packages/toolkit):
 *   pnpm mega-search:snapshot <corpusDir> [out.json] [--cache <dir>] [--queries <file>]
 *
 *   --cache    where to keep the index (default: a folder of its own in the
 *              OS temp folder, so the corpus folder is left as it is; pass
 *              the corpus' `.cache` to share the app's index instead)
 *   --queries  a text file of extra queries, one per line — e.g. a real list
 *              of names searched in bulk
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

import { INDEX_VERSION } from '../../file-indexer/index-version.mjs';
import { createMegaSearch } from '../../mega-search.mjs';
import type { SearchOptions } from '../../mega-search.types.mjs';
import { searchKey } from './snapshot-format.mjs';
import type { SearchRecord, Snapshot } from './snapshot-format.mjs';

/**
 * What be-krang's DocumentIntelligenceService sends for every query, before
 * the UI's options go on top (document-intelligence-service.mts).
 */
const BE_KRANG_DEFAULTS: SearchOptions = {
  maxTypoDistance: 1,
  isPhraseProximityEnabled: true,
  maxWordsInPhraseDistance: 1,
  snippetsLimit: 'ALL',
  sortBy: 'date',
};

/** The UI's search form as it starts: 10 per page, newest first, fuzzy on. */
const UI_DEFAULTS: SearchOptions = {
  ...BE_KRANG_DEFAULTS,
  pageSize: 10,
  sortOrder: 'desc',
  isInflectedWordFormsAllowed: true,
  maxTypoDistance: 1,
};

/** Every option set searched; `scope` is a part of the corpus (see pickScope). */
const optionSetsFor = (scope: string[]): Record<string, SearchOptions> => ({
  'ui:default': UI_DEFAULTS,
  'ui:fuzzy-off': { ...UI_DEFAULTS, isInflectedWordFormsAllowed: false },
  'ui:typo-0': { ...UI_DEFAULTS, maxTypoDistance: 0 },
  'ui:typo-2-asc': { ...UI_DEFAULTS, maxTypoDistance: 2, sortOrder: 'asc' },
  'ui:scoped': { ...UI_DEFAULTS, searchScopedPaths: scope },
  'ui:find-all': { ...UI_DEFAULTS, pageSize: 'ALL' },
  'api:default': {},
  'api:related-off': { isRelatedWordsAllowed: false },
  'api:adjacent-phrase': {
    isPhraseProximityEnabled: true,
    maxWordsInPhraseDistance: 0,
  },
  'api:highlights-page-2': {
    includeHighlights: true,
    snippetContextBefore: 5,
    snippetContextAfter: 10,
    page: 2,
    pageSize: 5,
  },
  'api:date-pattern-asc': {
    sortBy: 'date',
    sortOrder: 'asc',
    filenameDatePattern: '(\\d{2})\\.(\\d{2})\\.(\\d{4})',
  },
});

/**
 * A part of the corpus to scope searches to: its first subfolder holding
 * documents, or — in a corpus without subfolders — its first ten documents.
 */
function pickScope(relativePaths: string[]): string[] {
  const folder = relativePaths
    .map((file) => path.dirname(file))
    .find((dir) => dir !== '.');
  return folder ? [folder] : relativePaths.slice(0, 10);
}

const LETTER = 'А-ЯІЇЄҐа-яіїєґA-Za-z';
const WORD = `[${LETTER}]{4,}`;
const NAME = "[А-ЯІЇЄҐ][а-яіїєґ'’ʼ]{2,}";

/**
 * Queries sampled from `text`, by group. The same text always gives the
 * same queries, so two snapshots of one corpus ask the same things.
 */
function sampleQueries(text: string): Record<string, string[]> {
  let seed = 42;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const sample = (
    pattern: RegExp,
    count: number,
    toQuery = (match: string) => match,
  ) => {
    const pool = [
      ...new Set([...text.matchAll(pattern)].map((m) => m.slice(1).join(' '))),
    ];
    const picked: string[] = [];
    while (picked.length < count && pool.length > 0) {
      const [match] = pool.splice(Math.floor(random() * pool.length), 1);
      picked.push(toQuery(match));
    }
    return picked;
  };

  return {
    word: sample(new RegExp(`(${WORD})`, 'gu'), 30),
    twoWords: sample(new RegExp(`(${WORD}) (${WORD})`, 'gu'), 30),
    // what bulk name searches look like, as written and in lowercase
    name: sample(new RegExp(`(${NAME}) (${NAME})`, 'gu'), 20),
    nameLowercase: sample(new RegExp(`(${NAME}) (${NAME})`, 'gu'), 10, (q) =>
      q.toLowerCase(),
    ),
    // a number between two words, which phrase search has to bridge
    numberBetween: sample(
      new RegExp(`(${WORD})[ ,]+(?:№ ?)?\\d[\\d./]*[ ,]+(${WORD})`, 'gu'),
      20,
    ),
    // a letter dropped, and two letters swapped
    typo: sample(
      /([А-ЯІЇЄҐа-яіїєґ]{7,})/gu,
      15,
      (w) => w.slice(0, 3) + w.slice(4),
    ),
    swap: sample(
      /([А-ЯІЇЄҐа-яіїєґ]{7,})/gu,
      10,
      (w) => w.slice(0, 2) + w[3] + w[2] + w.slice(4),
    ),
    apostropheOrHyphen: sample(/([а-яіїєґ]+['’ʼ-][а-яіїєґ]+)/gu, 10),
    quoted: sample(
      new RegExp(`(${WORD}) (${WORD})`, 'gu'),
      10,
      (q) => `"${q}"`,
    ),
    number: [
      ...sample(/(\d{2}\.\d{2}\.\d{4})/gu, 10),
      ...sample(/(№ ?\d+(?:\/\d+)?)/gu, 10),
    ],
  };
}

/** The code a snapshot was taken with: its commit, and whether it was edited. */
const gitCommit = (): string => {
  const git = (...args: string[]) =>
    execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  try {
    const commit = git('rev-parse', '--short', 'HEAD');
    const isEdited =
      git('status', '--porcelain', '--untracked-files=no') !== '';
    return isEdited ? `${commit} + uncommitted changes` : commit;
  } catch {
    return 'unknown';
  }
};

/** Where a corpus' snapshot index is kept by default, one folder per corpus. */
const defaultCacheRoot = (corpusDir: string) =>
  path.join(
    os.tmpdir(),
    'mega-search-snapshot-cache',
    createHash('sha1')
      .update(path.resolve(corpusDir))
      .digest('hex')
      .slice(0, 12),
  );

async function takeSnapshot({
  corpusDir,
  cacheRoot = defaultCacheRoot(corpusDir),
  extraQueries = [],
  onProgress = () => {},
}: {
  corpusDir: string;
  cacheRoot?: string;
  extraQueries?: string[];
  onProgress?: (done: number, total: number) => void;
}): Promise<Snapshot> {
  const indexingStart = Date.now();
  const megaSearch = await createMegaSearch({
    rootDirectory: corpusDir,
    cacheRoot,
  });
  const indexingMs = Date.now() - indexingStart;

  const docs = [...megaSearch.indexer.getDocumentCache().values()]
    .map((doc) => doc.metadata)
    .sort((a, b) => a.originalFilePath.localeCompare(b.originalFilePath));
  const relativePath = (file: string) => path.relative(corpusDir, file);
  const text = docs
    .map((doc) =>
      doc.textFilePath && fs.existsSync(doc.textFilePath)
        ? fs.readFileSync(doc.textFilePath, 'utf8')
        : '',
    )
    .join('\n');

  const optionSets = optionSetsFor(
    pickScope(docs.map((doc) => relativePath(doc.originalFilePath))),
  );
  const queryGroups = sampleQueries(text);
  if (extraQueries.length > 0) queryGroups.extra = extraQueries;

  const results: Record<string, SearchRecord> = {};
  const total =
    Object.values(queryGroups).flat().length * Object.keys(optionSets).length;
  const searchingStart = Date.now();
  let done = 0;

  for (const [group, queries] of Object.entries(queryGroups)) {
    for (const query of queries) {
      for (const [optionSet, options] of Object.entries(optionSets)) {
        const searchStart = performance.now();
        const result = await megaSearch.search(query, options);
        results[searchKey(group, query, optionSet)] = {
          total: result.pagination.totalResults,
          page: result.results.map((r) => ({
            doc: relativePath(r.doc.originalFilePath),
            score: Math.round(r.score * 1e6) / 1e6,
            snippets: r.snippets.map((s) => `${s.match}@${s.matchCharStart}`),
            highlights: r.highlights.length,
          })),
          ms: Math.round((performance.now() - searchStart) * 10) / 10,
        };
        onProgress(++done, total);
      }
    }
  }

  return {
    meta: {
      createdAt: new Date().toISOString(),
      commit: gitCommit(),
      indexVersion: INDEX_VERSION,
      documents: docs.length,
      searches: done,
      indexingMs,
      searchingMs: Date.now() - searchingStart,
    },
    results,
  };
}

/** Resolves a path the way the person typing it meant it: from where pnpm ran. */
const fromInvocationDir = (file: string) =>
  path.resolve(process.env.INIT_CWD ?? process.cwd(), file);

async function main(args: string[]): Promise<void> {
  const option = (name: string) => {
    const at = args.indexOf(name);
    if (at < 0) return undefined;
    const [, value] = args.splice(at, 2);
    return value;
  };
  const cacheArg = option('--cache');
  const queriesArg = option('--queries');
  const [corpusArg, outArg] = args;
  if (!corpusArg) {
    console.error(
      'Usage: mega-search:snapshot <corpusDir> [out.json] [--cache <dir>] [--queries <file>]',
    );
    process.exit(1);
  }

  const corpusDir = fromInvocationDir(corpusArg);
  const outPath = outArg
    ? fromInvocationDir(outArg)
    : path.join(os.tmpdir(), `mega-search-snapshot-${Date.now()}.json`);
  const extraQueries = queriesArg
    ? fs
        .readFileSync(fromInvocationDir(queriesArg), 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];

  console.log(`Indexing ${corpusDir}…`);
  const snapshot = await takeSnapshot({
    corpusDir,
    cacheRoot: cacheArg ? fromInvocationDir(cacheArg) : undefined,
    extraQueries,
    onProgress: (done, total) => {
      if (done === 1) console.log(`Searching: ${total} searches…`);
      if (done % 250 === 0 || done === total) {
        console.log(`  ${done}/${total}`);
      }
    },
  });

  fs.writeFileSync(outPath, JSON.stringify(snapshot));
  const { documents, searches, indexingMs, searchingMs } = snapshot.meta;
  console.log(
    `${documents} documents indexed in ${(indexingMs / 1000).toFixed(1)}s, ` +
      `${searches} searches in ${(searchingMs / 1000).toFixed(1)}s → ${outPath}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { takeSnapshot };
