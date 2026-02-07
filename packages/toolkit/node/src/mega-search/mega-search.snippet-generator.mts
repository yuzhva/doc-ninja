import { levenshtein } from './fuzzy.mjs';
import { LRUCache } from './lru-cache.mjs';
import type { HighlightInfo, SnippetInfo } from './mega-search.types.mjs';
import {
  calculateMatchConfidence,
  getDocumentToken,
} from './mega-search.utils.mjs';
import { createLogger } from './shared/logger.mjs';
import { UkrainianTextProcessor } from './text-processor.mjs';
import type {
  DocumentIndex,
  InvertedIndexEntry,
  ProcessedSearchToken,
} from './types.mjs';

const logger = createLogger('SnippetGenerator');

export class SnippetGenerator {
  // Caches for document vocabularies to avoid re-processing
  private stemmedVocabCache = new LRUCache<string, string[]>(200);
  private lowerVocabCache = new LRUCache<string, string[]>(200);

  constructor(private textProcessor: UkrainianTextProcessor) {}

  /**
   * Generate all highlights for a document.
   */
  generateHighlights(
    docId: string,
    doc: DocumentIndex,
    originalPhraseOrStemmedTokens: string[],
    isPhrase: boolean,
    isTypoToleranceEnabled: boolean,
  ): HighlightInfo[] {
    const start = Date.now();
    const highlights: HighlightInfo[] = [];

    if (isPhrase && isTypoToleranceEnabled) {
      // Use cached lowercased vocab
      let lowerVocab = this.lowerVocabCache.get(docId);
      if (!lowerVocab) {
        lowerVocab = doc.vocab.map((v) => v.toLowerCase());
        this.lowerVocabCache.set(docId, lowerVocab);
      }

      const matchingVocabIndices = new Map<
        number,
        { term: string; confidence: number }
      >();

      lowerVocab.forEach((vocabTermLower, index) => {
        for (const queryToken of originalPhraseOrStemmedTokens) {
          const distance = levenshtein(vocabTermLower, queryToken);
          if (distance <= 2) {
            const confidence =
              distance === 0 ? 1.0 : Math.max(0.5, 1.0 - distance * 0.2);
            if (
              !matchingVocabIndices.has(index) ||
              matchingVocabIndices.get(index)!.confidence < confidence
            ) {
              matchingVocabIndices.set(index, {
                term: queryToken,
                confidence,
              });
            }
          }
        }
      });

      if (matchingVocabIndices.size > 0) {
        doc.positions.forEach((p) => {
          const match = matchingVocabIndices.get(p[0]);
          if (match) {
            highlights.push({
              term: match.term,
              originalWord: doc.vocab[p[0]],
              charStart: p[1],
              charEnd: p[2],
              confidence: match.confidence,
            });
          }
        });
      }
    } else {
      // Regular highlight extraction
      let stemmedVocab = this.stemmedVocabCache.get(docId);
      if (!stemmedVocab) {
        stemmedVocab = doc.vocab.map((v) => this.textProcessor.stemWord(v));
        this.stemmedVocabCache.set(docId, stemmedVocab);
      }

      const matchingVocabIndices = new Set<number>();
      const queryTokenSet = new Set(originalPhraseOrStemmedTokens);

      stemmedVocab.forEach((docTokenStem, index) => {
        if (queryTokenSet.has(docTokenStem)) {
          matchingVocabIndices.add(index);
        }
      });

      if (matchingVocabIndices.size > 0) {
        doc.positions.forEach((p) => {
          if (matchingVocabIndices.has(p[0])) {
            const docTokenTerm = doc.vocab[p[0]];
            const docTokenStem = stemmedVocab![p[0]];
            const queryToken = originalPhraseOrStemmedTokens.find(
              (t) => t === docTokenStem,
            );

            highlights.push({
              term: queryToken || docTokenStem,
              originalWord: docTokenTerm,
              charStart: p[1],
              charEnd: p[2],
              confidence: isTypoToleranceEnabled
                ? calculateMatchConfidence(
                    queryToken || docTokenStem,
                    docTokenStem,
                  )
                : 1.0,
            });
          }
        });
      }
    }

    const duration = Date.now() - start;
    if (duration > 10) {
      logger.info(
        `[PERF] Highlights generation for ${doc.metadata.fileName}: ${duration}ms`,
      );
    }

    return highlights;
  }

  /**
   * Main entry point for snippet generation.
   */
  generateSnippets(
    doc: DocumentIndex,
    originalPhraseOrStemmedTokens: string[],
    invertedIndex: Map<string, InvertedIndexEntry[]>,
    isPhrase: boolean,
    isTypoToleranceEnabled: boolean,
    matchPositions: number[][] | undefined,
    contextBefore: number,
    contextAfter: number,
  ): SnippetInfo[] {
    const start = Date.now();
    let snippets: SnippetInfo[] = [];

    if (isPhrase) {
      // matchPositions already contains the correct matches from PhraseMatcher
      snippets = this.extractPhraseSnippetsFromPositions(
        doc,
        originalPhraseOrStemmedTokens,
        matchPositions,
        isTypoToleranceEnabled,
        contextBefore,
        contextAfter,
      );
    } else {
      snippets = this.extractTokenSnippets(
        doc,
        originalPhraseOrStemmedTokens,
        isTypoToleranceEnabled,
        contextBefore,
        contextAfter,
      );
    }

    const duration = Date.now() - start;
    if (duration > 10) {
      logger.info(
        `[PERF] Snippet extraction for ${doc.metadata.fileName}: ${duration}ms`,
      );
    }
    return snippets;
  }

  /**
   * ✅ UNIFIED: Extract phrase snippets from pre-computed match positions
   * Works for both strict and fuzzy phrase search
   */
  private extractPhraseSnippetsFromPositions(
    doc: DocumentIndex,
    originalPhraseOrStemmedTokens: string[],
    sequences: number[][] | undefined,
    isTypoToleranceEnabled: boolean,
    contextBefore: number,
    contextAfter: number,
  ): SnippetInfo[] {
    if (!sequences || sequences.length === 0) return [];

    const snippets: SnippetInfo[] = [];

    for (const sequencePositions of sequences) {
      if (sequencePositions.length !== originalPhraseOrStemmedTokens.length)
        continue;

      const sequence = sequencePositions.map((pos) =>
        getDocumentToken(doc, pos),
      );
      if (sequence.some((token) => token === null)) continue;

      const matchType = isTypoToleranceEnabled
        ? 'fuzzy-phrase'
        : 'exact-phrase';

      const snippet = this.createSnippetFromSequence(
        doc,
        sequence as ProcessedSearchToken[],
        originalPhraseOrStemmedTokens,
        matchType,
        contextBefore,
        contextAfter,
      );
      if (snippet) snippets.push(snippet);
    }

    return this.removeDuplicateSnippets(snippets);
  }

  private extractTokenSnippets(
    doc: DocumentIndex,
    originalPhraseOrStemmedTokens: string[],
    isTypoToleranceEnabled: boolean,
    contextBefore: number,
    contextAfter: number,
  ): SnippetInfo[] {
    const snippets: SnippetInfo[] = [];
    const processedBounds = new Set<string>();
    const matchedTokenIndices = new Set<number>();

    doc.positions.forEach((p, tokenIndex) => {
      const docTokenTerm = doc.vocab[p[0]];
      const docTokenToCompare = isTypoToleranceEnabled
        ? this.textProcessor.stemWord(docTokenTerm)
        : docTokenTerm.toLowerCase();
      if (originalPhraseOrStemmedTokens.includes(docTokenToCompare)) {
        matchedTokenIndices.add(tokenIndex);
      }
    });

    matchedTokenIndices.forEach((tokenIndex) => {
      const docToken = getDocumentToken(doc, tokenIndex);
      if (!docToken) return;

      const docTokenToCompare = isTypoToleranceEnabled
        ? this.textProcessor.stemWord(docToken.term)
        : docToken.term.toLowerCase();
      const queryToken = originalPhraseOrStemmedTokens.find(
        (qt) => qt === docTokenToCompare,
      );
      if (!queryToken) return;

      const snippetBounds = this.findSentenceBoundariesForSnippet(
        doc,
        tokenIndex,
        tokenIndex,
        contextBefore,
        contextAfter,
      );

      const boundsKey = `${snippetBounds.start}-${snippetBounds.end}`;
      if (processedBounds.has(boundsKey)) return;
      processedBounds.add(boundsKey);

      const tokensForSnippet = doc.positions
        .slice(snippetBounds.start, snippetBounds.end)
        .map((p) => doc.vocab[p[0]]);
      const snippetText = tokensForSnippet.join(' ');

      const { text: highlightedText } = this.highlightTermsInSnippet(
        snippetText,
        [{ term: queryToken, originalWord: docToken.term }],
      );

      const confidence = isTypoToleranceEnabled
        ? calculateMatchConfidence(queryToken, docTokenToCompare)
        : 1.0;

      snippets.push({
        context: highlightedText + '...',
        match: docToken.term,
        matchStartTokenIndex: tokenIndex,
        matchEndTokenIndex: tokenIndex,
        matchCharStart: docToken.charStart,
        matchCharEnd: docToken.charEnd,
        matchType: 'token',
        confidence,
        highlights: [
          {
            term: queryToken,
            originalWord: docToken.term,
            tokenIndex,
            charStart: docToken.charStart,
            charEnd: docToken.charEnd,
          },
        ],
      });
    });

    return this.removeDuplicateSnippets(snippets);
  }

  private createSnippetFromSequence(
    doc: DocumentIndex,
    sequence: ProcessedSearchToken[],
    originalPhraseOrStemmedTokens: string[],
    matchType: 'exact-phrase' | 'fuzzy-phrase',
    contextBefore: number,
    contextAfter: number,
  ): SnippetInfo | null {
    if (
      !this.isValidMatch(sequence, originalPhraseOrStemmedTokens, matchType)
    ) {
      return null;
    }

    const matchStartPos = sequence[0].position;
    const matchEndPos = sequence[sequence.length - 1].position;

    const snippetBounds = this.findSentenceBoundariesForSnippet(
      doc,
      matchStartPos,
      matchEndPos,
      contextBefore,
      contextAfter,
    );

    const tokensForSnippet = doc.positions
      .slice(snippetBounds.start, snippetBounds.end)
      .map((p) => doc.vocab[p[0]]);
    const snippetText = tokensForSnippet.join(' ');

    const termsToHighlight = sequence.map((match, index) => ({
      term: originalPhraseOrStemmedTokens[index],
      originalWord: match.term,
    }));

    const { text: highlightedText } = this.highlightTermsInSnippet(
      snippetText,
      termsToHighlight,
    );

    const snippetHighlights = sequence.map((match, index) => ({
      term: originalPhraseOrStemmedTokens[index],
      originalWord: match.term,
      tokenIndex: match.position,
      charStart: match.charStart,
      charEnd: match.charEnd,
    }));

    const confidence = this.calculateSequenceConfidence(
      sequence,
      originalPhraseOrStemmedTokens,
      matchType,
    );

    const matchedText = sequence.map((s) => s.term).join(' ');

    return {
      context: highlightedText + '...',
      match: matchedText,
      matchStartTokenIndex: matchStartPos,
      matchEndTokenIndex: matchEndPos,
      matchCharStart: sequence[0].charStart,
      matchCharEnd: sequence[sequence.length - 1].charEnd,
      matchType,
      confidence,
      highlights: snippetHighlights,
    };
  }

  private isValidMatch(
    sequence: ProcessedSearchToken[],
    queryTokens: string[],
    matchType: 'exact-phrase' | 'fuzzy-phrase',
  ): boolean {
    if (matchType === 'exact-phrase') {
      return sequence.every((token, index) => {
        const queryToken = queryTokens[index];
        return token.term.toLowerCase() === queryToken.toLowerCase();
      });
    }
    return true;
  }

  private calculateSequenceConfidence(
    sequence: ProcessedSearchToken[],
    queryTokens: string[],
    matchType: 'exact-phrase' | 'fuzzy-phrase',
  ): number {
    if (matchType === 'exact-phrase') {
      return 1.0;
    }

    const totalDistance = sequence.reduce((sum, match, index) => {
      const queryToken = queryTokens[index];
      return sum + levenshtein(match.term.toLowerCase(), queryToken);
    }, 0);

    return Math.max(0.3, 1.0 - totalDistance / (queryTokens.length * 3));
  }

  private findSentenceBoundariesForSnippet(
    doc: DocumentIndex,
    matchStartPos: number,
    matchEndPos: number,
    contextBefore: number,
    contextAfter: number,
  ): { start: number; end: number } {
    const isBoundaryToken = (
      tokenIndex: number,
      direction: 'forward' | 'backward',
    ): boolean => {
      const token = doc.vocab[doc.positions[tokenIndex][0]];
      if (/[.!?]$/.test(token) || ['?', '!', ';', '.'].includes(token)) {
        return true;
      }
      return false;
    };

    let sentenceStart = Math.max(0, matchStartPos - contextBefore);
    for (let i = matchStartPos - 1; i >= sentenceStart; i--) {
      if (isBoundaryToken(i, 'backward')) {
        sentenceStart = i + 1;
        break;
      }
    }

    let sentenceEnd = Math.min(
      doc.positions.length,
      matchEndPos + contextAfter,
    );
    for (let i = matchEndPos + 1; i < sentenceEnd; i++) {
      if (isBoundaryToken(i, 'forward')) {
        const token = doc.vocab[doc.positions[i][0]];
        if (/[.!?]$/.test(token) || ['?', '!', ';', '.'].includes(token)) {
          sentenceEnd = i + 1;
        } else {
          sentenceEnd = i;
        }
        break;
      }
    }

    let bufferStart = Math.max(0, sentenceStart);
    let bufferEnd = Math.min(doc.positions.length, sentenceEnd);

    const MAX_SNIPPET_TOKENS = Math.max(
      100,
      contextBefore + contextAfter + (matchEndPos - matchStartPos),
    );
    const snippetTokenCount = bufferEnd - bufferStart;

    if (snippetTokenCount > MAX_SNIPPET_TOKENS) {
      const matchCenter = (matchStartPos + matchEndPos) / 2;
      const halfWindow = MAX_SNIPPET_TOKENS / 2;
      bufferStart = Math.max(0, Math.floor(matchCenter - halfWindow));
      bufferEnd = Math.min(
        doc.positions.length,
        Math.ceil(matchCenter + halfWindow),
      );
    }

    return { start: bufferStart, end: bufferEnd };
  }

  private highlightTermsInSnippet(
    snippetText: string,
    termsToHighlight: Array<{ term: string; originalWord: string }>,
  ): { text: string; highlightedWords: string[] } {
    const highlightedWords: string[] = [];
    let text = snippetText;

    const uniqueTerms = [
      ...new Map(
        termsToHighlight.map((item) => [item.originalWord.toLowerCase(), item]),
      ).values(),
    ];

    if (uniqueTerms.length > 0) {
      uniqueTerms.sort((a, b) => b.originalWord.length - a.originalWord.length);
      const pattern = uniqueTerms
        .map((t) => this.escapeRegExp(t.originalWord))
        .join('|');
      const regex = new RegExp(`\\b(${pattern})\\b`, 'gi');

      text = text.replace(regex, (match) => {
        highlightedWords.push(match);
        return `<b>${match}</b>`;
      });
    }

    return { text, highlightedWords };
  }

  private removeDuplicateSnippets(snippets: SnippetInfo[]): SnippetInfo[] {
    const seen = new Set<string>();
    return snippets.filter((snippet) => {
      const simplifiedContext = snippet.context
        .replace(/<b>|<\/b>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (seen.has(simplifiedContext)) {
        return false;
      } else {
        seen.add(simplifiedContext);
        return true;
      }
    });
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
