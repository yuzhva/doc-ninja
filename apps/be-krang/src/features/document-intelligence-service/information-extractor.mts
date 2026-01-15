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

class InformationExtractor {
  private static convertUkrainianDateToDMY(dateString: string): string | null {
    const monthMap: { [key: string]: string } = {
      січня: '01',
      лютого: '02',
      березня: '03',
      квітня: '04',
      травня: '05',
      червня: '06',
      липня: '07',
      серпня: '08',
      вересня: '09',
      жовтня: '10',
      листопада: '11',
      грудня: '12',
    };

    // Clean up content: replace non-breaking spaces, multiple spaces
    const cleanDate = dateString.replace(/\s+/g, ' ').trim();
    const parts = cleanDate.split(' ');

    if (parts.length !== 3) {
      return null;
    }

    const day = parts[0].padStart(2, '0');
    // Provide safe access to avoid runtime error if month is not in map
    const monthRaw = parts[1]?.toLowerCase();
    const month = monthMap[monthRaw];
    const year = parts[2];

    if (!month) {
      return null;
    }

    return `${day}.${month}.${year}`;
  }

  /**
   * Finds the document date from the header.
   * Expects DD.MM.YYYY format usually found in the first few paragraphs.
   */
  private static findActionDate(content: string | null): string | null {
    if (!content) {
      return null;
    }

    // Scan first 1000 characters to capture the header
    const headerContext = content.slice(0, 1000);

    // Find the first occurrence of DD.MM.YYYY
    // Example: "01.10.2025" or with whitespace/text around it
    const dateRegex = /(\d{2}\.\d{2}\.\d{4})/;
    const match = headerContext.match(dateRegex);

    return match ? match[1] : null;
  }

  /**
   * Finds the document number from the header.
   * Expects format like "№280" or "№ 318".
   */
  private static findDocumentNumber(content: string | null): string | null {
    if (!content) {
      return null;
    }

    // Scan first 1000 characters to capture the header
    const headerContext = content.slice(0, 1000);

    // Regex for "№" followed by non-whitespace chars
    // Example 1: №280
    // Example 2: №318
    const numberRegex = /(№\s*\S+)/;
    const match = headerContext.match(numberRegex);

    return match ? match[1] : null;
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
   * Retrieves the immediate next block of text from 'contentAfter' to be used as context.
   * Useful when metadata (Reason, Date) is separated from the list item by a newline.
   * Returns null if the next block appears to be a separate numbered item.
   */
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

  /**
   * Refines the paragraph block by splitting on numbered lists or semicolons
   * to isolate the specific item relevant to the match.
   * Returns partitioned content: the selected item, text before it, and text after it.
   */
  private static getParagraphContent(
    paragraphBlock: string,
    relativePosition: number,
  ): {
    selected: string;
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
    let match;
    while ((match = numberRegex.exec(roughBlock)) !== null) {
      const fullMatchStart = match.index;
      const numberStart = roughBlock[fullMatchStart].match(/\s/)
        ? fullMatchStart + 1
        : fullMatchStart;
      splitPoints.push(numberStart);
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
      return { selected: '', before: '', after: '' };
    }

    const selected = roughBlock.substring(refinedStart, refinedEnd);
    const before = roughBlock.substring(0, refinedStart);
    const after = roughBlock.substring(refinedEnd);

    // Normalize whitespace in the selected part
    const cleanSelected = selected.replace(/\s+/g, ' ').trim();

    return { selected: cleanSelected, before, after };
  }

  /**
   * Finds the nearest preceding numbered title from the content before a match.
   * Scans backwards to find the hierarchical parents (e.g., 1. -> 1.1. -> Match).
   */
  private static findNearestTitle(
    contentBefore: string,
    currentSection: string,
  ): string | null {
    // Regex for "1.", "1.1.", "2.3" at start of line
    // Also handles typos like "1.1.." (multiple dots at end)
    const numberedListRegex = /^\d+(\.\d+)*\.+\s+/;

    // 1. If the current section itself starts with a number, it's likely the title/item itself.
    if (numberedListRegex.test(currentSection)) {
      return null;
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
      return titleParts.reverse().join('\n\n');
    }

    return null;
  }

  /**
   * Finds the "Підстава" (reason) block and its position within a given text.
   * Returns partitioned result.
   */
  private static findReason(text: string): {
    match: string | null;
    before: string;
    after: string;
  } {
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
  private static findActionPeriod(sectionContent: string): {
    match: string | null;
    before: string;
    after: string;
  } {
    const actionDateRegex =
      /З\s+\d{1,2}(?:\s+по\s+\d{1,2})?\s+[а-яіїєґ]+\s+\d{4}/gi;
    // Find the last match in the section
    const matches = [...sectionContent.matchAll(actionDateRegex)];

    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      if (lastMatch.index !== undefined) {
        const start = lastMatch.index;
        // Take text from match start to end of sentence or string
        let contentChunk = sectionContent.substring(start);
        const sentenceEnd = contentChunk.indexOf('.');
        const endRelative =
          sentenceEnd !== -1 ? sentenceEnd + 1 : contentChunk.length;

        const rawActionStr = contentChunk.substring(0, endRelative);
        const cleanActionStr = rawActionStr.replace(/\s+/g, ' ').trim();

        return {
          match: cleanActionStr,
          before: sectionContent.substring(0, start),
          after: sectionContent.substring(start + endRelative),
        };
      }
    }

    return { match: null, before: sectionContent, after: '' };
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
    const actionDate = this.findActionDate(contentBefore);
    const documentNumber = this.findDocumentNumber(contentBefore);

    // 3. Isolate Specific Item
    const relativePosition = position - blockStartIndex;
    const itemSplit = this.getParagraphContent(
      paragraphBlock,
      relativePosition,
    );
    let refinedContent = itemSplit.selected;

    // 4. Extract Metadata
    // Strategy: Look in 'item.after' first (safest), then 'nextContextBlock'.
    // Finally check 'item.selected' (inline metadata) and strip if found.

    const contextForSearch = [
      itemSplit.after,
      this.getNextContextBlock(contentAfter) ?? '',
    ].join('\n');

    // -- Action Period --
    let actionPeriodRes = this.findActionPeriod(contextForSearch);
    if (!actionPeriodRes.match) {
      // Fallback: Check inline
      const inlineRes = this.findActionPeriod(refinedContent);
      if (inlineRes.match) {
        actionPeriodRes = inlineRes;
        // Can optionally strip action period from content, but usually better to keep context
      }
    }
    const actionPeriod = actionPeriodRes.match;

    // -- Reason --
    let reasonRes = this.findReason(contextForSearch);
    if (!reasonRes.match) {
      // Fallback: Check inline
      const inlineRes = this.findReason(refinedContent);
      if (inlineRes.match) {
        reasonRes = inlineRes;
        // Strip inline reason from content to avoid duplication in summary
        refinedContent = inlineRes.before.replace(/\s+/g, ' ').trim();
      }
    }
    const reason = reasonRes.match;

    // 5. Identify Section Title
    const sectionTitle = this.findNearestTitle(contentBefore, paragraphBlock);

    // 6. Generate Summary
    const summary = this.generateSummary(
      sectionTitle,
      refinedContent,
      actionPeriod,
      reason,
    );

    // Extract exact matched text from source if possible
    let matchedText = match.matchedText;
    if (typeof position === 'number' && position >= 0 && match.matchedText) {
      const length = match.matchedText.length;
      if (position + length <= content.length) {
        matchedText = content.substring(position, position + length);
      }
    }

    return {
      ...match, // Inherit input fields
      matchedText, // Update with exact text from content if found
      actionDate,
      documentNumber,
      summary,
    };
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

export { InformationExtractor };
export type { ExtractedInfo };
