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
    searchTokens: string[],
    uniqueQueryTokens: string[],
    isPhrase: boolean,
    fuzzy: boolean,
  ): HighlightInfo[] {
    const start = Date.now();
    const highlights: HighlightInfo[] = [];

    if (isPhrase && fuzzy) {
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
        for (const queryToken of searchTokens) {
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
      const queryTokenSet = new Set(uniqueQueryTokens);

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
            const queryToken = uniqueQueryTokens.find(
              (t) => t === docTokenStem,
            );

            highlights.push({
              term: queryToken || docTokenStem,
              originalWord: docTokenTerm,
              charStart: p[1],
              charEnd: p[2],
              confidence: fuzzy
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
    uniqueQueryTokens: string[],
    invertedIndex: Map<string, InvertedIndexEntry[]>,
    isPhrase: boolean,
    fuzzy: boolean,
    searchTokens: string[],
    matchPositions: number[][] | undefined,
    contextBefore: number,
    contextAfter: number,
  ): SnippetInfo[] {
    const start = Date.now();
    let snippets: SnippetInfo[] = [];

    if (isPhrase) {
      if (fuzzy) {
        snippets = this.extractFuzzyPhraseSnippets(
          doc,
          searchTokens,
          matchPositions,
          contextBefore,
          contextAfter,
        );
      } else {
        snippets = this.extractPhraseSnippets(
          doc,
          searchTokens,
          contextBefore,
          contextAfter,
        );
      }
    } else {
      snippets = this.extractTokenSnippets(
        doc,
        uniqueQueryTokens,
        invertedIndex,
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

  private extractFuzzyPhraseSnippets(
    doc: DocumentIndex,
    queryTokens: string[],
    sequences: number[][] | undefined,
    contextBefore: number,
    contextAfter: number,
  ): SnippetInfo[] {
    if (!sequences || sequences.length === 0) return [];

    const snippets: SnippetInfo[] = [];

    for (const sequencePositions of sequences) {
      if (sequencePositions.length !== queryTokens.length) continue;

      const sequence = sequencePositions.map((pos) =>
        getDocumentToken(doc, pos),
      );
      if (sequence.some((token) => token === null)) continue;

      const snippet = this.createSnippetFromSequence(
        doc,
        sequence as ProcessedSearchToken[],
        queryTokens,
        'fuzzy-phrase',
        contextBefore,
        contextAfter,
      );
      snippets.push(snippet);
    }

    return this.removeDuplicateSnippets(snippets);
  }

  private extractPhraseSnippets(
    doc: DocumentIndex,
    searchTokens: string[],
    contextBefore: number,
    contextAfter: number,
  ): SnippetInfo[] {
    const snippets: SnippetInfo[] = [];
    const phraseLength = searchTokens.length;
    if (phraseLength === 0) return [];

    for (let i = 0; i <= doc.positions.length - phraseLength; i++) {
      let isMatch = true;
      const sequence: ProcessedSearchToken[] = [];

      for (let j = 0; j < phraseLength; j++) {
        const token = getDocumentToken(doc, i + j);
        if (
          !token ||
          this.textProcessor.stemWord(token.term) !== searchTokens[j]
        ) {
          isMatch = false;
          break;
        }
        sequence.push(token);
      }

      if (isMatch) {
        const snippet = this.createSnippetFromSequence(
          doc,
          sequence,
          searchTokens,
          'exact-phrase',
          contextBefore,
          contextAfter,
        );
        snippets.push(snippet);
        i += phraseLength - 1;
      }
    }

    return this.removeDuplicateSnippets(snippets);
  }

  private extractTokenSnippets(
    doc: DocumentIndex,
    uniqueQueryTokens: string[],
    invertedIndex: Map<string, InvertedIndexEntry[]>,
    contextBefore: number,
    contextAfter: number,
  ): SnippetInfo[] {
    const snippets: SnippetInfo[] = [];
    const processedBounds = new Set<string>();
    const matchedTokenIndices = new Set<number>();

    doc.positions.forEach((p, tokenIndex) => {
      const docTokenTerm = doc.vocab[p[0]];
      const docTokenStem = this.textProcessor.stemWord(docTokenTerm);
      if (uniqueQueryTokens.includes(docTokenStem)) {
        matchedTokenIndices.add(tokenIndex);
      }
    });

    matchedTokenIndices.forEach((tokenIndex) => {
      const docToken = getDocumentToken(doc, tokenIndex);
      if (!docToken) return;

      const docTokenStem = this.textProcessor.stemWord(docToken.term);
      const queryToken = uniqueQueryTokens.find((qt) => qt === docTokenStem);
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

      const confidence = calculateMatchConfidence(queryToken, docTokenStem);

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
    queryTokens: string[],
    matchType: 'exact-phrase' | 'fuzzy-phrase',
    contextBefore: number,
    contextAfter: number,
  ): SnippetInfo {
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
      term: queryTokens[index],
      originalWord: match.term,
    }));

    const { text: highlightedText } = this.highlightTermsInSnippet(
      snippetText,
      termsToHighlight,
    );

    const snippetHighlights = sequence.map((match, index) => ({
      term: queryTokens[index],
      originalWord: match.term,
      tokenIndex: match.position,
      charStart: match.charStart,
      charEnd: match.charEnd,
    }));

    let confidence = 1.0;
    if (matchType === 'fuzzy-phrase') {
      const totalDistance = sequence.reduce((sum, match, index) => {
        const queryToken = queryTokens[index];
        return sum + levenshtein(match.term.toLowerCase(), queryToken);
      }, 0);
      confidence = Math.max(
        0.3,
        1.0 - totalDistance / (queryTokens.length * 3),
      );
    }

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
