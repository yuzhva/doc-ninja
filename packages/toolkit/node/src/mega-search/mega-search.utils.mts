import { setImmediate as nextTurn } from 'timers/promises';

import { editDistance } from './fuzzy.mjs';
import { countsAsWord } from './text-processor.mjs';
import { DocumentIndex, ProcessedSearchToken } from './types.mjs';

/**
 * A check, for a loop to make before each step, that throws once `signal`
 * aborts. An abort comes in as an event — a closed connection, a message —
 * which the event loop takes in only between tasks, and a step that reads
 * nothing from disk awaits none: the check lets the event loop in once
 * `everyMs` of work went by since it last did. Without a signal there is
 * nothing to wait for, and it never pauses.
 */
export function createAbortCheck(
  signal: AbortSignal | undefined,
  everyMs = 20,
): () => Promise<void> {
  let lastPause = Date.now();
  return async () => {
    if (!signal) return;
    if (Date.now() - lastPause >= everyMs) {
      await nextTurn();
      lastPause = Date.now();
    }
    signal.throwIfAborted();
  };
}

/**
 * Whether the token at `position` counts as a word: not a number, nor a
 * function word. Both are indexed, but wherever distance is counted in words
 * — phrase gaps, snippet windows and sentence ends, document length — they
 * don't count, so a search for words finds what it found before they were
 * indexed.
 */
export function isWordAt(doc: DocumentIndex, position: number): boolean {
  return countsAsWord(doc.vocab[doc.positions.vocabIndex(position)]);
}

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
  const [vocabIndex, charStart, charEnd] = doc.positions.at(position);
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
 * Calculate confidence score based on the typo distance (editDistance).
 */
export function calculateMatchConfidence(
  queryTerm: string,
  matchedTerm: string,
): number {
  if (queryTerm === matchedTerm) return 1.0;

  const distance = editDistance(queryTerm, matchedTerm);
  const maxLength = Math.max(queryTerm.length, matchedTerm.length);

  return Math.max(0, (maxLength - distance) / maxLength);
}
