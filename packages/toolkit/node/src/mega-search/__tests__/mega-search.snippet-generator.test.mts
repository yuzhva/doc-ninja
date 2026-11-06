import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SnippetGenerator } from '../mega-search.snippet-generator.mjs';
import {
  TermMatcher,
  mergeMatchedWords,
} from '../mega-search.term-matcher.mjs';
import type { TermMatchOptions } from '../mega-search.term-matcher.mjs';
import type { SnippetInfo } from '../mega-search.types.mjs';
import {
  buildDocumentIndex,
  buildSearchData,
  stemQuery,
} from '../test-utils/in-memory-index.mjs';
import type { SearchData } from '../test-utils/in-memory-index.mjs';
import { UkrainianTextProcessor } from '../text-processor.mjs';

const textProcessor = new UkrainianTextProcessor();
const termMatcher = new TermMatcher(textProcessor);

const DOCS = {
  'apostrophe.txt': "Об'єкт прийнято. Отримано П'ять примірників.",
  'sentences.txt':
    'Перше речення без збігу. Бюджет міста затверджено радою! Наступне речення теж без збігу.',
  // речення0 збігу1 бюджет2 міста3 затверджено4 радою5 наступне6 речення7 теж8 збігу9
  'repeat.txt': 'The car hit another car.',
  'typo.txt': 'Rech car spotted.',
  'orders.txt':
    'Начальник управління підписав наказ. Наказ начальника управління.',
  'repeated.txt': 'Оплатити рахунок. Оплатити рахунок. Оплатити рахунок.',
  // оплатити0 рахунок1 оплатити2 рахунок3 оплатити4 рахунок5
};

/** Where each occurrence of `word` starts in `text`. */
const offsetsOf = (text: string, word: string) =>
  [...text.matchAll(new RegExp(word, 'g'))].map((m) => m.index);

const highlightedSpans = (context: string) =>
  [...context.matchAll(/<b>(.*?)<\/b>/g)].map((m) => m[1]);

describe('SnippetGenerator', () => {
  const generator = new SnippetGenerator();
  let rawTextDir: string;
  let data: SearchData;

  before(async () => {
    rawTextDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'mega-search-snippets-'),
    );
    data = await buildSearchData(DOCS, { rawTextDir });
  });

  after(() => fs.promises.rm(rawTextDir, { recursive: true, force: true }));

  /** What MegaSearch hands the generator for a query: tokens + matched words. */
  const matchQuery = (
    query: string,
    {
      isFuzzy = true,
      isRelatedWordsAllowed = true,
      maxTypoDistance = 1,
    }: Partial<TermMatchOptions> = {},
  ) => {
    const words = textProcessor
      .tokenize(query)
      .map((token) =>
        termMatcher.match(
          token.term,
          { isFuzzy, isRelatedWordsAllowed, maxTypoDistance },
          data,
        ),
      );
    return {
      queryTokens: words.map((word) => word.queryToken),
      matchedWords: mergeMatchedWords(words),
      isFuzzy,
    };
  };

  const tokenSnippets = (
    docId: string,
    query: string,
    {
      contextBefore = 0,
      contextAfter = 30,
      ...matchOptions
    }: Partial<TermMatchOptions> & {
      contextBefore?: number;
      contextAfter?: number;
    } = {},
  ) =>
    generator.generateSnippets(data.docCache.get(docId)!, {
      ...matchQuery(query, matchOptions),
      isPhrase: false,
      contextBefore,
      contextAfter,
    });

  const phraseSnippets = (
    docId: string,
    query: string,
    phraseSequences: number[][] | undefined,
    isFuzzy = true,
  ) =>
    generator.generateSnippets(data.docCache.get(docId)!, {
      ...matchQuery(query, { isFuzzy }),
      isPhrase: true,
      phraseSequences,
      contextBefore: 0,
      contextAfter: 30,
    });

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

    it('gives the same text at each place a snippet of its own', async () => {
      const snippets = await tokenSnippets('repeated.txt', 'рахунок');

      assert.deepEqual(
        snippets.map((s) => s.matchCharStart),
        offsetsOf(DOCS['repeated.txt'], 'рахунок'),
      );
    });

    it('returns no snippets when no document word matched', async () => {
      assert.deepEqual(await tokenSnippets('repeat.txt', 'bicycle'), []);
    });

    it('reports a typo match as the query token, at lower confidence', async () => {
      const snippets = await tokenSnippets('orders.txt', 'упрвління');

      assert.deepEqual(
        snippets.map((s) => s.match),
        ['управління', 'управління'],
      );
      assert.equal(snippets[0].highlights[0].term, stemQuery('упрвління')[0]);
      // one edit over the 10 letters of "управління"
      assert.equal(snippets[0].confidence, 1 - 1 / 10);
    });

    it('without fuzzy match, renders only the form typed', async () => {
      const snippets = await tokenSnippets('orders.txt', 'начальника', {
        isFuzzy: false,
      });

      assert.deepEqual(
        snippets.map((s) => [s.match, s.highlights[0].term, s.confidence]),
        [['начальника', 'начальника', 1]],
      );
    });

    describe('without a readable raw text cache', () => {
      const docWithoutRawText = (text: string) =>
        buildDocumentIndex('no-raw.txt', text, {
          textFilePath: path.join(os.tmpdir(), 'mega-search-missing.txt'),
        });

      // the document is not in `data`, so its matched word is given directly
      const fallbackSnippets = (text: string, word: string) =>
        generator.generateSnippets(docWithoutRawText(text), {
          queryTokens: [word],
          matchedWords: new Map([[word, { queryToken: word, confidence: 1 }]]),
          isFuzzy: false,
          isPhrase: false,
          contextBefore: 0,
          contextAfter: 30,
        });

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

      it('still highlights Cyrillic words, as whole words only', async () => {
        // Regression guard: the fallback wrapped terms in \b…\b, and JS word
        // boundaries only know ASCII letters, so Cyrillic was never wrapped.
        const [snippet] = await fallbackSnippets(
          'Бюджет бюджетний міста.',
          'бюджет',
        );

        assert.deepEqual(highlightedSpans(snippet.context), ['бюджет']);
      });
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

    it('renders every occurrence, the same text at each place included', async () => {
      // Regression guard: snippets were deduplicated by their text, so a
      // sentence repeated for every person gave one snippet — and be-krang,
      // which extracts a row from each, lost the rest.
      const snippets = await phraseSnippets(
        'repeated.txt',
        'оплатити рахунок',
        [
          [0, 1],
          [2, 3],
          [4, 5],
        ],
      );

      assert.deepEqual(
        snippets.map((s) => s.matchCharStart),
        offsetsOf(DOCS['repeated.txt'], 'Оплатити'),
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

    it('renders strict matches with a typo too, at lower confidence', async () => {
      // Regression guard: exact-phrase snippets re-checked every word for
      // equality with the query, dropping the typo matches fuzzy match off
      // must still find.
      const [snippet] = await phraseSnippets(
        'typo.txt',
        'rich car',
        [[0, 1]],
        false,
      );

      assert.deepEqual(
        [snippet.matchType, snippet.match, snippet.confidence],
        ['exact-phrase', 'Rech car', 1 - 1 / 6],
      );
    });

    it('needs match positions — without them there is nothing to render', async () => {
      // which is why MegaSearch records positions on both phrase paths
      // (exact and proximity)
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
    const highlightsOf = (
      docId: string,
      query: string,
      options?: Partial<TermMatchOptions>,
    ) =>
      generator.generateHighlights(
        data.docCache.get(docId)!,
        matchQuery(query, options).matchedWords,
      );

    it('lists every occurrence of a matched word with raw char offsets', () => {
      const raw = DOCS['orders.txt'];
      const highlights = highlightsOf('orders.txt', 'управління');

      assert.equal(highlights.length, 2);
      for (const highlight of highlights) {
        assert.equal(
          raw.slice(highlight.charStart, highlight.charEnd),
          'управління',
        );
        assert.equal(highlight.term, stemQuery('управління')[0]);
        assert.equal(highlight.confidence, 1);
      }
    });

    it('lists typo matches at lower confidence, and nothing the query did not match', () => {
      // Regression guard: phrase highlights scored every word within 2 edits
      // of a query stem, whether or not the search matched it.
      assert.deepEqual(
        highlightsOf('typo.txt', 'rich').map((h) => [
          h.originalWord,
          h.confidence,
        ]),
        [['rech', 0.75]],
      );
    });

    it('without fuzzy match, lists only the form typed', () => {
      assert.deepEqual(
        highlightsOf('orders.txt', 'начальника', { isFuzzy: false }).map(
          (h) => [h.originalWord, h.term],
        ),
        [['начальника', 'начальника']],
      );
    });
  });
});
