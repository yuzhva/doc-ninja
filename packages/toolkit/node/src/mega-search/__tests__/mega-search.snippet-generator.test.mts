import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SnippetGenerator } from '../mega-search.snippet-generator.mjs';
import type { SnippetInfo } from '../mega-search.types.mjs';
import {
  buildDocumentIndex,
  buildSearchData,
  stemQuery,
} from '../test-utils/in-memory-index.mjs';
import type { SearchData } from '../test-utils/in-memory-index.mjs';
import { knownBug } from '../test-utils/known-bug.mjs';
import { UkrainianTextProcessor } from '../text-processor.mjs';

const DOCS = {
  'apostrophe.txt': "Об'єкт прийнято. Отримано П'ять примірників.",
  'sentences.txt':
    'Перше речення без збігу. Бюджет міста затверджено радою! Наступне речення теж без збігу.',
  // речення0 збігу1 бюджет2 міста3 затверджено4 радою5 наступне6 речення7 теж8 збігу9
  'repeat.txt': 'The car hit another car.',
  'typo.txt': 'Rech car spotted.',
  'orders.txt':
    'Начальник управління підписав наказ. Наказ начальника управління.',
};

const highlightedSpans = (context: string) =>
  [...context.matchAll(/<b>(.*?)<\/b>/g)].map((m) => m[1]);

describe('SnippetGenerator', () => {
  const generator = new SnippetGenerator(new UkrainianTextProcessor());
  let rawTextDir: string;
  let data: SearchData;

  before(async () => {
    rawTextDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'mega-search-snippets-'),
    );
    data = await buildSearchData(DOCS, { rawTextDir });
  });

  after(() => fs.promises.rm(rawTextDir, { recursive: true, force: true }));

  const tokenSnippets = (
    docId: string,
    query: string,
    { contextBefore = 0, contextAfter = 30 } = {},
  ) =>
    generator.generateSnippets(
      data.docCache.get(docId)!,
      stemQuery(query),
      data.invertedIndex,
      false,
      true,
      undefined,
      contextBefore,
      contextAfter,
    );

  const phraseSnippets = (
    docId: string,
    query: string,
    positions: number[][] | undefined,
    isTypoToleranceEnabled = true,
  ) =>
    generator.generateSnippets(
      data.docCache.get(docId)!,
      stemQuery(query),
      data.invertedIndex,
      true,
      isTypoToleranceEnabled,
      positions,
      0,
      30,
    );

  describe('token snippets', () => {
    it('renders context from the raw text, keeping casing and apostrophes', async () => {
      // Regression guard for 481a194c: snippets used to be rebuilt from
      // normalized vocab, which lost the apostrophe in «П'ять».
      const [snippet] = await tokenSnippets('apostrophe.txt', "п'ять");

      assert.equal(snippet.match, "П'ять");
      assert.equal(snippet.context, "<b>П'ять</b> примірників...");
      assert.equal(snippet.matchType, 'token');
      assert.equal(snippet.confidence, 1);
    });

    it('reports offsets that locate the match in the raw text', async () => {
      const raw = DOCS['apostrophe.txt'];
      const [snippet] = await tokenSnippets('apostrophe.txt', "п'ять");

      assert.equal(
        raw.slice(snippet.matchCharStart, snippet.matchCharEnd),
        snippet.match,
      );
      assert.deepEqual(snippet.highlights, [
        {
          term: stemQuery("п'ять")[0],
          originalWord: 'пять',
          tokenIndex: snippet.matchStartTokenIndex,
          charStart: snippet.matchCharStart,
          charEnd: snippet.matchCharEnd,
        },
      ]);
    });

    it('stays inside the sentence that contains the match', async () => {
      const [snippet] = await tokenSnippets('sentences.txt', 'бюджет', {
        contextBefore: 5,
      });

      assert.equal(snippet.context, '<b>Бюджет</b> міста затверджено радою...');
    });

    it('adds up to contextBefore tokens from the same sentence', async () => {
      const [snippet] = await tokenSnippets('sentences.txt', 'затверджено', {
        contextBefore: 2,
      });

      assert.equal(snippet.context, 'Бюджет міста <b>затверджено</b> радою...');
    });

    it('highlights exactly its own match, by offset', async () => {
      const raw = DOCS['repeat.txt'];
      const snippets = await tokenSnippets('repeat.txt', 'car');

      assert.equal(snippets.length, 2);
      for (const snippet of snippets) {
        assert.deepEqual(highlightedSpans(snippet.context), [
          raw.slice(snippet.matchCharStart, snippet.matchCharEnd),
        ]);
      }
    });

    it('returns no snippets when no document token has the query stem', async () => {
      assert.deepEqual(await tokenSnippets('repeat.txt', 'bicycle'), []);
    });

    describe('without a readable raw text cache', () => {
      const docWithoutRawText = (text: string) =>
        buildDocumentIndex('no-raw.txt', text, {
          textFilePath: path.join(os.tmpdir(), 'mega-search-missing.txt'),
        });

      const fallbackSnippets = (text: string, query: string) =>
        generator.generateSnippets(
          docWithoutRawText(text),
          stemQuery(query),
          new Map(),
          false,
          true,
          undefined,
          0,
          30,
        );

      it('falls back to joining the normalized vocabulary', async () => {
        const [snippet] = await fallbackSnippets(
          'The Car hit another car.',
          'car',
        );

        assert.equal(snippet.match, 'car');
        assert.equal(
          snippet.context.replace(/<\/?b>/g, ''),
          'car hit another car...',
        );
      });

      it(
        'still highlights Cyrillic words',
        knownBug(
          'the fallback highlighter wraps terms in \\b…\\b, and JavaScript word boundaries ' +
            'only know ASCII letters, so Cyrillic matches are never wrapped in <b>',
        ),
        async () => {
          const [snippet] = await fallbackSnippets('Бюджет міста.', 'бюджет');

          assert.deepEqual(highlightedSpans(snippet.context), ['бюджет']);
        },
      );
    });
  });

  describe('phrase snippets', () => {
    it('builds one fuzzy-phrase snippet per matched sequence', async () => {
      const snippets = await phraseSnippets(
        'orders.txt',
        'начальник управління',
        [
          [0, 1],
          [5, 6],
        ],
      );

      assert.deepEqual(
        snippets.map((s: SnippetInfo) => [s.matchType, s.match]),
        [
          ['fuzzy-phrase', 'Начальник управління'],
          ['fuzzy-phrase', 'начальника управління'],
        ],
      );
      assert.deepEqual(highlightedSpans(snippets[0].context), [
        'Начальник',
        'управління',
      ]);
      assert.deepEqual(
        snippets[0].highlights.map((h) => h.tokenIndex),
        [0, 1],
      );
    });

    it('lowers fuzzy-phrase confidence by the total edit distance', async () => {
      const [snippet] = await phraseSnippets('typo.txt', 'rich car', [[0, 1]]);

      // one edit ("rech" vs "rich") over a 2-word phrase: 1 - 1 / (2 * 3)
      assert.equal(snippet.confidence, 1 - 1 / 6);
    });

    it('labels strict matches as exact-phrase with full confidence', async () => {
      const [snippet] = await phraseSnippets('repeat.txt', 'car', [[0]], false);

      assert.equal(snippet.matchType, 'exact-phrase');
      assert.equal(snippet.confidence, 1);
    });

    it('needs match positions — without them there is nothing to render', async () => {
      // MegaSearch only passes positions for proximity searches; see the
      // quoted-phrase snippet known bug in mega-search.test.mts.
      assert.deepEqual(
        await phraseSnippets('orders.txt', 'начальник управління', undefined),
        [],
      );
    });

    it('skips sequences whose length does not match the phrase', async () => {
      assert.deepEqual(
        await phraseSnippets('orders.txt', 'начальник управління', [[0]]),
        [],
      );
    });
  });

  describe('generateHighlights()', () => {
    it('lists every occurrence of a query stem with raw char offsets', () => {
      const raw = DOCS['orders.txt'];
      const highlights = generator.generateHighlights(
        'orders.txt',
        data.docCache.get('orders.txt')!,
        stemQuery('управління'),
        false,
        true,
      );

      assert.equal(highlights.length, 2);
      for (const highlight of highlights) {
        assert.equal(
          raw.slice(highlight.charStart, highlight.charEnd),
          'управління',
        );
        assert.equal(highlight.confidence, 1);
      }
    });

    it('in fuzzy-phrase mode, also scores near words (up to 2 edits)', () => {
      const [highlight] = generator.generateHighlights(
        'typo.txt',
        data.docCache.get('typo.txt')!,
        stemQuery('rich'),
        true,
        true,
      );

      assert.equal(highlight.originalWord, 'rech');
      assert.equal(highlight.confidence, 0.8);
    });
  });
});
