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

// NOT IN USE — kept as a note on a problem the stemmer leaves open.
//
// The problem: sound alternations (чергування) change letters inside a word
// from one form to the next, so the stemmer, which only cuts endings off,
// gives the forms of one word different stems:
// - і in a closed last syllable is о or е where it opens: рік → рік, року →
//   рок; осіб → осіб, особа → особ; стіл → стіл, стола → стол; піч / печі
// - г, к, х before the ending -і are з, ц, с: книга → книг, книзі → книз;
//   рука / руці; вухо / вусі; відпустка / відпустці
// - о or е between the last two consonants comes and goes: відпустка →
//   відпустк, відпусток → відпусток; день → ден, дня → дня
//
// Today such forms are found through typo tolerance only: one letter apart,
// at a confidence below 1, and not at all with typos off (maxTypoDistance 0).
//
// What the code below does: the stems the other forms of a word may have,
// with each alternation undone in the stem's last syllable. TermMatcher would
// match a query word's variants as it matches its stem (matchStem in
// matchInflectedForms, cut-short and related-word rules included, as "дн"
// has to find "дня").
//
// Why it's not in use: the rules are letters written down by hand, with no
// knowledge of which word is which, so they also join words that only look
// alike — "лис" (fox) and "лих" (trouble), "лік" and "лок". There's no way to
// tell those from рука / руці without knowing the words.
//
// The proper fix knows the words: a dictionary of Ukrainian word forms
// mapped to their lemma, as Lucene's UkrainianMorfologikAnalyzer uses —
// built from VESUM (github.com/brown-uk/dict_uk). Check the license before
// shipping it: the VESUM data is CC BY-NC-SA 4.0 (non-commercial), while the
// morfologik-ukrainian-search package built from it says Apache 2.0.
//
// const CONSONANTS = 'бвгґджзйклмнпрстфхцчшщь';
// const CONSONANT_ALTERNATIONS: Record<string, string> = {
//   г: 'з',
//   з: 'г',
//   к: 'ц',
//   ц: 'к',
//   х: 'с',
//   с: 'х',
// };
//
// /** The stems other forms of the word may have: рік → рок, рек; книг → книз. */
// function alternationVariants(stem: string): Set<string> {
//   const variants = new Set<string>();
//   const last = stem.length - 1;
//   const isConsonant = (letter: string) => CONSONANTS.includes(letter);
//
//   // і in the last, closed syllable → о, е: рік → рок, осіб → особ
//   const i = stem.lastIndexOf('і');
//   if (i > 0 && i < last && [...stem.slice(i + 1)].every(isConsonant)) {
//     for (const vowel of ['о', 'е']) {
//       variants.add(stem.slice(0, i) + vowel + stem.slice(i + 1));
//     }
//   }
//
//   // г, к, х ↔ з, ц, с at the end: книг → книз, руц → рук
//   const alternation = CONSONANT_ALTERNATIONS[stem[last]];
//   if (alternation && stem.length > 2) {
//     variants.add(stem.slice(0, last) + alternation);
//   }
//
//   if (stem.length > 2 && isConsonant(stem[last])) {
//     // о, е between the last two consonants goes: ден → дн
//     if ('ео'.includes(stem[last - 1]) && isConsonant(stem[last - 2])) {
//       variants.add(stem.slice(0, last - 1) + stem[last]);
//     }
//     // ... or comes: відпустк → відпусток
//     if (isConsonant(stem[last - 1])) {
//       for (const vowel of ['о', 'е']) {
//         variants.add(stem.slice(0, last) + vowel + stem[last]);
//       }
//     }
//   }
//   return variants;
// }

export { lemmatizeUkrainian, normalizeUkrainian, ukrainianFunctionWords };
