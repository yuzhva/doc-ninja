import type { NameMatch } from './name-matcher.mts';

interface ExtractedInfo {
  content: string | null;
  sectionTitle: string | null;
  reason: string | null;
  documentDate: string | null;
  actionDate: string | null;
  context: string | null;
}

class InformationExtractor {
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

    const containingSectionText = content.substring(paragraphStart === -1 ? 0 : paragraphStart, paragraphEnd).trim();

    // Find the nearest preceding numbered title (e.g., "1.", "1.2.", "1.2.3.")
    const contentBefore = content.substring(0, paragraphStart === -1 ? 0 : paragraphStart);
    const sectionTitle = this.findNearestTitle(contentBefore);

    const actionDate = this.findActionDate(containingSectionText);
    const reason = this.findReason(containingSectionText);
    const paragraphContent = this.getParagraphContent(containingSectionText);

    return {
      content: paragraphContent,
      sectionTitle,
      reason,
      documentDate,
      actionDate,
      context: containingSectionText,
    };
  }

  /**
   * Finds the nearest preceding numbered title from the content before a match.
   */
  private static findNearestTitle(contentBefore: string): string | null {
    // Regex for numbered headings like "1.", "1.1.", "1.1.1.1." that start on a new line
    const titleRegex = /^\d+(\.\d+)*\..*$/gm;
    const titles = [...contentBefore.matchAll(titleRegex)];

    if (titles.length > 0) {
      // The last match is the nearest preceding one
      return titles[titles.length - 1][0].trim();
    }

    return null;
  }

  /**
   * Extracts content from the paragraph by taking the first meaningful line.
   */
  private static getParagraphContent(sectionContent: string): string | null {
    const lines = sectionContent.split('\n');
    if (lines.length > 0) {
      // Find the first non-empty line
      const firstLine = lines.find((line) => line.trim() !== '');
      if (firstLine) {
        // Clean up and return the first line as the content
        return firstLine.replace(/^\d+\.?\s*/, '').trim();
      }
    }
    return 'Content';
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

  /**
   * Finds the relevant action date within a block of text.
   */
  /*private static findActionDate(sectionContent: string): string | null {
    const dateRangeRegex =
      /з\s+(\d{1,2}(?:\s+[а-яіїєґ]+)?)\s+по\s+(\d{1,2}\s+[а-яіїєґ]+\s+\d{4})/i;
    const singleDateRegex = /з\s+(\d{1,2}\s+[а-яіїєґ]+\s+\d{4})/i;

    let match = sectionContent.match(dateRangeRegex);
    if (match) {
      return `з ${match[1]} по ${match[2]}`;
    }

    match = sectionContent.match(singleDateRegex);
    if (match) {
      return `з ${match[1]}`;
    }

    return null;
  }
  */
  /*
  private static findActionDate(sectionContent: string): string | null {
    // Regex to find a sentence containing a date like "01 жовтня 2025 року" or "01 жовтня 2025 р."
    // "(року|р\.)?" makes "року" or "р." optional.
    const sentenceWithDateRegex = /([^\n\.]*?\d{1,2}\s+[а-яіїєґ]+\s+\d{4}(?:\s*(?:року|р\.))?[^\n\.]*[\.\n])/i;
    const match = sectionContent.match(sentenceWithDateRegex);
    return match ? match[1].replace(/\s+/g, ' ').trim() : null;
  }
  */
  private static findActionDate(sectionContent: string): string | null {
    // Regex to find a sentence containing a date like "01 жовтня 2025 року"
    // It looks for a sentence (ending with a period or newline) that contains the date pattern.
    const sentenceWithDateRegex = /([^\n\.]*?\d{1,2}\s+[а-яіїєґ]+\s+\d{4}\s*року[^\n\.]*[\.\n])/i;
    const match = sectionContent.match(sentenceWithDateRegex);
    
    // Return the full sentence, cleaned up.
    return match ? match[1].replace(/\s+/g, ' ').trim() : null;
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
