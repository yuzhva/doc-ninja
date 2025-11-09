const englishStopWords = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'must',
  'shall',
  'this',
  'that',
  'these',
  'those',
  'here',
  'there',
  'where',
  'when',
  'how',
  'why',
  'what',
  'who',
]);

function normalizeEnglish(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s'-]/g, '')
    .trim();
}

const englishSuffixes = [
  'ing',
  'ed',
  'er',
  'est',
  'ly',
  'tion',
  'sion',
  'ness',
  'ment',
  'able',
  'ible',
  'ful',
  'less',
  'ous',
  'ious',
  'ive',
  'ize',
  'ise',
  'al',
  'ic',
];

function stemEnglish(word: string): string {
  let stem = word;
  if (stem.endsWith('ies') && stem.length > 4) {
    stem = stem.slice(0, -3) + 'y';
  } else if (stem.endsWith('s') && stem.length > 3 && !stem.endsWith('ss')) {
    stem = stem.slice(0, -1);
  }
  const sortedSuffixes = [...englishSuffixes].sort(
    (a, b) => b.length - a.length,
  );
  for (const suffix of sortedSuffixes) {
    if (stem.endsWith(suffix) && stem.length > suffix.length + 2) {
      stem = stem.slice(0, -suffix.length);
      break;
    }
  }
  if (stem.length > 3 && stem.match(/[bcdfghjklmnpqrstvwxz]{2}$/)) {
    const lastTwo = stem.slice(-2);
    if (lastTwo[0] === lastTwo[1]) {
      stem = stem.slice(0, -1);
    }
  }
  return stem;
}

export { englishStopWords, normalizeEnglish, stemEnglish };
