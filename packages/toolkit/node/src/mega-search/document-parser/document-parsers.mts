import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as zlib from 'zlib';

import type { DocumentInput } from './document-parsers.utils.mjs';
import { getBufferFromInput, getExtension } from './document-parsers.utils.mjs';

interface DocumentParser {
  canHandle(input: DocumentInput): boolean;
  extractText(input: DocumentInput): Promise<string>;
}

class TextParser implements DocumentParser {
  canHandle(input: DocumentInput): boolean {
    return getExtension(input) === '.txt';
  }

  async extractText(input: DocumentInput): Promise<string> {
    const buffer = await getBufferFromInput(input);
    return buffer.toString('utf8');
  }
}

class DocxParser implements DocumentParser {
  canHandle(input: DocumentInput): boolean {
    return getExtension(input) === '.docx';
  }

  async extractText(input: DocumentInput): Promise<string> {
    const sourceName =
      input.fileName ||
      (input.filePath ? path.basename(input.filePath) : 'buffer');

    try {
      const buffer = await getBufferFromInput(input);
      return await this.parseDocxBuffer(buffer);
    } catch (error) {
      console.error(
        `DOCX extraction failed for ${sourceName}:`,
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
      if (endOfCentralDir === null) {
        throw new Error('Invalid ZIP file structure (EOCD not found)');
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
    // OPTIMIZATION: We limit scan to the last ~66KB. This avoids scanning the whole file
    // and reduces false positives from compressed data matching the signature.
    // Search for End of Central Directory signature (0x06054b50) from the end
    // The EOCD record is at least 22 bytes.
    // Comment length is the last 2 bytes. Max comment length is 65535.
    // So we scan the last 65535 + 22 bytes.
    const minEOCDLength = 22;
    const maxCommentLength = 65535;
    const scanStart = Math.max(
      0,
      buffer.length - minEOCDLength - maxCommentLength,
    );

    for (let i = buffer.length - minEOCDLength; i >= scanStart; i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) {
        return i;
      }
    }
    return null;
  }

  private parseCentralDirectoryEntry(buffer: Buffer, offset: number): any {
    if (offset + 46 > buffer.length) return null; // Out of bounds

    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      return null; // Invalid central directory signature
    }

    // Read compressed size from Central Directory (offset 20)
    // This is more reliable than Local Header which might be 0 if Data Descriptor is used
    const compressedSize = buffer.readUInt32LE(offset + 20);

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
    // Pass compressedSize from CD
    const fileData = this.extractFileData(
      buffer,
      localHeaderOffset,
      compressedSize,
    );

    return {
      filename,
      data: fileData,
      nextOffset:
        offset + 46 + filenameLength + extraFieldLength + commentLength,
    };
  }

  private extractFileData(
    buffer: Buffer,
    localHeaderOffset: number,
    compressedSize: number,
  ): Buffer {
    if (localHeaderOffset + 30 > buffer.length) {
      throw new Error('Local header offset out of bounds');
    }

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error('Invalid local file header');
    }

    const compressionMethod = buffer.readUInt16LE(localHeaderOffset + 8);
    // We ignore compressedSize from local header (offset 18) as it might be 0

    const filenameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);

    const dataOffset =
      localHeaderOffset + 30 + filenameLength + extraFieldLength;

    if (dataOffset + compressedSize > buffer.length) {
      throw new Error(
        `Compressed data out of bounds (Offset: ${dataOffset}, Size: ${compressedSize}, Buffer: ${buffer.length})`,
      );
    }

    const compressedData = buffer.subarray(
      dataOffset,
      dataOffset + compressedSize,
    );

    // Decompress if needed
    if (compressionMethod === 8) {
      // DEFLATE
      try {
        return zlib.inflateRawSync(compressedData);
      } catch (e) {
        throw new Error(
          `Decompression failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else if (compressionMethod === 0) {
      // No compression
      return compressedData;
    } else {
      throw new Error(`Unsupported compression method: ${compressionMethod}`);
    }
  }

  private extractTextFromDocumentXml(xmlContent: string): string {
    const paragraphs: string[] = [];

    // Split by paragraph tags to preserve structure
    // This is more robust than a global regex which might miss nested tags
    const pParts = xmlContent.split('<w:p');

    for (let i = 1; i < pParts.length; i++) {
      const part = pParts[i];
      const endP = part.indexOf('</w:p>');
      if (endP === -1) continue;

      const pContent = part.substring(0, endP);
      let pText = '';

      // We want to capture text (<w:t>), tabs (<w:tab/>), and breaks (<w:br/>, <w:cr/>)
      // We'll use a regex that finds these tags in order
      const tagRegex = /<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;

      const matches = pContent.matchAll(tagRegex);

      for (const match of matches) {
        const fullMatch = match[0];

        if (fullMatch.startsWith('<w:tab')) {
          pText += '\t';
        } else if (
          fullMatch.startsWith('<w:br') ||
          fullMatch.startsWith('<w:cr')
        ) {
          pText += '\n';
        } else if (match[1]) {
          // It's a w:t tag with content
          pText += match[1];
        }
      }

      // Decode HTML entities
      if (pText.length > 0) {
        pText = pText
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");

        paragraphs.push(pText);
      }
    }

    return paragraphs.join('\n\n').trim();
  }
}

class DocParser implements DocumentParser {
  // Add constants for better maintainability
  private static readonly FILE_INFO_BLOCK_SIZE = 4096;
  private static readonly MIN_VALID_WORD_LENGTH = 2;
  private static readonly MAX_FORMATTING_CODE_RATIO = 0.3;
  private static readonly CHUNK_SIZE = 1024;

  canHandle(input: DocumentInput): boolean {
    return getExtension(input) === '.doc';
  }

  async extractText(input: DocumentInput): Promise<string> {
    const sourceName =
      input.fileName ||
      (input.filePath ? path.basename(input.filePath) : 'buffer');
    try {
      const buffer = await getBufferFromInput(input);
      const text = this.parseDocBinary(buffer);

      if (!text || text.trim().length === 0) {
        console.warn(`No readable text found in DOC file: ${sourceName}`);
        return '';
      }

      return text;
    } catch (error) {
      console.error(
        `DOC extraction failed for ${sourceName}:`,
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `Failed to extract text from DOC: ${error instanceof Error ? error.message : 'File may be corrupted or use unsupported format'}`,
      );
    }
  }

  private parseDocBinary(buffer: Buffer): string {
    // Strategy: "Strings" extraction with encoding awareness.
    // Instead of trying to parse the complex binary structure (which leads to data loss),
    // we scan the entire file for contiguous blocks of valid characters in common encodings.
    // This ensures we get all text, even if some formatting is lost.

    // 1. Extract UTF-16LE strings (Standard Word content)
    const utf16 = this.extractStrings(buffer, 'utf16le');

    // 2. Extract Single-byte strings (Older Word content / Metadata / Fallback)
    // We try Windows-1251 (Cyrillic) as it covers ASCII as well.
    const win1251 = this.extractStrings(buffer, 'win1251');

    // Heuristic to choose the best result
    // UTF-16 is usually the main body in .doc files.
    // If we found a significant amount of UTF-16 text, prefer it.
    let text = win1251;
    if (utf16.length > win1251.length || utf16.length > 200) {
      text = utf16;
    }

    // ✅ FIX: Normalize line endings.
    // The binary extraction might capture \r (CR) characters which are valid in the file
    // but break downstream processing that expects \n (LF).
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    text = this.removeMetadata(text);
    return this.cleanStart(text);
  }

  private cleanStart(text: string): string {
    // Remove short garbage lines at the start (common in binary extractions)
    // We look for the first "meaningful" line (e.g. > 5 chars)
    const lines = text.split('\n');
    let startIndex = 0;

    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const line = lines[i].trim();
      // If line is very short and looks like garbage (unlikely to be a title)
      if (line.length > 0 && line.length < 5) {
        startIndex = i + 1;
      } else if (line.length >= 5) {
        // Found a substantial line, stop skipping
        break;
      }
    }

    if (startIndex > 0) {
      return lines.slice(startIndex).join('\n').trim();
    }
    return text;
  }

  private removeMetadata(text: string): string {
    // Common OLE markers and system strings that appear at the end of .doc files
    // We cut off the text when we encounter the OLE directory structure or Style definitions
    const markers = [
      'Root Entry',
      'WordDocument',
      'SummaryInformation',
      'DocumentSummaryInformation',
      'MsoDataStore',
      'CompObj',
      '1Table',
      '0Table',
      'ObjectPool',
      // Style definitions often start appearing here
      'PAGE   \\* MERGEFORMAT',
      'Normal',
      'Heading 1',
      'Default Paragraph Font',
      'Звичайний', // "Normal" in Ukrainian
      'Шрифт абзацу за замовчуванням', // "Default Paragraph Font" in Ukrainian
    ];

    let cutIndex = text.length;
    let foundMarker = false;

    for (const marker of markers) {
      const index = text.lastIndexOf(marker);
      if (index !== -1 && index < cutIndex) {
        // Only consider markers if they appear in the extracted text
        // We assume these system names don't appear in the user content
        // console.log(`[DocParser] Found end marker: "${marker}" at index ${index}`);
        cutIndex = index;
        foundMarker = true;
      }
    }

    if (foundMarker) {
      return text.substring(0, cutIndex).trim();
    }
    return text;
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

  private extractStrings(
    buffer: Buffer,
    encoding: 'utf16le' | 'win1251',
  ): string {
    const minLength = 3; // Minimum sequence length to be considered text
    const foundStrings: string[] = [];

    let start = -1;
    let currentLength = 0;
    const step = encoding === 'utf16le' ? 2 : 1;

    for (let i = 0; i <= buffer.length - step; i += step) {
      const isValid = this.isValidChar(buffer, i, encoding);

      if (isValid) {
        if (start === -1) start = i;
        currentLength++;
      } else {
        if (start !== -1) {
          // DEBUG: Uncomment to see what breaks the text flow
          // const brokenBy = buffer.subarray(i, i + step).toString('hex');
          // console.debug(`[DocParser] Sequence broken at offset ${i} by hex: ${brokenBy} (${encoding})`);

          if (currentLength >= minLength) {
            const chunk = buffer.subarray(start, start + currentLength * step);
            try {
              const str = chunk.toString(encoding);
              // Additional filter: must have at least one letter to be considered text
              // (avoids sequences of just punctuation or spaces)
              if (/[a-zA-Zа-яїієґА-ЯЇІЄҐ]/.test(str)) {
                foundStrings.push(str.trim());
              }
            } catch (e) {
              /* ignore */
            }
          }
        }
        start = -1;
        currentLength = 0;
      }
    }

    // Capture last chunk if exists
    if (start !== -1 && currentLength >= minLength) {
      const chunk = buffer.subarray(start, start + currentLength * step);
      try {
        const str = chunk.toString(encoding);
        if (/[a-zA-Zа-яїієґА-ЯЇІЄҐ]/.test(str)) {
          foundStrings.push(str.trim());
        }
      } catch (e) {
        /* ignore */
      }
    }

    return foundStrings.join('\n\n');
  }

  private isValidChar(
    buffer: Buffer,
    offset: number,
    encoding: 'utf16le' | 'win1251',
  ): boolean {
    if (encoding === 'utf16le') {
      const low = buffer[offset];
      const high = buffer[offset + 1];

      // ASCII range in UTF-16LE: low byte is char, high byte is 0
      if (high === 0) {
        return (
          (low >= 32 && low <= 126) || // ASCII Printable
          low === 9 ||
          low === 10 ||
          low === 13 || // Whitespace
          low >= 0xa0 // Latin-1 Supplement (includes «, », ©, etc.)
        );
      }

      // Cyrillic range (0x04)
      if (high === 0x04) return true;

      // General Punctuation (0x20) - includes smart quotes (’), dashes, currency (€)
      // Letterlike Symbols & Number Forms (0x21) - includes №
      // Mathematical Operators (0x22)
      if (high >= 0x20 && high <= 0x22) return true;

      return false;
    } else {
      // Windows-1251 / ASCII
      const byte = buffer[offset];

      // ASCII printable + whitespace
      if (
        (byte >= 32 && byte <= 126) ||
        byte === 9 ||
        byte === 10 ||
        byte === 13
      )
        return true;

      // Allow all upper range (0x80 - 0xFF)
      // This covers Cyrillic, smart quotes, dashes, number signs (№), etc.
      // While this might include some undefined chars, it ensures we don't break
      // text sequences on valid symbols like ’ or №.
      if (byte >= 0x80 && byte <= 0xff) return true;

      return false;
    }
  }
}

class DocumentExtractor {
  private parsers: DocumentParser[] = [
    new TextParser(),
    new DocxParser(),
    new DocParser(),
  ];

  async extractText(input: DocumentInput): Promise<string> {
    const sourceName =
      input.fileName ||
      (input.filePath ? path.basename(input.filePath) : 'buffer');

    try {
      const parser = this.parsers.find((p) => p.canHandle(input));

      if (!parser) {
        const ext = getExtension(input) || 'unknown';
        throw new Error(`No parser available for file extension: ${ext}`);
      }

      // Check if file exists and is readable ONLY if path is provided AND buffer is missing
      if (input.filePath && !input.fileBuffer) {
        try {
          await promisify(fs.access)(input.filePath, fs.constants.R_OK);
        } catch (accessError) {
          throw new Error(`File is not accessible: ${input.filePath}`);
        }
      }

      const text = await parser.extractText(input);
      return text || ''; // Ensure we always return a string
    } catch (error) {
      console.error(
        `Text extraction failed for ${sourceName}:`,
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

export type { DocumentInput, DocumentParser };
