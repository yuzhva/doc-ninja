import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import type { SearchResult } from '../features/document-intelligence-service/index.mjs';

type NameMatch = {
  searchQuery: string;
  foundInDocument: string;
  matchedText: string;
  position: number;
};

type ExtractedInfo = Pick<
  NameMatch,
  'searchQuery' | 'foundInDocument' | 'matchedText'
> & {
  content: string | null;
  sectionTitle: string | null;
  reason: string | null;
  documentDate: string | null;
  actionDateContent: string | null;
  actionDate: string | null;
  context: string | null;
  summary: string | null;
  status: string | null;
  commandType: string | null;
};

type StatusRule = {
  containsText: string[];
  status: string;
};

type CommandTypeRule = {
  containsText: string[];
  commandType: string;
};

class InformationExtractor {
  private static statusRules: StatusRule[] | null = null;
  private static commandTypeRules: CommandTypeRule[] | null = null;

  private static async loadRules(): Promise<void> {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));

    // Load Status Rules
    if (!this.statusRules) {
      try {
        const rulesPath = path.join(__dirname, 'status-rules.json');
        try {
          await fs.access(rulesPath);
          const content = await fs.readFile(rulesPath, 'utf-8');
          this.statusRules = JSON.parse(content);
        } catch (e) {
          this.statusRules = [];
        }
      } catch (e) {
        console.warn('Error initializing status rules:', e);
        this.statusRules = [];
      }
    }

    // Load Command Type Rules
    if (!this.commandTypeRules) {
      try {
        const rulesPath = path.join(__dirname, 'command-type-rules.json');
        try {
          await fs.access(rulesPath);
          const content = await fs.readFile(rulesPath, 'utf-8');
          this.commandTypeRules = JSON.parse(content);
        } catch (e) {
          this.commandTypeRules = [];
        }
      } catch (e) {
        console.warn('Error initializing command type rules:', e);
        this.commandTypeRules = [];
      }
    }
  }

  private static determineStatus(summary: string | null): string | null {
    if (!this.statusRules || !summary) return null;

    const lowerSummary = summary.toLowerCase();
    // Split once for performance
    const summaryWords = lowerSummary.split(/[\s,.;:!?()"]+/);

    for (const rule of this.statusRules) {
      // Check if all keywords in the rule are present in the summary
      if (
        rule.containsText.every((text) =>
          this.textContains(lowerSummary, summaryWords, text.toLowerCase()),
        )
      ) {
        return rule.status;
      }
    }

    return null;
  }

  private static determineCommandType(
    summary: string | null,
    status: string | null,
  ): string | null {
    // If status is present, command type is always "Зміна статусу"
    if (status) {
      return 'Зміна статусу';
    }

    if (!this.commandTypeRules || !summary) return null;

    const lowerSummary = summary.toLowerCase();
    // Split once for performance
    const summaryWords = lowerSummary.split(/[\s,.;:!?()"]+/);

    for (const rule of this.commandTypeRules) {
      if (
        rule.containsText.every((text) =>
          this.textContains(lowerSummary, summaryWords, text.toLowerCase()),
        )
      ) {
        return rule.commandType;
      }
    }

    return null;
  }

  /**
   * Checks if text contains keyword, with support for partial matches (declensions)
   */
  private static textContains(
    text: string,
    words: string[],
    keyword: string,
  ): boolean {
    // 1. Exact substring match (fastest)
    if (text.includes(keyword)) return true;

    // 2. Fuzzy match for declensions (e.g. "відпустку" vs "відпустці")
    // Check if any word in text starts with a significant portion of the keyword
    // Only for keywords longer than 4 chars to avoid false positives
    if (keyword.length <= 4) return false;

    const minMatch = Math.ceil(keyword.length * 0.75); // 75% match
    const keywordPrefix = keyword.substring(0, minMatch);

    return words.some((word) => word.startsWith(keywordPrefix));
  }

  private static generateSummary(
    sectionTitle: string | null,
    content: string | null,
    actionDateContent: string | null,
    reason: string | null,
  ): string {
    const summaryParts: string[] = [];

    if (sectionTitle) summaryParts.push(sectionTitle);
    summaryParts.push(''); // Add a blank line for separation
    if (content) summaryParts.push(content);
    if (actionDateContent) summaryParts.push(actionDateContent);
    if (reason) summaryParts.push(reason);

    return summaryParts.join('\n').trim();
  }

  /**
   * Extracts contextual information for a given name match within a document.
   */
  static extract(content: string, match: NameMatch): ExtractedInfo {
    const documentDate = this.findDocumentDate(content);

    // Find the start and end of the paragraph containing the match.
    // A paragraph is assumed to be separated by double newlines or start/end of the document.
    const paragraphStart = content.lastIndexOf('\n\n', match.position);
    let paragraphEnd = content.indexOf('\n\n', match.position);
    if (paragraphEnd === -1) {
      paragraphEnd = content.length;
    }

    const containingSectionText = content
      .substring(paragraphStart === -1 ? 0 : paragraphStart, paragraphEnd)
      .trim();

    // Find the nearest preceding numbered title (e.g., "1.", "1.2.", "1.2.3.")
    const contentBefore = content.substring(
      0,
      paragraphStart === -1 ? 0 : paragraphStart,
    );
    const sectionTitle = this.findNearestTitle(
      contentBefore,
      containingSectionText,
    );

    const paragraphContent = this.getParagraphContent(
      containingSectionText,
      match.matchedText,
    );
    const actionDateContent = this.findActionDateContent(containingSectionText);
    const reason = this.findReason(containingSectionText);

    // Priority of date extraction:
    // 1. Explicit action date in the text (e.g. "З 15 жовтня...") or general date in paragraph
    // 2. Date found in the section title (e.g. parent header)
    // 3. Date found in the "Reason" (Підстава) block
    // 4. Fallback: Date extracted from the filename
    const actionDate =
      // this.findActionDate(actionDateContent || containingSectionText) ||
      this.findActionDate(actionDateContent) ||
      (reason && this.findActionDate(reason)) ||
      // NOTE: in title / reason: there are dates of legal laws / acts are used, so it's better not to parse them
      // (sectionTitle && this.findActionDate(sectionTitle)) ||
      this.extractDateFromFilename(match.foundInDocument);

    // Generate summary and determine status
    const summary = this.generateSummary(
      sectionTitle,
      paragraphContent,
      actionDateContent,
      reason,
    );

    const status = this.determineStatus(summary);
    const commandType = this.determineCommandType(summary, status);

    return {
      searchQuery: match.searchQuery,
      foundInDocument: match.foundInDocument,
      matchedText: match.matchedText,
      content: paragraphContent,
      sectionTitle,
      reason,
      documentDate,
      actionDateContent,
      actionDate,
      context: containingSectionText,
      summary,
      status,
      commandType,
    };
  }

  static async extractSearchResults(
    searchResults: SearchResult[],
  ): Promise<ExtractedInfo[]> {
    // Ensure rules are loaded before processing
    await this.loadRules();

    const extractedResults: ExtractedInfo[] = [];

    // Cache file contents to avoid reading the same file multiple times for different snippets
    const fileContentCache = new Map<string, string>();

    for (const searchResult of searchResults) {
      const searchMatches = searchResult.results;

      for (const searchMatch of searchMatches) {
        const docPath = searchMatch.doc.textFilePath;
        const docName = searchMatch.doc.fileName;

        try {
          // OPTIMIZATION: Read file only once per document
          let content = fileContentCache.get(docPath);
          if (!content) {
            content = await fs.readFile(docPath, 'utf-8');
            fileContentCache.set(docPath, content);
          }

          // Process each snippet in this document
          for (const matchedSnippet of searchMatch.snippets) {
            // Create a proper NameMatch object for the extract method
            const nameMatch = {
              searchQuery: searchResult.query,
              foundInDocument: docName,
              matchedText: matchedSnippet.match || '',
              position: matchedSnippet.matchCharStart || 0,
            };

            const extractedResult = this.extract(content, nameMatch);

            extractedResults.push(extractedResult);
          }
        } catch (error) {
          console.error(`Failed to read file ${docPath}:`, error);
          // Continue processing other files
        }
      }
    }

    return extractedResults;
  }

  /**
   * Finds the nearest preceding numbered title from the content before a match.
   */
  private static findNearestTitle(
    contentBefore: string,
    currentSection: string,
  ): string | null {
    const numberedListRegex = /^\d+(\.\d+)*\.\s+/;

    // If the current section itself starts with a number, it's the content, not a separate title.
    if (numberedListRegex.test(currentSection)) {
      return null;
    }

    const paragraphs = contentBefore.split('\n\n');
    const titleParts: string[] = [];
    let lastPrefix: string | null = null;

    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const paragraph = paragraphs[i].trim();
      const match = paragraph.match(numberedListRegex);

      if (match) {
        // If a paragraph is numbered, check if it contains a reason. If so, it's not a title.
        if (this.findReason(paragraph)) {
          continue;
        }

        const currentPrefix = match[0];

        if (lastPrefix === null) {
          // This is the first title found when searching backwards, so it's the most direct ancestor.
          titleParts.push(paragraph);
          lastPrefix = currentPrefix;
        } else {
          // Compare the numeric parts to determine hierarchy
          const lastNum = lastPrefix.trim().slice(0, -1); // "1.1.1.1." -> "1.1.1.1"
          const currentNum = currentPrefix.trim().slice(0, -1); // "1.1.1." -> "1.1.1"

          if (lastNum.startsWith(currentNum + '.')) {
            // This is a parent of the last title found (e.g., '1.1.1' is a parent of '1.1.1.1').
            titleParts.push(paragraph);
            lastPrefix = currentPrefix;
          }
        }

        // Check if the current prefix is top-level title (e.g., "5.").
        // If we've found a title and its prefix is top-level, we can stop.
        if (lastPrefix && /^\d+\.\s+/.test(lastPrefix)) {
          break;
        }
      }
    }

    if (titleParts.length > 0) {
      // The parts were added from most nested to least, so reverse them and join.
      return titleParts.reverse().join('\n\n');
    }

    return null;
  }

  /**
   * Extracts content from the paragraph by taking the first meaningful line.
   */
  private static getParagraphContent(
    sectionContent: string,
    matchDeclension: string,
  ): string {
    // Helper to escape special characters for use in a regex.
    const escapeRegExp = (str: string) =>
      str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const escapedMatch = escapeRegExp(matchDeclension);
    // This regex finds a sentence containing the match.
    // A sentence starts at the beginning of the string or after a . or ;
    // and ends with a . or ; or the end of the string.
    const sentenceRegex = new RegExp(
      `(?:^|(?<=[.;]\\s*))([^.;]*?${escapedMatch}[^.;]*[.;]?)`,
      'i',
    );
    const match = sectionContent.match(sentenceRegex);

    if (match && match[1]) {
      // Return the captured sentence, cleaned up.
      return match[1].replace(/\s+/g, ' ').trim();
    }

    // Fallback: if match not found, return the first non-empty line.
    const firstLine = sectionContent
      .split('\n')
      .find((line) => line.trim() !== '');
    return firstLine ? firstLine.replace(/^\d+\.?\s*/, '').trim() : '';
  }

  /**
   * Finds the document's main date, usually in the header.
   */
  private static findDocumentDate(content: string): string | null {
    // Regex for DD.MM.YYYY format
    const dateRegex = /(\d{2}\.\d{2}\.\d{4})/;
    const header = content.substring(0, 200); // Search in the header
    const match = header.match(dateRegex);
    return match ? match[1] : null;
  }

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

    const parts = dateString.split(' ');
    if (parts.length !== 3) {
      return null;
    }

    const day = parts[0].padStart(2, '0');
    const month = monthMap[parts[1].toLowerCase()];
    const year = parts[2];

    if (!month) {
      return null;
    }

    return `${day}.${month}.${year}`;
  }

  private static findActionDate(content: string | null): string | null {
    if (!content) {
      return null;
    }

    // Check for range pattern first: "З 15 по 24 жовтня 2025"
    // We want the start date (15), using the month and year from the end.
    const rangeRegex = /З\s+(\d{1,2})\s+по\s+\d{1,2}\s+([а-яіїєґ]+)\s+(\d{4})/i;
    const rangeMatch = content.match(rangeRegex);

    if (rangeMatch) {
      const day = rangeMatch[1];
      const month = rangeMatch[2];
      const year = rangeMatch[3];
      return this.convertUkrainianDateToDMY(`${day} ${month} ${year}`);
    }

    const dateRegex = /(\d{1,2}\s+[а-яіїєґ]+\s+\d{4})/;
    const match = content.match(dateRegex);

    if (match) {
      return this.convertUkrainianDateToDMY(match[1]);
    }

    return null;
  }

  /**
   * Finds the relevant action date within a block of text.
   */
  private static findActionDateContent(sectionContent: string): string | null {
    // Regex for a date pattern like "З 15 жовтня 2025" or "З 15 по 24 жовтня 2025"
    const actionDateRegex =
      /З\s+\d{1,2}(?:\s+по\s+\d{1,2})?\s+[а-яіїєґ]+\s+\d{4}/gi;
    const matches = [...sectionContent.matchAll(actionDateRegex)];

    if (matches.length > 0) {
      // Find the last match
      const lastMatch = matches[matches.length - 1];
      if (lastMatch.index !== undefined) {
        // Take the text from the last match to the end of the section
        let actionDateText = sectionContent.substring(lastMatch.index);
        const sentenceEndIndex = actionDateText.indexOf('.');
        if (sentenceEndIndex !== -1) {
          // NOTE: the {sentenceEndIndex + 1} is used to preserve the dot `.` at the end of the sentence
          actionDateText = actionDateText.substring(0, sentenceEndIndex + 1);
        }
        return actionDateText.replace(/\s+/g, ' ').trim();
      }
    }

    return null;
  }

  /**
   * Extracts date from filename (e.g. "Order_12.05.2023.doc" -> "12.05.2023")
   */
  private static extractDateFromFilename(filename: string): string | null {
    // Matches DD.MM.YYYY or DD-MM-YYYY or DD.MM.YY
    const dateRegex = /(?:^|\D)(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\D|$)/;
    const match = filename.match(dateRegex);

    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      let year = match[3];

      // Handle 2-digit years
      if (year.length === 2) {
        const yearNum = parseInt(year, 10);
        year = (yearNum < 50 ? 2000 + yearNum : 1900 + yearNum).toString();
      }

      return `${day}.${month}.${year}`;
    }
    return null;
  }

  /**
   * Finds the "Підстава" (reason) that applies to a name within a section.
   */
  private static findReason(sectionContent: string): string | null {
    const reasonKeyword = 'Підстава:';
    const reasonIndex = sectionContent.lastIndexOf(reasonKeyword);

    if (reasonIndex !== -1) {
      // Take the text from "Підстава:" to the end of the section
      const reasonText = sectionContent.substring(reasonIndex);
      return reasonText.replace(/\s+/g, ' ').trim();
    }

    return null;
  }
}

export { InformationExtractor };
export type { ExtractedInfo };
