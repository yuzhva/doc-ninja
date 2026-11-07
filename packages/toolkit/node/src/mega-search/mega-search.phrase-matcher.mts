import type { WordMatch } from './mega-search.term-matcher.mjs';
import { isWordAt } from './mega-search.utils.mjs';
import type { DocumentIndex } from './types.mjs';

export class PhraseMatcher {
  /**
   * Find every occurrence of a phrase: its words in order, each at most
   * `maxWordsBetween` document words after the previous one (0 = adjacent).
   * Numbers in between don't count as words. What counts as each word —
   * inflected forms, typos — was settled by the TermMatcher that built
   * `words`.
   *
   * A word with a joint in `joints` (the query's, see findJoints) must be the
   * very next token after the previous one, glued to it by the same
   * characters: the parts of a number the query writes glued together
   * ("22.12.2024" → 22, 12, 2024) are found as written, not in
   * "12.01.2024, 22", "22/12/2024" or "22 12 2024".
   *
   * An occurrence is one per position of the first word, made of the nearest
   * words after it that complete the phrase. Other ways to complete it from
   * the same start are the same occurrence: "договір, договір оренди" holds
   * "підписати договір" once, not twice. The same text at another place is
   * another occurrence — documents repeat a sentence for every person, and
   * be-krang extracts a row from each.
   *
   * @returns docId → the token positions of each occurrence
   */
  findPhrases(
    words: readonly WordMatch[],
    maxWordsBetween: number,
    docCache: ReadonlyMap<string, DocumentIndex>,
    joints: Readonly<Record<number, string>> = {},
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
        doc,
        words.map((word) => word.positionsIn(docId, doc)),
        maxWordsBetween,
        joints,
      );
      if (sequences.length > 0) {
        phrases.set(docId, sequences);
      }
    }

    return phrases;
  }

  private findSequencesInPositions(
    doc: DocumentIndex,
    positionsByWord: ReadonlyArray<readonly number[]>,
    maxWordsBetween: number,
    joints: Readonly<Record<number, string>>,
  ): number[][] {
    if (positionsByWord.some((positions) => positions.length === 0)) {
      return [];
    }

    // Adjacent words are one position apart, so a gap of N words is N + 1.
    const maxStep = maxWordsBetween + 1;

    const canFollow = (
      position: number,
      next: number,
      joint: string | undefined,
    ): boolean => {
      if (joint !== undefined) {
        return next === position + 1 && doc.joints[next] === joint;
      }
      // A step that fits needs no count: numbers in it only shorten the gap
      if (next - position <= maxStep) return true;
      let wordsBetween = 0;
      for (let p = position + 1; p < next; p++) {
        if (isWordAt(doc, p) && ++wordsBetween > maxWordsBetween) return false;
      }
      return true;
    };

    // Positions are ascending, so the first path found is the nearest one.
    const findNearestPath = (
      wordIndex: number,
      path: number[],
    ): number[] | null => {
      if (wordIndex === positionsByWord.length) return path;

      const lastPosition = path[path.length - 1];
      const joint = joints[wordIndex];
      for (const nextPosition of positionsByWord[wordIndex]) {
        if (nextPosition <= lastPosition) continue;
        // Later positions are further still: past the first that can't
        // follow, none can
        if (!canFollow(lastPosition, nextPosition, joint)) break;
        const found = findNearestPath(wordIndex + 1, [...path, nextPosition]);
        if (found) return found;
      }
      return null;
    };

    const sequences: number[][] = [];
    for (const startPosition of positionsByWord[0]) {
      const sequence = findNearestPath(1, [startPosition]);
      if (sequence) sequences.push(sequence);
    }
    return sequences;
  }
}
