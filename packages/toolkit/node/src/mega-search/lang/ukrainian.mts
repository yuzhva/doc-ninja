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

function normalizeUkrainian(text: string): string {
  return text
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
