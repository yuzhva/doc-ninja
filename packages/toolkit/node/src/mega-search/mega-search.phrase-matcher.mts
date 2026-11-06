import type { WordMatch } from './mega-search.term-matcher.mjs';
import type { DocumentIndex } from './types.mjs';

export class PhraseMatcher {
  /**
   * Find every occurrence of a phrase: its words in order, each at most
   * `maxWordsBetween` document words after the previous one (0 = adjacent).
   * What counts as each word — inflected forms, typos — was settled by the
   * TermMatcher that built `words`.
   *
   * @returns docId → the token positions of each occurrence
   */
  findPhrases(
    words: readonly WordMatch[],
    maxWordsBetween: number,
    docCache: Map<string, DocumentIndex>,
  ): Map<string, number[][]> {
    const phrases = new Map<string, number[][]>();
    if (words.length === 0) return phrases;

    // Only a document holding every word can hold the phrase.
    let candidateDocIds = new Set(words[0].documentIds());
    for (let i = 1; i < words.length && candidateDocIds.size > 0; i++) {
      const docIds = new Set(words[i].documentIds());
      candidateDocIds = new Set(
        [...candidateDocIds].filter((docId) => docIds.has(docId)),
      );
    }

    for (const docId of candidateDocIds) {
      const doc = docCache.get(docId);
      if (!doc) continue;

      const sequences = this.findSequencesInPositions(
        words.map((word) => word.positionsIn(docId, doc)),
        maxWordsBetween,
      );
      if (sequences.length > 0) {
        phrases.set(docId, sequences);
      }
    }

    return phrases;
  }

  private findSequencesInPositions(
    positionsByWord: ReadonlyArray<readonly number[]>,
    maxWordsBetween: number,
  ): number[][] {
    if (positionsByWord.some((positions) => positions.length === 0)) {
      return [];
    }

    // Adjacent words are one position apart, so a gap of N words is N + 1.
    const maxStep = maxWordsBetween + 1;

    const findPaths = (
      wordIndex: number,
      currentPath: number[],
    ): number[][] => {
      if (wordIndex === positionsByWord.length) {
        return [currentPath];
      }

      const lastPosition = currentPath[currentPath.length - 1];
      let paths: number[][] = [];

      for (const nextPosition of positionsByWord[wordIndex]) {
        const step = nextPosition - lastPosition;
        if (step > 0 && step <= maxStep) {
          paths = paths.concat(
            findPaths(wordIndex + 1, [...currentPath, nextPosition]),
          );
        }
      }
      return paths;
    };

    let allSequences: number[][] = [];
    for (const startPosition of positionsByWord[0]) {
      allSequences = allSequences.concat(findPaths(1, [startPosition]));
    }

    return allSequences;
  }
}
