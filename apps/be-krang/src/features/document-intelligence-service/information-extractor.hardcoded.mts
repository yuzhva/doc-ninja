import fs from 'fs/promises';

import type { SearchResult } from './index.mjs';

// Base type representing the search match context
type ExtractionInput = {
  searchQuery: string;
  foundInDocument: string;
  originalFilePath?: string; // Add filepath for uniqueness (optional on input but populated)
  matchedText: string;
  position?: number;
};

// Extended type with enriched information
type ExtractedInfo = ExtractionInput & {
  actionDate: string | null;
  documentNumber: string | null;
  summary: string | null;
};

type FindResult = {
  match: string | null;
  before: string;
  after: string;
};

class InformationExtractorHardcoded {
  /**
   * Finds the document date from the header.
   * Expects DD.MM.YYYY format usually found in the first few paragraphs.
   */
  private static findActionDate(content: string | null): FindResult {
    if (!content) {
      return { match: null, before: '', after: '' };
    }

    // Scan first 1000 characters to capture the header
    const headerContext = content.slice(0, 1000);

    // Find the first occurrence of DD.MM.YYYY
    // Example: "01.10.2025" or with whitespace/text around it
    const dateRegex = /(\d{2}\.\d{2}\.\d{4})/;
    const match = headerContext.match(dateRegex);

    if (match && typeof match.index === 'number') {
      const matchVal = match[1];
      const start = match.index;
      const end = start + match[0].length;
      return {
        match: matchVal,
        before: content.substring(0, start),
        after: content.substring(end),
      };
    }

    return { match: null, before: content, after: '' };
  }

  /**
   * Finds the document number from the header.
   * Expects format like "№280" or "№ 318".
   */
  private static findDocumentNumber(content: string | null): FindResult {
    if (!content) {
      return { match: null, before: '', after: '' };
    }

    // Scan first 1000 characters to capture the header
    const headerContext = content.slice(0, 1000);

    // Regex for "№" followed by non-whitespace chars
    // Example 1: №280
    // Example 2: №318
    const numberRegex = /(№\s*\S+)/;
    const match = headerContext.match(numberRegex);

    if (match && typeof match.index === 'number') {
      const matchVal = match[1];
      const start = match.index;
      const end = start + match[0].length;
      return {
        match: matchVal,
        before: content.substring(0, start),
        after: content.substring(end),
      };
    }

    return { match: null, before: content, after: '' };
  }

  /**
   * Helper to isolate the coarse paragraph block (text between double newlines)
   * and splits the content into before, block, and after segments.
   * IMPROVED: Handles paragraphs separated by newlines with optional whitespace (e.g. \n \t \n).
   */
  private static getParagraphBlock(
    fullContent: string,
    position: number,
  ): {
    block: string;
    before: string;
    after: string;
    blockStartIndex: number;
  } {
    if (!fullContent || position < 0) {
      return { block: '', before: '', after: '', blockStartIndex: 0 };
    }

    // Find Start: Scan backwards for \n followed possibly by whitespace then another \n
    let blockStartIndex = 0;
    // We check for the *end* of the separator (the \n that precedes our block)
    for (let i = position; i >= 0; i--) {
      // Look for the "second" newline of a pair \n...whitespace...\n
      if (fullContent[i] === '\n') {
        // Scan backwards to see if this is preceded by whitespace and another \n
        let j = i - 1;
        while (
          j >= 0 &&
          (fullContent[j] === ' ' ||
            fullContent[j] === '\t' ||
            fullContent[j] === '\r')
        ) {
          j--;
        }
        if (j >= 0 && fullContent[j] === '\n') {
          // Found separator. The block starts immediately after the newline at i
          blockStartIndex = i + 1;
          break;
        }
      }
    }

    // Find End: Scan forwards for \n followed possibly by whitespace then another \n
    let blockEndIndex = fullContent.length;
    for (let i = position; i < fullContent.length; i++) {
      // Look for the "first" newline of a pair \n...whitespace...\n
      if (fullContent[i] === '\n') {
        // Scan forwards to see if this is followed by whitespace and another \n
        let j = i + 1;
        while (
          j < fullContent.length &&
          (fullContent[j] === ' ' ||
            fullContent[j] === '\t' ||
            fullContent[j] === '\r')
        ) {
          j++;
        }
        if (j < fullContent.length && fullContent[j] === '\n') {
          // Found separator. The block ends at the newline at i
          blockEndIndex = i;
          break;
        }
      }
    }

    const before = fullContent.substring(0, blockStartIndex);
    const block = fullContent.substring(blockStartIndex, blockEndIndex);
    const after = fullContent.substring(blockEndIndex);

    return { block, before, after, blockStartIndex };
  }

  /**
   * Refines the paragraph block by splitting on numbered lists or semicolons
   * to isolate the specific item relevant to the match.
   * Returns partitioned content: the selected item, text before it, and text after it.
   */
  private static findParagraphContent(
    paragraphBlock: string,
    relativePosition: number,
  ): {
    match: string;
    before: string;
    after: string;
  } {
    const roughBlock = paragraphBlock;

    // Collect all candidate separators positions
    const splitPoints: number[] = [];

    // 1. Semicolons
    let pos = roughBlock.indexOf(';');
    while (pos !== -1) {
      splitPoints.push(pos + 1);
      pos = roughBlock.indexOf(';', pos + 1);
    }

    // 2. Numbered Items
    const numberRegex = /(?:^|\s)(\d+\.)\s/g;
    let matchedBlock;
    while ((matchedBlock = numberRegex.exec(roughBlock)) !== null) {
      const fullMatchStart = matchedBlock.index;
      const numberStart = roughBlock[fullMatchStart].match(/\s/)
        ? fullMatchStart + 1
        : fullMatchStart;
      splitPoints.push(numberStart);
    }

    // 3. Newlines (Implicit line-based items)
    // Treats the start of the line containing the match as the item start.
    // This handles compacted lists where items are separated only by newlines.
    let nlPos = roughBlock.indexOf('\n');
    while (nlPos !== -1) {
      // separator is the character *after* the newline
      splitPoints.push(nlPos + 1);
      nlPos = roughBlock.indexOf('\n', nlPos + 1);
    }

    splitPoints.push(0);
    splitPoints.sort((a, b) => a - b);

    // Find boundaries
    let refinedStart = 0;
    for (const idx of splitPoints) {
      if (idx <= relativePosition) {
        refinedStart = idx;
      } else {
        break;
      }
    }

    let refinedEnd = roughBlock.length;
    for (const idx of splitPoints) {
      if (idx > relativePosition) {
        refinedEnd = idx;
        break;
      }
    }

    if (refinedStart >= refinedEnd) {
      return { match: '', before: '', after: '' };
    }

    const selected = roughBlock.substring(refinedStart, refinedEnd);
    const before = roughBlock.substring(0, refinedStart);
    const after = roughBlock.substring(refinedEnd);

    // Normalize whitespace but preserve newlines to support regex anchors
    // 1. Collapse horizontal whitespace (space, tab) to single space
    // 2. Collapse vertical whitespace (newlines) to single newline, trimming around line breaks
    const cleanSelected = selected
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();

    return { match: cleanSelected, before, after };
  }

  /**
   * Finds the nearest preceding numbered title from the content before a match.
   * Scans backwards to find the hierarchical parents (e.g., 1. -> 1.1. -> Match).
   */
  private static findNearestTitle(
    contentBefore: string,
    currentSection: string,
  ): FindResult {
    // Regex for "1.", "1.1.", "2.3" at start of line
    // Also handles typos like "1.1.." (multiple dots at end)
    const numberedListRegex = /^\d+(\.\d+)*\.+\s+/;

    // 1. If the current section itself starts with a number, it's likely the title/item itself.
    if (numberedListRegex.test(currentSection)) {
      return { match: null, before: contentBefore, after: '' };
    }

    // Split by newlines (handling varied spacing)
    const lines = contentBefore.split(/\n+/);
    const titleParts: string[] = [];

    // Track the hierarchy levels of the last added title (e.g. [1, 2] for "1.2.")
    let lastLevelIds: number[] | null = null;

    // Iterate backwards
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;

      const match = line.match(numberedListRegex);

      if (match) {
        // Exclude numbered lines that look like "Reasons" or other metadata
        if (line.includes('Підстава:')) continue;

        // Extract the numbering string, removing ALL trailing dots
        // e.g. "1.2." -> "1.2", "1.2.." -> "1.2"
        const numberStr = match[0].trim().replace(/\.+$/, '');
        // Split into numeric levels: "1.2" -> [1, 2]
        const currentIds = numberStr.split('.').map(Number);

        if (lastLevelIds === null) {
          // Found the immediate parent
          titleParts.push(line);
          lastLevelIds = currentIds;
        } else {
          // Check hierarchy: is this a parent of the last found title?
          // A parent must have fewer levels (e.g. [1] is parent of [1, 2])
          // And the levels it has must match the child's levels exactly.
          if (currentIds.length < lastLevelIds.length) {
            const isParent = currentIds.every(
              (val, index) => val === lastLevelIds![index],
            );

            if (isParent) {
              titleParts.push(line);
              lastLevelIds = currentIds;
            }
          }
        }

        // Stop if we hit a top-level numbering (e.g. "1." -> length 1)
        if (lastLevelIds && lastLevelIds.length === 1) {
          break;
        }
      }
    }

    if (titleParts.length > 0) {
      return {
        match: titleParts.reverse().join('\n\n'),
        before: contentBefore, // Partitioning not implemented for composite titles
        after: '',
      };
    }

    return { match: null, before: contentBefore, after: '' };
  }

  /**
   * Finds the "Підстава" (reason) block and its position within a given text.
   * Returns partitioned result.
   */
  private static findReason(text: string): FindResult {
    const reasonKeyword = 'Підстава:';
    const reasonIndex = text.lastIndexOf(reasonKeyword);

    if (reasonIndex !== -1) {
      const reasonText = text
        .substring(reasonIndex)
        .replace(/\s+/g, ' ')
        .trim();
      return {
        match: reasonText,
        before: text.substring(0, reasonIndex),
        after: text.substring(reasonIndex + reasonText.length), // Usually empty if reason is at end
      };
    }

    return { match: null, before: text, after: '' };
  }

  /**
   * Finds the relevant action period/duration within a block of text.
   * Returns partitioned result.
   */
  private static findActionPeriod(sectionContent: string): FindResult {
    // Regex enforces:
    // 1. Start of line or string ((?:^|[\r\n]))
    // 2. Optional whitespace \s*
    // 3. Capital З (only) - removing 'i' flag
    // 4. Date pattern
    const actionDateRegex =
      /(?:^|[\r\n])\s*(З\s+\d{1,2}(?:\s+по\s+\d{1,2})?\s+[а-яА-ЯіїєґІЇЄҐ]+\s+\d{4})/g;

    // Find the last match in the section
    const matches = [...sectionContent.matchAll(actionDateRegex)];

    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      if (lastMatch.index !== undefined) {
        // lastMatch[1] contains the captured date string starting with 'З'
        const dateGroup = lastMatch[1];

        // Calculate where the 'З' actually starts within the full match to exclude leading newlines
        const matchRelativeOffset = lastMatch[0].lastIndexOf(dateGroup);
        const start = lastMatch.index + matchRelativeOffset;

        // Take text from match start to end of sentence or string
        let contentChunk = sectionContent.substring(start);
        const sentenceEnd = contentChunk.indexOf('.');
        const endRelative =
          sentenceEnd !== -1 ? sentenceEnd + 1 : contentChunk.length;

        const rawActionStr = contentChunk.substring(0, endRelative);
        const cleanActionStr = rawActionStr.replace(/\s+/g, ' ').trim();

        // Perform sanitization on the 'before' content here (destructive)
        const beforeRaw = sectionContent.substring(0, start).trim();
        const beforeClean = beforeRaw.replace(/[.,;]+$/, '');

        return {
          match: cleanActionStr,
          before: beforeClean,
          after: sectionContent.substring(start + endRelative),
        };
      }
    }

    // If no action period found, return the whole content as 'after'
    // so subsequent extractors (like findReason) can process it.
    return { match: null, before: '', after: sectionContent };
  }

  private static generateSummary(
    sectionTitle: string | null,
    content: string | null,
    actionPeriod: string | null,
    reason: string | null,
  ): string {
    const summaryParts: string[] = [];

    if (sectionTitle) summaryParts.push(sectionTitle);
    summaryParts.push('');
    if (content) summaryParts.push(content);
    if (actionPeriod) summaryParts.push(actionPeriod);
    if (reason) summaryParts.push(reason);

    return summaryParts.join('\n').trim();
  }

  /**
   * Core extraction logic for a single NameMatch.
   */
  static extract(content: string, match: ExtractionInput): ExtractedInfo {
    // Ensure position is available for extraction
    const position = match.position ?? 0;

    // 1. Identify Context (Paragraph Block)
    const {
      block: paragraphBlock,
      before: contentBefore,
      after: contentAfter,
      blockStartIndex,
    } = this.getParagraphBlock(content, position);

    // 2. Determine Action Date & Doc Number
    const actionDateRes = this.findActionDate(contentBefore);
    const actionDate = actionDateRes.match;

    const documentNumberRes = this.findDocumentNumber(contentBefore);
    const documentNumber = documentNumberRes.match;

    // 3. Isolate Specific Item (Raw)
    const relativePosition = position - blockStartIndex;
    const {
      match: paragraphCompleteContent,
      after: paragraphCompleteContentAfter,
    } = this.findParagraphContent(paragraphBlock, relativePosition);

    // console.log({ paragraphCompleteContent, paragraphCompleteContentAfter });

    const fullScope = [paragraphCompleteContent, paragraphCompleteContentAfter]
      .join('\n')
      .trim();

    // A. Find Reason (from the END of the full scope)
    const { match: reason, before: contentBeforeReason } =
      this.findReason(fullScope);
    // console.log({ contentBeforeReason, reason });

    // B. Find Action Period (from the END of what's before the reason)
    const { match: actionPeriod, before: contentBeforeActionPeriod } =
      this.findActionPeriod(contentBeforeReason);

    // C. The remainder is the sanitized item CONTENT.
    // However, we must be careful: `contentBeforeActionPeriod` might include text from
    // previous list items if we combined too much.
    // BUT! Since we started with `paragraphCompleteContent` (our item) and appended footers,
    // the "content before" should mostly be our item... unless our item was short and `findActionPeriod` matched something way earlier.

    // Safer approach for Sanitized Content:
    // Take the original `paragraphCompleteContent`.
    // Remove the found `reason` if it was inside it.
    // Remove the found `actionPeriod` if it was inside it.

    let sanitizedContent = paragraphCompleteContent;

    if (reason && sanitizedContent.includes(reason)) {
      sanitizedContent = sanitizedContent.replace(reason, '').trim();
    }

    if (actionPeriod && sanitizedContent.includes(actionPeriod)) {
      sanitizedContent = sanitizedContent.replace(actionPeriod, '').trim();
    }

    // console.log({ actionPeriod, sanitizedContent });

    // 6. Identify Section Title
    const sectionTitleRes = this.findNearestTitle(
      contentBefore,
      paragraphBlock,
    );
    const sectionTitle = sectionTitleRes.match;

    // 7. Generate Summary
    const summary = this.generateSummary(
      sectionTitle,
      sanitizedContent,
      actionPeriod,
      reason,
    );

    // Extract exact matched text from source if possible
    let matchedText = match.matchedText;

    return {
      ...match, // Inherit input fields
      actionDate,
      documentNumber,
      summary,
      matchedText,
    };
  }

  // Define getNextContextBlock helper again since we need it for context extension
  private static getNextContextBlock(contentAfter: string): string | null {
    // skip leading newlines/whitespace to find start of text
    const matchStart = contentAfter.search(/\S/);
    if (matchStart === -1) return null;

    const contentStart = contentAfter.substring(matchStart);
    let endIndex = contentStart.indexOf('\n\n');
    if (endIndex === -1) endIndex = contentStart.length;

    const cleanBlock = contentStart.substring(0, endIndex).trim();

    if (!cleanBlock) return null;

    // Heuristic: If the next block starts with a number (e.g. "34. "),
    // it is likely a new, separate list item, not a metadata extension for the current one.
    if (/^\d+\.\s/.test(cleanBlock)) {
      return null;
    }

    return cleanBlock;
  }

  static async extractSearchResults(
    searchResults: SearchResult[],
  ): Promise<ExtractedInfo[]> {
    const extractedResults: ExtractedInfo[] = [];
    const fileContentCache = new Map<string, string>();

    for (const searchResult of searchResults) {
      const searchMatches = searchResult.results;

      for (const searchMatch of searchMatches) {
        const docPath = searchMatch.doc.textFilePath;
        const docName = searchMatch.doc.fileName;
        // Use originalFilePath if available (likely passed from browser/indexer), fallback to textFilePath
        const originalFilePath =
          (searchMatch.doc as any).originalFilePath || docPath;

        try {
          let content = fileContentCache.get(docPath);
          if (!content) {
            content = await fs.readFile(docPath, 'utf-8');
            fileContentCache.set(docPath, content);
          }

          for (const matchedSnippet of searchMatch.snippets) {
            // Prepare initial object with search data
            const input: ExtractedInfo = {
              searchQuery: searchResult.query,
              foundInDocument: docName,
              originalFilePath, // Populate unique path
              matchedText: matchedSnippet.match || '',
              position: matchedSnippet.matchCharStart || 0,
              actionDate: null,
              documentNumber: null,
              summary: null,
            };

            const extractedResult = this.extract(content, input);
            extractedResults.push(extractedResult);
          }
        } catch (error) {
          console.error(`Failed to read file ${docPath}:`, error);
        }
      }
    }

    return extractedResults;
  }
}

export { InformationExtractorHardcoded };
export type { ExtractedInfo };
