/**
 * Preprocesses text for better NLP analysis while preserving structure
 */
class TextPreprocessor {
  /**
   * Clean and structure text for NLP processing
   */
  static preprocessForNLP(text: string): {
    cleanText: string;
    sentences: string[];
    paragraphs: string[];
    metadata: {
      characterCount: number;
      wordCount: number;
      sentenceCount: number;
      paragraphCount: number;
    };
  } {
    // Clean the text while preserving structure
    const cleanText = text
      .replace(/[^\u0000-\u007F\u0080-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF\u0400-\u04FF]/g, ' ') // Keep Latin, Cyrillic
      .replace(/\s+/g, ' ')                    // Normalize whitespace
      .replace(/\n\s*\n/g, '\n\n')            // Keep paragraph breaks
      .trim();

    // Split into paragraphs (double newlines)
    const paragraphs = cleanText
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    // Split into sentences (more sophisticated sentence boundary detection)
    const sentences = cleanText
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => s.replace(/\n/g, ' ')); // Remove internal newlines from sentences

    // Calculate metadata
    const wordCount = cleanText.split(/\s+/).filter(w => w.length > 0).length;

    return {
      cleanText,
      sentences,
      paragraphs,
      metadata: {
        characterCount: cleanText.length,
        wordCount,
        sentenceCount: sentences.length,
        paragraphCount: paragraphs.length
      }
    };
  }

  /**
   * Extract potential document sections for better context
   */
  static extractSections(text: string): {
    title?: string;
    sections: Array<{
      title: string;
      content: string;
      startPosition: number;
    }>;
  } {
    const sections: Array<{title: string; content: string; startPosition: number}> = [];

    // Look for section headers (headings or numbered sections)
    const sectionPattern = /^(===\s*HEADING\s*\d+\s*===|(\d+\.?\s*[А-ЯІЇЄҐ][а-яіїєґ\s]+)|([А-ЯІЇЄҐ][А-ЯІЇЄҐ\s]{2,}))\s*$/gm;

    let match;
    let lastIndex = 0;
    let currentSection = '';

    while ((match = sectionPattern.exec(text)) !== null) {
      // Add previous section if exists
      if (lastIndex > 0) {
        const content = text.substring(lastIndex, match.index).trim();
        if (content.length > 0) {
          sections.push({
            title: currentSection,
            content,
            startPosition: lastIndex
          });
        }
      }

      currentSection = match[1] || match[2] || match[3] || '';
      lastIndex = match.index + match[0].length;
    }

    // Add final section
    if (lastIndex < text.length) {
      const content = text.substring(lastIndex).trim();
      if (content.length > 0) {
        sections.push({
          title: currentSection || 'Content',
          content,
          startPosition: lastIndex
        });
      }
    }

    // Try to extract title (first heading or first line if short)
    const firstLine = text.split('\n')[0]?.trim();
    const title = firstLine && firstLine.length < 100 ? firstLine : undefined;

    return { title, sections };
  }
}

export { TextPreprocessor };
