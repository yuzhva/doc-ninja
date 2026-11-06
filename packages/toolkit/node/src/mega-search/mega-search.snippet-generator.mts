import * as fs from 'fs';

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
  // Cache for raw (pre-normalization) document text, keyed by docId.
  // Smaller cap than the token caches since full text is heavier per entry.
  private rawTextCache = new LRUCache<string, string>(50);

  constructor(private textProcessor: UkrainianTextProcessor) {}

  /**
   * Read the original raw document text (as written to disk pre-normalization),
   * for use cases where the normalized `doc.vocab` tokens (lowercased, stripped
   * of apostrophes/punctuation, stop words removed) are not suitable — e.g.
   * rendering snippet context or highlighting exact substrings.
   * Returns null if no text cache path is available or the read fails, so
   * callers can fall back to vocab-reconstructed text.
   */
  private async getRawText(doc: DocumentIndex): Promise<string | null> {
    const cacheKey = doc.metadata.originalFilePath;
    const cached = this.rawTextCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const textFilePath = doc.metadata.textFilePath;
    if (!textFilePath) return null;

    try {
      const text = await fs.promises.readFile(textFilePath, 'utf8');
      this.rawTextCache.set(cacheKey, text);
      return text;
    } catch (error) {
      logger.warn(
        `Failed to read raw text for ${doc.metadata.fileName} at ${textFilePath}:`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  /**
   * Resolve the display text for a token-index range [start, end) within a
   * snippet. Prefers an exact slice of the raw (pre-normalization) document
   * text via char offsets — preserving original casing, apostrophes, stop
   * words, and punctuation. Falls back to joining normalized `doc.vocab`
   * tokens only if the raw text cache is unavailable (e.g. missing/unreadable
   * textFilePath), which reproduces the previous (lossy) behavior.
   *
   * `rawCharStart` is the absolute offset in the raw document where `text`
   * begins — callers use it to translate a match's absolute charStart/charEnd
   * into an offset relative to `text` for highlighting. It's `null` when the
   * vocab-join fallback was used, since those offsets aren't meaningful.
   */
  private async getSnippetText(
    doc: DocumentIndex,
    snippetBounds: { start: number; end: number },
  ): Promise<{ text: string; rawCharStart: number | null }> {
    const boundTokens = doc.positions.slice(
      snippetBounds.start,
      snippetBounds.end,
    );
    if (boundTokens.length === 0) return { text: '', rawCharStart: null };

    const rawText = await this.getRawText(doc);
    if (rawText !== null) {
      const charStart = boundTokens[0][1];
      const charEnd = boundTokens[boundTokens.length - 1][2];
      return {
        text: rawText.slice(charStart, charEnd),
        rawCharStart: charStart,
      };
    }

    return {
      text: boundTokens.map((p) => doc.vocab[p[0]]).join(' '),
      rawCharStart: null,
    };
  }

  /**
   * Slice the exact raw substring for a [charStart, charEnd) match span —
   * preserving original casing/apostrophes/punctuation, unlike rejoining
   * normalized `ProcessedSearchToken.term` values. Falls back to `fallback`
   * (the previous normalized-join behavior) if raw text is unavailable.
   */
  private async getRawSubstring(
    doc: DocumentIndex,
    charStart: number,
    charEnd: number,
    fallback: string,
  ): Promise<string> {
    const rawText = await this.getRawText(doc);
    if (rawText !== null) {
      return rawText.slice(charStart, charEnd);
    }
    return fallback;
  }

  /**
   * Wrap each [start, end) span in `<b>` tags by direct index splicing —
   * no pattern matching involved, so it can't highlight the wrong
   * occurrence of a term and isn't affected by casing/apostrophe/punctuation
   * differences between the query term and the matched text. Spans are
   * clamped to `text`'s bounds and processed right-to-left so earlier
   * offsets never shift; spans that overlap an already-wrapped span are
   * dropped rather than risk malformed/nested tags.
   */
  private spliceHighlightSpans(
    text: string,
    spans: Array<{ start: number; end: number }>,
  ): string {
    const validSpans = spans
      .map((s) => ({
        start: Math.max(0, Math.min(s.start, text.length)),
        end: Math.max(0, Math.min(s.end, text.length)),
      }))
      .filter((s) => s.end > s.start)
      .sort((a, b) => b.start - a.start);

    let result = text;
    let rightBoundary = text.length + 1;
    for (const span of validSpans) {
      if (span.end > rightBoundary) continue;
      result =
        result.slice(0, span.start) +
        '<b>' +
        result.slice(span.start, span.end) +
        '</b>' +
        result.slice(span.end);
      rightBoundary = span.start;
    }
    return result;
  }

  /**
   * Highlight a snippet's matched term(s) within `text`. When `rawCharStart`
   * is known (i.e. `text` is a raw-text slice), translates each span's
   * absolute document offsets into offsets relative to `text` and splices
   * `<b>` tags in directly — exact by construction. Falls back to the older
   * regex-based `highlightTermsInSnippet` only when raw offsets aren't
   * available (vocab-join fallback path).
   */
  private highlightSnippet(
    text: string,
    rawCharStart: number | null,
    spans: Array<{ charStart?: number; charEnd?: number }>,
    fallbackTerms: Array<{ term: string; originalWord: string }>,
  ): string {
    if (rawCharStart !== null) {
      const relativeSpans = spans
        .filter(
          (s): s is { charStart: number; charEnd: number } =>
            typeof s.charStart === 'number' && typeof s.charEnd === 'number',
        )
        .map((s) => ({
          start: s.charStart - rawCharStart,
          end: s.charEnd - rawCharStart,
        }));

      if (relativeSpans.length > 0) {
        return this.spliceHighlightSpans(text, relativeSpans);
      }
    }

    return this.highlightTermsInSnippet(text, fallbackTerms).text;
  }

  /**
   * In token mode, the query term a document term stands for: the term
   * itself when it is one of the query tokens, or — via `termAliases` — the
   * query token it was matched to through typo tolerance.
   */
  private resolveQueryTerm(
    docTerm: string,
    queryTokens: string[],
    termAliases: ReadonlyMap<string, string>,
  ): string | undefined {
    return queryTokens.includes(docTerm) ? docTerm : termAliases.get(docTerm);
  }

  /**
   * Generate all highlights for a document.
   *
   * @param termAliases Token mode only: index terms the query matched through
   *   typo tolerance, mapped to the query token each one stands for.
   */
  generateHighlights(
    docId: string,
    doc: DocumentIndex,
    originalPhraseOrStemmedTokens: string[],
    isPhrase: boolean,
    isTypoToleranceEnabled: boolean,
    termAliases: ReadonlyMap<string, string> = new Map(),
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

      stemmedVocab.forEach((docTokenStem, index) => {
        if (
          this.resolveQueryTerm(
            docTokenStem,
            originalPhraseOrStemmedTokens,
            termAliases,
          ) !== undefined
        ) {
          matchingVocabIndices.add(index);
        }
      });

      if (matchingVocabIndices.size > 0) {
        doc.positions.forEach((p) => {
          if (matchingVocabIndices.has(p[0])) {
            const docTokenTerm = doc.vocab[p[0]];
            const docTokenStem = stemmedVocab![p[0]];
            const queryToken = this.resolveQueryTerm(
              docTokenStem,
              originalPhraseOrStemmedTokens,
              termAliases,
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
   *
   * @param termAliases See generateHighlights.
   */
  async generateSnippets(
    doc: DocumentIndex,
    originalPhraseOrStemmedTokens: string[],
    invertedIndex: Map<string, InvertedIndexEntry[]>,
    isPhrase: boolean,
    isTypoToleranceEnabled: boolean,
    matchPositions: number[][] | undefined,
    contextBefore: number,
    contextAfter: number,
    termAliases: ReadonlyMap<string, string> = new Map(),
  ): Promise<SnippetInfo[]> {
    const start = Date.now();
    let snippets: SnippetInfo[] = [];

    if (isPhrase) {
      // matchPositions already contains the correct matches from PhraseMatcher
      snippets = await this.extractPhraseSnippetsFromPositions(
        doc,
        originalPhraseOrStemmedTokens,
        matchPositions,
        isTypoToleranceEnabled,
        contextBefore,
        contextAfter,
      );
    } else {
      snippets = await this.extractTokenSnippets(
        doc,
        originalPhraseOrStemmedTokens,
        isTypoToleranceEnabled,
        contextBefore,
        contextAfter,
        termAliases,
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
  private async extractPhraseSnippetsFromPositions(
    doc: DocumentIndex,
    originalPhraseOrStemmedTokens: string[],
    sequences: number[][] | undefined,
    isTypoToleranceEnabled: boolean,
    contextBefore: number,
    contextAfter: number,
  ): Promise<SnippetInfo[]> {
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

      const snippet = await this.createSnippetFromSequence(
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

  private async extractTokenSnippets(
    doc: DocumentIndex,
    originalPhraseOrStemmedTokens: string[],
    isTypoToleranceEnabled: boolean,
    contextBefore: number,
    contextAfter: number,
    termAliases: ReadonlyMap<string, string>,
  ): Promise<SnippetInfo[]> {
    const snippets: SnippetInfo[] = [];
    const processedBounds = new Set<string>();
    const matchedTokenIndices = new Set<number>();

    doc.positions.forEach((p, tokenIndex) => {
      const docTokenTerm = doc.vocab[p[0]];
      const docTokenToCompare = isTypoToleranceEnabled
        ? this.textProcessor.stemWord(docTokenTerm)
        : docTokenTerm.toLowerCase();
      if (
        this.resolveQueryTerm(
          docTokenToCompare,
          originalPhraseOrStemmedTokens,
          termAliases,
        ) !== undefined
      ) {
        matchedTokenIndices.add(tokenIndex);
      }
    });

    for (const tokenIndex of matchedTokenIndices) {
      const docToken = getDocumentToken(doc, tokenIndex);
      if (!docToken) continue;

      const docTokenToCompare = isTypoToleranceEnabled
        ? this.textProcessor.stemWord(docToken.term)
        : docToken.term.toLowerCase();
      const queryToken = this.resolveQueryTerm(
        docTokenToCompare,
        originalPhraseOrStemmedTokens,
        termAliases,
      );
      if (!queryToken) continue;

      const snippetBounds = await this.findSentenceBoundariesForSnippet(
        doc,
        tokenIndex,
        tokenIndex,
        contextBefore,
        contextAfter,
      );

      const boundsKey = `${snippetBounds.start}-${snippetBounds.end}`;
      if (processedBounds.has(boundsKey)) continue;
      processedBounds.add(boundsKey);

      const { text: snippetText, rawCharStart } = await this.getSnippetText(
        doc,
        snippetBounds,
      );

      const highlightedText = this.highlightSnippet(
        snippetText,
        rawCharStart,
        [{ charStart: docToken.charStart, charEnd: docToken.charEnd }],
        [{ term: queryToken, originalWord: docToken.term }],
      );

      const confidence = isTypoToleranceEnabled
        ? calculateMatchConfidence(queryToken, docTokenToCompare)
        : 1.0;

      const matchedText = await this.getRawSubstring(
        doc,
        docToken.charStart,
        docToken.charEnd,
        docToken.term,
      );

      snippets.push({
        context: highlightedText + '...',
        match: matchedText,
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
    }

    return this.removeDuplicateSnippets(snippets);
  }

  private async createSnippetFromSequence(
    doc: DocumentIndex,
    sequence: ProcessedSearchToken[],
    originalPhraseOrStemmedTokens: string[],
    matchType: 'exact-phrase' | 'fuzzy-phrase',
    contextBefore: number,
    contextAfter: number,
  ): Promise<SnippetInfo | null> {
    if (
      !this.isValidMatch(sequence, originalPhraseOrStemmedTokens, matchType)
    ) {
      return null;
    }

    const matchStartPos = sequence[0].position;
    const matchEndPos = sequence[sequence.length - 1].position;

    const snippetBounds = await this.findSentenceBoundariesForSnippet(
      doc,
      matchStartPos,
      matchEndPos,
      contextBefore,
      contextAfter,
    );

    const { text: snippetText, rawCharStart } = await this.getSnippetText(
      doc,
      snippetBounds,
    );

    const termsToHighlight = sequence.map((match, index) => ({
      term: originalPhraseOrStemmedTokens[index],
      originalWord: match.term,
    }));

    const highlightedText = this.highlightSnippet(
      snippetText,
      rawCharStart,
      sequence.map((match) => ({
        charStart: match.charStart,
        charEnd: match.charEnd,
      })),
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

    const matchedText = await this.getRawSubstring(
      doc,
      sequence[0].charStart,
      sequence[sequence.length - 1].charEnd,
      sequence.map((s) => s.term).join(' '),
    );

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

  private async findSentenceBoundariesForSnippet(
    doc: DocumentIndex,
    matchStartPos: number,
    matchEndPos: number,
    contextBefore: number,
    contextAfter: number,
  ): Promise<{ start: number; end: number }> {
    // Punctuation is never tokenized as its own vocab entry (the tokenizer's
    // character class only captures letters/apostrophes/hyphens — see
    // UkrainianTextProcessor.tokenize), so a sentence terminator always lands
    // in the raw text immediately after the preceding word token's charEnd,
    // never as a vocab token of its own. Checking raw text here is what makes
    // boundary detection actually work, vs. the previous vocab-token check
    // (which could never match and always fell through to the fixed window).
    const rawText = await this.getRawText(doc);

    const isBoundaryToken = (tokenIndex: number): boolean => {
      if (rawText !== null) {
        const charEnd = doc.positions[tokenIndex][2];
        return charEnd < rawText.length && '.!?;'.includes(rawText[charEnd]);
      }

      // Degraded fallback when raw text is unavailable: preserves the old
      // (effectively dead) behavior rather than failing outright.
      const token = doc.vocab[doc.positions[tokenIndex][0]];
      return /[.!?;]$/.test(token) || ['?', '!', ';', '.'].includes(token);
    };

    let sentenceStart = Math.max(0, matchStartPos - contextBefore);
    for (let i = matchStartPos - 1; i >= sentenceStart; i--) {
      if (isBoundaryToken(i)) {
        sentenceStart = i + 1;
        break;
      }
    }

    let sentenceEnd = Math.min(
      doc.positions.length,
      matchEndPos + contextAfter,
    );
    for (let i = matchEndPos + 1; i < sentenceEnd; i++) {
      if (isBoundaryToken(i)) {
        sentenceEnd = i + 1;
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
      // `\b` only knows ASCII word characters, so it never matches around
      // Cyrillic words — use Unicode-aware lookarounds instead.
      const regex = new RegExp(
        `(?<![\\p{L}\\p{N}_])(${pattern})(?![\\p{L}\\p{N}_])`,
        'giu',
      );

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
