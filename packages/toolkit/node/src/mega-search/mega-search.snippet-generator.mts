import * as fs from 'fs';

import { editDistance } from './fuzzy.mjs';
import { LRUCache } from './lru-cache.mjs';
import type { MatchedWord } from './mega-search.term-matcher.mjs';
import type { HighlightInfo, SnippetInfo } from './mega-search.types.mjs';
import { getDocumentToken, isWordAt } from './mega-search.utils.mjs';
import { createLogger } from './shared/logger.mjs';
import { UkrainianTextProcessor } from './text-processor.mjs';
import type { DocumentIndex, ProcessedSearchToken } from './types.mjs';

const logger = createLogger('SnippetGenerator');
const textProcessor = new UkrainianTextProcessor();

/** How many of a document's words isTextOf compares, at most. */
const WORDS_COMPARED = 32;

/**
 * Whether `text` is the text `doc` was indexed from: its words, spread over
 * the whole text, are where the index has them.
 *
 * The text cache on disk holds a file's latest text only. While an update
 * replaces `doc` with a newer version, a search still reads `doc` (see
 * FileIndexer), and its offsets would cut the newer text into other words
 * ("Наказ про відпустку" read as "Кошт"). An edit that moves no word and
 * keeps every compared one may go unnoticed.
 */
function isTextOf(text: string, doc: DocumentIndex): boolean {
  const { positions, vocab } = doc;
  if (positions.length === 0) return true;
  if (text.length < positions.charEnd(positions.length - 1)) return false;

  const steps = Math.min(WORDS_COMPARED, positions.length) - 1;
  for (let step = 0; step <= steps; step++) {
    const i =
      steps === 0 ? 0 : Math.round((step * (positions.length - 1)) / steps);
    const word = textProcessor.normalize(
      text.slice(positions.charStart(i), positions.charEnd(i)),
    );
    if (word !== vocab[positions.vocabIndex(i)]) return false;
  }
  return true;
}

type SnippetRequest = {
  /**
   * The query words as matches report them (WordMatch.queryToken): stems
   * with fuzzy match on, the words as typed otherwise. In phrase order.
   */
  queryTokens: string[];
  /** Every document word the query matched (see mergeMatchedWords). */
  matchedWords: ReadonlyMap<string, MatchedWord>;
  isFuzzy: boolean;
  isPhrase: boolean;
  /** Phrase searches: the token positions of each phrase occurrence. */
  phraseSequences?: number[][];
  contextBefore: number;
  contextAfter: number;
};

export type { SnippetRequest };

export class SnippetGenerator {
  // Raw (pre-normalization) text per version of a document — null for a
  // version whose text is gone. A reindexed document has new positions, so
  // the text of its previous version must never be cut by them. Full text is
  // heavy per entry, hence the small cap.
  private rawTextCache = new LRUCache<string, string | null>(50);

  /**
   * Read the original raw document text (as written to disk pre-normalization),
   * for use cases where the normalized `doc.vocab` tokens (lowercased, stripped
   * of apostrophes/punctuation) are not suitable — e.g.
   * rendering snippet context or highlighting exact substrings.
   * Returns null if no text cache path is available, the read fails, or the
   * text is no longer this version's (see isTextOf), so callers can fall back
   * to vocab-reconstructed text.
   */
  private async getRawText(doc: DocumentIndex): Promise<string | null> {
    const { originalFilePath, lastModified } = doc.metadata;
    const cacheKey = `${originalFilePath}\u0000${lastModified}`;
    const cached = this.rawTextCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const textFilePath = doc.metadata.textFilePath;
    if (!textFilePath) return null;

    try {
      const read = await fs.promises.readFile(textFilePath, 'utf8');
      const text = isTextOf(read, doc) ? read : null;
      if (text === null) {
        logger.debug(
          `Raw text of ${doc.metadata.fileName} is of a newer version, using its index words`,
        );
      }
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
   * text via char offsets — preserving original casing, apostrophes, single
   * letters, and punctuation. Falls back to joining normalized `doc.vocab`
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
    const { positions } = doc;
    const first = snippetBounds.start;
    const last = Math.min(snippetBounds.end, positions.length) - 1;
    if (last < first) return { text: '', rawCharStart: null };

    const rawText = await this.getRawText(doc);
    if (rawText !== null) {
      const charStart = positions.charStart(first);
      const charEnd = positions.charEnd(last);
      return {
        text: rawText.slice(charStart, charEnd),
        rawCharStart: charStart,
      };
    }

    const words: string[] = [];
    for (let i = first; i <= last; i++) {
      words.push(doc.vocab[positions.vocabIndex(i)]);
    }
    return { text: words.join(' '), rawCharStart: null };
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
   * Every occurrence of a matched word in the document, with raw char offsets.
   */
  generateHighlights(
    doc: DocumentIndex,
    matchedWords: ReadonlyMap<string, MatchedWord>,
  ): HighlightInfo[] {
    const start = Date.now();
    const highlights: HighlightInfo[] = [];

    const { positions } = doc;
    for (let token = 0; token < positions.length; token++) {
      const originalWord = doc.vocab[positions.vocabIndex(token)];
      const matched = matchedWords.get(originalWord);
      if (!matched) continue;
      const charStart = positions.charStart(token);
      const charEnd = positions.charEnd(token);

      highlights.push({
        term: matched.queryToken,
        originalWord,
        charStart,
        charEnd,
        confidence: matched.confidence,
      });
    }

    const duration = Date.now() - start;
    if (duration > 10) {
      logger.debug(
        `[PERF] Highlights generation for ${doc.metadata.fileName}: ${duration}ms`,
      );
    }

    return highlights;
  }

  /**
   * The document's snippets, in text order — the first `limit` of them,
   * the rest never generated.
   */
  async generateSnippets(
    doc: DocumentIndex,
    request: SnippetRequest,
    limit = Infinity,
  ): Promise<SnippetInfo[]> {
    const start = Date.now();
    let snippets: SnippetInfo[] = [];

    if (request.isPhrase) {
      // the sequences already are the matches PhraseMatcher verified
      snippets = await this.extractPhraseSnippetsFromPositions(
        doc,
        request.queryTokens,
        request.phraseSequences,
        request.isFuzzy,
        request.contextBefore,
        request.contextAfter,
        limit,
      );
    } else {
      snippets = await this.extractTokenSnippets(
        doc,
        request.matchedWords,
        request.contextBefore,
        request.contextAfter,
        limit,
      );
    }

    const duration = Date.now() - start;
    if (duration > 10) {
      logger.debug(
        `[PERF] Snippet extraction for ${doc.metadata.fileName}: ${duration}ms`,
      );
    }
    return snippets;
  }

  /**
   * One snippet per phrase occurrence PhraseMatcher found, strict and fuzzy
   * alike. Snippets of the same text at different places are all kept: each
   * is its own match, and its own extraction row in be-krang.
   */
  private async extractPhraseSnippetsFromPositions(
    doc: DocumentIndex,
    originalPhraseOrStemmedTokens: string[],
    sequences: number[][] | undefined,
    isFuzzy: boolean,
    contextBefore: number,
    contextAfter: number,
    limit: number,
  ): Promise<SnippetInfo[]> {
    if (!sequences || sequences.length === 0) return [];

    const snippets: SnippetInfo[] = [];

    for (const sequencePositions of sequences) {
      if (snippets.length >= limit) break;
      if (sequencePositions.length !== originalPhraseOrStemmedTokens.length)
        continue;

      const sequence = sequencePositions.map((pos) =>
        getDocumentToken(doc, pos),
      );
      if (sequence.some((token) => token === null)) continue;

      const matchType = isFuzzy ? 'fuzzy-phrase' : 'exact-phrase';

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

    return snippets;
  }

  /**
   * One snippet per occurrence of a matched word, unless an earlier one
   * already has the very same window. As with phrases, the same text at
   * different places gives a snippet each.
   */
  private async extractTokenSnippets(
    doc: DocumentIndex,
    matchedWords: ReadonlyMap<string, MatchedWord>,
    contextBefore: number,
    contextAfter: number,
    limit: number,
  ): Promise<SnippetInfo[]> {
    const snippets: SnippetInfo[] = [];
    const processedBounds = new Set<string>();

    for (let tokenIndex = 0; tokenIndex < doc.positions.length; tokenIndex++) {
      if (snippets.length >= limit) break;
      const matched = matchedWords.get(
        doc.vocab[doc.positions.vocabIndex(tokenIndex)],
      );
      if (!matched) continue;
      const { queryToken, confidence } = matched;

      const docToken = getDocumentToken(doc, tokenIndex);
      if (!docToken) continue;

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

    return snippets;
  }

  private async createSnippetFromSequence(
    doc: DocumentIndex,
    sequence: ProcessedSearchToken[],
    originalPhraseOrStemmedTokens: string[],
    matchType: 'exact-phrase' | 'fuzzy-phrase',
    contextBefore: number,
    contextAfter: number,
  ): Promise<SnippetInfo | null> {
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

  /**
   * Lowered by the edit distance between each matched word and its query
   * token: typos in either mode, and — with fuzzy match on, where the query
   * tokens are stems — the endings of inflected forms too.
   */
  private calculateSequenceConfidence(
    sequence: ProcessedSearchToken[],
    queryTokens: string[],
  ): number {
    const totalDistance = sequence.reduce((sum, match, index) => {
      const queryToken = queryTokens[index];
      return sum + editDistance(match.term.toLowerCase(), queryToken);
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
    // Punctuation is never tokenized as its own vocab entry (tokens are words
    // and runs of digits only — see UkrainianTextProcessor.tokenize), so a
    // sentence terminator always lands in the raw text immediately after the
    // preceding token's charEnd, never as a vocab token of its own. Checking raw text here is what makes
    // boundary detection actually work, vs. the previous vocab-token check
    // (which could never match and always fell through to the fixed window).
    const rawText = await this.getRawText(doc);

    const isBoundaryToken = (tokenIndex: number): boolean => {
      if (rawText !== null) {
        const charEnd = doc.positions.charEnd(tokenIndex);
        return charEnd < rawText.length && '.!?;'.includes(rawText[charEnd]);
      }

      // Degraded fallback when raw text is unavailable: preserves the old
      // (effectively dead) behavior rather than failing outright.
      const token = doc.vocab[doc.positions.vocabIndex(tokenIndex)];
      return /[.!?;]$/.test(token) || ['?', '!', ';', '.'].includes(token);
    };

    // The context is counted in words, and ends at a word: numbers within it
    // are shown, but neither use it up nor end a sentence ("від 21.11.2022.
    // Затвердити"), so a snippet holds the words it held before numbers were
    // indexed.
    let sentenceStart = matchStartPos;
    for (
      let i = matchStartPos - 1, words = 0;
      i >= 0 && words < contextBefore;
      i--
    ) {
      if (!isWordAt(doc, i)) continue;
      if (isBoundaryToken(i)) break;
      words++;
      sentenceStart = i;
    }

    // contextAfter counts the match's last token as its first word
    let sentenceEnd = matchEndPos;
    for (
      let i = matchEndPos, words = 0;
      i < doc.positions.length && words < contextAfter;
      i++
    ) {
      const isMatchEnd = i === matchEndPos;
      if (!isMatchEnd && !isWordAt(doc, i)) continue;
      words++;
      sentenceEnd = i + 1;
      if (!isMatchEnd && isBoundaryToken(i)) break;
    }

    let bufferStart = sentenceStart;
    let bufferEnd = sentenceEnd;

    const MAX_SNIPPET_TOKENS = Math.max(
      100,
      contextBefore + contextAfter + (matchEndPos - matchStartPos),
    );
    let snippetTokenCount = 0;
    for (let i = bufferStart; i < bufferEnd; i++) {
      if (isWordAt(doc, i)) snippetTokenCount++;
    }

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

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
