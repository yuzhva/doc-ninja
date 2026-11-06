import natural from 'natural';

/**
 * Function words: the prepositions, conjunctions and particles that only tie
 * the words around them together ("про", "та", "лише"). They are indexed
 * like every word, so a phrase holds them as written ("наказ про відпустку"
 * is not "наказ на відпустку"), but they match themselves only, don't count
 * where distance is counted in words, and a word-by-word search skips them
 * (see isFunctionWord in text-processor).
 *
 * Exact forms, as the tokenizer gives them: lower case, no apostrophes.
 * Single letters ("в", "і", "з") are never tokens, so they aren't listed.
 * Neither is "мов": it is the plural of "мова" too.
 *
 * This used to be a list of stop words, left out of the index altogether and
 * compared by stem. It held words that name things ("рік", "справа", "день",
 * "люди"), and comparing stems dropped words it didn't hold: "друг" (from
 * "другий"), "сталь" (from "стала"). On a real corpus that left 15% of the
 * words unsearchable. Pronouns, verbs and numerals are ordinary words now.
 */
const ukrainianFunctionWords: ReadonlySet<string> = new Set([
  // Prepositions
  'на',
  'із',
  'зі',
  'за',
  'під',
  'над',
  'перед',
  'через',
  'при',
  'про',
  'по',
  'до',
  'від',
  'для',
  'без',
  'крім',
  'між',
  'серед',
  'проти',
  'біля',
  'навколо',
  'повз',
  'вздовж',
  'посеред',
  'понад',
  'замість',
  'внаслідок',
  'задля',
  'попри',
  'щодо',

  // Conjunctions
  'та',
  'але',
  'проте',
  'однак',
  'або',
  'чи',
  'бо',
  'що',
  'щоб',
  'щоби',
  'як',
  'якщо',
  'якби',
  'хоч',
  'хоча',
  'неначе',
  'ніби',
  'нібито',
  'адже',
  'тобто',
  'ніж',
  'аніж',
  'оскільки',
  'тому',

  // Particles
  'би',
  'же',
  'ось',
  'он',
  'хай',
  'нехай',
  'не',
  'ні',
  'ані',
  'так',
  'еге',
  'авжеж',
  'атож',
  'ну',
  'от',
  'тільки',
  'лише',
  'лиш',
  'навіть',
  'якраз',
  'майже',
  'принаймні',
  'все-таки',
]);

/** Latin letters that look like Cyrillic ones, and those Cyrillic ones. */
const LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = {
  a: 'а',
  c: 'с',
  e: 'е',
  i: 'і',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
  ï: 'ї',
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  I: 'І',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
  Y: 'У',
  Ï: 'Ї',
};
const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LATIN_TO_CYRILLIC).map(([latin, cyrillic]) => [
    cyrillic,
    latin,
  ]),
);
const LATIN_LOOKALIKE = new RegExp(
  `[${Object.keys(LATIN_TO_CYRILLIC).join('')}]`,
  'g',
);
const CYRILLIC_LOOKALIKE = new RegExp(
  `[${Object.keys(CYRILLIC_TO_LATIN).join('')}]`,
  'g',
);
const HAS_LATIN = /[A-Za-zÏï]/;
const HAS_CYRILLIC = /[Ѐ-ӿ]/;

/**
 * A word typed in both alphabets, its look-alike letters written in the one
 * most of its letters are in: "Мiнiстерство" with a Latin "i" is
 * "Міністерство", "Microsоft" with a Cyrillic "о" is "Microsoft". The eye
 * can't tell the letters apart, so the text means the word — left mixed, no
 * query typed in one alphabet found it. Words in one alphabet stay as they
 * are, and so do the parts of a compound: "IT-відділ".
 */
function unmixLookalikes(text: string): string {
  if (!HAS_LATIN.test(text) || !HAS_CYRILLIC.test(text)) return text;

  return text.replace(/\p{L}+/gu, (word) => {
    if (!HAS_LATIN.test(word) || !HAS_CYRILLIC.test(word)) return word;
    const cyrillic = word.match(/[Ѐ-ӿ]/g)!.length;
    const latin = word.match(/[A-Za-zÏï]/g)!.length;
    return cyrillic >= latin
      ? word.replace(LATIN_LOOKALIKE, (letter) => LATIN_TO_CYRILLIC[letter])
      : word.replace(CYRILLIC_LOOKALIKE, (letter) => CYRILLIC_TO_LATIN[letter]);
  });
}

function normalizeUkrainian(text: string): string {
  return unmixLookalikes(text)
    .toLowerCase()
    .trim()
    .replace(/['`’ʼ]/g, '') // Remove apostrophes (', `, ’, ʼ) which are common in Ukrainian
    .replace(/\s+/g, ' ')
    .replace(/[^\w\sа-яїієґ-]/g, '')
    .trim();
}

/**
 * A robust algorithmic stemmer for Ukrainian using 'natural' library.
 * Unlike English, Ukrainian is highly inflected (7 cases, 3 genders, etc.),
 * so we rely on a specialized stemmer.
 */
function lemmatizeUkrainian(word: string): string {
  return natural.PorterStemmerUk.stem(word);
}

export { lemmatizeUkrainian, normalizeUkrainian, ukrainianFunctionWords };
