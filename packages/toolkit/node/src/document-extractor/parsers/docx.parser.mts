import path from 'path';
import zlib from 'zlib';

import type {
  DocumentExtractorInput,
  DocumentExtractorParserParams,
} from '../document-extractor.types.ts';
import {
  getBufferFromInput,
  getExtension,
} from '../document-extractor.utils.js';

class DocxParser implements DocumentExtractorParserParams {
  private readonly supportedExtensions = ['.docx', '.docm', '.dotx', '.dotm'];

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

export { DocxParser };
