/**
 * Normalize Ukrainian text:
 *  - lowercase,
 *  - unify whitespace,
 *  - remove punctuation except Cyrillic/Latin letters, digits and spaces,
 *  - normalize some Ukrainian characters (optional mapping)
 */
export function normalizeUkrainian(s: string): string {
  if (!s) return '';
  let t = s.toLowerCase();
  t = t.replace(/\u00A0/g, ' ').replace(/\u2011/g, '-').replace(/\s+/g, ' ');
  t = t.replace(/ё/g, 'е');
  t = t.replace(/[^0-9\p{L}\s\-']/gu, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/**
 * Heuristic lemmatizer for Ukrainian words.
 * Covers common noun/adjective endings.
 */
export function lemmatizeUkrainian(token: string): string {
  if (!token) return token;
  if (/^\d+$/.test(token)) return token;

  const lower = token;
  if (/(ого|ього|ому|их|ими)$/u.test(lower)) {
    return lower.replace(/(ого|ього)$/u, 'ий');
  }
  if (/[ая]$/u.test(lower) && lower.length > 3) {
    return lower.replace(/[ая]$/u, '');
  }
  if (/[ую]$/u.test(lower) && lower.length > 3) {
    return lower.replace(/[ую]$/u, '');
  }
  if (/(ом|ем|єм|ою)$/u.test(lower) && lower.length > 4) {
    return lower.replace(/(ом|ем|єм|ою)$/u, '');
  }
  if (lower.endsWith('ь') && lower.length > 3) {
    return lower.slice(0, -1);
  }
  return lower;
}

export const ukrainianStopWords = new Set([
  'і', 'в', 'на', 'з', 'за', 'до', 'по', 'від', 'для', 'про', 'під', 'над', 'між', 'через',
  'це', 'той', 'та', 'те', 'який', 'яка', 'яке', 'що', 'хто', 'де', 'коли', 'як',
  'але', 'або', 'якщо', 'тому', 'щоб', 'після', 'перед', 'біля', 'навколо'
]);
