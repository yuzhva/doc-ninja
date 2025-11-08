import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as zlib from 'zlib';

interface DocumentParser {
  canHandle(filePath: string): boolean;
  extractText(filePath: string): Promise<string>;
}

class TextParser implements DocumentParser {
  canHandle(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.txt';
  }

  async extractText(filePath: string): Promise<string> {
    return await promisify(fs.readFile)(filePath, 'utf8');
  }
}

class DocxParser implements DocumentParser {
  canHandle(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.docx';
  }

  async extractText(filePath: string): Promise<string> {
    try {
      const buffer = await promisify(fs.readFile)(filePath);
      return await this.parseDocxBuffer(buffer);
    } catch (error) {
      console.error(
        `DOCX extraction failed for ${path.basename(filePath)}:`,
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `Failed to extract text from DOCX: ${error instanceof Error ? error.message : 'File may be corrupted or password-protected'}`,
      );
    }
  }

  private async parseDocxBuffer(buffer: Buffer): Promise<string> {
    try {
      // DOCX is a ZIP file - we need to extract document.xml
      const zipEntries = this.parseZipFile(buffer);
      const documentXml = zipEntries.get('word/document.xml');

      if (!documentXml) {
        throw new Error('Invalid DOCX file: missing word/document.xml');
      }

      const xmlContent = documentXml.toString('utf8');
      const extractedText = this.extractTextFromDocumentXml(xmlContent);

      if (!extractedText || extractedText.trim().length === 0) {
        console.warn('No text content found in DOCX document');
        return '';
      }

      return extractedText;
    } catch (error) {
      throw new Error(
        `DOCX parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private parseZipFile(buffer: Buffer): Map<string, Buffer> {
    const entries = new Map<string, Buffer>();

    try {
      // Simple ZIP parser - find central directory
      const endOfCentralDir = this.findEndOfCentralDirectory(buffer);
      if (!endOfCentralDir) {
        throw new Error('Invalid ZIP file structure');
      }

      const centralDirOffset = buffer.readUInt32LE(endOfCentralDir + 16);
      const entryCount = buffer.readUInt16LE(endOfCentralDir + 10);

      // Parse central directory entries
      let centralOffset = centralDirOffset;
      for (let i = 0; i < entryCount; i++) {
        try {
          const entry = this.parseCentralDirectoryEntry(buffer, centralOffset);
          if (entry) {
            entries.set(entry.filename, entry.data);
            centralOffset = entry.nextOffset;
          } else {
            break; // Invalid entry, stop parsing
          }
        } catch (entryError) {
          console.warn(
            `Skipping corrupted ZIP entry ${i}:`,
            entryError instanceof Error
              ? entryError.message
              : String(entryError),
          );
          break;
        }
      }

      return entries;
    } catch (error) {
      throw new Error(
        `ZIP parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private findEndOfCentralDirectory(buffer: Buffer): number | null {
    // Search for End of Central Directory signature (0x06054b50) from the end
    for (let i = buffer.length - 22; i >= 0; i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) {
        return i;
      }
    }
    return null;
  }

  private parseCentralDirectoryEntry(buffer: Buffer, offset: number): any {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      return null; // Invalid central directory signature
    }

    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    const filename = buffer.toString(
      'utf8',
      offset + 46,
      offset + 46 + filenameLength,
    );

    // Read local file header to get actual file data
    const fileData = this.extractFileData(buffer, localHeaderOffset);

    return {
      filename,
      data: fileData,
      nextOffset:
        offset + 46 + filenameLength + extraFieldLength + commentLength,
    };
  }

  private extractFileData(buffer: Buffer, localHeaderOffset: number): Buffer {
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error('Invalid local file header');
    }

    const compressionMethod = buffer.readUInt16LE(localHeaderOffset + 8);
    const compressedSize = buffer.readUInt32LE(localHeaderOffset + 18);
    const filenameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);

    const dataOffset =
      localHeaderOffset + 30 + filenameLength + extraFieldLength;
    const compressedData = buffer.subarray(
      dataOffset,
      dataOffset + compressedSize,
    );

    // Decompress if needed
    if (compressionMethod === 8) {
      // DEFLATE
      return zlib.inflateRawSync(compressedData);
    } else if (compressionMethod === 0) {
      // No compression
      return compressedData;
    } else {
      throw new Error(`Unsupported compression method: ${compressionMethod}`);
    }
  }

  private extractTextFromDocumentXml(xmlContent: string): string {
    // Enhanced to preserve paragraph structure
    const paragraphTexts: string[] = [];

    // Find all paragraph elements
    const paragraphRegex = /<w:p[^>]*>.*?<\/w:p>/gs;
    const paragraphs = xmlContent.match(paragraphRegex) || [];

    paragraphs.forEach((paragraph) => {
      const paragraphTextParts: string[] = [];
      const textMatches = paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);

      for (const textMatch of textMatches) {
        if (textMatch[1] && textMatch[1].trim()) {
          const textContent = textMatch[1]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");

          paragraphTextParts.push(textContent.trim());
        }
      }

      if (paragraphTextParts.length > 0) {
        paragraphTexts.push(paragraphTextParts.join(' '));
      }
    });

    // JOIN WITH DOUBLE NEWLINES to preserve paragraph breaks
    return paragraphTexts.join('\n\n').trim();
  }
}

class DocParser implements DocumentParser {
  canHandle(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.doc';
  }

  async extractText(filePath: string): Promise<string> {
    try {
      const buffer = await promisify(fs.readFile)(filePath);
      const text = this.parseDocBinary(buffer);

      if (!text || text.trim().length === 0) {
        console.warn(
          `No readable text found in DOC file: ${path.basename(filePath)}`,
        );
        return '';
      }

      return text;
    } catch (error) {
      console.error(
        `DOC extraction failed for ${path.basename(filePath)}:`,
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `Failed to extract text from DOC: ${error instanceof Error ? error.message : 'File may be corrupted or use unsupported format'}`,
      );
    }
  }

  private parseDocBinary(buffer: Buffer): string {
    try {
      // DOC files use Microsoft Compound Document format
      if (!this.isValidDocFile(buffer)) {
        throw new Error('Invalid DOC file format');
      }

      // Try multiple extraction methods
      const methods = [
        () => this.extractFromWordDocument(buffer),
        () => this.extractTextStreams(buffer),
        () => this.extractReadableText(buffer),
      ];

      for (let i = 0; i < methods.length; i++) {
        try {
          const result = methods[i]();
          if (result && result.trim().length > 10) {
            return result;
          }
        } catch (methodError) {
          console.warn(
            `DOC extraction method ${i + 1} failed:`,
            methodError instanceof Error
              ? methodError.message
              : String(methodError),
          );
          // Continue to next method
        }
      }

      throw new Error(
        'Could not extract meaningful text from DOC file using any method',
      );
    } catch (error) {
      throw new Error(
        `DOC parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private isValidDocFile(buffer: Buffer): boolean {
    // Check for Compound Document signature
    if (buffer.length < 8) return false;
    const signature = buffer.subarray(0, 8);
    const expectedSignature = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    return signature.equals(expectedSignature);
  }

  private extractFromWordDocument(buffer: Buffer): string {
    const paragraphs: string[] = [];

    // Scan through the file in chunks looking for text patterns
    const chunkSize = 1024;
    for (let i = 0; i < buffer.length - chunkSize; i += chunkSize) {
      const chunk = buffer.subarray(i, i + chunkSize);
      const text = this.extractTextFromChunk(chunk);
      if (text) {
        // Split by natural paragraph indicators and preserve them
        const chunkParagraphs = text
          .split(/\n{2,}|\r\n{2,}/)
          .filter((p) => p.trim());
        paragraphs.push(...chunkParagraphs);
      }
    }

    // JOIN WITH DOUBLE NEWLINES to preserve paragraph structure
    return paragraphs
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private extractTextFromChunk(chunk: Buffer): string {
    // Convert chunk to string and look for both Ukrainian and English text
    let text = '';

    // Try different encodings
    const encodings = ['utf8', 'utf16le', 'win1251'];

    for (const encoding of encodings) {
      try {
        const decoded = chunk.toString(encoding as BufferEncoding);

        // Look for Ukrainian text
        const ukrainianMatches = decoded.match(
          /[а-яїієґА-ЯЇІЄҐ][а-яїієґА-ЯЇІЄҐ\s.,!?;:\-()]{5,}/g,
        );
        if (ukrainianMatches && ukrainianMatches.length > 0) {
          text += ukrainianMatches.join(' ') + ' ';
        }

        // Look for English text
        const englishMatches = decoded.match(
          /[a-zA-Z][a-zA-Z\s.,!?;:\-()]{5,}/g,
        );
        if (englishMatches && englishMatches.length > 0) {
          text += englishMatches.join(' ') + ' ';
        }
      } catch (error) {
        // Encoding failed, continue to next
      }
    }

    return text.trim();
  }

  private extractTextStreams(buffer: Buffer): string {
    const textParts: string[] = [];

    // Look for null-terminated strings
    let currentString = '';
    for (let i = 0; i < buffer.length - 1; i++) {
      const char = buffer[i];

      if (char >= 32 && char <= 126) {
        // ASCII printable
        currentString += String.fromCharCode(char);
      } else if (char >= 0x80) {
        // Potential Cyrillic
        // Try to decode as UTF-8 or Windows-1251
        const bytes = buffer.subarray(i, Math.min(i + 4, buffer.length));
        const decoded = this.tryDecodeText(bytes);
        if (decoded) {
          currentString += decoded;
          i += decoded.length - 1;
        }
      } else {
        // End of string
        if (currentString.length > 5 && this.isValidText(currentString)) {
          textParts.push(currentString.trim());
        }
        currentString = '';
      }
    }

    return textParts.join(' ').replace(/\s+/g, ' ').trim();
  }

  private tryDecodeText(bytes: Buffer): string | null {
    const encodings = ['utf8', 'win1251'];

    for (const encoding of encodings) {
      try {
        const decoded = bytes.toString(encoding as BufferEncoding);
        if (this.isValidText(decoded)) {
          return decoded;
        }
      } catch (error) {
        // Continue to next encoding
      }
    }

    return null;
  }

  private isValidText(text: string): boolean {
    // Check if text contains Ukrainian or English characters
    return /[а-яїієґa-z]/i.test(text);
  }

  private extractReadableText(buffer: Buffer): string {
    // Last resort: extract any readable text (Ukrainian or English)
    const words: string[] = [];

    // Try to extract text by looking for character patterns
    for (let i = 0; i < buffer.length - 10; i++) {
      const chunk = buffer.subarray(i, i + 100);

      // Try UTF-8 decoding
      try {
        const text = chunk.toString('utf8');

        // Extract Ukrainian words
        const ukrainianMatches = text.match(/[а-яїієґА-ЯЇІЄҐ]+/g);
        if (ukrainianMatches) {
          words.push(...ukrainianMatches.filter((word) => word.length > 2));
        }

        // Extract English words
        const englishMatches = text.match(/[a-zA-Z]+/g);
        if (englishMatches) {
          words.push(...englishMatches.filter((word) => word.length > 2));
        }
      } catch (error) {
        // Continue
      }

      // Try Windows-1251 decoding for Cyrillic
      try {
        const text = chunk.toString('binary');
        const cyrillicChars = text
          .split('')
          .map((char) => {
            const code = char.charCodeAt(0);
            if (code >= 0xc0 && code <= 0xff) {
              // Windows-1251 Cyrillic range
              return String.fromCharCode(code - 0xc0 + 0x0410);
            }
            return char;
          })
          .join('');

        const matches = cyrillicChars.match(/[а-яїієґА-ЯЇІЄҐ]+/g);
        if (matches) {
          words.push(...matches.filter((word) => word.length > 2));
        }
      } catch (error) {
        // Continue
      }
    }

    // Filter out garbage characters and keep only valid words
    const validWords = words.filter((word) => {
      // Remove words with too many non-letter characters
      const nonLetterCount = (word.match(/[^a-zA-Zа-яїієґА-ЯЇІЄҐ]/g) || [])
        .length;
      return nonLetterCount / word.length < 0.3; // Less than 30% non-letters
    });

    // Remove duplicates and join
    const uniqueWords = Array.from(new Set(validWords));
    return uniqueWords.join(' ');
  }
}

class DocumentExtractor {
  private parsers: DocumentParser[] = [
    new TextParser(),
    new DocxParser(),
    new DocParser(),
  ];

  async extractText(filePath: string): Promise<string> {
    try {
      const parser = this.parsers.find((p) => p.canHandle(filePath));

      if (!parser) {
        throw new Error(
          `No parser available for file extension: ${path.extname(filePath)}`,
        );
      }

      // Check if file exists and is readable
      try {
        await promisify(fs.access)(filePath, fs.constants.R_OK);
      } catch (accessError) {
        throw new Error(`File is not accessible: ${filePath}`);
      }

      const text = await parser.extractText(filePath);
      return text || ''; // Ensure we always return a string
    } catch (error) {
      console.error(
        `Text extraction failed for ${path.basename(filePath)}:`,
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `Document extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  getSupportedExtensions(): string[] {
    return ['.txt', '.doc', '.docx'];
  }

  addParser(parser: DocumentParser): void {
    this.parsers.push(parser);
  }
}

export { DocParser, DocumentExtractor, DocxParser, TextParser };

export type { DocumentParser };
