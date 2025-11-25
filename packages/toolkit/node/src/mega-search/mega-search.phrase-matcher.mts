import { getDocumentToken } from './mega-search.utils.mjs';
import { UkrainianTextProcessor } from './text-processor.mjs';
import { DocumentIndex, InvertedIndexEntry } from './types.mjs';

export class PhraseMatcher {
  constructor(private textProcessor: UkrainianTextProcessor) {}

  /**
   * Efficiently count exact phrase occurrences
   */
  countExactPhrase(doc: DocumentIndex, queryTokens: string[]): number {
    let count = 0;
    const phraseLength = queryTokens.length;
    if (phraseLength === 0) return 0;

    for (let i = 0; i <= doc.positions.length - phraseLength; i++) {
      let match = true;
      for (let j = 0; j < phraseLength; j++) {
        const docToken = getDocumentToken(doc, i + j);
        if (
          !docToken ||
          this.textProcessor.stemWord(docToken.term) !== queryTokens[j]
        ) {
          match = false;
          break;
        }
      }
      if (match) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get candidate documents for a phrase search by finding the intersection
   * of documents containing each term.
   */
  getCandidateDocsForPhrase(
    queryTokens: string[],
    invertedIndex: Map<string, InvertedIndexEntry[]>,
  ): string[] {
    if (queryTokens.length === 0) return [];

    const docSets = queryTokens.map((token) => {
      const postings = invertedIndex.get(token) || [];
      return new Set(postings.map((p) => p.documentId));
    });

    if (docSets.length === 0) return [];

    let intersection = docSets[0];
    for (let i = 1; i < docSets.length; i++) {
      intersection = new Set(
        [...intersection].filter((docId) => docSets[i].has(docId)),
      );
    }

    return Array.from(intersection);
  }

  /**
   * Index-based fuzzy phrase search.
   */
  findDocsWithFuzzyPhrase(
    queryTokens: string[],
    options: { fuzzyThreshold: number; maxDistance: number },
    invertedIndex: Map<string, InvertedIndexEntry[]>,
    stemDictionary: Map<string, string[]>,
    docCache: Map<string, DocumentIndex>,
  ): Map<string, number[][]> {
    if (queryTokens.length === 0) return new Map();

    // 1. Find all fuzzy matching terms for each query token
    const termCandidatesPerQueryToken = queryTokens.map((queryToken) => {
      const stem = this.textProcessor.stemWord(queryToken);
      return stemDictionary.get(stem) || [];
    });

    // 2. Get document sets for each query token
    const docSets = termCandidatesPerQueryToken.map((candidates) => {
      const docIds = new Set<string>();
      for (const candidateWord of candidates) {
        const stem = this.textProcessor.stemWord(candidateWord);
        const postings = invertedIndex.get(stem);
        if (postings) {
          for (const p of postings) {
            docIds.add(p.documentId);
          }
        }
      }
      return docIds;
    });

    // 3. Find intersection
    if (docSets.some((s) => s.size === 0)) return new Map();
    let candidateDocIds = docSets[0];
    for (let i = 1; i < docSets.length; i++) {
      candidateDocIds = new Set(
        [...candidateDocIds].filter((docId) => docSets[i].has(docId)),
      );
    }

    // 4. Verify sequences
    const finalDocs = new Map<string, number[][]>();
    let processedCount = 0;

    for (const docId of candidateDocIds) {
      const doc = docCache.get(docId);
      if (!doc) continue;

      // Memory pressure check hook could go here if passed

      const matchesByToken = termCandidatesPerQueryToken.map((candidates) => {
        const positions: number[] = [];
        for (const candidateWord of candidates) {
          const stem = this.textProcessor.stemWord(candidateWord);
          const postings = invertedIndex.get(stem);
          const docPosting = postings?.find((p) => p.documentId === docId);

          if (docPosting) {
            for (const pos of docPosting.positions) {
              const actualWord = doc.vocab[doc.positions[pos][0]];
              if (actualWord.toLowerCase() === candidateWord) {
                positions.push(pos);
              }
            }
          }
        }
        return positions.sort((a, b) => a - b);
      });

      const sequences = this.findSequencesInPositions(
        matchesByToken,
        options.maxDistance,
      );
      if (sequences.length > 0) {
        finalDocs.set(docId, sequences);
      }
    }

    return finalDocs;
  }

  private findSequencesInPositions(
    matchesByToken: number[][],
    maxDistance: number,
  ): number[][] {
    if (matchesByToken.some((m) => m.length === 0)) {
      return [];
    }

    const findPaths = (
      tokenIndex: number,
      currentPath: number[],
    ): number[][] => {
      if (tokenIndex === matchesByToken.length) {
        return [currentPath];
      }

      const lastPosition = currentPath[currentPath.length - 1];
      const nextTokenPositions = matchesByToken[tokenIndex];
      let paths: number[][] = [];

      for (const nextPos of nextTokenPositions) {
        const distance = nextPos - lastPosition;
        if (distance > 0 && distance <= maxDistance) {
          const newPaths = findPaths(tokenIndex + 1, [...currentPath, nextPos]);
          paths = paths.concat(newPaths);
        }
      }
      return paths;
    };

    let allSequences: number[][] = [];
    for (const startPos of matchesByToken[0]) {
      allSequences = allSequences.concat(findPaths(1, [startPos]));
    }

    return allSequences;
  }
}
