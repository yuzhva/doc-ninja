import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  UkrainianTextProcessor,
  countsAsWord,
  findJoints,
  isFunctionWord,
  matchesItselfOnly,
} from '../text-processor.mjs';

const processor = new UkrainianTextProcessor();
const terms = (text: string) => processor.tokenize(text).map((t) => t.term);

describe('UkrainianTextProcessor', () => {
  describe('normalize()', () => {
    it('lowercases, removes apostrophes and punctuation, collapses whitespace', () => {
      assert.equal(
        processor.normalize("  П'ЯТЬ,   Об’єкт  Обʼєкт! "),
        'пять обєкт обєкт',
      );
    });
  });

  describe('tokenize()', () => {
    it('emits normalized terms whose char offsets point into the original text', () => {
      const text = "Наказ про П'ять.";
      const tokens = processor.tokenize(text);

      assert.deepEqual(
        tokens.map((t) => t.term),
        ['наказ', 'про', 'пять'],
      );
      // highlighting slices these offsets out of the raw text, so they must
      // span the original spelling (casing, apostrophe), not the normalized term
      assert.deepEqual(
        tokens.map((t) => text.slice(t.charStart, t.charEnd)),
        ['Наказ', 'про', "П'ять"],
      );
    });

    it('keeps every word: function words, pronouns, verbs and numerals too', () => {
      // Regression guard: a stop list, compared by stem, left these out of
      // the index — "справа", "рік", "друг" (from "другий") could not be found
      assert.deepEqual(
        terms(
          'Справа за рік: друг та сталь. Була книга, і було. The running dogs',
        ),
        [
          'справа',
          'за',
          'рік',
          'друг',
          'та',
          'сталь',
          'була',
          'книга',
          'було',
          'the',
          'running',
          'dogs',
        ],
      );
    });

    it('drops single letters, and keeps numbers — single digits and leading zeros too', () => {
      assert.deepEqual(terms('x 2024 A кіт 15.06, № 5'), [
        '2024',
        'кіт',
        '15',
        '06',
        '5',
      ]);
    });

    it('splits a number from the letters and separators around it', () => {
      const text = 'вх№36088 від 22.12.2024).';
      const tokens = processor.tokenize(text);

      assert.deepEqual(
        tokens.map((t) => t.term),
        ['вх', '36088', 'від', '22', '12', '2024'],
      );
      assert.deepEqual(
        tokens.map((t) => text.slice(t.charStart, t.charEnd)),
        ['вх', '36088', 'від', '22', '12', '2024'],
      );
    });

    it('finds the words it found before numbers were indexed', () => {
      // A digit used to end a word as any separator does, and still does
      const text =
        'ВОС-790037Д, 1-й корпус, кв.15а, 3х4, рахунок№12/2024р., 2-го поверху';
      const words = (tokens: ReturnType<typeof processor.tokenize>) =>
        tokens.map((t) => [t.term, t.charStart, t.charEnd]);

      assert.deepEqual(
        words(processor.tokenize(text).filter((t) => !/^[0-9]+$/.test(t.term))),
        words(processor.tokenize(text.replace(/[0-9]/g, '#'))),
      );
    });

    it('numbers positions consecutively over the kept tokens only', () => {
      assert.deepEqual(
        processor.tokenize('A cat, a dog').map((t) => [t.term, t.position]),
        [
          ['cat', 0],
          ['dog', 1],
        ],
      );
    });

    it('reads a word typed in both alphabets in the one most of its letters are in', () => {
      // Latin "i" in "Міністерство", Latin "C" and "i" in "Світанок", Latin
      // "ï" in "Україна", a Cyrillic "о" in "Microsoft"
      assert.deepEqual(terms('Мiнiстерство, Cвiтанок, Украïна, Microsоft'), [
        'міністерство',
        'світанок',
        'україна',
        'microsoft',
      ]);
      // words in one alphabet, and the parts of a compound, stay as they are
      assert.deepEqual(terms('IT-відділ, Wi-Fi, офіс'), [
        'it-відділ',
        'wi-fi',
        'офіс',
      ]);
    });

    it('keeps a hyphenated compound as one token', () => {
      assert.deepEqual(terms('науково-дослідний інститут'), [
        'науково-дослідний',
        'інститут',
      ]);
    });

    it('keeps words written with any Ukrainian apostrophe as one token', () => {
      // Regression guard: the token regex listed the ASCII apostrophe twice
      // instead of ' and ’, so the apostrophe Word inserts automatically split
      // «Об’єкт» into «об» + «єкт», and such words could not be found.
      assert.deepEqual(terms("Об'єкт, Об’єкт, Обʼєкт"), [
        'обєкт',
        'обєкт',
        'обєкт',
      ]);
    });

    it('keeps hyphens at word edges out of the token', () => {
      // A compound broken by a space ("інженера- конструктора") left the
      // hyphen on the token, so "інженера" found "інженера-" only with typo
      // tolerance on.
      const text =
        'інженера- конструктора, Івано- Франківськ, -Залізничний, ДСТУ- 3008 — офіс';
      const tokens = processor.tokenize(text);

      assert.deepEqual(
        tokens.map((t) => t.normalized),
        [
          'інженера',
          'конструктора',
          'івано',
          'франківськ',
          'залізничний',
          'дсту',
          '3008',
          'офіс',
        ],
      );
      assert.deepEqual(
        tokens.map((t) => text.slice(t.charStart, t.charEnd)),
        [
          'інженера',
          'конструктора',
          'Івано',
          'Франківськ',
          'Залізничний',
          'ДСТУ',
          '3008',
          'офіс',
        ],
      );
    });

    it('keeps quote marks at word edges out of the token span', () => {
      const text = "Слово ‘наказ’ та 'бюджет'";
      const tokens = processor.tokenize(text);

      assert.deepEqual(
        tokens.map((t) => text.slice(t.charStart, t.charEnd)),
        ['Слово', 'наказ', 'та', 'бюджет'],
      );
    });
  });

  describe('findJoints()', () => {
    const joints = (text: string) => findJoints(text, processor.tokenize(text));

    it('keeps what glues a number to the token next to it, by token index', () => {
      // лист0 вх1 36088(2) від3 22(4) 12(5) 2024(6) пункти7 15(8) 2(9) та10 2024(11) го12
      assert.deepEqual(
        joints('Лист вх№36088 від 22.12.2024, пункти 15, 2 та 2024-го.'),
        { 2: '№', 5: '.', 6: '.', 12: '-' },
      );
    });

    it('keeps nothing where whitespace parts the tokens, or no number is one of them', () => {
      assert.deepEqual(joints('Лист вх. № 36088 від 22 12 2024'), {});
      assert.deepEqual(joints('Петренку,Івану; науково-дослідний'), {});
    });

    it('keeps an empty joint for tokens glued with nothing between them', () => {
      assert.deepEqual(joints('вх36088'), { 1: '' });
    });
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

    it('keys a function word by itself, and no other word by a function word', () => {
      assert.equal(processor.stemWord('про'), 'про');
      assert.equal(processor.stemWord('щодо'), 'щодо');
      // their stems would be "не" and "but": they keep their whole form, so
      // the postings of "не" and "but" hold those words alone
      assert.equal(processor.stemWord('нею'), 'нею');
      assert.equal(processor.stemWord('buts'), 'buts');
    });
  });

  describe('function words', () => {
    it('are the prepositions, conjunctions and particles, in exact form', () => {
      for (const word of ['про', 'та', 'лише', 'не', 'of', 'and', 'not']) {
        assert.ok(isFunctionWord(word), word);
      }
      // words that name something, and other forms of a function word
      for (const word of [
        'справа',
        'рік',
        'друг',
        'мов',
        'його',
        'may',
        'no',
      ]) {
        assert.equal(isFunctionWord(word), false, word);
      }
    });

    it('match as typed only and do not count as words, as numbers', () => {
      assert.deepEqual(
        ['про', '2024', 'наказ'].map((term) => [
          matchesItselfOnly(term),
          countsAsWord(term),
        ]),
        [
          [true, false],
          [true, false],
          [false, true],
        ],
      );
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
