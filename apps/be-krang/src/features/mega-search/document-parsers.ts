import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as zlib from 'zlib';

export interface DocumentParser {
  canHandle(filePath: string): boolean;
  extractText(filePath: string): Promise<string>;
}

export class TextParser implements DocumentParser {
  canHandle(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.txt';
  }

  async extractText(filePath: string): Promise<string> {
    return await promisify(fs.readFile)(filePath, 'utf8');
  }
}

export class DocxParser implements DocumentParser {
  canHandle(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.docx';
  }

  async extractText(filePath: string): Promise<string> {
    try {
      const buffer = await promisify(fs.readFile)(filePath);
      return await this.parseDocxBuffer(buffer);
    } catch (error) {
      console.error(`Error extracting DOCX text from ${filePath}:`, error);
      throw new Error(`Failed to extract text from DOCX: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async parseDocxBuffer(buffer: Buffer): Promise<string> {
    // DOCX is a ZIP file - we need to extract document.xml
    const zipEntries = this.parseZipFile(buffer);
    const documentXml = zipEntries.get('word/document.xml');

    if (!documentXml) {
      throw new Error('Invalid DOCX file: missing word/document.xml');
    }

    const xmlContent = documentXml.toString('utf8');
    return this.extractTextFromDocumentXml(xmlContent);
  }

  private parseZipFile(buffer: Buffer): Map<string, Buffer> {
    const entries = new Map<string, Buffer>();

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
      const entry = this.parseCentralDirectoryEntry(buffer, centralOffset);
      if (entry) {
        entries.set(entry.filename, entry.data);
        centralOffset = entry.nextOffset;
      }
    }

    return entries;
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

    const filename = buffer.toString('utf8', offset + 46, offset + 46 + filenameLength);

    // Read local file header to get actual file data
    const fileData = this.extractFileData(buffer, localHeaderOffset);

    return {
      filename,
      data: fileData,
      nextOffset: offset + 46 + filenameLength + extraFieldLength + commentLength,
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

    const dataOffset = localHeaderOffset + 30 + filenameLength + extraFieldLength;
    const compressedData = buffer.subarray(dataOffset, dataOffset + compressedSize);

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
    // Better XML parser for extracting text from <w:t> elements
    const paragraphTexts: string[] = [];

    // Find all paragraph elements
    const paragraphRegex = /<w:p[^>]*>.*?<\/w:p>/gs;
    const paragraphs = xmlContent.match(paragraphRegex) || [];

    paragraphs.forEach(paragraph => {
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

    return paragraphTexts.join('\n').replace(/\s+/g, ' ').trim();
  }
}

export class DocParser implements DocumentParser {
  canHandle(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.doc';
  }

  async extractText(filePath: string): Promise<string> {
    try {
      const buffer = await promisify(fs.readFile)(filePath);
      return this.parseDocBinary(buffer);
    } catch (error) {
      console.error(`Error extracting DOC text from ${filePath}:`, error);
      throw new Error(`Failed to extract text from DOC: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private parseDocBinary(buffer: Buffer): string {
    // DOC files use Microsoft Compound Document format
    if (!this.isValidDocFile(buffer)) {
      throw new Error('Invalid DOC file format');
    }

    // Try multiple extraction methods
    const methods = [
      () => this.extractFromWordDocument(buffer),
      () => this.extractTextStreams(buffer),
      () => this.extractReadableText(buffer)
    ];

    for (const method of methods) {
      try {
        const result = method();
        if (result && result.length > 10) {
          return result;
        }
      } catch (error) {
        console.warn('DOC extraction method failed, trying next...', error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error('Could not extract meaningful text from DOC file');
  }

  private isValidDocFile(buffer: Buffer): boolean {
    // Check for Compound Document signature
    if (buffer.length < 8) return false;
    const signature = buffer.subarray(0, 8);
    const expectedSignature = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    return signature.equals(expectedSignature);
  }

  private extractFromWordDocument(buffer: Buffer): string {
    // Look for specific Word document structures
    const textChunks: string[] = [];

    // Scan through the file in chunks looking for text patterns
    const chunkSize = 1024;
    for (let i = 0; i < buffer.length - chunkSize; i += chunkSize) {
      const chunk = buffer.subarray(i, i + chunkSize);
      const text = this.extractTextFromChunk(chunk);
      if (text) {
        textChunks.push(text);
      }
    }

    return textChunks.join(' ').replace(/\s+/g, ' ').trim();
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
        const ukrainianMatches = decoded.match(/[а-яїієґА-ЯЇІЄҐ][а-яїієґА-ЯЇІЄҐ\s.,!?;:\-()]{5,}/g);
        if (ukrainianMatches && ukrainianMatches.length > 0) {
          text += ukrainianMatches.join(' ') + ' ';
        }

        // Look for English text
        const englishMatches = decoded.match(/[a-zA-Z][a-zA-Z\s.,!?;:\-()]{5,}/g);
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

      if (char >= 32 && char <= 126) { // ASCII printable
        currentString += String.fromCharCode(char);
      } else if (char >= 0x80) { // Potential Cyrillic
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
          words.push(...ukrainianMatches.filter(word => word.length > 2));
        }

        // Extract English words
        const englishMatches = text.match(/[a-zA-Z]+/g);
        if (englishMatches) {
          words.push(...englishMatches.filter(word => word.length > 2));
        }
      } catch (error) {
        // Continue
      }

      // Try Windows-1251 decoding for Cyrillic
      try {
        const text = chunk.toString('binary');
        const cyrillicChars = text.split('').map(char => {
          const code = char.charCodeAt(0);
          if (code >= 0xC0 && code <= 0xFF) {
            // Windows-1251 Cyrillic range
            return String.fromCharCode(code - 0xC0 + 0x0410);
          }
          return char;
        }).join('');

        const matches = cyrillicChars.match(/[а-яїієґА-ЯЇІЄҐ]+/g);
        if (matches) {
          words.push(...matches.filter(word => word.length > 2));
        }
      } catch (error) {
        // Continue
      }
    }

    // Filter out garbage characters and keep only valid words
    const validWords = words.filter(word => {
      // Remove words with too many non-letter characters
      const nonLetterCount = (word.match(/[^a-zA-Zа-яїієґА-ЯЇІЄҐ]/g) || []).length;
      return nonLetterCount / word.length < 0.3; // Less than 30% non-letters
    });

    // Remove duplicates and join
    const uniqueWords = Array.from(new Set(validWords));
    return uniqueWords.join(' ');
  }
}

export class DocumentExtractor {
  private parsers: DocumentParser[] = [
    new TextParser(),
    new DocxParser(),
    new DocParser()
  ];

  async extractText(filePath: string): Promise<string> {
    const parser = this.parsers.find(p => p.canHandle(filePath));

    if (!parser) {
      throw new Error(`No parser available for file: ${filePath}`);
    }

    return await parser.extractText(filePath);
  }

  getSupportedExtensions(): string[] {
    return ['.txt', '.doc', '.docx'];
  }

  addParser(parser: DocumentParser): void {
    this.parsers.push(parser);
  }
}
