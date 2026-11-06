import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { knownBug } from '../test-utils/known-bug.mjs';
import { UkrainianTextProcessor } from '../text-processor.mjs';

const processor = new UkrainianTextProcessor();
const terms = (text: string) => processor.tokenize(text).map((t) => t.term);

describe('UkrainianTextProcessor', () => {
  describe('normalize()', () => {
    it('lowercases, removes apostrophes and punctuation, collapses whitespace', () => {
      assert.equal(processor.normalize("  П'ЯТЬ,   Об’єкт! "), 'пять обєкт');
    });
  });

  describe('tokenize()', () => {
    it('emits normalized terms whose char offsets point into the original text', () => {
      const text = "Наказ про П'ять.";
      const tokens = processor.tokenize(text);

      assert.deepEqual(
        tokens.map((t) => t.term),
        ['наказ', 'пять'],
      );
      // highlighting slices these offsets out of the raw text, so they must
      // span the original spelling (casing, apostrophe), not the normalized term
      assert.deepEqual(
        tokens.map((t) => text.slice(t.charStart, t.charEnd)),
        ['Наказ', "П'ять"],
      );
    });

    it('drops Ukrainian and English stop words, including their inflected forms', () => {
      // the stop list is stored stemmed, so "було" is caught via the stem of "була"
      assert.deepEqual(terms('Була книга, і було. The running dogs'), [
        'книга',
        'running',
        'dogs',
      ]);
    });

    it('drops single letters and numbers', () => {
      assert.deepEqual(terms('x 2024 A кіт 15.06'), ['кіт']);
    });

    it('numbers positions consecutively over the kept tokens only', () => {
      assert.deepEqual(
        processor
          .tokenize('The cat and the dog')
          .map((t) => [t.term, t.position]),
        [
          ['cat', 0],
          ['dog', 1],
        ],
      );
    });

    it('keeps a hyphenated compound as one token', () => {
      assert.deepEqual(terms('північно-східний район'), [
        'північно-східний',
        'район',
      ]);
    });

    it(
      'keeps a word written with the typographic apostrophe (’) as one token',
      knownBug(
        "the token regex lists the ASCII apostrophe twice ('') instead of ' and ’, so the " +
          'apostrophe Word inserts automatically splits «Об’єкт» into «об» + «єкт», ' +
          'and such words can no longer be found',
      ),
      () => {
        assert.deepEqual(terms('Об’єкт передано'), ['обєкт', 'передано']);
      },
    );
  });

  describe('stemWord()', () => {
    it('maps Ukrainian inflections onto one stem', () => {
      assert.equal(
        processor.stemWord('документи'),
        processor.stemWord('документів'),
      );
      assert.equal(
        processor.stemWord('управління'),
        processor.stemWord('управлінням'),
      );
    });

    it('uses the Porter stemmer for English', () => {
      assert.equal(processor.stemWord('running'), 'run');
      assert.equal(processor.stemWord('cars'), 'car');
    });

    it('returns non-alphabetic input unchanged', () => {
      assert.equal(processor.stemWord('2024'), '2024');
    });
  });

  describe('detectLanguage()', () => {
    it('classifies text by its share of Cyrillic letters', () => {
      assert.equal(processor.detectLanguage('Привіт світ'), 'ukrainian');
      assert.equal(processor.detectLanguage('hello world'), 'english');
      assert.equal(processor.detectLanguage('hello світ'), 'mixed');
    });

    it('falls back to english for text without letters', () => {
      assert.equal(processor.detectLanguage('123 !!'), 'english');
    });
  });

  describe('calculateSimilarity()', () => {
    it('is 1 - distance / longer length', () => {
      assert.equal(processor.calculateSimilarity('кіт', 'кіт'), 1);
      assert.equal(processor.calculateSimilarity('кіт', 'кит'), 1 - 1 / 3);
    });
  });

  describe('tokenizeWithParagraphs()', () => {
    it('splits on blank lines and maps each paragraph to its token range', () => {
      const text = 'Наказ підписано.\n\n  Бюджет затверджено.';
      const { tokens, paragraphs } = processor.tokenizeWithParagraphs(text);

      assert.equal(tokens.length, 4);
      assert.deepEqual(
        paragraphs.map((p) => [
          p.content,
          text.slice(p.startPos, p.endPos),
          p.tokenStart,
          p.tokenEnd,
        ]),
        [
          ['Наказ підписано.', 'Наказ підписано.', 0, 2],
          ['Бюджет затверджено.', 'Бюджет затверджено.', 2, 4],
        ],
      );
    });
  });
});
