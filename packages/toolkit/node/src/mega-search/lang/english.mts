import natural from 'natural';

/**
 * Function words: the articles, conjunctions, prepositions and particles
 * that only tie the words around them together. Indexed, matched as typed
 * only, and skipped by word-by-word searches — see ukrainianFunctionWords.
 *
 * Exact forms, in lower case. "a" and "i" are single letters, never tokens.
 * Not here on purpose: "may", "will", "can", "no" — they are also a month, a
 * testament, a tin, and "No." of a number.
 */
const englishFunctionWords: ReadonlySet<string> = new Set([
  // Articles
  'the',
  'an',

  // Conjunctions
  'and',
  'or',
  'but',
  'nor',
  'so',
  'yet',
  'for',
  'because',
  'as',
  'if',
  'when',
  'than',
  'while',
  'although',
  'though',
  'unless',
  'until',
  'since',

  // Prepositions
  'in',
  'on',
  'at',
  'to',
  'of',
  'with',
  'by',
  'from',
  'up',
  'down',
  'about',
  'into',
  'over',
  'after',
  'under',
  'above',
  'below',
  'through',
  'during',
  'before',
  'between',
  'out',
  'off',
  'against',
  'among',
  'throughout',
  'despite',
  'towards',
  'upon',
  'within',
  'without',

  // Particles
  'not',
]);

function normalizeEnglish(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s'-]/g, '')
    .trim();
}

function stemEnglish(word: string): string {
  return natural.PorterStemmer.stem(word);
}

export { englishFunctionWords, normalizeEnglish, stemEnglish };
