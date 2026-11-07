import { createMegaSearch } from '../mega-search.mjs';
import type { MegaSearch } from '../mega-search.mjs';
import type { PaginatedSearchResult } from '../mega-search.types.mjs';
import type { SearchConfig } from '../types.mjs';
import { createTempCorpus } from './temp-corpus.mjs';
import type { TempCorpus } from './temp-corpus.mjs';

type SearchFixture = {
  corpus: TempCorpus;
  megaSearch: MegaSearch;
  /** Config the instance was created with — reuse it for a "second app start". */
  config: Partial<SearchConfig>;
  cleanup: () => Promise<void>;
};

/**
 * A temp corpus on disk plus a fully initialized MegaSearch over it — the same
 * path production takes (createMegaSearch → buildFullIndex → search).
 * Indexes `.txt` only unless `extensions` is overridden.
 */
async function createSearchFixture(
  files: Record<string, string>,
  configOverrides: Partial<SearchConfig> = {},
): Promise<SearchFixture> {
  const corpus = await createTempCorpus(files);
  const config: Partial<SearchConfig> = {
    rootDirectory: corpus.root,
    extensions: ['.txt'],
    ...configOverrides,
  };
  const megaSearch = await createMegaSearch(config);

  return { corpus, megaSearch, config, cleanup: corpus.cleanup };
}

/** File names of a result page, in result order. */
const fileNames = (result: PaginatedSearchResult): string[] =>
  result.results.map((r) => r.doc.fileName);

export { createSearchFixture, fileNames };
export type { SearchFixture };
