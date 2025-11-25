import { levenshtein } from './fuzzy.mjs';
import { DocumentIndex, ProcessedSearchToken } from './types.mjs';

/**
 * Helper to rehydrate a token object from the compact index on demand.
 */
export function getDocumentToken(
  doc: DocumentIndex,
  position: number,
): ProcessedSearchToken | null {
  if (position < 0 || position >= doc.positions.length) {
    return null;
  }
  const [vocabIndex, charStart, charEnd] = doc.positions[position];
  const term = doc.vocab[vocabIndex];

  return {
    term,
    position,
    charStart,
    charEnd,
    normalized: term.toLowerCase(),
  };
}

/**
 * Calculate confidence score based on Levenshtein distance.
 */
export function calculateMatchConfidence(
  queryTerm: string,
  matchedTerm: string,
): number {
  if (queryTerm === matchedTerm) return 1.0;

  const distance = levenshtein(queryTerm, matchedTerm);
  const maxLength = Math.max(queryTerm.length, matchedTerm.length);

  return Math.max(0, (maxLength - distance) / maxLength);
}
