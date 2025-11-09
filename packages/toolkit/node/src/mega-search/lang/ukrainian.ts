/**
 * Normalize Ukrainian text:
 *  - lowercase,
 *  - unify whitespace,
 *  - remove punctuation except Cyrillic/Latin letters, digits and spaces,
 *  - normalize some Ukrainian characters (optional mapping)
 */
function normalizeUkrainian(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\u0400-\u04FFa-zA-Z\u0100-\u017F\s'-]/g, '')
    .trim();
}

/**
 * Heuristic lemmatizer for Ukrainian words.
 * Covers common noun/adjective endings.
 */
function lemmatizeUkrainian(word: string): string {
  let stem = word;

  // General stemming rules
  if (word.endsWith('ння') || word.endsWith('ття')) {
    stem = word.slice(0, -3) + 'нн';
  } else if (word.endsWith('ання') || word.endsWith('іння')) {
    stem = word.slice(0, -4) + 'нн';
  } else if (
    word.endsWith('ський') ||
    word.endsWith('ська') ||
    word.endsWith('ське')
  ) {
    stem = word.slice(0, -4);
  } else if (
    word.endsWith('ому') ||
    word.endsWith('ій') ||
    word.endsWith('ою')
  ) {
    stem = word.slice(0, -2);
  } else if (
    word.endsWith('і') ||
    word.endsWith('у') ||
    word.endsWith('а') ||
    word.endsWith('е') ||
    word.endsWith('я') ||
    word.endsWith('ю') ||
    word.endsWith('о')
  ) {
    if (word.length > 3) {
      stem = word.slice(0, -1);
    }
  }

  return stem;
}

const ukrainianStopWords = new Set([
  'а',
  'але',
  'і',
  'та',
  'або',
  'чи',
  'не',
  'ні',
  'на',
  'в',
  'у',
  'з',
  'до',
  'від',
  'за',
  'під',
  'над',
  'про',
  'для',
  'як',
  'що',
  'це',
  'той',
  'та',
  'те',
  'який',
  'яка',
  'яке',
  'які',
  'він',
  'вона',
  'воно',
  'вони',
  'я',
  'ти',
  'ми',
  'ви',
  'мене',
  'тебе',
  'його',
  'її',
  'нас',
  'вас',
  'їх',
  'буде',
  'був',
  'була',
  'було',
  'були',
  'є',
  'бути',
  'мати',
  'має',
  'мають',
  'мав',
  'мала',
  'мало',
  'мали',
]);

export { lemmatizeUkrainian, normalizeUkrainian, ukrainianStopWords };
