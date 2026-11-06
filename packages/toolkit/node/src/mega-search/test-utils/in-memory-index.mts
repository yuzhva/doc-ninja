import fs from 'node:fs';
import path from 'node:path';

import { IndexBuilder } from '../file-indexer/index-builder.mjs';
import { InvertedIndex } from '../file-indexer/inverted-index.mjs';
import { createLogger } from '../shared/logger.mjs';
import {
  UkrainianTextProcessor,
  findJoints,
  isNumberTerm,
} from '../text-processor.mjs';
import { TokenPositions } from '../token-positions.mjs';
import type {
  DocumentIndex,
  DocumentMetadata,
  SearchConfig,
  SearchSnapshot,
} from '../types.mjs';

/** The three structures MegaSearch reads from FileIndexer.getSearchSnapshot(). */
type SearchData = Pick<SearchSnapshot, 'invertedIndex' | 'stemDictionary'> & {
  docCache: Map<string, DocumentIndex>;
};

const textProcessor = new UkrainianTextProcessor();

/**
 * Encodes text the way DocumentProcessor.indexDocumentInternal does
 * (deduplicated vocab + [vocabIndex, charStart, charEnd] positions + joints +
 * stemmed term frequencies), minus the disk I/O and extraction.
 */
function buildDocumentIndex(
  docId: string,
  text: string,
  metadata: Partial<DocumentMetadata> = {},
): DocumentIndex {
  const vocab: string[] = [];
  const vocabIndexByTerm = new Map<string, number>();
  const positions: number[] = []; // vocabIndex, charStart, charEnd each
  const termFrequency = new Map<string, number>();
  const tokens = textProcessor.tokenize(text);

  for (const token of tokens) {
    let vocabIndex = vocabIndexByTerm.get(token.term);
    if (vocabIndex === undefined) {
      vocabIndex = vocab.length;
      vocab.push(token.term);
      vocabIndexByTerm.set(token.term, vocabIndex);
    }
    positions.push(vocabIndex, token.charStart, token.charEnd);

    const stem = textProcessor.stemWord(token.normalized);
    termFrequency.set(stem, (termFrequency.get(stem) ?? 0) + 1);
  }

  return {
    metadata: {
      fileName: path.basename(docId),
      originalFilePath: docId,
      lastModified: 0,
      size: text.length,
      indexed: true,
      language: textProcessor.detectLanguage(text),
      ...metadata,
    },
    vocab,
    positions: TokenPositions.fromFlat(positions),
    joints: findJoints(text, tokens),
    termFrequency,
    wordCount: tokens.filter((token) => !isNumberTerm(token.term)).length,
  };
}

/**
 * Builds search data entirely in memory, using the real tokenizer and the real
 * IndexBuilder — so unit tests of PhraseMatcher/SnippetGenerator run against
 * production-shaped indexes without creating a MegaSearch.
 *
 * Pass `rawTextDir` to also write each text to `<rawTextDir>/<docId>` and point
 * `metadata.textFilePath` at it; SnippetGenerator reads that file to render
 * snippets from the raw (un-normalized) text. Without it, snippets fall back
 * to joining normalized vocab.
 */
async function buildSearchData(
  docs: Record<string, string>,
  { rawTextDir }: { rawTextDir?: string } = {},
): Promise<SearchData> {
  const docCache = new Map<string, DocumentIndex>();

  for (const [docId, text] of Object.entries(docs)) {
    let textFilePath: string | undefined;
    if (rawTextDir) {
      textFilePath = path.join(rawTextDir, docId);
      await fs.promises.writeFile(textFilePath, text, 'utf8');
    }
    docCache.set(docId, buildDocumentIndex(docId, text, { textFilePath }));
  }

  const invertedIndex = new InvertedIndex();
  const stemDictionary = new Map<string, Set<string>>();
  const builderConfig: SearchConfig = {
    rootDirectory: '',
    extensions: [],
    maxFileSize: Infinity,
    concurrency: 1,
  };
  await new IndexBuilder(
    builderConfig,
    createLogger('test:in-memory-index'),
  ).updateInvertedIndexBatch(docCache, invertedIndex, stemDictionary);

  return { docCache, invertedIndex, stemDictionary };
}

/** Tokenizes + stems a query exactly like MegaSearch's typo-tolerant path. */
function stemQuery(query: string): string[] {
  return textProcessor
    .tokenize(query)
    .map((token) => textProcessor.stemWord(token.term));
}

export { buildDocumentIndex, buildSearchData, stemQuery };
export type { SearchData };
