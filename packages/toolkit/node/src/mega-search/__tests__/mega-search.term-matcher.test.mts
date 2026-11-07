import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import {
  TermMatcher,
  mergeMatchedWords,
} from '../mega-search.term-matcher.mjs';
import type { TermMatchOptions } from '../mega-search.term-matcher.mjs';
import { calculateMatchConfidence } from '../mega-search.utils.mjs';
import { buildSearchData, stemQuery } from '../test-utils/in-memory-index.mjs';
import type { SearchData } from '../test-utils/in-memory-index.mjs';
import { UkrainianTextProcessor } from '../text-processor.mjs';

const matcher = new TermMatcher(new UkrainianTextProcessor());

// One name and one English word, a different form of it in each document.
const DOCS = {
  'genitive.txt': 'Наказ видано на користь Євгена Петренка.',
  'nominative.txt': 'Заяву подав Євген Петренко.',
  'dative.txt': 'Лист надіслано Євгену Петренку.',
  'full-name.txt': 'Документ підписав Євгеній Коваль.',
  'parked.txt': 'The car was parked outside.',
  'parking.txt': 'Free parking near the office.',
  'parks.txt': 'Two parks in town.',
  'archive.txt': 'Передано до архіву.',
  'mixed.txt': 'Rech car, rich man.', // rech0 car1 rich2 man3
};

const FUZZY: TermMatchOptions = {
  isFuzzy: true,
  isRelatedWordsAllowed: false,
  maxTypoDistance: 1,
};
const STRICT: TermMatchOptions = {
  isFuzzy: false,
  isRelatedWordsAllowed: false,
  maxTypoDistance: 1,
};

describe('TermMatcher', () => {
  let data: SearchData;

  before(async () => {
    data = await buildSearchData(DOCS);
  });

  const match = (word: string, options: TermMatchOptions) =>
    matcher.match(word, options, data);

  /** Documents where the word really occurs, i.e. with positions. */
  const docsWith = (word: string, options: TermMatchOptions) => {
    const wordMatch = match(word, options);
    return [...wordMatch.documentIds()]
      .filter(
        (docId) =>
          wordMatch.positionsIn(docId, data.docCache.get(docId)!).length > 0,
      )
      .sort();
  };

  describe('with fuzzy match on', () => {
    it('matches every inflected form of the word', () => {
      assert.deepEqual(docsWith('євгена', FUZZY), [
        'dative.txt',
        'full-name.txt',
        'genitive.txt',
        'nominative.txt',
      ]);
      assert.deepEqual(docsWith('parked', FUZZY), [
        'parked.txt',
        'parking.txt',
        'parks.txt',
      ]);
    });

    it('reports every form as the query stem, at full confidence', () => {
      const { queryToken, words } = match('євгена', FUZZY);

      assert.equal(queryToken, stemQuery('євгена')[0]);
      assert.deepEqual([...words.keys()].sort(), [
        'євген',
        'євгена',
        'євгену',
        'євгеній',
      ]);
      for (const matched of words.values()) {
        assert.deepEqual(matched, { queryToken, confidence: 1 });
      }
    });

    it('also matches the forms of a stem within maxTypoDistance, at lower confidence', () => {
      const { words } = match('єгена', FUZZY); // stem "єген", 1 edit from "євген"

      assert.deepEqual([...words.keys()].sort(), [
        'євген',
        'євгена',
        'євгену',
        'євгеній',
      ]);
      // the closer of the two comparisons: stem to stem ("єген" ↔ "євген",
      // 0.8) or word to word ("єгена" ↔ "євгена", 5/6)
      assert.equal(
        words.get('євгену')!.confidence,
        calculateMatchConfidence('єгена', 'євгена'),
      );
      assert.ok(words.get('євгену')!.confidence < 1);
    });

    it('also matches the forms of a word within maxTypoDistance whose stem the typo hid', () => {
      // "prked" stems to itself, 3 edits from "park" — but it is 1 edit
      // from "parked", which fuzzy match off finds; on must find it too.
      assert.deepEqual(docsWith('prked', STRICT), ['parked.txt']);
      assert.deepEqual(docsWith('prked', FUZZY), [
        'parked.txt',
        'parking.txt',
        'parks.txt',
      ]);
    });

    it('matches a form the stemmer filed under another stem, even with maxTypoDistance 0', () => {
      // "архів" → "арх" but "архіву" → "архів" (see the forms tests below).
      assert.notEqual(stemQuery('архів')[0], stemQuery('архіву')[0]);
      assert.deepEqual(docsWith('архів', { ...FUZZY, maxTypoDistance: 0 }), [
        'archive.txt',
      ]);
    });
  });

  describe('with fuzzy match off', () => {
    it('matches only the form typed — the other forms are inflections, not typos', () => {
      // "євгену" and "євген" are 1 edit from "євгена", within the default
      // maxTypoDistance; as forms of the same stem they still do not count.
      assert.deepEqual(docsWith('євгена', STRICT), ['genitive.txt']);
      assert.deepEqual(docsWith('parked', STRICT), ['parked.txt']);
    });

    it('reports the word itself as the query token', () => {
      const { queryToken, words } = match('євгена', STRICT);

      assert.equal(queryToken, 'євгена');
      assert.deepEqual(
        [...words.entries()],
        [['євгена', { queryToken: 'євгена', confidence: 1 }]],
      );
    });

    it('still matches words within maxTypoDistance, at lower confidence', () => {
      const { words } = match('єгена', STRICT);

      assert.deepEqual([...words.keys()], ['євгена']);
      assert.equal(
        words.get('євгена')!.confidence,
        calculateMatchConfidence('єгена', 'євгена'),
      );
      assert.ok(words.get('євгена')!.confidence < 1);
    });

    it('counts document frequency per stem, so other forms of it count too', () => {
      // documentIds()/documentCount stay cheap (no document loads);
      // positionsIn() is what narrows them to the form typed.
      const wordMatch = match('євгена', STRICT);

      assert.equal(wordMatch.documentCount, 4);
      assert.deepEqual(
        wordMatch.positionsIn(
          'nominative.txt',
          data.docCache.get('nominative.txt')!,
        ),
        [],
      );
    });
  });

  describe('maxTypoDistance 0', () => {
    it('turns typo tolerance off in both modes', () => {
      for (const isFuzzy of [true, false]) {
        assert.deepEqual(
          docsWith('єгена', { ...FUZZY, isFuzzy, maxTypoDistance: 0 }),
          [],
          `isFuzzy: ${isFuzzy}`,
        );
      }
      assert.deepEqual(docsWith('євгена', { ...STRICT, maxTypoDistance: 0 }), [
        'genitive.txt',
      ]);
    });
  });

  describe('WordMatch.positionsIn()', () => {
    it('merges the positions of several matched stems in document order', () => {
      const wordMatch = match('rich', FUZZY); // "rich" and "rech"

      assert.deepEqual(
        wordMatch.positionsIn('mixed.txt', data.docCache.get('mixed.txt')!),
        [0, 2],
      );
    });

    it('is empty for a document without a match', () => {
      assert.deepEqual(
        match('rich', FUZZY).positionsIn(
          'parks.txt',
          data.docCache.get('parks.txt')!,
        ),
        [],
      );
    });
  });

  describe('mergeMatchedWords()', () => {
    it('keeps the most confident match of a word several query words matched', () => {
      const merged = mergeMatchedWords([
        match('rech', STRICT), // "rech" exactly
        match('rich', STRICT), // "rich" exactly, "rech" through a typo
      ]);

      assert.deepEqual(merged.get('rech'), {
        queryToken: 'rech',
        confidence: 1,
      });
      assert.deepEqual(merged.get('rich'), {
        queryToken: 'rich',
        confidence: 1,
      });
    });
  });
});

/**
 * Declensions the stemmer files under two stems: it cuts off whatever looks
 * like an ending, so "паперова" → "папер" while "паперовий" → "паперов",
 * "архів" → "арх" while "архіву" → "архів". Each one is a document of its own.
 */
const FORMS_OF_ONE_WORD: Record<string, string[]> = {
  паперовий: [
    'паперовий',
    'паперового',
    'паперовому',
    'паперовим',
    'паперовім',
    'паперова',
    'паперової',
    'паперовій',
    'паперову',
    'паперовою',
    'паперове',
    'паперові',
    'паперових',
    'паперовими',
  ],
  грошовий: [
    'грошовий',
    'грошового',
    'грошовому',
    'грошовим',
    'грошова',
    'грошової',
    'грошовій',
    'грошову',
    'грошовою',
    'грошове',
    'грошові',
    'грошових',
  ],
  архів: [
    'архів',
    'архіву',
    'архівом',
    'архіві',
    'архіви',
    'архівів',
    'архівах',
  ],
  умова: [
    'умова',
    'умови',
    'умові',
    'умову',
    'умовою',
    'умов',
    'умовам',
    'умовах',
  ],
  система: [
    'система',
    'системи',
    'системі',
    'систему',
    'системою',
    'систем',
    'системах',
  ],
  диплом: ['диплом', 'диплому', 'дипломом', 'дипломі', 'дипломи', 'дипломів'],
  сертифікат: [
    'сертифікат',
    'сертифіката',
    'сертифікатом',
    'сертифікати',
    'сертифікатів',
  ],
  Мирослав: ['мирослав', 'мирослава', 'мирославу', 'мирославові', 'мирославом'],
  Василь: ['василь', 'василя', 'василю', 'василеві', 'василем'],
  Шевченко: ['шевченко', 'шевченка', 'шевченку', 'шевченкові', 'шевченком'],
  'Іванов (he)': ['іванов', 'іванова', 'іванову', 'івановим', 'іванові'],
  'Іванова (she)': ['іванова', 'іванової', 'івановій', 'іванову', 'івановою'],
  Петрів: ['петрів', 'петріва', 'петріву'],
  Цап: ['цап', 'цапа', 'цапу', 'цапові', 'цапом'],
};

/**
 * Words that only share the start of a stem, up to 2 letters apart — what
 * related words add, and inflected forms alone keep apart.
 */
const RELATED_WORDS: Array<[query: string, related: string, why: string]> = [
  ['бондар', 'бондарук', 'another surname'],
  ['бондаря', 'бондарука', 'another surname'],
  ['цап', 'цапик', 'another surname'],
  ['кота', 'котика', 'another surname'],
  ['антонову', 'антоновича', 'a patronymic'],
  ['кота', 'котел', 'another word'],
  ['суду', 'судин', 'another word'],
  ['дій', 'дітей', 'another word'],
  ['василь', 'васильки', 'another word'],
  ['parked', 'parker', 'another word'],
  ['столяр', 'столярного', 'a derived word'],
  ['дмитріва', 'дмитро', 'another name, under the stem of "Дмитрів"'],
  // The stemmer leaves "призначил" too long rather than cutting "признач"
  // short — the same as "Бондар" + "-ук" to a rule without endings.
  ['призначив', 'призначила', 'a verb form only related words find'],
];

describe('TermMatcher — inflected forms and related words', () => {
  let data: SearchData;

  before(async () => {
    data = await buildSearchData({
      ...Object.fromEntries(
        Object.entries(FORMS_OF_ONE_WORD).map(([word, forms]) => [
          `${word}.txt`,
          forms.join(' '),
        ]),
      ),
      'related.txt': RELATED_WORDS.map(
        ([query, related]) => `${query} ${related}`,
      ).join(' '),
      'cat.txt': 'кіт котом',
      'dmytro.txt': 'Дмитрів Дмитро Дмитра',
    });
  });

  const FORMS_ONLY: TermMatchOptions = {
    isFuzzy: true,
    isRelatedWordsAllowed: false,
    maxTypoDistance: 0,
  };
  const RELATED: TermMatchOptions = {
    ...FORMS_ONLY,
    isRelatedWordsAllowed: true,
  };

  const wordsOf = (word: string, options: TermMatchOptions) =>
    matcher.match(word, options, data).words;

  describe('inflected forms (related words off)', () => {
    for (const [word, forms] of Object.entries(FORMS_OF_ONE_WORD)) {
      it(`every form of ${word} finds every other, without typo tolerance`, () => {
        for (const form of forms) {
          const found = wordsOf(form, FORMS_ONLY);
          assert.deepEqual(
            forms.filter((other) => !found.has(other)),
            [],
            `"${form}" (stem "${stemQuery(form)[0]}")`,
          );
        }
      });
    }

    it('even where the stemmer filed them under two stems', () => {
      assert.notEqual(stemQuery('паперова')[0], stemQuery('паперовий')[0]);
      assert.notEqual(stemQuery('архів')[0], stemQuery('архіву')[0]);
      assert.notEqual(stemQuery('мирослав')[0], stemQuery('мирослава')[0]);
    });

    it('counts those forms as the word itself, at full confidence', () => {
      assert.equal(
        wordsOf('паперовий', FORMS_ONLY).get('паперова')?.confidence,
        1,
      );
      assert.equal(
        wordsOf('паперова', FORMS_ONLY).get('паперовий')?.confidence,
        1,
      );
      assert.equal(wordsOf('архіву', FORMS_ONLY).get('архів')?.confidence, 1);
    });

    for (const [query, related, why] of RELATED_WORDS) {
      it(`does not find "${related}" for "${query}" — ${why}`, () => {
        assert.ok(!wordsOf(query, FORMS_ONLY).has(related));
      });
    }

    it('takes from a shorter stem only the forms of the word, not every word under it', () => {
      // "Дмитрів" → "дмитр", the stem of "Дмитро" as well.
      assert.equal(stemQuery('дмитрів')[0], stemQuery('дмитро')[0]);
      assert.deepEqual([...wordsOf('дмитріва', FORMS_ONLY).keys()].sort(), [
        'дмитрів',
        'дмитріва',
      ]);
    });

    it('leaves a vowel change inside the stem to typo tolerance (Кіт → Кота)', () => {
      // "кіт" → "кіт", "котом" → "кот": no shared start for a stem rule.
      assert.ok(!wordsOf('кіт', FORMS_ONLY).has('котом'));
      assert.ok(!wordsOf('кіт', RELATED).has('котом'));

      const typo = wordsOf('кіт', { ...FORMS_ONLY, maxTypoDistance: 1 });
      assert.ok(typo.get('котом')!.confidence < 1);
    });
  });

  describe('related words (on by default)', () => {
    for (const [query, related, why] of RELATED_WORDS) {
      it(`find "${related}" for "${query}" — ${why} — at lower confidence`, () => {
        const found = wordsOf(query, RELATED).get(related);

        assert.ok(found, `"${related}" found`);
        assert.ok(found.confidence < 1);
      });
    }

    it('still count the forms of the word itself at full confidence', () => {
      // "папер" (of "паперова") is also 2 letters from "паперов": related,
      // and the stem of the word's own forms.
      assert.equal(
        wordsOf('паперовий', RELATED).get('паперова')?.confidence,
        1,
      );
    });

    it('have no effect with fuzzy match off', () => {
      const strict = { ...RELATED, isFuzzy: false };

      assert.deepEqual([...wordsOf('бондар', strict).keys()], ['бондар']);
    });
  });
});

describe('TermMatcher — numbers', () => {
  const NUMBERS = {
    'year.txt': 'Звіт за 2024 рік.',
    'near-years.txt': 'Звіти за 2023 і 20245, сторінка 202.',
    'numbers-only.txt': '12 34 56',
    'words.txt': 'Пункт аб, розділ вг.',
  };
  let data: SearchData;

  before(async () => {
    data = await buildSearchData(NUMBERS);
  });

  const MODES: TermMatchOptions[] = [true, false].flatMap((isFuzzy) =>
    [0, 1, 2].map((maxTypoDistance) => ({
      isFuzzy,
      isRelatedWordsAllowed: true,
      maxTypoDistance,
    })),
  );

  it('matches a number itself only, whatever the typo distance and fuzzy match', () => {
    for (const options of MODES) {
      const wordMatch = matcher.match('2024', options, data);

      assert.deepEqual(
        [...wordMatch.documentIds()],
        ['year.txt'],
        `${JSON.stringify(options)}`,
      );
      assert.deepEqual([...wordMatch.words.keys()], ['2024']);
      assert.equal(wordMatch.words.get('2024')!.confidence, 1);
    }
  });

  it('matches no word to a number', () => {
    // "аб" is 2 edits from "12" as much as from "вг"
    const wordMatch = matcher.match(
      'аб',
      { isFuzzy: false, isRelatedWordsAllowed: true, maxTypoDistance: 2 },
      data,
    );

    assert.ok(wordMatch.words.has('вг'));
    assert.ok(![...wordMatch.documentIds()].includes('numbers-only.txt'));
  });
});
