import path from 'path';

import type {
  DocumentExtractorInput,
  DocumentExtractorParserParams,
} from '../document-extractor.types.ts';
import {
  getBufferFromInput,
  getExtension,
} from '../document-extractor.utils.js';

class DocParser implements DocumentExtractorParserParams {
  private readonly supportedExtensions = ['.doc', '.dot'];
  // Add constants for better maintainability
  private static readonly FILE_INFO_BLOCK_SIZE = 4096;
  private static readonly MIN_VALID_WORD_LENGTH = 2;
  private static readonly MAX_FORMATTING_CODE_RATIO = 0.3;
  private static readonly CHUNK_SIZE = 1024;

  canHandle(input: DocumentExtractorInput): boolean {
    const ext = getExtension(input).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  async extractText(input: DocumentExtractorInput): Promise<string> {
    const sourceName =
      input.fileName ||
      (input.filePath ? path.basename(input.filePath) : 'buffer');
    try {
      const buffer = await getBufferFromInput(input, this.supportedExtensions);
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
              const str =
                encoding === 'win1251'
                  ? new TextDecoder('windows-1251').decode(chunk)
                  : chunk.toString(encoding);
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
        const str =
          encoding === 'win1251'
            ? new TextDecoder('windows-1251').decode(chunk)
            : chunk.toString(encoding);
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

export { DocParser };
