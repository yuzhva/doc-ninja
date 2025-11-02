import type { NameMatch } from "./name-matcher.mts";

interface ExtractedInfo {
  content: string | null;
  sectionTitle: string | null;
  reason: string | null;
  documentDate: string | null;
  actionDateContent: string | null;
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
    const paragraphStart = content.lastIndexOf("\n\n", match.position);
    let paragraphEnd = content.indexOf("\n\n", match.position);
    if (paragraphEnd === -1) {
      paragraphEnd = content.length;
    }

    const containingSectionText = content
      .substring(paragraphStart === -1 ? 0 : paragraphStart, paragraphEnd)
      .trim();

    // Find the nearest preceding numbered title (e.g., "1.", "1.2.", "1.2.3.")
    const contentBefore = content.substring(
      0,
      paragraphStart === -1 ? 0 : paragraphStart
    );
    const sectionTitle = this.findNearestTitle(
      contentBefore,
      containingSectionText
    );

    const paragraphContent = this.getParagraphContent(
      containingSectionText,
      match.declension
    );
    const actionDateContent = this.findActionDateContent(containingSectionText);
    const actionDate =
      this.findActionDate(actionDateContent || containingSectionText) ||
      (sectionTitle && this.findActionDate(sectionTitle));
    const reason = this.findReason(containingSectionText);

    return {
      content: paragraphContent,
      sectionTitle,
      reason,
      documentDate,
      actionDateContent,
      actionDate,
      context: containingSectionText,
    };
  }

  /**
   * Finds the nearest preceding numbered title from the content before a match.
   */
  private static findNearestTitle(
    contentBefore: string,
    currentSection: string
  ): string | null {
    const numberedListRegex = /^\d+(\.\d+)*\.\s+/;

    // If the current section itself starts with a number, it's the content, not a separate title.
    if (numberedListRegex.test(currentSection)) {
      return null;
    }

    const paragraphs = contentBefore.split("\n\n");
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

          if (lastNum.startsWith(currentNum + ".")) {
            // This is a parent of the last title found (e.g., '1.1.1' is a parent of '1.1.1.1').
            titleParts.push(paragraph);
            lastPrefix = currentPrefix;
          }
        }

        // Check if the current prefix is a top-level title (e.g., "5.").
        // If we've found a title and its prefix is top-level, we can stop.
        if (lastPrefix && /^\d+\.\s+/.test(lastPrefix)) {
          break;
        }
      }
    }

    if (titleParts.length > 0) {
      // The parts were added from most nested to least, so reverse them and join.
      return titleParts.reverse().join("\n\n");
    }

    return null;
  }

  /**
   * Extracts content from the paragraph by taking the first meaningful line.
   */
  private static getParagraphContent(
    sectionContent: string,
    matchDeclension: string
  ): string {
    // Helper to escape special characters for use in a regex.
    const escapeRegExp = (str: string) =>
      str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const escapedMatch = escapeRegExp(matchDeclension);
    // This regex finds a sentence containing the match.
    // A sentence starts at the beginning of the string or after a . or ;
    // and ends with a . or ; or the end of the string.
    const sentenceRegex = new RegExp(
      `(?:^|(?<=[.;]\\s*))([^.;]*?${escapedMatch}[^.;]*[.;]?)`,
      "i"
    );
    const match = sectionContent.match(sentenceRegex);

    if (match && match[1]) {
      // Return the captured sentence, cleaned up.
      return match[1].replace(/\s+/g, " ").trim();
    }

    // Fallback: if match not found, return the first non-empty line.
    const firstLine = sectionContent
      .split("\n")
      .find((line) => line.trim() !== "");
    return firstLine ? firstLine.replace(/^\d+\.?\s*/, "").trim() : "";
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
      січня: "01",
      лютого: "02",
      березня: "03",
      квітня: "04",
      травня: "05",
      червня: "06",
      липня: "07",
      серпня: "08",
      вересня: "09",
      жовтня: "10",
      листопада: "11",
      грудня: "12",
    };

    const parts = dateString.split(" ");
    if (parts.length !== 3) {
      return null;
    }

    const day = parts[0].padStart(2, "0");
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
    // Regex for a date pattern like "З 15 жовтня 2025"
    const actionDateRegex = /З\s+\d{1,2}\s+[а-яіїєґ]+\s+\d{4}/gi;
    const matches = [...sectionContent.matchAll(actionDateRegex)];

    if (matches.length > 0) {
      // Find the last match
      const lastMatch = matches[matches.length - 1];
      if (lastMatch.index !== undefined) {
        // Take the text from the last match to the end of the section
        let actionDateText = sectionContent.substring(lastMatch.index);
        const sentenceEndIndex = actionDateText.indexOf(".");
        if (sentenceEndIndex !== -1) {
          // NOTE: the {sentenceEndIndex + 1} is used to preserve the dot `.` at the end of the sentence
          actionDateText = actionDateText.substring(0, sentenceEndIndex + 1);
        }
        return actionDateText.replace(/\s+/g, " ").trim();
      }
    }

    return null;
  }

  /**
   * Finds the "Підстава" (reason) that applies to a name within a section.
   */
  private static findReason(sectionContent: string): string | null {
    const reasonKeyword = "Підстава:";
    const reasonIndex = sectionContent.lastIndexOf(reasonKeyword);

    if (reasonIndex !== -1) {
      // Take the text from "Підстава:" to the end of the section
      const reasonText = sectionContent.substring(reasonIndex);
      return reasonText.replace(/\s+/g, " ").trim();
    }

    return null;
  }
}

export { InformationExtractor };
export type { ExtractedInfo };
